import { migrateVault, type VaultData } from '../../src/domain';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  SESSION_ENCRYPTION_KEY?: string;
  GITHUB_ALLOWED_LOGIN?: string;
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  GITHUB_REPO_BRANCH?: string;
}

const COOKIE = 'collect_everything_session';
const SNAPSHOT_PATH = 'current/collect-everything.v2.json';
// The vault may include thousands of catalog entries with image source URLs.
// Keep a hard bound while leaving room for the English Union Arena catalog.
const MAX_SNAPSHOT_BYTES = 16_000_000;
const API_VERSION = '2022-11-28';

type AuthSession = { login: string; accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number };
type RepositoryHead = { exists: boolean; revision: string | null; commitSha: string; treeSha: string };
type Canonical = RepositoryHead & { rawData: string | null; updatedAt: string | null };
type TokenResponse = { access_token: string; refresh_token: string; expires_in?: number; refresh_token_expires_in?: number };

class ServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = 'ServiceError'; }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, configured: isConfigured(env) });
      const protectedRoutes = ['/api/auth/device/start', '/api/auth/device/poll', '/api/auth/sign-out', '/api/session', '/api/data'];
      if (protectedRoutes.includes(url.pathname) && !isConfigured(env)) return json({ error: 'sync_not_configured', message: 'Private sync needs its GitHub App and encrypted session secrets configured on the Worker.' }, 503);
      if (url.pathname === '/api/auth/device/start' && request.method === 'POST') return await startDeviceFlow(request, env);
      if (url.pathname === '/api/auth/device/poll' && request.method === 'POST') return await pollDeviceFlow(request, env);
      if (url.pathname === '/api/auth/sign-out' && request.method === 'POST') { assertSameOrigin(request); return clearSession(); }
      if (url.pathname === '/api/session' && request.method === 'GET') {
        const { session, cookie } = await getSession(request, env);
        return json({ authenticated: true, login: session.login, expiresAt: session.accessExpiresAt }, 200, cookie);
      }
      if (url.pathname === '/api/data' && request.method === 'GET') {
        const { session, cookie } = await getSession(request, env);
        const canonical = await getCanonical(env, session.accessToken);
        if (!canonical.exists || !canonical.rawData || !canonical.revision || !canonical.updatedAt) {
          return json({ exists: false, data: null, revision: null, commitSha: canonical.commitSha, updatedAt: null }, 200, cookie);
        }
        return jsonVault(canonical.rawData, canonical.revision, canonical.commitSha, canonical.updatedAt, cookie);
      }
      if (url.pathname === '/api/data' && request.method === 'PUT') {
        assertSameOrigin(request);
        const { session, cookie } = await getSession(request, env);
        const input = await readJsonLimited<{ expectedRevision?: unknown; data?: unknown }>(request, MAX_SNAPSHOT_BYTES);
        if (input.expectedRevision !== null && (typeof input.expectedRevision !== 'string' || !/^[a-f0-9]{40}$/i.test(input.expectedRevision))) throw new ServiceError('Invalid expected revision. Reload the private backup and try again.', 400, 'invalid_revision');
        let data: VaultData;
        try { data = migrateVault(input.data); }
        catch { throw new ServiceError('Invalid vault snapshot. Check the schema version and catalog relationships before syncing.', 400, 'invalid_snapshot'); }
        return json(await commitSnapshot(env, session, input.expectedRevision as string | null, data), 200, cookie);
      }
      return json({ error: 'not_found', message: 'This private sync route was not found.' }, 404);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('Unknown private sync failure.');
      const status = cause instanceof ServiceError ? cause.status : 502;
      const code = cause instanceof ServiceError ? cause.code : 'sync_failed';
      console.error(JSON.stringify({ event: 'private_sync_failed', route: url.pathname, status, code }));
      return json({ error: code, message: error.message }, status);
    }
  },
};

