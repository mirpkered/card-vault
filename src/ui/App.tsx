import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Archive, ArrowDownToLine, ArrowUpFromLine, BookOpen, Check, CircleHelp, Download, Grid2X2, ImagePlus, List, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-react';
import { cardStatus, completion, emptyVault, filterCards, findConflicts, migrateVault, parseCsv, validateInventoryRows, type CardDefinition, type CardSet, type CardVariant, type Ownership, type VaultData } from '../domain';
import { loadVault, saveVault } from '../storage';

type View = 'gallery' | 'list' | 'checklist';
type Filter = 'all' | 'owned' | 'missing' | 'incoming' | 'duplicate';
const initialStatus: Record<string, string> = { 'Kayou Naruto NREA02': 'Tracking started', 'Kayou Naruto NREA03': 'Tracking started', 'Super Rare Games': 'Collection ready' };

export default function App() {
  const [vault, setVault] = useState<VaultData>(emptyVault);
  const [ready, setReady] = useState(false);
  const [setId, setSetId] = useState('set:kayou-naruto-nrea02');
  const [view, setView] = useState<View>('gallery');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CardDefinition | null>(null);
  const [modal, setModal] = useState<'add-card' | 'add-set' | 'help' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState(false);

  useEffect(() => { loadVault().then((data) => { setVault(data); setReady(true); }).catch((e: Error) => { setError(`Could not open local vault: ${e.message}`); setReady(true); }); }, []);
  useEffect(() => { if (ready) saveVault(vault).catch((e: Error) => setError(`Save failed: ${e.message}`)); }, [vault, ready]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3600); return () => window.clearTimeout(timer); }, [notice]);

  const seriesMap = new Map(vault.catalog.series.map((x) => [x.id, x]));
  const selectedSet = vault.catalog.sets.find((x) => x.id === setId) ?? vault.catalog.sets[0];
  const selectedSeries = selectedSet ? seriesMap.get(selectedSet.seriesId) : undefined;
  const cards = vault.catalog.cards.filter((card) => !selectedSet || card.setId === selectedSet.id);
  const byId = new Map(vault.catalog.ownership.map((x) => [x.cardId, x]));
  const visibleCards = useMemo(() => filterCards(cards, vault.catalog.ownership, filter, query), [cards, filter, query, vault.catalog.ownership]);
  const progress = completion(cards, vault.catalog.ownership);
  const allProgress = completion(vault.catalog.cards, vault.catalog.ownership);
  const [reviewImport, setReviewImport] = useState(false);
  const srgSets = vault.catalog.sets.filter((set) => set.sourceCompletionIndicator !== undefined);
  const markerDiscrepancies = srgSets.filter((set) => set.sourceCompletionIndicator !== 'unmarked' && ((set.sourceCompletionIndicator === 'complete') !== (completion(vault.catalog.cards.filter((card) => card.setId === set.id), vault.catalog.ownership).percent === 100)));
  const unmarkedSets = srgSets.filter((set) => set.sourceCompletionIndicator === 'unmarked');

  function updateOwnership(card: CardDefinition, field: 'personal' | 'duplicates' | 'incoming', quantity: number) {
    const found = byId.get(card.id);
    const record: Ownership = { cardId: card.id, personal: found?.personal ?? 0, duplicates: found?.duplicates ?? 0, incoming: found?.incoming ?? 0, updatedAt: new Date().toISOString(), [field]: Math.max(0, Math.floor(quantity)) };
    setVault((prev) => ({ ...prev, updatedAt: new Date().toISOString(), catalog: { ...prev.catalog, ownership: [...prev.catalog.ownership.filter((x) => x.cardId !== card.id), record] } }));
  }
  function addCard(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const number = String(data.get('number') ?? '').trim(); const name = String(data.get('name') ?? '').trim();
    if (!selectedSet || !number || !name) return;
    if (selectedSet.expectedCardCount !== undefined && vault.catalog.cards.filter((card) => card.setId === selectedSet.id).length >= selectedSet.expectedCardCount) { setError(`This set already has its expected ${selectedSet.expectedCardCount} card slots.`); return; }
    const id = `${selectedSet.id}:${number}`;
    if (vault.catalog.cards.some((card) => card.id === id)) { setError(`Card ID ${id} already exists.`); return; }
    const card: CardDefinition = { id, setId: selectedSet.id, number, name, rarity: String(data.get('rarity') ?? '').trim() || undefined };
    setVault((prev) => ({ ...prev, catalog: { ...prev.catalog, cards: [...prev.catalog.cards, card] } })); setModal(null); setNotice('Card added to your catalog.');
  }
  function addSet(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get('name') ?? '').trim(); const seriesId = String(data.get('seriesId') ?? '');
    if (!name || !seriesId) return;
    const id = `${seriesId}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (vault.catalog.sets.some((item) => item.id === id)) { setError('A set with that name already exists in this series.'); return; }
    const releaseNumber = String(data.get('releaseNumber') ?? '').trim() || undefined;
    const isSrg = seriesId === 'series:srg-switch';
    const set: CardSet = { id, seriesId, name, releaseNumber, ...(isSrg ? { expectedCardCount: 6 } : {}) };
    const slots: CardDefinition[] = isSrg ? ['title', '1', '2', '3', '4', '5'].map((slot) => ({ id: `${id}:${slot}`, setId: id, number: slot === 'title' ? 'Title' : slot, name: slot === 'title' ? 'Title card' : `Card ${slot}`, category: slot === 'title' ? 'Title' : 'Numbered', slot: slot === 'title' ? 'title' : 'numbered' })) : [];
    setVault((prev) => ({ ...prev, catalog: { ...prev.catalog, sets: [...prev.catalog.sets, set], cards: [...prev.catalog.cards, ...slots] } })); setSetId(id); setModal(null); setNotice(isSrg ? 'Release created with its six card slots.' : 'Set created.');
  }
  function addImage(card: CardDefinition, url: string, kind: 'verified-remote' | 'user-provided') {
    const variantId = `${card.id}:standard`;
    const variant: CardVariant = { id: variantId, cardId: card.id, name: 'Standard', imageUrls: [{ url, source: kind, ...(kind === 'verified-remote' ? { verifiedAt: new Date().toISOString() } : {}) }] };
    setVault((prev) => ({ ...prev, catalog: { ...prev.catalog, variants: [...prev.catalog.variants.filter((v) => v.id !== variantId), variant] } }));
  }
  function exportJson() { download('collect-everything-backup.json', JSON.stringify(vault, null, 2), 'application/json'); }
  function exportCsv() {
    const rows = [['card_id', 'set_id', 'card_number', 'name', 'personal', 'duplicates', 'incoming'], ...vault.catalog.cards.map((c) => [c.id, c.setId, c.number, c.name, byId.get(c.id)?.personal ?? 0, byId.get(c.id)?.duplicates ?? 0, byId.get(c.id)?.incoming ?? 0])];
    download('collect-everything-inventory.csv', rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv');
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        const parsed = parseCsv(await file.text()); if (parsed.errors.length) throw new Error(parsed.errors.join(' '));
        const checked = validateInventoryRows(parsed.rows, vault.catalog.cards); if (checked.errors.length) throw new Error(checked.errors.join(' '));
        const changed = checked.updates.filter((next) => { const current = vault.catalog.ownership.find((item) => item.cardId === next.cardId); return !current || current.personal !== next.personal || current.duplicates !== next.duplicates || current.incoming !== next.incoming; });
        if (changed.length && !window.confirm(`This CSV changes quantities for ${changed.length} card${changed.length === 1 ? '' : 's'}. Apply those inventory updates? Other card records will be kept.`)) return;
        const proposed = new Map(vault.catalog.ownership.map((x) => [x.cardId, x])); checked.updates.forEach((x) => proposed.set(x.cardId, x));
        setVault((prev) => ({ ...prev, catalog: { ...prev.catalog, ownership: [...proposed.values()] } })); setNotice(`Imported ${parsed.rows.length} inventory rows.`);
      } else {
        const incoming = migrateVault(JSON.parse(await file.text()));
        const conflicts = findConflicts(vault, incoming);
        if (conflicts.length) throw new Error(`Restore paused: ${conflicts.length} overlapping records differ. Export a backup and review both files before choosing a copy. ${conflicts.slice(0, 2).join(' ')}`);
        const merge = window.confirm(`Restore ${incoming.catalog.cards.length} cards and merge non-conflicting records with your current vault? No records will be deleted.`);
        if (!merge) return;
        setVault(mergeVault(vault, incoming));
        const srgStart = incoming.catalog.sets.find((item) => item.seriesId === 'series:srg-switch' && item.sourceCompletionIndicator);
        if (srgStart) setSetId(srgStart.id);
        setNotice(`Backup restored with ${incoming.catalog.sets.filter((item) => item.seriesId === 'series:srg-switch').length} Super Rare releases.`);
      }
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); }
  }

  const activeName = selectedSet ? `${selectedSeries?.name ?? 'Collection'} ${selectedSet.name}` : 'All cards';

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-wordmark" src={`${import.meta.env.BASE_URL}collect-wordmark.svg`} alt="Collect!"/><small>EVERYTHING, COLLECTED.</small></div>
      <button className="nav-item active"><Grid2X2 size={18} /> Overview</button>
      <div className="sidebar-label">YOUR COLLECTIONS <button aria-label="Add a set" className="icon-button small" onClick={() => setModal('add-set')}><Plus size={15} /></button></div>
      {vault.catalog.series.map((series, index) => { const sets = vault.catalog.sets.filter((set) => set.seriesId === series.id); const ids = new Set(sets.map((set) => set.id)); const owned = completion(vault.catalog.cards.filter((card) => ids.has(card.setId)), vault.catalog.ownership).owned; const total = vault.catalog.cards.filter((card) => ids.has(card.setId)).length; return <button className={`collection-nav ${series.id === selectedSeries?.id ? 'chosen' : ''}`} key={series.id} onClick={() => { if (sets[0]) setSetId(sets[0].id); else setModal('add-set'); }}><span className={`collection-dot ${index === 0 ? 'lime' : 'purple'}`}></span><span>{series.name}<small>{series.id === 'series:kayou-naruto' ? 'NREA02 · NREA03' : 'Nintendo Switch releases'}</small></span><span className="nav-count">{owned}/{total}</span></button>; })}
      <div className="sidebar-foot"><div className="local-badge"><span className="pulse"></span>Local vault <span>●</span></div><p>Your collection lives on this device.</p><button className="nav-item" onClick={() => setModal('help')}><CircleHelp size={17} /> How it works</button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="crumb">COLLECTIONS <span>/</span> <b>{activeName.toUpperCase()}</b></div><div className="mobile-brand"><img src={`${import.meta.env.BASE_URL}collect-wordmark.svg`} alt="Collect!"/></div><div className="top-actions"><span className="sync-label"><ShieldCheck size={15} /> Saved on this device</span><button className="avatar" aria-label="Local profile">V</button></div></header>
      <div className="content-wrap">
        <section className="welcome-row"><div><div className="eyebrow"><Sparkles size={14} /> YOUR COLLECTION, IN FOCUS</div><h1>Good to see you.<br/><span>Let’s make some room.</span></h1><p className="lede">A considered home for every card you’re chasing.</p></div><div className="progress-orbit" aria-label={`${allProgress.owned} of ${allProgress.total} cards owned`}><div><strong>{allProgress.percent}<small>%</small></strong><span>COMPLETE</span></div><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="51"/><circle className="orbit-progress" cx="60" cy="60" r="51" style={{ strokeDashoffset: 320 - 320 * allProgress.percent / 100 }}/></svg></div></section>

        <section className="summary-grid" aria-label="Collection summary"><Metric label="UNIQUE CARDS" value={allProgress.total.toString().padStart(2, '0')} detail="across all collections" icon={<BookOpen size={17}/>} /><Metric label="IN YOUR VAULT" value={allProgress.owned.toString().padStart(2, '0')} detail="unique definitions owned" icon={<Check size={17}/>} /><Metric label="STILL CHASING" value={vault.catalog.cards.filter((c) => cardStatus(c.id, vault.catalog.ownership) === 'missing').length.toString().padStart(2, '0')} detail="not yet in your collection" icon={<ImagePlus size={17}/>} /><Metric label="ON THE WAY" value={vault.catalog.ownership.reduce((sum, x) => sum + x.incoming, 0).toString().padStart(2, '0')} detail="incoming copies" icon={<ArrowDownToLine size={17}/>} /></section>

        <section className="collection-section">
          <div className="section-heading"><div><div className="eyebrow">THE ARCHIVE</div><h2>Your collections <span className="heading-count">{vault.catalog.series.length.toString().padStart(2, '0')}</span></h2></div><button className="button outline" onClick={() => setModal('add-set')}><Plus size={16}/> Add a set</button></div>
          <div className="collection-cards">{vault.catalog.series.map((series, index) => {
            const sets = vault.catalog.sets.filter((s) => s.seriesId === series.id); const ids = new Set(sets.map((s) => s.id)); const seriesCards = vault.catalog.cards.filter((c) => ids.has(c.setId)); const done = completion(seriesCards, vault.catalog.ownership); const title = series.name; const accent = index === 0 ? 'cover-naruto' : 'cover-blue';
            return <button className={`collection-card ${accent}`} key={series.id} onClick={() => { if (sets[0]) setSetId(sets[0].id); else setModal('add-set'); }}><span className="cover-orb"></span><span className="cover-content"><span className="cover-tag">{index === 0 ? 'ANIME · TCG' : 'GAMING · PROMO'}</span><strong>{title}</strong><span className="cover-sub">{index === 0 ? 'NREA02 · NREA03' : 'NINTENDO SWITCH RELEASE CARDS'}</span><span className="cover-footer"><span>{done.owned} / {done.total} CARDS</span><span className="cover-arrow">↗</span></span></span><span className="cover-meta"><span>{initialStatus[title] ?? 'Collection'}</span><span className="mini-progress"><i style={{ width: `${done.percent}%` }} /></span></span></button>;
          })}<button className="new-collection" onClick={() => setModal('add-set')}><span><Plus size={20}/></span><strong>Start a collection</strong><small>Build a set from the cards you love.</small></button></div>
        </section>

        <section className="cards-section">
            <div className="section-heading cards-heading"><div><div className="eyebrow">CARD BY CARD</div><h2>{selectedSet?.name ?? 'Your cards'} <span className="heading-count">{cards.length.toString().padStart(2, '0')}</span></h2>{selectedSet?.sourceCompletionIndicator && <div className={`source-marker ${selectedSet.sourceCompletionIndicator}`}>Workbook: {selectedSet.sourceCompletionIndicator === 'complete' ? 'green / complete' : selectedSet.sourceCompletionIndicator === 'incomplete' ? 'yellow / incomplete' : 'unmarked'}{selectedSet.sourceCompletionIndicator !== 'unmarked' && ((selectedSet.sourceCompletionIndicator === 'complete') !== (progress.percent === 100)) && <b> · differs from current quantities</b>}</div>}</div><div className="heading-actions">{selectedSeries && vault.catalog.sets.filter((set) => set.seriesId === selectedSeries.id).length > 1 && <label className="set-picker-label"><span>SET</span><select aria-label="Select set" value={selectedSet?.id ?? ''} onChange={(e) => setSetId(e.target.value)}>{vault.catalog.sets.filter((set) => set.seriesId === selectedSeries.id).map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>}<button className="button primary" onClick={() => setModal('add-card')}><Plus size={16}/> Add card</button></div></div>
          <div className="toolbar"><div className="search-box"><Search size={16}/><input aria-label="Search cards" placeholder="Find a card, number, rarity…" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}</div><div className="tool-right"><button className={`button subtle ${showFilters ? 'selected' : ''}`} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={15}/> Filters {filter !== 'all' && <i className="filter-dot"/>}</button><div className="view-switch" aria-label="Card view">{(['gallery', 'list', 'checklist'] as View[]).map((v) => <button key={v} className={view === v ? 'active' : ''} aria-label={`${v} view`} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'gallery' ? <Grid2X2 size={15}/> : v === 'list' ? <List size={16}/> : <Check size={16}/>}</button>)}</div></div></div>
          {showFilters && <div className="filter-row"><span>SHOW</span>{(['all', 'owned', 'missing', 'incoming', 'duplicate'] as Filter[]).map((value) => <button key={value} className={`filter-chip ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{value === 'all' ? 'Everything' : value[0].toUpperCase() + value.slice(1)}</button>)}<span className="filter-spacer"/><label className="toggle-label"><input type="checkbox" checked={statusFilter} onChange={(e) => setStatusFilter(e.target.checked)}/> Show status</label></div>}
          {srgSets.length > 0 && <div className="source-review"><span><b>Super Rare workbook check</b>{markerDiscrepancies.length} marker mismatches · {unmarkedSets.length} unmarked releases</span><button onClick={() => setReviewImport(true)}>Review details</button></div>}
          <div className="result-line"><span>{visibleCards.length} {visibleCards.length === 1 ? 'card' : 'cards'} <span>· {filter === 'all' ? 'all statuses' : filter}</span></span><span>{progress.owned} of {progress.total} collected</span></div>
          {visibleCards.length ? <div className={`card-grid ${view}-view`}>{visibleCards.map((card) => <CardTile key={card.id} card={card} inventory={byId.get(card.id)} variants={vault.catalog.variants.filter((v) => v.cardId === card.id)} view={view} showStatus={statusFilter} onOpen={() => setSelected(card)} onQuantity={updateOwnership}/>)}</div> : <div className="empty-state"><div className="empty-art"><Archive size={27}/><span>✦</span></div><h3>{cards.length ? 'Nothing in this view yet' : 'Your card gallery is ready'}</h3><p>{cards.length ? 'Try another filter or search term.' : 'Add cards one by one, or import a validated inventory file to get started.'}</p>{cards.length === 0 && <button className="button primary" onClick={() => setModal('add-card')}><Plus size={16}/> Add your first card</button>}</div>}
        </section>

        <section className="local-panel"><div className="panel-icon"><ShieldCheck size={19}/></div><div><strong>Your vault stays yours.</strong><p>Saved locally, ready offline. Make a backup whenever you like.</p></div><div className="panel-actions"><button onClick={exportJson}><Download size={15}/> Backup</button><button onClick={exportCsv}><ArrowUpFromLine size={15}/> CSV</button><label className="panel-import"><Upload size={15}/> Import<input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => void importFile(e.target.files?.[0])}/></label></div></section>
        <footer>COLLECT EVERYTHING <span>·</span> VERSION 0.1 <button onClick={() => setModal('help')}><Settings2 size={13}/> LOCAL SETTINGS</button></footer>
      </div>
    </main>
    {notice && <div className="toast success"><Check size={16}/>{notice}</div>}
    {error && <div className="toast error"><X size={16}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
    {modal && <Modal title={modal === 'add-card' ? 'Add a card' : modal === 'add-set' ? 'Add a set' : 'A little about your vault'} onClose={() => setModal(null)}>{modal === 'add-card' ? <form onSubmit={addCard} className="form-stack"><p>Card IDs are namespaced to this set, so the same number can exist in another collection.</p><label>Set<select value={setId} onChange={(e) => setSetId(e.target.value)}>{vault.catalog.sets.map((s) => <option value={s.id} key={s.id}>{seriesMap.get(s.seriesId)?.name} · {s.name}</option>)}</select></label><div className="form-row"><label>Card number<input name="number" placeholder="e.g. 01" required/></label><label>Rarity <span className="optional">OPTIONAL</span><input name="rarity" placeholder="Leave blank if none"/></label></div><label>Card name<input name="name" placeholder="Name on the card" required/></label><button className="button primary full"><Plus size={16}/> Add card</button></form> : modal === 'add-set' ? <form onSubmit={addSet} className="form-stack"><p>Sets can be numbered releases or any named checklist, with or without rarity tiers.</p><label>Collection<select name="seriesId" required>{vault.catalog.series.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label>Set or release name<input name="name" placeholder="e.g. NREA01 or Release 042" required/></label><label>Release number <span className="optional">OPTIONAL</span><input name="releaseNumber" placeholder="For numbered releases"/></label><button className="button primary full"><Plus size={16}/> Create set</button></form> : <div className="help-copy"><p><b>Local-first.</b> Your catalog and quantities are stored in this browser’s IndexedDB. They work offline after the first load.</p><p><b>Move your data.</b> JSON includes the versioned catalog. CSV imports require <code>card_id, personal, incoming</code> with optional <code>duplicates</code> and can only update known card IDs.</p><p><b>Safe sync.</b> Private GitHub sync is not connected in this foundation. No access token is stored here; use backups until a token-safe sync service is added.</p><p><b>Images.</b> Open a card to add a user image URL. Mark a remote image as verified only after checking it is the exact card.</p></div>}</Modal>}
    {reviewImport && <Modal title="Workbook comparison" onClose={() => setReviewImport(false)}><div className="report-copy"><p>Workbook markers are preserved as source metadata. Completion is calculated from Personal plus Dupes quantities.</p><h3>Color markers that differ from the quantities</h3>{markerDiscrepancies.length ? <ul>{markerDiscrepancies.map((set) => { const missing = vault.catalog.cards.filter((card) => card.setId === set.id && (byId.get(card.id)?.personal ?? 0) + (byId.get(card.id)?.duplicates ?? 0) === 0); return <li key={set.id}><b>{set.name}</b> · {set.sourceCompletionIndicator === 'complete' ? 'green' : 'yellow'} · row {set.sourceRow} · {missing.length ? `no physical copy for ${missing.map((card) => card.number).join(', ')}` : 'every slot has a physical copy'}</li>; })}</ul> : <p>None.</p>}<h3>Titles without a color marker</h3>{unmarkedSets.length ? <ul>{unmarkedSets.map((set) => <li key={set.id}><b>{set.name}</b> · row {set.sourceRow}</li>)}</ul> : <p>None.</p>}<p className="report-foot">Imported from Switch Games. Card notes in the final column are preserved verbatim.</p></div></Modal>}
    {selected && <CardDetail card={selected} inventory={byId.get(selected.id)} variants={vault.catalog.variants.filter((v) => v.cardId === selected.id)} onClose={() => setSelected(null)} onQuantity={updateOwnership} onImage={addImage}/>}
  </div>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) { return <div className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{detail}</small></div>; }
function CardTile({ card, inventory, variants, view, showStatus, onOpen, onQuantity }: { card: CardDefinition; inventory?: Ownership; variants: CardVariant[]; view: View; showStatus: boolean; onOpen: () => void; onQuantity: (c: CardDefinition, f: 'personal' | 'duplicates' | 'incoming', q: number) => void }) {
  const status = cardStatus(card.id, inventory ? [inventory] : []); const image = variants[0]?.imageUrls[0]?.url; const physicallyOwned = (inventory?.personal ?? 0) + (inventory?.duplicates ?? 0) > 0;
  return <article className={`card-tile ${view === 'list' ? 'tile-list' : ''} ${view === 'checklist' ? 'tile-check' : ''} ${physicallyOwned ? 'has-owned' : ''}`}>
    <button className="card-image" onClick={onOpen} aria-label={`Open ${card.name}`}><span className="card-index">{card.number}</span>{image ? <img src={image} alt={card.name} loading="lazy"/> : <span className="placeholder"><span className="placeholder-mark">✳</span><small>IMAGE NOT ADDED</small></span>}{showStatus && <span className={`status-tag ${status}`}>{status}</span>}</button>
    <div className="tile-info"><button className="tile-title" onClick={onOpen}>{card.name}</button><span>{card.rarity || card.category || 'No rarity'}{card.sourceNote ? ` · ${card.sourceNote}` : ''}</span></div>
    <div className="tile-qty"><Quantity label="PERSONAL" value={inventory?.personal ?? 0} onChange={(n) => onQuantity(card, 'personal', n)}/><Quantity label="DUPES" value={inventory?.duplicates ?? 0} onChange={(n) => onQuantity(card, 'duplicates', n)}/><button className="incoming-action" onClick={() => onQuantity(card, 'incoming', (inventory?.incoming ?? 0) + 1)}>+ incoming {inventory?.incoming ? `(${inventory.incoming})` : ''}</button></div>
  </article>;
}
function CardDetail({ card, inventory, variants, onClose, onQuantity, onImage }: { card: CardDefinition; inventory?: Ownership; variants: CardVariant[]; onClose: () => void; onQuantity: (c: CardDefinition, f: 'personal' | 'duplicates' | 'incoming', q: number) => void; onImage: (c: CardDefinition, url: string, kind: 'verified-remote' | 'user-provided') => void }) {
  const [url, setUrl] = useState(''); const [kind, setKind] = useState<'verified-remote' | 'user-provided'>('user-provided'); const image = variants[0]?.imageUrls[0]?.url;
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button className="modal-close" aria-label="Close card detail" onClick={onClose}><X size={18}/></button><div className="detail-image">{image ? <img src={image} alt={card.name}/> : <div className="placeholder"><span className="placeholder-mark">✳</span><small>NO IMAGE YET</small></div>}</div><div className="detail-content"><div className="eyebrow">CARD DETAIL · {card.number}</div><h2 id="detail-title">{card.name}</h2><p className="detail-rarity">{card.rarity || 'No rarity assigned'} <span>·</span> {card.id}</p><div className="detail-counts"><Quantity label="PERSONAL" value={inventory?.personal ?? 0} onChange={(n) => onQuantity(card, 'personal', n)}/><Quantity label="DUPES" value={inventory?.duplicates ?? 0} onChange={(n) => onQuantity(card, 'duplicates', n)}/><Quantity label="INCOMING" value={inventory?.incoming ?? 0} onChange={(n) => onQuantity(card, 'incoming', n)}/></div>{card.sourceNote && <p className="detail-rarity">Workbook note: {card.sourceNote}</p>}<div className="image-editor"><strong>Card image</strong><p>Only add a verified URL when you’ve confirmed it shows this exact card.</p><div className="image-add-row"><input aria-label="Image URL" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)}/><select aria-label="Image source" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="user-provided">My image</option><option value="verified-remote">Verified URL</option></select><button className="button primary" disabled={!url} onClick={() => { onImage(card, url, kind); setUrl(''); }}>Save</button></div></div></div></section></div>;
}
function Quantity({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) { return <div><small>{label}</small><span><button aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => onChange(value - 1)}>−</button><b>{value}</b><button aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onChange(value + 1)}>+</button></span></div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="form-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="modal-close" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>{children}</section></div>; }
function download(name: string, value: string, mime: string) { const url = URL.createObjectURL(new Blob([value], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function csvCell(value: string | number) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function mergeVault(local: VaultData, remote: VaultData): VaultData {
  const mergeById = <T extends { id: string }>(a: T[], b: T[]) => [...a, ...b.filter((y) => !a.some((x) => x.id === y.id))];
  const ownership = [...local.catalog.ownership]; for (const incoming of remote.catalog.ownership) if (!ownership.some((x) => x.cardId === incoming.cardId)) ownership.push(incoming);
  return { schemaVersion: local.schemaVersion, updatedAt: new Date().toISOString(), catalog: { publishers: mergeById(local.catalog.publishers, remote.catalog.publishers), franchises: mergeById(local.catalog.franchises, remote.catalog.franchises), series: mergeById(local.catalog.series, remote.catalog.series), sets: mergeById(local.catalog.sets, remote.catalog.sets), cards: mergeById(local.catalog.cards, remote.catalog.cards), variants: mergeById(local.catalog.variants, remote.catalog.variants), ownership, acquisitions: mergeById(local.catalog.acquisitions, remote.catalog.acquisitions) } };
}
