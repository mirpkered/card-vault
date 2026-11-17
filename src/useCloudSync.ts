import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { VaultData } from './domain';
import { CloudRequestError, getCloudHealth, getCloudSession, getRemoteRevision, getRemoteVault, pollDeviceSignIn, putRemoteVault, signOutCloud, startDeviceSignIn, type RemoteVault } from './cloudSync';
import { shouldSaveRecoveryBeforeRemoteRefresh, vaultsEqual } from './syncMerge';
import { hasRecoveryVault, loadRecoveryVault, saveRecoveryVault } from './storage';

export type CloudSyncStatus = 'checking' | 'local-only' | 'signed-out' | 'needs-initial-upload' | 'syncing' | 'synced' | 'offline' | 'failed';
export type DeviceFlow = { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number; lastPollAt: number };

export function useCloudSync(vault: VaultData, setVault: Dispatch<SetStateAction<VaultData>>, ready: boolean) {
  const [status, setStatus] = useState<CloudSyncStatus>('checking');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [login, setLogin] = useState('');
  const [message, setMessage] = useState('Checking private sync…');
  const [error, setError] = useState('');
  const [device, setDevice] = useState<DeviceFlow | null>(null);
  const [remote, setRemote] = useState<RemoteVault | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [syncCycle, setSyncCycle] = useState(0);
  const syncInFlight = useRef(false);
  const suppressAutoSync = useRef(false);
  const recoveryFailed = useRef(false);
  const vaultRef = useRef(vault);

  useEffect(() => { vaultRef.current = vault; }, [vault]);
  useEffect(() => { void hasRecoveryVault().then(setRecoveryAvailable).catch(() => setRecoveryAvailable(false)); }, []);

  const inspectRemote = useCallback(async (next: RemoteVault, local: VaultData, setLocal: Dispatch<SetStateAction<VaultData>>) => {
    setError('');
    if (!next.exists || !next.data) {
      setRemote(next);
      setStatus('needs-initial-upload');
      setMessage('The private repository is ready for its first vault backup.');
      setBootstrapped(true);
      return;
    }
    if (vaultsEqual(local, next.data)) {
      setRemote(next);
      setStatus('synced');
      setMessage('This device matches the private GitHub vault.');
      setLastSavedAt(next.updatedAt ?? next.data.updatedAt);
      setBootstrapped(true);
      recoveryFailed.current = false;
      return;
    }

    const catalogDiffers = JSON.stringify(local.catalog) !== JSON.stringify(next.data.catalog);
    setStatus('syncing');
    setMessage('Updating this device from the private GitHub vault…');
    if (shouldSaveRecoveryBeforeRemoteRefresh(local, next.data)) {
      try {
        await saveRecoveryVault(local);
        setRecoveryAvailable(true);
        recoveryFailed.current = false;
      } catch (cause) {
        recoveryFailed.current = true;
        setStatus('failed');
        setMessage('This device was not changed because its local recovery copy could not be saved.');
        setError(cause instanceof Error ? `Could not protect this device’s current copy: ${cause.message}` : 'Could not save a recovery copy of this device. Export a backup before retrying.');
        setBootstrapped(true);
        return;
      }
    }
    setRemote(next);
    suppressAutoSync.current = true;
    setLocal(next.data);
    setLastSavedAt(next.updatedAt ?? next.data.updatedAt);
    setStatus('synced');
    setMessage(catalogDiffers ? 'Updated from GitHub. The previous device copy is saved here as a recovery backup.' : 'Updated to match the latest GitHub save.');
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
          setMessage('Sign in to load the private GitHub vault on this device.');
          setBootstrapped(true);
          return;
        }
        setLogin(session.login);
        const next = await getRemoteVault();
        if (!active) return;
        await inspectRemote(next, vaultRef.current, setVault);
      } catch (cause) {
        if (!active) return;
        const requestError = cause instanceof CloudRequestError ? cause : null;
        setStatus(requestError?.status === 401 ? 'signed-out' : 'offline');
        setMessage(requestError?.status === 401 ? 'Your GitHub session needs to be renewed.' : 'Could not reach the private sync service. This device is unchanged.');
        setError(cause instanceof Error ? cause.message : 'Could not check private sync.');
        setBootstrapped(true);
      }
    })();
    return () => { active = false; };
  }, [ready, inspectRemote, setVault]);

  const refreshRemote = useCallback(async () => {
    try {
      const next = await getRemoteVault();
      await inspectRemote(next, vaultRef.current, setVault);
    } catch (cause) {
      if (cause instanceof CloudRequestError && cause.status === 401) {
        setLogin('');
        setStatus('signed-out');
        setMessage('Your GitHub session needs to be renewed.');
      }
      setError(cause instanceof Error ? cause.message : 'Could not load the private GitHub vault.');
    }
  }, [inspectRemote, setVault]);

  const handleWriteError = useCallback(async (cause: unknown) => {
    const requestError = cause instanceof CloudRequestError ? cause : null;
    if (requestError?.status === 409) {
      try {
        const latest = await getRemoteVault();
        if (latest.exists && latest.data) {
          await inspectRemote(latest, vaultRef.current, setVault);
          return;
        }
        setRemote(latest);
        setStatus('needs-initial-upload');
        setMessage('The private vault is empty. Your device copy remains here.');
        setBootstrapped(true);
      } catch (refreshError) {
        setStatus('offline');
        setMessage('Could not load the latest GitHub vault. This device remains unchanged.');
        setError(refreshError instanceof Error ? refreshError.message : 'Could not load the latest private copy.');
      }
      return;
    }
    setError(cause instanceof Error ? cause.message : 'Could not save the private GitHub vault.');
    if (requestError?.status === 401) {
      setLogin('');
      setStatus('signed-out');
      setMessage('Your GitHub session expired. Sign in again; this device is unchanged.');
    } else {
      setStatus('offline');
      setMessage('The private save was not confirmed. This device’s changes are kept for retry.');
    }
  }, [inspectRemote, setVault]);

  const writeVault = useCallback(async (source: VaultData, expectedRevision: string | null) => {
    const snapshot = { ...source, updatedAt: new Date().toISOString() };
    const saved = await putRemoteVault(expectedRevision, snapshot);
    const confirmed = { ...saved, data: saved.data ?? snapshot };
    setRemote(confirmed);
    if (vaultsEqual(vaultRef.current, source)) setVault(confirmed.data ?? snapshot);
    setLastSavedAt(saved.updatedAt ?? snapshot.updatedAt);
    setError('');
    setStatus('synced');
    setMessage('Saved to the private GitHub vault. Other devices will load this update.');
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
    setMessage('Checking GitHub for the latest vault…');
    try {
      const current = await getRemoteVault();
      if (current.exists && current.data && (recoveryFailed.current || !remote?.exists || current.revision !== remote.revision)) {
        await inspectRemote(current, vaultRef.current, setVault);
      } else if (!current.exists && remote?.exists) {
        setRemote(current);
        setStatus('failed');
        setMessage('The private vault is unavailable. This device was left unchanged.');
        setError('GitHub no longer has the saved vault. No device data was replaced.');
      } else {
        setRemote(current);
        if (current.exists && vaultsEqual(vaultRef.current, current.data!)) {
          setLastSavedAt(current.updatedAt ?? current.data!.updatedAt);
          setStatus('synced');
          setMessage('This device matches the private GitHub vault.');
        } else {
          await writeVault(vaultRef.current, current.revision);
        }
      }
    } catch (cause) { await handleWriteError(cause); }
    finally { syncInFlight.current = false; setSyncCycle((value) => value + 1); }
  }, [handleWriteError, inspectRemote, login, remote, setVault, writeVault]);

  useEffect(() => {
    if (!ready || !bootstrapped || status !== 'synced' || !remote?.exists || !remote.data || syncInFlight.current) return;
    if (suppressAutoSync.current) { suppressAutoSync.current = false; return; }
    if (vaultsEqual(vault, remote.data)) return;
    const timer = window.setTimeout(() => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      setStatus('syncing');
      setMessage('Saving this change to the private GitHub vault…');
      void writeVault(vaultRef.current, remote.revision)
        .catch((cause: unknown) => handleWriteError(cause))
        .finally(() => { syncInFlight.current = false; setSyncCycle((value) => value + 1); });
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [ready, bootstrapped, status, vault, remote, writeVault, handleWriteError, syncCycle]);

  useEffect(() => {
    if (!ready || !bootstrapped || !login || !remote?.exists) return;
    let active = true;
    const checkForUpdate = async () => {
      if (!active || document.visibilityState !== 'visible' || syncInFlight.current) return;
      syncInFlight.current = true;
      try {
        const revision = await getRemoteRevision();
        if (!active) return;
        if (revision.exists && revision.revision !== remote.revision) {
          const latest = await getRemoteVault();
          if (active) await inspectRemote(latest, vaultRef.current, setVault);
        }
      } catch {
        // Keep the local copy until GitHub can be checked again.
      } finally {
        syncInFlight.current = false;
        if (active) setSyncCycle((value) => value + 1);
      }
    };
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void checkForUpdate(); };
    const timer = window.setInterval(() => void checkForUpdate(), 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [ready, bootstrapped, login, remote?.revision, inspectRemote, setVault]);

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
      await inspectRemote(next, vaultRef.current, setVault);
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
      setStatus(configured ? 'signed-out' : 'local-only');
      setMessage('Signed out. This device’s offline copy remains available.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    }
  }, [configured]);

  const getRecoveryCopy = useCallback(() => loadRecoveryVault(), []);

  return { status, configured, login, message, error, device, lastSavedAt, recoveryAvailable, beginSignIn, checkSignIn, syncNow, disconnect, refreshRemote, getRecoveryCopy };
}