async function startDeviceFlow(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  const form = new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID!, scope: 'offline_access' });
  const response = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof result?.device_code !== 'string' || typeof result.user_code !== 'string') throw new ServiceError('GitHub could not create a sign-in code. Confirm Device Flow is enabled in the GitHub App settings.', 502, 'device_flow_unavailable');
  return json({ deviceCode: result.device_code, userCode: result.user_code, verificationUri: 'https://github.com/login/device', expiresIn: Number(result.expires_in) || 900, interval: Number(result.interval) || 5 });
}

async function pollDeviceFlow(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  const input = await readJsonLimited<{ deviceCode?: unknown; interval?: unknown }>(request, 4096);
  if (typeof input.deviceCode !== 'string' || !/^[A-Za-z0-9._-]{30,200}$/.test(input.deviceCode)) throw new ServiceError('The one-time code is invalid. Start GitHub sign-in again.', 400, 'invalid_device_code');
  const interval = typeof input.interval === 'number' && Number.isFinite(input.interval) ? Math.max(5, Math.min(60, Math.floor(input.interval))) : 5;
  const form = new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID!, device_code: input.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  const token = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (token?.error === 'authorization_pending') return json({ status: 'pending' }, 202);
  if (token?.error === 'slow_down') return json({ status: 'pending', interval: Number(token.interval) || interval + 5 }, 202);
  if (token?.error) throw new ServiceError(token.error === 'access_denied' ? 'GitHub sign-in was denied. Start again when ready.' : 'GitHub sign-in expired or could not be completed. Start a new code.', token.error === 'access_denied' ? 403 : 400, 'device_authorization_failed');
  if (!response.ok || typeof token?.access_token !== 'string' || typeof token.refresh_token !== 'string') throw new ServiceError('GitHub did not return the required expiring sign-in tokens. Check that expiring user tokens and offline access are enabled for the GitHub App.', 502, 'token_exchange_failed');
  const established = await establishSession(token as TokenResponse, env);
  return json({ authenticated: true, login: established.login, expiresAt: established.expiresAt }, 200, established.cookie);
}

async function establishSession(token: TokenResponse, env: Env) {
  const user = await githubApi<{ login: string }>('/user', token.access_token);
  if (!env.GITHUB_ALLOWED_LOGIN || user.login.toLowerCase() !== env.GITHUB_ALLOWED_LOGIN.toLowerCase()) throw new ServiceError('This GitHub account is not allowed to use this personal collection.', 403, 'account_not_allowed');
  const { owner, repository, branch } = repositoryConfig(env);
  const repo = await githubApi<{ full_name?: string; permissions?: { push?: boolean } }>(`/repos/${owner}/${repository}`, token.access_token);
  if (repo.full_name?.toLowerCase() !== `${owner}/${repository}`.toLowerCase() || repo.permissions?.push !== true) throw new ServiceError('The GitHub App needs Contents read/write access to the configured private data repository.', 403, 'repository_not_writable');
  void branch;
  const expiresAt = Date.now() + (Number(token.expires_in) || 28_800) * 1000;
  const refreshExpiresAt = Date.now() + (Number(token.refresh_token_expires_in) || 15_897_600) * 1000;
  const session: AuthSession = { login: user.login, accessToken: token.access_token, refreshToken: token.refresh_token, accessExpiresAt: expiresAt, refreshExpiresAt };
  const sealed = await seal(session, env.SESSION_ENCRYPTION_KEY!);
  const cookie = `${COOKIE}=${sealed}; Path=/; Max-Age=${Math.floor((refreshExpiresAt - Date.now()) / 1000)}; HttpOnly; Secure; SameSite=Lax`;
  return { login: user.login, expiresAt, cookie };
}

