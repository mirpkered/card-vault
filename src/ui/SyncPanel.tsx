import { useState } from 'react';
import { Check, Cloud, Copy, Download, ExternalLink, RefreshCw, ShieldCheck, Smartphone, Unplug } from 'lucide-react';
import type { useCloudSync } from '../useCloudSync';

type Controller = ReturnType<typeof useCloudSync>;

const labels: Record<Controller['status'], string> = {
  checking: 'Checking',
  'local-only': 'Local only',
  'signed-out': 'Not connected',
  'needs-initial-upload': 'First backup needed',
  syncing: 'Syncing',
  synced: 'Synced',
  offline: 'Offline',
  failed: 'Could not save',
};

export function SyncPanel({ sync }: { sync: Controller }) {
  const [copied, setCopied] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const connected = !!sync.login;
  const busy = sync.status === 'checking' || sync.status === 'syncing';

  async function copyCode() {
    if (!sync.device) return;
    try {
      await navigator.clipboard.writeText(sync.device.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }

  async function downloadRecoveryCopy() {
    try {
      const recovery = await sync.getRecoveryCopy();
      if (!recovery) throw new Error('There is no previous device copy saved here.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(recovery)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'collect-everything-device-recovery.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRecoveryError('');
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : 'Could not download the saved device copy.');
    }
  }

  return <div className="sync-panel">
    <div className={`sync-status-card ${sync.status}`}>
      <span className="sync-status-icon">{sync.status === 'synced' ? <Check size={18}/> : <Cloud size={18}/>}</span>
      <div><strong>{labels[sync.status]}</strong><p>{sync.message}</p></div>
    </div>

    {sync.configured === false && <div className="sync-note"><ShieldCheck size={16}/><p>This copy is in local-only mode. Your collection still saves on this device, and JSON backups remain available. Private sync becomes available after its Worker and private data repository are configured.</p></div>}

    {sync.configured !== false && !connected && <>
      <p className="sync-explainer">GitHub is the master copy. Connect to load the latest vault on this device. Changes you make in the app save back to the private repository, and other connected devices pick them up.</p>
      {!sync.device ? <button className="button primary full" onClick={() => void sync.beginSignIn()} disabled={busy}><ShieldCheck size={16}/> Connect with GitHub</button> : <div className="device-flow">
        <div className="device-step"><span>1</span><p>Enter this one-time code in GitHub:</p></div>
        <div className="device-code"><strong>{sync.device.userCode}</strong><button className="icon-button" onClick={() => void copyCode()} aria-label="Copy sign-in code">{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div>
        <a className="button outline full" href={sync.device.verificationUri} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Open GitHub authorization</a>
        <p className="sync-help">Approve the one-time code, then return here. It expires in about {Math.max(1, Math.round(sync.device.expiresIn / 60))} minutes.</p>
        <button className="button primary full" onClick={() => void sync.checkSignIn()}><Check size={16}/> I approved it · Check connection</button>
      </div>}
    </>}

    {connected && <>
      <div className="connected-row"><div><span className="sync-overline">CONNECTED ACCOUNT</span><strong>{sync.login}</strong>{sync.lastSavedAt && <small>Last saved {new Date(sync.lastSavedAt).toLocaleString()}</small>}</div><button className="button subtle" onClick={() => void sync.disconnect()} disabled={busy}><Unplug size={15}/> Sign out</button></div>
      {sync.status === 'needs-initial-upload' && <div className="sync-warning"><strong>Start the private backup</strong><p>This creates the first GitHub master copy from this device. Check that the correct inventory is loaded before continuing.</p><button className="button primary full" onClick={() => void sync.syncNow()} disabled={busy}><Cloud size={16}/> Save first private backup</button></div>}
      {(sync.status === 'synced' || sync.status === 'offline' || sync.status === 'failed') && <div className="sync-actions"><p>{sync.status === 'synced' ? 'GitHub is the master copy. This device checks for newer saves when opened and while active.' : 'This device is unchanged unless GitHub can be reached. Retry when your connection is back.'}</p><button className="button outline full" onClick={() => void sync.syncNow()} disabled={busy}><RefreshCw size={15}/> {sync.status === 'synced' ? 'Check GitHub now' : 'Retry sync'}</button></div>}
      {sync.recoveryAvailable && <div className="sync-recovery"><p>A previous copy from this device is saved here in case you need it.</p><button className="button outline full" onClick={() => void downloadRecoveryCopy()}><Download size={15}/> Download previous device copy</button></div>}
    </>}

    {sync.error && <div className="sync-error" role="alert">{sync.error}</div>}
    {recoveryError && <div className="sync-error" role="alert">{recoveryError}</div>}
    <div className="sync-footnote"><Smartphone size={14}/><span>Each device keeps an offline copy. GitHub is the master; connected devices check for newer saves automatically.</span></div>
  </div>;
}
