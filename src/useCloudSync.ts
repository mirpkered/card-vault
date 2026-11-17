import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { VaultData } from './domain';
import { CloudRequestError, getCloudHealth, getCloudSession, getRemoteVault, pollDeviceSignIn, putRemoteVault, signOutCloud, startDeviceSignIn, type RemoteVault } from './cloudSync';
import { applyVaultMerge, isPristineVault, prepareVaultMerge, vaultsEqual, type MergeChoice, type VaultMergePlan } from './syncMerge';

export type CloudSyncStatus = 'checking' | 'local-only' | 'signed-out' | 'needs-initial-upload' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'failed';
export type DeviceFlow = { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number; lastPollAt: number };

export function useCloudSync(vault: VaultData, setVault: Dispatch<SetStateAction<VaultData>>, ready: boolean) {
  const [status, setStatus] = useState<CloudSyncStatus>('checking');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [login, setLogin] = useState('');
  const [message, setMessage] = useState('Checking private sync…');
  const [error, setError] = useState('');
  const [device, setDevice] = useState<DeviceFlow | null>(null);
  const [remote, setRemote] = useState<RemoteVault | null>(null);
  const [mergePlan, setMergePlan] = useState<VaultMergePlan | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [syncCycle, setSyncCycle] = useState(0);
  const syncInFlight = useRef(false);
  const suppressAutoSync = useRef(false);
  const vaultRef = useRef(vault);

  useEffect(() => { vaultRef.current = vault; }, [vault]);

  const inspectRemote = useCallback((next: RemoteVault, local: VaultData, setLocal?: Dispatch<SetStateAction<VaultData>>) => {
    setRemote(next);
    setMergePlan(null);
    setChoices({});
    if (!next.exists || !next.data) {
      setStatus('needs-initial-upload');
      setMessage('The private repository is ready for its first vault backup.');
      setBootstrapped(true);
      return;
    }
    if (vaultsEqual(local, next.data)) {
      setStatus('synced');
      setMessage('This device matches the private backup. New edits sync automatically.');
      setLastSavedAt(next.updatedAt ?? next.data.updatedAt);
      setBootstrapped(true);
      return;
    }
    if (isPristineVault(local)) {
      suppressAutoSync.current = true;
      setLocal?.(next.data);
      setStatus('synced');
      setMessage('Loaded the private vault onto this device. New edits sync automatically.');
      setLastSavedAt(next.updatedAt ?? next.data.updatedAt);
      setBootstrapped(true);
      return;
    }
    setMergePlan(prepareVaultMerge(local, next.data));
    setStatus('conflict');
    setMessage('This device and the private backup both have changes. Review them before merging.');
    setBootstrapped(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    setBootstrapped(false);
    setStatus('checking');
    setError('');
    void (async () => {
      try {
        const health = await getCloudHealth();
        if (!active) return;
        setConfigured(health.configured);
        if (!health.configured) {
          setStatus('local-only');
          setMessage('Private sync is not configured here. This device still works locally.');
          setBootstrapped(true);
          return;
        }
        const session = await getCloudSession();
        if (!active) return;
        if (!session) {
          setStatus('signed-out');
          setMessage('Sign in to reach your private backup from this browser.');
          setBootstrapped(true);
          return;
        }
        setLogin(session.login);
        const next = await getRemoteVault();
        if (!active) return;
        inspectRemote(next, vaultRef.current, setVault);
      } catch (cause) {
        if (!active) return;
        const requestError = cause instanceof CloudRequestError ? cause : null;
        setStatus(requestError?.status === 401 ? 'signed-out' : 'offline');
        setMessage(requestError?.status === 401 ? 'Your GitHub session needs to be renewed.' : 'Could not reach the private sync service. Your local vault is unchanged.');
        setError(cause instanceof Error ? cause.message : 'Could not check private sync.');
        setBootstrapped(true);
      }
    })();
    return () => { active = false; };
  }, [ready, inspectRemote, setVault]);

  const refreshRemote = useCallback(async () => {
    try {
      const next = await getRemoteVault();
      inspectRemote(next, vaultRef.current, setVault);
    } catch (cause) {
      if (cause instanceof CloudRequestError && cause.status === 401) {
        setLogin('');
        setStatus('signed-out');
        setMessage('Your GitHub session needs to be renewed.');
      }
      setError(cause instanceof Error ? cause.message : 'Could not load the private backup.');
    }
  }, [inspectRemote, setVault]);

  const handleWriteError = useCallback(async (cause: unknown) => {
    const requestError = cause instanceof CloudRequestError ? cause : null;
    setError(cause instanceof Error ? cause.message : 'Could not save the private backup.');
    if (requestError?.status === 409) {
      try {
        const next = await getRemoteVault();
        setRemote(next);
        if (next.exists && next.data) {
          setMergePlan(prepareVaultMerge(vaultRef.current, next.data));
          setChoices({});
          setStatus('conflict');
          setMessage('Another device saved first. Your changes are kept here; review the two copies.');
        } else {
          setStatus('needs-initial-upload');
          setMessage('The private backup changed before this save. Review it before trying again.');
        }
      } catch (refreshError) {
        setStatus('offline');
        setMessage('The save conflicted and the newest private copy could not be loaded. Your local vault is unchanged.');
        setError(refreshError instanceof Error ? refreshError.message : 'Could not load the latest private copy.');
      }
    } else if (requestError?.status === 401) {
      setLogin('');
      setStatus('signed-out');
      setMessage('Your GitHub session expired. Sign in again; local changes are kept.');
    } else {
      setStatus('offline');
      setMessage('The private save was not confirmed. Your local changes are kept for retry.');
    }
  }, []);

  const writeVault = useCallback(async (source: VaultData, expectedRevision: string | null, applyReviewedMerge = false) => {
    const snapshot = { ...source, updatedAt: new Date().toISOString() };
    const saved = await putRemoteVault(expectedRevision, snapshot);
    const confirmed = { ...saved, data: saved.data ?? snapshot };
    setRemote(confirmed);
    if (applyReviewedMerge || vaultsEqual(vaultRef.current, source)) setVault(confirmed.data ?? snapshot);
    setLastSavedAt(saved.updatedAt ?? snapshot.updatedAt);
    setMergePlan(null);
    setChoices({});
    setError('');
    setStatus('synced');
    setMessage('Saved to the private repository. New edits sync automatically.');
    setBootstrapped(true);
  }, [setVault]);

  const syncNow = useCallback(async () => {
    if (!login) {
      setStatus('signed-out');
      setMessage('Sign in to GitHub before syncing.');
      return;
    }
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setStatus('syncing');
    setMessage('Saving a versioned private backup…');
    try {
      if (!remote) {
        const current = await getRemoteVault();
        setRemote(current);
        await writeVault(vaultRef.current, current.revision);
      } else {
        await writeVault(vaultRef.current, remote.revision);
      }
    } catch (cause) { await handleWriteError(cause); }
    finally { syncInFlight.current = false; setSyncCycle((value) => value + 1); }
  }, [handleWriteError, login, remote, writeVault]);

  useEffect(() => {
    if (!ready || !bootstrapped || status !== 'synced' || !remote?.exists || !remote.data || syncInFlight.current) return;
    if (suppressAutoSync.current) { suppressAutoSync.current = false; return; }
    if (vaultsEqual(vault, remote.data)) return;
    const timer = window.setTimeout(() => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      setStatus('syncing');
      setMessage('Saving your change to the private repository…');
      void writeVault(vaultRef.current, remote.revision)
        .catch((cause: unknown) => handleWriteError(cause))
        .finally(() => { syncInFlight.current = false; setSyncCycle((value) => value + 1); });
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [ready, bootstrapped, status, vault, remote, writeVault, handleWriteError, syncCycle]);

  const beginSignIn = useCallback(async () => {
    setError('');
    try {
      const started = await startDeviceSignIn();
      setDevice({ ...started, lastPollAt: 0 });
      setMessage('Enter the one-time code in GitHub, then return here.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start GitHub sign-in.');
    }
  }, []);

  const checkSignIn = useCallback(async () => {
    if (!device) return;
    const waitMs = device.interval * 1000 - (Date.now() - device.lastPollAt);
    if (waitMs > 0) {
      setMessage(`Wait ${Math.ceil(waitMs / 1000)} seconds before checking again.`);
      return;
    }
    setDevice({ ...device, lastPollAt: Date.now() });
    setError('');
    setMessage('Checking GitHub authorization…');
    try {
      const result = await pollDeviceSignIn(device.deviceCode, device.interval);
      if (!result.authenticated) {
        if (result.interval) setDevice((current) => current ? { ...current, interval: result.interval! } : current);
        setMessage('Still waiting for approval. Check again after approving the code in GitHub.');
        return;
      }
      setDevice(null);
      const session = await getCloudSession();
      if (!session) throw new Error('GitHub did not create a sign-in session. Start again.');
      setLogin(session.login);
      const next = await getRemoteVault();
      inspectRemote(next, vaultRef.current, setVault);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not finish GitHub sign-in.');
    }
  }, [device, inspectRemote, setVault]);

  const disconnect = useCallback(async () => {
    try {
      await signOutCloud();
      setLogin('');
      setDevice(null);
      setRemote(null);
      setMergePlan(null);
      setStatus(configured ? 'signed-out' : 'local-only');
      setMessage('Signed out. This device’s local vault is still available.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    }
  }, [configured]);

  const chooseConflict = useCallback((key: string, choice: MergeChoice) => setChoices((previous) => ({ ...previous, [key]: choice })), []);

  const approveMerge = useCallback(async () => {
    if (!mergePlan || !remote?.exists || !remote.revision) return;
    if (mergePlan.conflicts.some((conflict) => !choices[conflict.key])) {
      setError('Choose which copy to keep for every changed record.');
      return;
    }
    syncInFlight.current = true;
    setStatus('syncing');
    setMessage('Checking the private copy before applying your review…');
    setError('');
    try {
      const latest = await getRemoteVault();
      if (!latest.exists || latest.revision !== remote.revision || !latest.data) {
        if (latest.exists && latest.data) {
          setRemote(latest);
          setMergePlan(prepareVaultMerge(vaultRef.current, latest.data));
          setChoices({});
          setStatus('conflict');
          setMessage('The private copy changed during your review. Please review the newer version.');
          return;
        }
        setStatus('needs-initial-upload');
        setMessage('The private backup is no longer available. No merge was applied.');
        return;
      }
      const merged = applyVaultMerge(mergePlan, choices);
      await writeVault(merged, latest.revision, true);
    } catch (cause) { await handleWriteError(cause); }
    finally { syncInFlight.current = false; setSyncCycle((value) => value + 1); }
  }, [choices, handleWriteError, mergePlan, remote, writeVault]);

  return { status, configured, login, message, error, device, remote, mergePlan, choices, lastSavedAt, beginSignIn, checkSignIn, syncNow, disconnect, chooseConflict, approveMerge, refreshRemote };
}