async function getSession(request: Request, env: Env): Promise<{ session: AuthSession; cookie?: string }> {
  const value = readCookie(request, COOKIE);
  if (!value) throw new ServiceError('Sign in with GitHub to reach the private backup.', 401, 'unauthorized');
  let session: AuthSession;
  try { session = await unseal<AuthSession>(value, env.SESSION_ENCRYPTION_KEY!); }
  catch { throw new ServiceError('The encrypted session expired. Sign in again.', 401, 'unauthorized'); }
  if (!env.GITHUB_ALLOWED_LOGIN || session.login.toLowerCase() !== env.GITHUB_ALLOWED_LOGIN.toLowerCase()) throw new ServiceError('This account is not allowed to use this private collection.', 401, 'unauthorized');
  if (session.accessExpiresAt > Date.now() + 60_000) return { session };
  if (session.refreshExpiresAt <= Date.now()) throw new ServiceError('GitHub authorization expired. Sign in again.', 401, 'reauthorization_required');
  const refreshed = await tokenRequest(new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID!, client_secret: env.GITHUB_APP_CLIENT_SECRET!, refresh_token: session.refreshToken }), 'refresh_token');
  session = { ...session, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, accessExpiresAt: Date.now() + (Number(refreshed.expires_in) || 28_800) * 1000, refreshExpiresAt: Date.now() + (Number(refreshed.refresh_token_expires_in) || 15_897_600) * 1000 };
  const cookie = `${COOKIE}=${await seal(session, env.SESSION_ENCRYPTION_KEY!)}; Path=/; Max-Age=${Math.floor((session.refreshExpiresAt - Date.now()) / 1000)}; HttpOnly; Secure; SameSite=Lax`;
  return { session, cookie };
}

async function getCanonical(env: Env, token: string): Promise<Canonical> {
  const head = await getRepositoryHead(env, token);
  if (!head.exists || !head.revision) return { ...head, rawData: null, updatedAt: null };
  const { owner, repository } = repositoryConfig(env);
  const blob = await githubApi<{ content: string; size: number }>(`/repos/${owner}/${repository}/git/blobs/${head.revision}`, token);
  if (blob.size > MAX_SNAPSHOT_BYTES) throw new ServiceError('The private snapshot exceeds the supported size.', 502, 'snapshot_too_large');
  let snapshot: unknown;
  let rawData: string;
  try {
    rawData = decodeBase64(blob.content);
    snapshot = JSON.parse(rawData);
  } catch { throw new ServiceError('The canonical private snapshot is not valid JSON. Restore a previous repository revision before syncing.', 502, 'invalid_remote_json'); }
  const data = migrateRemoteSnapshot(snapshot);
  // Current snapshots can be streamed back exactly as stored. Older schemas are
  // migrated in memory and serialized only when a migration actually changed them.
  const responseData = data === snapshot ? rawData : JSON.stringify(data);
  return { ...head, rawData: responseData, updatedAt: data.updatedAt };
}

