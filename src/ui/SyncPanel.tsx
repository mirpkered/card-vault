import { useState } from 'react';
import { AlertTriangle, Check, Cloud, Copy, ExternalLink, RefreshCw, ShieldCheck, Smartphone, Unplug } from 'lucide-react';
import type { useCloudSync } from '../useCloudSync';

type Controller = ReturnType<typeof useCloudSync>;

const labels: Record<Controller['status'], string> = {
  checking: 'Checking',
  'local-only': 'Local only',
  'signed-out': 'Not connected',
  'needs-initial-upload': 'First backup needed',
  syncing: 'Saving',
  synced: 'Synced',
  conflict: 'Review needed',
  offline: 'Offline',
  failed: 'Could not save',
};

export function SyncPanel({ sync }: { sync: Controller }) {
  const [copied, setCopied] = useState(false);
  const connected = !!sync.login;
  const busy = sync.status === 'checking' || sync.status === 'syncing';
  const unresolved = sync.mergePlan?.conflicts.filter((item) => !sync.choices[item.key]).length ?? 0;

  async function copyCode() {
    if (!sync.device) return;
    try {
      await navigator.clipboard.writeText(sync.device.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }

  return <div className="sync-panel">
    <div className={`sync-status-card ${sync.status}`}>
      <span className="sync-status-icon">{sync.status === 'conflict' ? <AlertTriangle size={18}/> : sync.status === 'synced' ? <Check size={18}/> : <Cloud size={18}/>}</span>
      <div><strong>{labels[sync.status]}</strong><p>{sync.message}</p></div>
    </div>

    {sync.configured === false && <div className="sync-note"><ShieldCheck size={16}/><p>This copy is in local-only mode. Your collection still saves on this device, and JSON backups remain available. Private sync becomes available after its Worker and private data repository are configured.</p></div>}

    {sync.configured !== false && !connected && <>
      <p className="sync-explainer">Connect this app to your private GitHub data repository. The app never receives your GitHub access token; it stays inside the secure sync service.</p>
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
      {sync.status === 'needs-initial-upload' && <div className="sync-warning"><strong>Start the private backup</strong><p>This creates the first snapshot from this device. Check that the correct inventory is loaded before continuing. If another browser has already created a backup, the service will stop and ask you to review both copies.</p><button className="button primary full" onClick={() => void sync.syncNow()} disabled={busy}><Cloud size={16}/> Save first private backup</button></div>}
      {(sync.status === 'synced' || sync.status === 'offline' || sync.status === 'failed') && <div className="sync-actions"><p>{sync.status === 'synced' ? 'Changes sync automatically after a short pause. You can also save now.' : 'Your local changes are kept. Retry when your connection is back.'}</p><button className="button outline full" onClick={() => void sync.syncNow()} disabled={busy}><RefreshCw size={15}/> {sync.status === 'synced' ? 'Sync now' : 'Retry sync'}</button></div>}
      {sync.status === 'conflict' && sync.mergePlan && <section className="merge-review" aria-labelledby="merge-title">
        <h3 id="merge-title">Review both copies</h3>
        <p>{sync.mergePlan.deviceOnly} device-only and {sync.mergePlan.privateOnly} private-only records will be kept. No records will be deleted. Choose a version for every changed record with the same ID.</p>
        {sync.mergePlan.conflicts.length === 0 && <div className="sync-note"><Check size={16}/><p>There are no same-ID changes to choose between. The records from both copies can be combined.</p></div>}
        <div className="merge-choices">{sync.mergePlan.conflicts.map((conflict) => <fieldset key={conflict.key}>
          <legend>{conflict.collection === 'ownership' ? 'Quantities' : conflict.collection} · {conflict.id}</legend>
          <div className="merge-version"><b>This device</b><span>{describe(conflict.deviceRecord)}</span></div>
          <div className="merge-version"><b>Private backup</b><span>{describe(conflict.privateRecord)}</span></div>
          <label><input type="radio" name={`choice-${conflict.key}`} checked={sync.choices[conflict.key] === 'device'} onChange={() => sync.chooseConflict(conflict.key, 'device')}/> Keep this device’s version</label>
          <label><input type="radio" name={`choice-${conflict.key}`} checked={sync.choices[conflict.key] === 'private'} onChange={() => sync.chooseConflict(conflict.key, 'private')}/> Keep the private version</label>
        </fieldset>)}</div>
        <button className="button primary full" onClick={() => void sync.approveMerge()} disabled={busy || unresolved > 0}><ShieldCheck size={16}/> Review and save merged vault</button>
        {unresolved > 0 && <small className="sync-help">Choose a version for {unresolved} changed record{unresolved === 1 ? '' : 's'} to continue.</small>}
      </section>}
    </>}

    {sync.error && <div className="sync-error" role="alert">{sync.error}</div>}
    <div className="sync-footnote"><Smartphone size={14}/><span>Each browser has its own offline copy. Sign in here to connect it to the shared private backup.</span></div>
  </div>;
}

function describe(record: Record<string, unknown>): string {
  if (typeof record.personal === 'number' || typeof record.incoming === 'number') return `Personal ${record.personal ?? 0} · Dupes ${record.duplicates ?? 0} · Incoming ${record.incoming ?? 0}`;
  const name = typeof record.name === 'string' ? record.name : typeof record.title === 'string' ? record.title : '';
  const number = typeof record.number === 'string' ? record.number : '';
  return [name, number, typeof record.rarity === 'string' ? record.rarity : ''].filter(Boolean).join(' · ') || JSON.stringify(record);
}
