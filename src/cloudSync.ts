import { migrateVault, type VaultData } from './domain';

export type CloudHealth = { configured: boolean };
export type CloudSession = { authenticated: true; login: string; expiresAt: number };
export type RemoteVault = { exists: boolean; data: VaultData | null; revision: string | null; commitSha: string | null; updatedAt: string | null };
export type RemoteRevision = Pick<RemoteVault, 'exists' | 'revision'>;

export class CloudRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'CloudRequestError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-Collect-Everything-Request', '1');
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => null) as ({ message?: unknown; error?: unknown } & Record<string, unknown>) | null;
  if (!response.ok || !body) {
    const message = typeof body?.message === 'string' ? body.message : `Private sync is unavailable (HTTP ${response.status}).`;
    throw new CloudRequestError(message, response.status, typeof body?.error === 'string' ? body.error : undefined);
  }
  return body as T;
}

export function getCloudHealth() {
  return request<CloudHealth>('/api/health').catch((error: unknown) => {
    if (error instanceof CloudRequestError && error.status === 404) return { configured: false };
    throw error;
  });
}

export async function getCloudSession(): Promise<CloudSession | null> {
  try { return await request<CloudSession>('/api/session'); }
  catch (error) { if (error instanceof CloudRequestError && error.status === 401) return null; throw error; }
}

export function startDeviceSignIn() {
  return request<{ deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number }>('/api/auth/device/start', { method: 'POST', body: '{}' });
}

export function pollDeviceSignIn(deviceCode: string, interval: number) {
  return request<{ status?: 'pending'; interval?: number; authenticated?: true; login?: string }>('/api/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceCode, interval }) });
}

export function signOutCloud() {
  return request<{ signedOut: true }>('/api/auth/sign-out', { method: 'POST', body: '{}' });
}

export async function getRemoteVault(): Promise<RemoteVault> {
  const remote = await request<RemoteVault>('/api/data');
  if (!remote.exists || !remote.data) return remote;
  try {
    const data = migrateVault(remote.data);
    return { ...remote, data, updatedAt: remote.updatedAt ?? data.updatedAt };
  } catch {
    throw new CloudRequestError('The private snapshot has an unsupported schema or invalid catalog records. No change was applied.', 502, 'invalid_remote_snapshot');
  }
}

export function getRemoteRevision() {
  return request<RemoteRevision>('/api/revision');
}

export function putRemoteVault(expectedRevision: string | null, data: VaultData) {
  return request<RemoteVault>('/api/data', { method: 'PUT', body: JSON.stringify({ expectedRevision, data }) });
}