async function getRepositoryHead(env: Env, token: string): Promise<RepositoryHead> {
  const { owner, repository, branch } = repositoryConfig(env);
  const root = `/repos/${owner}/${repository}`;
  let ref: { object: { sha: string } };
  try { ref = await githubApi(`${root}/git/ref/heads/${encodeURIComponent(branch)}`, token); }
  catch (cause) { if (cause instanceof ServiceError && cause.status === 404) throw new ServiceError(`The private data repository needs an initial commit on branch “${branch}”. Add a README, then retry.`, 400, 'repository_not_initialized'); throw cause; }
  const commit = await githubApi<{ tree: { sha: string } }>(`${root}/git/commits/${ref.object.sha}`, token);
  const tree = await githubApi<{ truncated?: boolean; tree: Array<{ path: string; sha: string; type: string }> }>(`${root}/git/trees/${commit.tree.sha}?recursive=1`, token);
  if (tree.truncated) throw new ServiceError('The private repository tree is too large to inspect safely.', 502, 'repository_too_large');
  const file = tree.tree.find((entry) => entry.path === SNAPSHOT_PATH && entry.type === 'blob');
  if (!file) return { exists: false, revision: null, commitSha: ref.object.sha, treeSha: commit.tree.sha };
  return { exists: true, revision: file.sha, commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

/** Migrate older canonical snapshots in memory; reading never writes to the private repository. */
export function migrateRemoteSnapshot(value: unknown): VaultData {
  try {
    return migrateVault(value);
  } catch {
    // Return one consistent sync error without exposing private snapshot contents.
  }
  throw new ServiceError('The canonical private snapshot has an unsupported schema or invalid catalog records. No change was applied.', 502, 'invalid_remote_snapshot');
}

export function assertExpectedRevision(expected: string | null, current: string | null): void {
  if (expected !== current) throw new ServiceError('Revision conflict: the private backup changed on another device. Your local changes remain here; reload and review both copies.', 409, 'revision_conflict');
}

async function commitSnapshot(env: Env, session: AuthSession, expectedRevision: string | null, data: VaultData) {
  const current = await getRepositoryHead(env, session.accessToken);
  assertExpectedRevision(expectedRevision, current.revision);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  if (new TextEncoder().encode(content).length > MAX_SNAPSHOT_BYTES) throw new ServiceError('The proposed vault exceeds the supported snapshot size.', 400, 'snapshot_too_large');
  const { owner, repository, branch } = repositoryConfig(env);
  const root = `/repos/${owner}/${repository}`;
  const blob = await githubApi<{ sha: string }>(`${root}/git/blobs`, session.accessToken, { method: 'POST', body: JSON.stringify({ content, encoding: 'utf-8' }) });
  const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [{ path: SNAPSHOT_PATH, mode: '100644', type: 'blob', sha: blob.sha }];
  if (current.exists && current.revision) treeEntries.push({ path: `backups/${current.revision}.json`, mode: '100644', type: 'blob', sha: current.revision });
  const tree = await githubApi<{ sha: string }>(`${root}/git/trees`, session.accessToken, { method: 'POST', body: JSON.stringify({ base_tree: current.treeSha, tree: treeEntries }) });
  const commit = await githubApi<{ sha: string }>(`${root}/git/commits`, session.accessToken, { method: 'POST', body: JSON.stringify({ message: `Save Collect Everything vault ${data.updatedAt}`, tree: tree.sha, parents: [current.commitSha] }) });
  try {
    const updatedRef = await githubApi<{ object?: { sha?: string } }>(`${root}/git/refs/heads/${encodeURIComponent(branch)}`, session.accessToken, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    if (updatedRef.object?.sha !== commit.sha) throw new ServiceError('Revision conflict: the private repository did not confirm this save. Your local changes remain here.', 409, 'revision_conflict');
  } catch (cause) {
    if (cause instanceof ServiceError && cause.status === 409) throw new ServiceError('Revision conflict: another device saved first. Your local changes remain here; review both copies.', 409, 'revision_conflict');
    throw cause;
  }
  return { exists: true, data: null, revision: blob.sha, commitSha: commit.sha, updatedAt: data.updatedAt };
}

async function githubApi<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'CollectEverything/0.1', 'X-GitHub-Api-Version': API_VERSION, 'Content-Type': 'application/json', ...init.headers } });
  if (!response.ok) {
    if (response.status === 401) throw new ServiceError('GitHub access expired. Sign in again.', 401, 'unauthorized');
    if (response.status === 409 || response.status === 422) throw new ServiceError(`GitHub rejected a stale repository update (${response.status}).`, 409, 'revision_conflict');
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const detail = typeof body?.message === 'string' ? body.message.replace(/[\r\n\t]+/g, ' ').slice(0, 140) : '';
    throw new ServiceError(`GitHub repository request failed (${response.status})${detail ? `: ${detail}` : '.'}`, response.status === 404 ? 404 : 502, 'github_request_failed');
  }
  return response.json() as Promise<T>;
}

async function tokenRequest(body: URLSearchParams, grant: 'device_code' | 'refresh_token') {
  if (grant === 'refresh_token') body.set('grant_type', 'refresh_token');
  const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const token = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof token?.access_token !== 'string' || typeof token.refresh_token !== 'string') throw new ServiceError('GitHub token renewal failed. Sign in again.', 401, 'reauthorization_required');
  return token as TokenResponse;
}

async function readJsonLimited<T>(request: Request, maxBytes: number): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError('A JSON request body is required.', 400, 'invalid_request');
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new ServiceError('The vault snapshot exceeds the supported size.', 400, 'snapshot_too_large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
  catch { throw new ServiceError('The request body is not valid JSON.', 400, 'invalid_json'); }
}

function repositoryConfig(env: Env) {
  const owner = env.GITHUB_REPO_OWNER ?? '';
  const repository = env.GITHUB_REPO_NAME ?? '';
  const branch = env.GITHUB_REPO_BRANCH ?? 'main';
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) || !/^[A-Za-z0-9_.\/-]+$/.test(branch)) throw new ServiceError('The private repository configuration is invalid.', 503, 'invalid_configuration');
  return { owner, repository, branch };
}

function isConfigured(env: Env) {
  return Boolean(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.GITHUB_ALLOWED_LOGIN && env.GITHUB_REPO_OWNER && env.GITHUB_REPO_NAME && env.SESSION_ENCRYPTION_KEY && new TextEncoder().encode(env.SESSION_ENCRYPTION_KEY).length >= 32);
}

function assertSameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-collect-everything-request') !== '1') throw new ServiceError('This request did not come from the Collect Everything app.', 403, 'invalid_origin');
}

function readCookie(request: Request, name: string) { return request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1); }
function json(value: unknown, status = 200, cookie?: string) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders(cookie) });
}
function jsonVault(rawData: string, revision: string, commitSha: string, updatedAt: string, cookie?: string) {
  const encoder = new TextEncoder();
  const prefix = encoder.encode('{"exists":true,"data":');
  const suffix = encoder.encode(`,"revision":${JSON.stringify(revision)},"commitSha":${JSON.stringify(commitSha)},"updatedAt":${JSON.stringify(updatedAt)}` + '}');
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(prefix); },
    pull(controller) {
      if (offset < rawData.length) {
        let end = Math.min(offset + 32_768, rawData.length);
        const last = rawData.charCodeAt(end - 1);
        if (end < rawData.length && last >= 0xd800 && last <= 0xdbff) end--;
        controller.enqueue(encoder.encode(rawData.slice(offset, end)));
        offset = end;
        return;
      }
      controller.enqueue(suffix);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: jsonHeaders(cookie) });
}
function jsonHeaders(cookie?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  if (cookie) headers.append('Set-Cookie', cookie);
  return headers;
}
function clearSession() { return new Response(JSON.stringify({ signedOut: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } }); }
function base64Url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
async function seal(value: unknown, secret: string) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  const data = new Uint8Array(iv.length + encrypted.byteLength);
  data.set(iv);
  data.set(new Uint8Array(encrypted), iv.length);
  return base64Url(data);
}
async function unseal<T>(encoded: string, secret: string): Promise<T> {
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encoded.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await encryptionKey(secret), bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(clear)) as T;
}
async function encryptionKey(secret: string) {
  let raw = new TextEncoder().encode(secret);
  try { const decoded = Uint8Array.from(atob(secret), (character) => character.charCodeAt(0)); if (decoded.length === 32) raw = decoded; } catch { /* Random text is hashed into an AES-256 key. */ }
  if (raw.length < 32) throw new ServiceError('The Worker session encryption key must contain at least 32 bytes.', 503, 'invalid_configuration');
  const key = raw.length === 32 ? raw : new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function decodeBase64(content: string) { const binary = atob(content.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))); }
