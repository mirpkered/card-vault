import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Archive, ArrowDownToLine, ArrowUpFromLine, BookOpen, Check, CircleHelp, Cloud, Download, Grid2X2, ImagePlus, List, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-react';
import { cardStatus, completion, emptyVault, filterCards, findConflicts, getTrackedCards, migrateVault, parseCsv, sortCardsByNumber, validateInventoryRows, type CardDefinition, type CardSet, type CardVariant, type CollectionCategory, type Ownership, type VaultData } from '../domain';
import { loadVault, saveVault } from '../storage';
import { applyNarutoCatalogUpdate, parseNarutoCatalogUpdate, planNarutoCatalogUpdate, type NarutoCatalogUpdate } from '../narutoCatalog';
import { applyFinalFantasyCatalogUpdate, parseFinalFantasyCatalogUpdate, planFinalFantasyCatalogUpdate, type FinalFantasyCatalogUpdate } from '../finalFantasyCatalog';
import { useCloudSync } from '../useCloudSync';
import { SyncPanel } from './SyncPanel';
import './sync.css';

type View = 'gallery' | 'list' | 'checklist';
type Filter = 'all' | 'owned' | 'missing' | 'incoming' | 'duplicate';
const categories: { id: CollectionCategory; label: string }[] = [{ id: 'cards', label: 'Cards' }, { id: 'media', label: 'Media' }, { id: 'misc', label: 'Misc' }];

export default function App() {
  const [vault, setVault] = useState<VaultData>(emptyVault);
  const [ready, setReady] = useState(false);
  const [setId, setSetId] = useState('set:kayou-naruto-nrea02');
  const [activeCategory, setActiveCategory] = useState<CollectionCategory>('cards');
  const [view, setView] = useState<View>('gallery');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CardDefinition | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>();
  const [modal, setModal] = useState<'add-card' | 'add-set' | 'add-collection' | 'manage-sets' | 'help' | 'sync' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState(false);
  const [manageSetsSearch, setManageSetsSearch] = useState('');
  const [narutoCatalogUpdate, setNarutoCatalogUpdate] = useState<NarutoCatalogUpdate | null>(null);
  const [showNarutoUpdateReview, setShowNarutoUpdateReview] = useState(false);
  const [finalFantasyCatalogUpdate, setFinalFantasyCatalogUpdate] = useState<FinalFantasyCatalogUpdate | null>(null);
  const [showFinalFantasyUpdateReview, setShowFinalFantasyUpdateReview] = useState(false);
  const cloudSync = useCloudSync(vault, setVault, ready);

  useEffect(() => { loadVault().then((data) => { setVault(data); setReady(true); }).catch((e: Error) => { setError(`Could not open local vault: ${e.message}`); setReady(true); }); }, []);
  useEffect(() => { if (ready) saveVault(vault).catch((e: Error) => setError(`Save failed: ${e.message}`)); }, [vault, ready]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    fetch(import.meta.env.BASE_URL + 'naruto-catalog.json')
      .then((response) => { if (!response.ok) throw new Error('Catalog update is unavailable.'); return response.json(); })
      .then((value: unknown) => { if (active) setNarutoCatalogUpdate(parseNarutoCatalogUpdate(value)); })
      .catch(() => { /* Local collection use continues if the update file is unavailable. */ });
    return () => { active = false; };
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    fetch(import.meta.env.BASE_URL + 'fftcg-catalog.json')
      .then((response) => { if (!response.ok) throw new Error('Catalog update is unavailable.'); return response.json(); })
      .then((value: unknown) => { if (active) setFinalFantasyCatalogUpdate(parseFinalFantasyCatalogUpdate(value)); })
      .catch(() => { /* Local collection use continues if the update file is unavailable. */ });
    return () => { active = false; };
  }, [ready]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3600); return () => window.clearTimeout(timer); }, [notice]);

  const seriesMap = new Map(vault.catalog.series.map((x) => [x.id, x]));
  const seriesCategory = (seriesId: string) => seriesMap.get(seriesId)?.category ?? 'cards';
  const categorySeries = vault.catalog.series.filter((series) => seriesCategory(series.id) === activeCategory);
  const trackedSets = vault.catalog.sets.filter((set) => set.tracked);
  const trackedCards = getTrackedCards(vault.catalog);
  const categoryTrackedSets = trackedSets.filter((set) => categorySeries.some((series) => series.id === set.seriesId));
  const selectedSet = trackedSets.find((x) => x.id === setId && seriesCategory(x.seriesId) === activeCategory);
  const selectedSeries = selectedSet ? seriesMap.get(selectedSet.seriesId) : undefined;
  const cards = useMemo(() => {
    const inSet = vault.catalog.cards.filter((card) => !selectedSet || card.setId === selectedSet.id);
    return selectedSet?.seriesId === 'series:final-fantasy-tcg' ? sortCardsByNumber(inSet) : inSet;
  }, [vault.catalog.cards, selectedSet?.id, selectedSet?.seriesId]);
  const byId = new Map<string, Ownership[]>();
  for (const item of vault.catalog.ownership) byId.set(item.cardId, [...(byId.get(item.cardId) ?? []), item]);
  const inventoryForCard = (cardId: string) => byId.get(cardId) ?? [];
  const visibleCards = useMemo(() => filterCards(cards, vault.catalog.ownership, filter, query), [cards, filter, query, vault.catalog.ownership]);
  const progress = completion(cards, vault.catalog.ownership);
  const allProgress = completion(trackedCards, vault.catalog.ownership);
  const currentItemLabel = activeCategory === 'cards' ? 'card' : activeCategory === 'media' ? 'DVD' : 'item';
  const itemPlural = activeCategory === 'cards' ? 'cards' : activeCategory === 'media' ? 'DVDs' : 'items';
  const [reviewImport, setReviewImport] = useState(false);
  const setManagerRows = vault.catalog.sets.filter((set) => {
    const normalized = manageSetsSearch.trim().toLowerCase();
    return !normalized || `${seriesMap.get(set.seriesId)?.name ?? ''} ${set.name}`.toLowerCase().includes(normalized);
  });
  const setManagerSeries = vault.catalog.series.filter((series) => setManagerRows.some((set) => set.seriesId === series.id));
  const narutoUpdatePlan = useMemo(() => narutoCatalogUpdate ? planNarutoCatalogUpdate(vault, narutoCatalogUpdate) : null, [vault, narutoCatalogUpdate]);
  const finalFantasyUpdatePlan = useMemo(() => finalFantasyCatalogUpdate ? planFinalFantasyCatalogUpdate(vault, finalFantasyCatalogUpdate) : null, [vault, finalFantasyCatalogUpdate]);
  const srgSets = vault.catalog.sets.filter((set) => set.tracked && set.sourceCompletionIndicator !== undefined);
  const markerDiscrepancies = srgSets.filter((set) => set.sourceCompletionIndicator !== 'unmarked' && ((set.sourceCompletionIndicator === 'complete') !== (completion(vault.catalog.cards.filter((card) => card.setId === set.id), vault.catalog.ownership).percent === 100)));
  const unmarkedSets = srgSets.filter((set) => set.sourceCompletionIndicator === 'unmarked');

  function updateSetTracking(id: string, tracked: boolean) {
    const target = vault.catalog.sets.find((set) => set.id === id);
    if (!target) return;
    setVault((prev) => ({ ...prev, updatedAt: new Date().toISOString(), catalog: { ...prev.catalog, sets: prev.catalog.sets.map((set) => set.id === id ? { ...set, tracked } : set) } }));
    if (tracked && !trackedSets.some((set) => set.seriesId === target.seriesId)) {
      setActiveCategory(seriesCategory(target.seriesId));
      setSetId(id);
    } else if (!tracked && setId === id) {
      setSetId(vault.catalog.sets.find((set) => set.seriesId === target.seriesId && set.id !== id && set.tracked)?.id ?? '');
    }
  }

  function updateOwnership(card: CardDefinition, field: 'personal' | 'duplicates' | 'incoming', quantity: number, requestedVariantId?: string) {
    const variantId = requestedVariantId ?? vault.catalog.variants.find((variant) => variant.cardId === card.id && variant.treatment === 'normal')?.id;
    setVault((prev) => {
      const found = prev.catalog.ownership.find((item) => item.cardId === card.id && (item.variantId ?? null) === (variantId ?? null));
      const record: Ownership = { cardId: card.id, ...(variantId ? { variantId } : {}), personal: found?.personal ?? 0, duplicates: found?.duplicates ?? 0, duplicatesKnown: field === 'duplicates' ? true : found?.duplicatesKnown ?? true, incoming: found?.incoming ?? 0, updatedAt: new Date().toISOString(), [field]: Math.max(0, Math.floor(quantity)) };
      const ownership = [...prev.catalog.ownership.filter((item) => item.cardId !== card.id || (item.variantId ?? null) !== (variantId ?? null)), record];
      return { ...prev, updatedAt: new Date().toISOString(), catalog: { ...prev.catalog, ownership } };
    });
  }
  function addCard(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const category = selectedSeries?.category ?? 'cards';
    const enteredNumber = String(data.get('number') ?? '').trim();
    const number = enteredNumber || (category === 'cards' ? '' : slugify(name));
    if (!selectedSet || !number || !name) return;
    if (selectedSet.expectedCardCount !== undefined && vault.catalog.cards.filter((card) => card.setId === selectedSet.id).length >= selectedSet.expectedCardCount) { setError(`This set already has its expected ${selectedSet.expectedCardCount} card slots.`); return; }
    const id = `${selectedSet.id}:${number}`;
    if (vault.catalog.cards.some((card) => card.id === id)) { setError(`${category === 'cards' ? 'Card' : 'Item'} ID ${id} already exists. Use a distinct identifier for this entry.`); return; }
    const card: CardDefinition = { id, setId: selectedSet.id, number, name, ...(category === 'cards' ? { rarity: String(data.get('rarity') ?? '').trim() || undefined } : { category: category === 'media' ? 'DVD' : 'Item' }) };
    setVault((prev) => ({ ...prev, updatedAt: new Date().toISOString(), catalog: { ...prev.catalog, cards: [...prev.catalog.cards, card] } })); setModal(null); setNotice(`${category === 'cards' ? 'Card' : 'Item'} added to your catalog.`);
  }
  function addCollection(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim(); const firstSet = String(data.get('firstSet') ?? '').trim();
    const category = String(data.get('category') ?? activeCategory) as CollectionCategory;
    if (!name || !firstSet || !categories.some((item) => item.id === category)) return;
    const slug = slugify(name); const setSlug = slugify(firstSet);
    if (!slug || !setSlug) { setError('Use a collection name and a set or list name with letters or numbers.'); return; }
    const seriesId = `series:${category}:${slug}`; const id = `set:${category}:${slug}:${setSlug}`;
    if (vault.catalog.series.some((item) => item.id === seriesId)) { setError(`A ${categoryLabel(category).toLowerCase()} collection with that name already exists.`); return; }
    const series = { id: seriesId, name, category };
    const set: CardSet = { id, seriesId, name: firstSet, tracked: true };
    setVault((prev) => ({ ...prev, updatedAt: new Date().toISOString(), catalog: { ...prev.catalog, series: [...prev.catalog.series, series], sets: [...prev.catalog.sets, set] } }));
    setActiveCategory(category); setSetId(id); setModal(null); setNotice(`${name} added to ${categoryLabel(category)}.`);
  }
  function addSet(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get('name') ?? '').trim(); const seriesId = String(data.get('seriesId') ?? '');
    if (!name || !seriesId) return;
    const slug = slugify(name);
    if (!slug) { setError('Use a set or list name with letters or numbers.'); return; }
    const id = `set:${seriesId.replace(/^series:/, '')}:${slug}`;
    if (vault.catalog.sets.some((item) => item.id === id)) { setError('A set with that name already exists in this series.'); return; }
    const releaseNumber = String(data.get('releaseNumber') ?? '').trim() || undefined;
    const isSrg = seriesId === 'series:srg-switch';
    const set: CardSet = { id, seriesId, name, releaseNumber, tracked: true, ...(isSrg ? { expectedCardCount: 6 } : {}) };
    const slots: CardDefinition[] = isSrg ? ['title', '1', '2', '3', '4', '5'].map((slot) => ({ id: `${id}:${slot}`, setId: id, number: slot === 'title' ? 'Title' : slot, name: slot === 'title' ? 'Title card' : `Card ${slot}`, category: slot === 'title' ? 'Title' : 'Numbered', slot: slot === 'title' ? 'title' : 'numbered' })) : [];
    setVault((prev) => ({ ...prev, updatedAt: new Date().toISOString(), catalog: { ...prev.catalog, sets: [...prev.catalog.sets, set], cards: [...prev.catalog.cards, ...slots] } })); setActiveCategory(seriesCategory(seriesId)); setSetId(id); setModal(null); setNotice(isSrg ? 'Release created with its six card slots.' : 'Set or list created.');
  }
  function addImage(card: CardDefinition, url: string, kind: 'verified-remote' | 'user-provided', requestedVariantId?: string) {
    const variantId = requestedVariantId ?? `${card.id}:standard`;
    const source = { url, source: kind, ...(kind === 'verified-remote' ? { verifiedAt: new Date().toISOString() } : {}) } as const;
    setVault((prev) => {
      const current = prev.catalog.variants.find((variant) => variant.id === variantId);
      const variant: CardVariant = current
        ? { ...current, imageUrls: current.imageUrls.some((image) => image.url === url) ? current.imageUrls : [...current.imageUrls, source] }
        : { id: variantId, cardId: card.id, name: 'Standard', imageUrls: [source] };
      return { ...prev, updatedAt: new Date().toISOString(), catalog: { ...prev.catalog, variants: [...prev.catalog.variants.filter((item) => item.id !== variantId), variant] } };
    });
  }
  function exportJson() { download('collect-everything-backup.json', JSON.stringify(vault, null, 2), 'application/json'); }
  function exportCsv() {
    const rows: (string | number | boolean)[][] = [['card_id', 'set_id', 'card_number', 'name', 'variant_id', 'personal', 'duplicates', 'duplicates_known', 'incoming']];
    for (const card of vault.catalog.cards) {
      const treatments = vault.catalog.variants.filter((variant) => variant.cardId === card.id && variant.treatment);
      const versions: (CardVariant | undefined)[] = treatments.length ? treatments : [undefined];
      for (const variant of versions) {
        const item = vault.catalog.ownership.find((ownership) => ownership.cardId === card.id && (ownership.variantId ?? null) === (variant?.id ?? null));
        rows.push([card.id, card.setId, card.number, card.name, variant?.id ?? '', item?.personal ?? 0, item?.duplicates ?? 0, item?.duplicatesKnown !== false, item?.incoming ?? 0]);
      }
    }
    download('collect-everything-inventory.csv', rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv');
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        const parsed = parseCsv(await file.text()); if (parsed.errors.length) throw new Error(parsed.errors.join(' '));
        const checked = validateInventoryRows(parsed.rows, vault.catalog.cards, vault.catalog.variants); if (checked.errors.length) throw new Error(checked.errors.join(' '));
        const effectiveUpdates = checked.updates.map((next) => {
          const current = vault.catalog.ownership.find((item) => item.cardId === next.cardId && (item.variantId ?? null) === (next.variantId ?? null));
          return next.duplicatesKnown === undefined && current?.duplicatesKnown !== undefined ? { ...next, duplicatesKnown: current.duplicatesKnown } : next;
        });
        const changed = effectiveUpdates.filter((next) => { const current = vault.catalog.ownership.find((item) => item.cardId === next.cardId && (item.variantId ?? null) === (next.variantId ?? null)); return !current || current.personal !== next.personal || current.duplicates !== next.duplicates || current.incoming !== next.incoming || (current.duplicatesKnown ?? true) !== (next.duplicatesKnown ?? true); });
        if (changed.length && !window.confirm(`This CSV changes quantities for ${changed.length} card${changed.length === 1 ? '' : 's'}. Apply those inventory updates? Other card records will be kept.`)) return;
        const proposed = new Map(vault.catalog.ownership.map((item) => [JSON.stringify([item.cardId, item.variantId ?? null]), item])); effectiveUpdates.forEach((item) => proposed.set(JSON.stringify([item.cardId, item.variantId ?? null]), item));
        setVault((prev) => ({ ...prev, catalog: { ...prev.catalog, ownership: [...proposed.values()] } })); setNotice(`Imported ${parsed.rows.length} inventory rows.`);
      } else {
        const incoming = migrateVault(JSON.parse(await file.text()));
        const conflicts = findConflicts(vault, incoming);
        if (conflicts.length) throw new Error(`Restore paused: ${conflicts.length} overlapping records differ. Export a backup and review both files before choosing a copy. ${conflicts.slice(0, 2).join(' ')}`);
        const merge = window.confirm(`Restore ${incoming.catalog.cards.length} cards and merge non-conflicting records with your current vault? No records will be deleted.`);
        if (!merge) return;
        setVault(mergeVault(vault, incoming));
        const preferredSet = incoming.catalog.sets.find((item) => item.seriesId === 'series:srg-switch' && item.sourceCompletionIndicator) ?? incoming.catalog.sets[0];
        if (preferredSet) { setActiveCategory(seriesCategory(preferredSet.seriesId)); setSetId(preferredSet.id); }
        setNotice(`Backup restored with ${incoming.catalog.cards.length} card definitions across ${incoming.catalog.sets.length} sets.`);
      }
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); }
  }

  function applyNarutoUpdate() {
    if (!narutoCatalogUpdate || !narutoUpdatePlan?.hasChanges || narutoUpdatePlan.conflicts.length) return;
    try {
      setVault(applyNarutoCatalogUpdate(vault, narutoCatalogUpdate));
      setShowNarutoUpdateReview(false);
      setNotice('Naruto Kayou catalog added. Your quantities were kept.');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Naruto catalog update failed.');
    }
  }

  function applyFinalFantasyUpdate() {
    if (!finalFantasyCatalogUpdate || !finalFantasyUpdatePlan?.hasChanges || finalFantasyUpdatePlan.conflicts.length) return;
    try {
      setVault(applyFinalFantasyCatalogUpdate(vault, finalFantasyCatalogUpdate));
      setActiveCategory('cards');
      setSetId(finalFantasyCatalogUpdate.sets.find((set) => set.trackedByDefault)?.id ?? '');
      setShowFinalFantasyUpdateReview(false);
      setNotice(`Added ${finalFantasyCatalogUpdate.sets.length} Final Fantasy TCG sets, ${finalFantasyCatalogUpdate.cards.length.toLocaleString()} card definitions, and separate Normal/Foil versions. Existing quantities remain on Normal.`);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Final Fantasy catalog update failed.');
    }
  }

  const activeName = selectedSet ? `${selectedSeries?.name ?? 'Collection'} ${selectedSet.name}` : categoryLabel(activeCategory);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-wordmark" src={`${import.meta.env.BASE_URL}collect-wordmark.svg`} alt="Collect!"/><small>EVERYTHING, COLLECTED.</small></div>
      <button className="nav-item active"><Grid2X2 size={18} /> Overview</button>
      <div className="sidebar-label">YOUR COLLECTIONS <button aria-label="Add a collection" className="icon-button small" onClick={() => setModal('add-collection')}><Plus size={15} /></button></div>
      {vault.catalog.series.map((series) => { const sets = vault.catalog.sets.filter((set) => set.seriesId === series.id); const visibleSets = sets.filter((set) => set.tracked); const ids = new Set(visibleSets.map((set) => set.id)); const done = completion(vault.catalog.cards.filter((card) => ids.has(card.setId)), vault.catalog.ownership); const kind = seriesCategory(series.id); return <button className={`collection-nav ${series.id === selectedSeries?.id ? 'chosen' : ''}`} key={series.id} onClick={() => { setActiveCategory(kind); if (visibleSets[0]) setSetId(visibleSets[0].id); else if (sets.length) { setSetId(''); setModal('manage-sets'); } else setModal('add-set'); }}><span className={`collection-dot ${kind === 'cards' ? 'lime' : kind === 'media' ? 'blue' : 'purple'}`}></span><span>{series.name}<small>{categoryLabel(kind)}</small></span><span className="nav-count">{done.owned}/{done.total}</span></button>; })}
      <div className="sidebar-foot"><div className="local-badge"><span className="pulse"></span>{cloudSync.status === 'synced' ? 'Synced vault' : 'Local vault'} <span>●</span></div><p>{cloudSync.status === 'synced' ? 'Private backup is connected.' : 'Your collection stays on this device.'}</p><button className="nav-item" onClick={() => setModal('help')}><CircleHelp size={17} /> How it works</button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="crumb">COLLECTIONS <span>/</span> <b>{activeName.toUpperCase()}</b></div><div className="mobile-brand"><img src={`${import.meta.env.BASE_URL}collect-wordmark.svg`} alt="Collect!"/></div><div className="top-actions"><button className={`sync-trigger ${cloudSync.status}`} onClick={() => setModal('sync')} aria-label={`Private sync: ${syncButtonLabel(cloudSync.status)}`}><Cloud size={15}/><span>{syncButtonLabel(cloudSync.status)}</span></button><button className="avatar" aria-label={cloudSync.login ? `GitHub account ${cloudSync.login}` : 'Local profile'}>{cloudSync.login ? cloudSync.login.slice(0, 1).toUpperCase() : 'V'}</button></div></header>
      <div className="content-wrap">
        {ready && narutoUpdatePlan && (narutoUpdatePlan.hasChanges || narutoUpdatePlan.conflicts.length > 0) && <section className="catalog-update-banner" aria-label="Naruto catalog update available"><div><strong>Naruto Kayou catalog is ready</strong><p>{narutoCatalogUpdate?.sets.length} sets · {narutoCatalogUpdate?.cards.length.toLocaleString()} card definitions · verified names and image links</p></div><button className="button primary" onClick={() => setShowNarutoUpdateReview(true)}>{narutoUpdatePlan.conflicts.length ? 'Review conflict' : 'Review update'}</button></section>}
        {ready && finalFantasyUpdatePlan && (finalFantasyUpdatePlan.hasChanges || finalFantasyUpdatePlan.conflicts.length > 0) && <section className="catalog-update-banner" aria-label="Final Fantasy TCG catalog update available"><div><strong>Final Fantasy TCG catalog is ready</strong><p>{finalFantasyCatalogUpdate?.sets.length} sets · {finalFantasyCatalogUpdate?.cards.length.toLocaleString()} card definitions · Normal, Foil, and sourced Full Art versions</p></div><button className="button primary" onClick={() => setShowFinalFantasyUpdateReview(true)}>{finalFantasyUpdatePlan.conflicts.length ? 'Review conflict' : 'Review update'}</button></section>}
        <section className="welcome-row"><div><div className="eyebrow"><Sparkles size={14} /> YOUR COLLECTION, IN FOCUS</div><h1>Good to see you.<br/><span>Let’s make some room.</span></h1><p className="lede">A considered home for everything you collect.</p></div><div className="progress-orbit" aria-label={`${allProgress.owned} of ${allProgress.total} collectible items owned`}><div><strong>{allProgress.percent}<small>%</small></strong><span>COMPLETE</span></div><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="51"/><circle className="orbit-progress" cx="60" cy="60" r="51" style={{ strokeDashoffset: 320 - 320 * allProgress.percent / 100 }}/></svg></div></section>

        <section className="category-picker" aria-label="Choose a collection category"><div className="eyebrow">START WITH A TYPE</div><div className="category-choice" role="group" aria-label="Collection category">{categories.map((category) => <button key={category.id} aria-pressed={activeCategory === category.id} className={activeCategory === category.id ? 'active' : ''} onClick={() => { setActiveCategory(category.id); const firstSet = trackedSets.find((set) => vault.catalog.series.some((series) => series.id === set.seriesId && (series.category ?? 'cards') === category.id)); setSetId(firstSet?.id ?? ''); }}>{category.label}</button>)}</div></section>

        <section className="summary-grid" aria-label="Collection summary"><Metric label="UNIQUE ITEMS" value={allProgress.total.toString().padStart(2, '0')} detail="in tracked sets" icon={<BookOpen size={17}/>} /><Metric label="IN YOUR VAULT" value={allProgress.owned.toString().padStart(2, '0')} detail="unique items owned" icon={<Check size={17}/>} /><Metric label="STILL CHASING" value={trackedCards.filter((c) => cardStatus(c.id, vault.catalog.ownership) === 'missing').length.toString().padStart(2, '0')} detail="not yet in your collection" icon={<ImagePlus size={17}/>} /><Metric label="ON THE WAY" value={vault.catalog.ownership.filter((item) => trackedCards.some((card) => card.id === item.cardId)).reduce((sum, item) => sum + item.incoming, 0).toString().padStart(2, '0')} detail="incoming copies" icon={<ArrowDownToLine size={17}/>} /></section>

        <section className="collection-section">
          <div className="section-heading"><div><div className="eyebrow">THE ARCHIVE</div><h2>Your collections <span className="heading-count">{categorySeries.length.toString().padStart(2, '0')}</span></h2></div><div className="heading-actions"><button className="button outline" onClick={() => { setManageSetsSearch(''); setModal('manage-sets'); }}>Manage sets</button><button className="button outline" onClick={() => setModal('add-collection')}><Plus size={16}/> Add collection</button></div></div>
          {categorySeries.length ? <div className="collection-cards">{categorySeries.map((series, index) => {
             const allSets = vault.catalog.sets.filter((s) => s.seriesId === series.id); const sets = allSets.filter((s) => s.tracked); const ids = new Set(sets.map((s) => s.id)); const seriesCards = vault.catalog.cards.filter((c) => ids.has(c.setId)); const done = completion(seriesCards, vault.catalog.ownership); const kind = seriesCategory(series.id); const accent = kind === 'cards' ? (index === 0 ? 'cover-naruto' : 'cover-blue') : kind === 'media' ? 'cover-blue' : 'cover-purple'; const setSummary = sets.length ? `${sets.length} tracked · ${allSets.length} available` : `${allSets.length} sets available · none tracked`;
             return <button className={`collection-card ${accent}`} key={series.id} onClick={() => { setActiveCategory(kind); if (sets[0]) setSetId(sets[0].id); else if (allSets.length) { setSetId(''); setModal('manage-sets'); } else setModal('add-set'); }}><span className="cover-orb"></span><span className="cover-content"><span className="cover-tag">{categoryLabel(kind).toUpperCase()}</span><strong>{series.name}</strong><span className="cover-sub">{setSummary}</span><span className="cover-footer"><span>{done.owned} / {done.total} {itemsLabel(kind).toUpperCase()}</span><span className="cover-arrow">↗</span></span></span><span className="cover-meta"><span>{done.total ? 'Collection' : 'Ready for your list'}</span><span className="mini-progress"><i style={{ width: `${done.percent}%` }} /></span></span></button>;
          })}<button className="new-collection" onClick={() => setModal('add-collection')}><span><Plus size={20}/></span><strong>Start a collection</strong><small>Choose Cards, Media, or Misc.</small></button></div> : <div className="empty-state category-empty"><div className="empty-art"><Archive size={27}/><span>✦</span></div><h3>No {categoryLabel(activeCategory).toLowerCase()} collections yet</h3><p>Start a collection here, or choose another category.</p><button className="button primary" onClick={() => setModal('add-collection')}><Plus size={16}/> Add a {categoryLabel(activeCategory).toLowerCase()} collection</button></div>}
        </section>

        {selectedSet ? <section className="cards-section">
          <div className="section-heading cards-heading"><div><div className="eyebrow">{categoryLabel(activeCategory).toUpperCase()} CATALOG</div><h2>{selectedSet.name} <span className="heading-count">{cards.length.toString().padStart(2, '0')}</span></h2>{selectedSet.sourceCompletionIndicator && <div className={`source-marker ${selectedSet.sourceCompletionIndicator}`}>Workbook: {selectedSet.sourceCompletionIndicator === 'complete' ? 'green / complete' : selectedSet.sourceCompletionIndicator === 'incomplete' ? 'yellow / incomplete' : 'unmarked'}{selectedSet.sourceCompletionIndicator !== 'unmarked' && ((selectedSet.sourceCompletionIndicator === 'complete') !== (progress.percent === 100)) && <b> · differs from current quantities</b>}</div>}</div><div className="heading-actions">{selectedSeries && trackedSets.filter((set) => set.seriesId === selectedSeries.id).length > 1 && <label className="set-picker-label"><span>SET</span><select aria-label="Select set" value={selectedSet.id} onChange={(e) => setSetId(e.target.value)}>{trackedSets.filter((set) => set.seriesId === selectedSeries.id).map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>}{selectedSeries && <button className="button outline" onClick={() => setModal('add-set')}><Plus size={16}/> Add set or list</button>}<button className="button primary" onClick={() => setModal('add-card')}><Plus size={16}/> Add {currentItemLabel}</button></div></div>
          <div className="toolbar"><div className="search-box"><Search size={16}/><input aria-label={`Search ${itemPlural}`} placeholder={activeCategory === 'cards' ? 'Find a card, number, rarity…' : `Find a ${currentItemLabel}, title, or ID…`} value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}</div><div className="tool-right"><button className={`button subtle ${showFilters ? 'selected' : ''}`} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={15}/> Filters {filter !== 'all' && <i className="filter-dot"/>}</button><div className="view-switch" aria-label={`${categoryLabel(activeCategory)} view`}>{(['gallery', 'list', 'checklist'] as View[]).map((v) => <button key={v} className={view === v ? 'active' : ''} aria-label={`${v} view`} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'gallery' ? <Grid2X2 size={15}/> : v === 'list' ? <List size={16}/> : <Check size={16}/>}</button>)}</div></div></div>
          {showFilters && <div className="filter-row"><span>SHOW</span>{(['all', 'owned', 'missing', 'incoming', 'duplicate'] as Filter[]).map((value) => <button key={value} className={`filter-chip ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{value === 'all' ? 'Everything' : value[0].toUpperCase() + value.slice(1)}</button>)}<span className="filter-spacer"/><label className="toggle-label"><input type="checkbox" checked={statusFilter} onChange={(e) => setStatusFilter(e.target.checked)}/> Show status</label></div>}
          {activeCategory === 'cards' && srgSets.length > 0 && <div className="source-review"><span><b>Super Rare workbook check</b>{markerDiscrepancies.length} marker mismatches · {unmarkedSets.length} unmarked releases</span><button onClick={() => setReviewImport(true)}>Review details</button></div>}
          <div className="result-line"><span>{visibleCards.length} {visibleCards.length === 1 ? currentItemLabel : itemPlural} <span>· {filter === 'all' ? 'all statuses' : filter}</span></span><span>{progress.owned} of {progress.total} collected</span></div>
          {visibleCards.length ? <div className={`card-grid ${view}-view`}>{visibleCards.map((card) => <CardTile key={card.id} card={card} inventory={inventoryForCard(card.id)} variants={vault.catalog.variants.filter((v) => v.cardId === card.id)} view={view} showStatus={statusFilter} itemLabel={currentItemLabel} onOpen={(variantId) => { setSelected(card); setSelectedVersionId(variantId); }} onQuantity={updateOwnership}/>)}</div> : <div className="empty-state"><div className="empty-art"><Archive size={27}/><span>✦</span></div><h3>{cards.length ? 'Nothing in this view yet' : `Your ${activeCategory === 'media' ? 'DVD' : activeCategory === 'cards' ? 'card' : 'item'} collection is ready`}</h3><p>{cards.length ? 'Try another filter or search term.' : `Add ${itemPlural} one by one, or import a validated inventory file to get started.`}</p>{cards.length === 0 && <button className="button primary" onClick={() => setModal('add-card')}><Plus size={16}/> Add your first {currentItemLabel}</button>}</div>}
        </section> : categorySeries.length ? <section className="cards-section"><div className="empty-state"><div className="empty-art"><Archive size={27}/><span>✦</span></div><h3>{categoryTrackedSets.length ? 'Choose a collection to get started' : 'No sets are currently tracked'}</h3><p>{categoryTrackedSets.length ? `Choose a collection in ${categoryLabel(activeCategory)} to view its sets.` : 'Turn a set on in Manage sets. Hidden sets keep their cards and quantities.'}</p><button className="button primary" onClick={() => categorySeries.some((series) => vault.catalog.sets.some((set) => set.seriesId === series.id)) ? setModal('manage-sets') : setModal('add-collection')}>{categorySeries.some((series) => vault.catalog.sets.some((set) => set.seriesId === series.id)) ? 'Manage sets' : 'Add collection'}</button></div></section> : null}

        <section className="local-panel"><div className="panel-icon"><ShieldCheck size={19}/></div><div><strong>Your vault stays yours.</strong><p>Saved locally and ready offline. Connect a private backup when you want it on another browser.</p></div><div className="panel-actions"><button onClick={() => setModal('sync')}><Cloud size={15}/> Sync</button><button onClick={exportJson}><Download size={15}/> Backup</button><button onClick={exportCsv}><ArrowUpFromLine size={15}/> CSV</button><label className="panel-import"><Upload size={15}/> Import<input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => void importFile(e.target.files?.[0])}/></label></div></section>
        <footer>COLLECT EVERYTHING <span>·</span> VERSION 0.1 <button onClick={() => setModal('help')}><Settings2 size={13}/> LOCAL SETTINGS</button></footer>
      </div>
    </main>
    {notice && <div className="toast success"><Check size={16}/>{notice}</div>}
    {error && <div className="toast error"><X size={16}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
    {modal && <Modal title={modal === 'add-card' ? `Add a ${currentItemLabel}` : modal === 'add-set' ? 'Add a set or list' : modal === 'add-collection' ? 'Start a collection' : modal === 'manage-sets' ? 'Manage sets' : modal === 'sync' ? 'Private sync' : 'A little about your vault'} onClose={() => setModal(null)}>{modal === 'sync' ? <SyncPanel sync={cloudSync}/> : modal === 'manage-sets' ? <div className="set-management"><p>Choose which sets you want to see and include in progress totals. Turning a set off keeps its cards and quantities in your vault.</p><div className="set-search"><Search size={15}/><input type="search" aria-label="Search sets" placeholder="Find a collection or set" value={manageSetsSearch} onChange={(e) => setManageSetsSearch(e.target.value)}/></div>{setManagerSeries.length ? <div className="set-manager-groups">{setManagerSeries.map((series) => { const seriesSets = setManagerRows.filter((set) => set.seriesId === series.id); return <section className="set-manager-group" key={series.id}><header><strong>{series.name}</strong><span>{seriesSets.filter((set) => set.tracked).length} of {vault.catalog.sets.filter((set) => set.seriesId === series.id).length} on</span></header>{seriesSets.map((set) => { const setCards = vault.catalog.cards.filter((card) => card.setId === set.id); const setProgress = completion(setCards, vault.catalog.ownership); return <label className="set-manager-row" key={set.id}><span><strong>{set.name}</strong><small>{setCards.length} {setCards.length === 1 ? 'item' : 'items'} · {setProgress.owned} owned</small></span><span className="set-switch"><input type="checkbox" role="switch" aria-label={`Track ${series.name} ${set.name}`} checked={!!set.tracked} onChange={(event) => updateSetTracking(set.id, event.target.checked)}/><i aria-hidden="true"/></span></label>; })}</section>; })}</div> : <p>No sets match your search.</p>}</div> : modal === 'add-card' ? <form onSubmit={addCard} className="form-stack"><p>{activeCategory === 'cards' ? 'Card IDs are namespaced to this set, so the same number can exist in another collection.' : `Each ${currentItemLabel} gets a stable ID within its collection. Leave the identifier blank to use the title.`}</p><label>Collection list<select value={selectedSet?.id ?? ''} onChange={(e) => setSetId(e.target.value)}>{trackedSets.filter((s) => seriesCategory(s.seriesId) === activeCategory).map((s) => <option value={s.id} key={s.id}>{seriesMap.get(s.seriesId)?.name} · {s.name}</option>)}</select></label><div className="form-row"><label>{activeCategory === 'cards' ? 'Card number' : 'Identifier'}<input name="number" placeholder={activeCategory === 'cards' ? 'e.g. 01' : 'Optional'} required={activeCategory === 'cards'}/></label>{activeCategory === 'cards' && <label>Rarity <span className="optional">OPTIONAL</span><input name="rarity" placeholder="Leave blank if none"/></label>}</div><label>{activeCategory === 'cards' ? 'Card name' : activeCategory === 'media' ? 'DVD title or season' : 'Item name'}<input name="name" placeholder={activeCategory === 'cards' ? 'Name on the card' : activeCategory === 'media' ? 'Enter the title shown on the DVD' : 'Name this item'} required/></label><button className="button primary full"><Plus size={16}/> Add {currentItemLabel}</button></form> : modal === 'add-collection' ? <form onSubmit={addCollection} className="form-stack"><p>Choose where this collection belongs. You can add more sets or lists later.</p><label>Category<select name="category" value={activeCategory} onChange={(e) => setActiveCategory(e.target.value as CollectionCategory)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label><label>Collection name<input name="name" placeholder="e.g. My collection" required/></label><label>First set or list<input name="firstSet" placeholder={activeCategory === 'cards' ? 'e.g. Base set' : activeCategory === 'media' ? 'e.g. DVD collection' : 'e.g. Items'} required/></label><button className="button primary full"><Plus size={16}/> Create collection</button></form> : modal === 'add-set' ? <form onSubmit={addSet} className="form-stack"><p>Organize a collection into numbered releases, volumes, or named lists.</p><label>Collection<select name="seriesId" required>{vault.catalog.series.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label>Set or list name<input name="name" placeholder="e.g. NREA01 or season 1" required/></label><label>Release number <span className="optional">OPTIONAL</span><input name="releaseNumber" placeholder="For numbered releases"/></label><button className="button primary full"><Plus size={16}/> Create set or list</button></form> : <div className="help-copy"><p><b>Local-first.</b> Your collections and quantities are stored in this browser’s IndexedDB. They work offline after the first load.</p><p><b>Move your data.</b> JSON includes the versioned catalog. Inventory CSV uses namespaced item IDs and can only update known records.</p><p><b>Private sync.</b> The secure Worker saves reviewed snapshots to your private GitHub data repository. The first upload and any conflicts require your review.</p><p><b>Images.</b> Add verified remote image URLs or user-provided images. Remote images are cached after viewing.</p></div>}</Modal>}
    {showNarutoUpdateReview && narutoCatalogUpdate && narutoUpdatePlan && <Modal title="Naruto Kayou sets" onClose={() => setShowNarutoUpdateReview(false)}><div className="report-copy"><p>This update includes all {narutoCatalogUpdate.sets.length} North American Kayou Naruto sets listed by NarutoDB: {narutoCatalogUpdate.sets.map((set) => set.displayName + ' (' + set.cardCount + ')').join(' · ')} — {narutoCatalogUpdate.cards.length.toLocaleString()} unique cards in total.</p><ul><li>{narutoUpdatePlan.setsToAdd} sets and {narutoUpdatePlan.cardsToAdd} new card definitions will be added.</li><li>{narutoUpdatePlan.namesToFill} blank names and {narutoUpdatePlan.numbersToUpdate} provisional numbers will be filled from the catalog.</li><li>{narutoUpdatePlan.imagesToAdd.toLocaleString()} verified NarutoDB image links will be added.</li><li>NREA02 and NREA03 keep their current visibility. The other six sets start turned off; turn on the ones you want in Manage sets.</li></ul><p>Applying adds catalog definitions only; new cards start with no ownership. Your existing Personal, Dupes, incoming quantities, custom names, and personal images are kept. Images remain hosted by NarutoDB and are cached by this app after viewing.</p>{narutoUpdatePlan.conflicts.length > 0 && <div className="sync-error" role="alert">This update is paused because some current records need review: {narutoUpdatePlan.conflicts.join(' ')}</div>}<p className="report-foot"><a href="https://narutodb.com/kayou/sets" target="_blank" rel="noreferrer">NarutoDB North American set list</a></p><div className="catalog-update-actions"><button className="button subtle" onClick={() => setShowNarutoUpdateReview(false)}>Not now</button><button className="button primary" disabled={!narutoUpdatePlan.hasChanges || narutoUpdatePlan.conflicts.length > 0} onClick={applyNarutoUpdate}>Add Naruto sets</button></div></div></Modal>}
    {showFinalFantasyUpdateReview && finalFantasyCatalogUpdate && finalFantasyUpdatePlan && <Modal title="Final Fantasy TCG sets" onClose={() => setShowFinalFantasyUpdateReview(false)}><div className="report-copy"><p>This update includes every release shown in Square Enix’s official Card Browser set filter: {finalFantasyCatalogUpdate.sets.length} sets with {finalFantasyCatalogUpdate.cards.length.toLocaleString()} set-specific card definitions.</p><ul><li>{finalFantasyUpdatePlan.setsToAdd} sets and {finalFantasyUpdatePlan.cardsToAdd} new card definitions will be added.</li>{finalFantasyUpdatePlan.cardDetailsToFill > 0 && <li>{finalFantasyUpdatePlan.cardDetailsToFill} existing definitions have official names or rarities to fill in.</li>}<li>{finalFantasyUpdatePlan.variantRecordsToAdd.toLocaleString()} Normal, Foil, Full Art, or Special version records will be added, with {finalFantasyUpdatePlan.imagesToAdd.toLocaleString()} official image links.</li><li>Normal and Foil quantities are separately trackable for each card; Full Art and other special treatments appear when Square Enix has a distinct image for them.</li><li>Only Memories of Life will be turned on initially. Use Manage sets to turn other releases on when you want to chase them.</li></ul><p>No inventory quantities are added. Existing card quantities will be associated with Normal without changing their amounts. Set visibility choices and personal images are preserved. When the official source has no separate Foil image, the Foil version uses the Normal image and identifies the finish as unshown.</p>{finalFantasyUpdatePlan.conflicts.length > 0 && <div className="sync-error" role="alert">This import is paused because some current records need review: {finalFantasyUpdatePlan.conflicts.join(' ')}</div>}<p className="report-foot"><a href={finalFantasyCatalogUpdate.browserUrl} target="_blank" rel="noreferrer">Square Enix official Card Browser</a></p><div className="catalog-update-actions"><button className="button subtle" onClick={() => setShowFinalFantasyUpdateReview(false)}>Not now</button><button className="button primary" disabled={!finalFantasyUpdatePlan.hasChanges || finalFantasyUpdatePlan.conflicts.length > 0} onClick={applyFinalFantasyUpdate}>Add all releases</button></div></div></Modal>}
    {reviewImport && <Modal title="Workbook comparison" onClose={() => setReviewImport(false)}><div className="report-copy"><p>Workbook markers are preserved as source metadata. Completion is calculated from Personal plus Dupes quantities.</p><h3>Color markers that differ from the quantities</h3>{markerDiscrepancies.length ? <ul>{markerDiscrepancies.map((set) => { const missing = vault.catalog.cards.filter((card) => card.setId === set.id && inventoryForCard(card.id).every((item) => item.personal + item.duplicates === 0)); return <li key={set.id}><b>{set.name}</b> · {set.sourceCompletionIndicator === 'complete' ? 'green' : 'yellow'} · row {set.sourceRow} · {missing.length ? `no physical copy for ${missing.map((card) => card.number).join(', ')}` : 'every slot has a physical copy'}</li>; })}</ul> : <p>None.</p>}<h3>Titles without a color marker</h3>{unmarkedSets.length ? <ul>{unmarkedSets.map((set) => <li key={set.id}><b>{set.name}</b> · row {set.sourceRow}</li>)}</ul> : <p>None.</p>}<p className="report-foot">Imported from Switch Games. Card notes in the final column are preserved verbatim.</p></div></Modal>}
    {selected && <CardDetail card={selected} inventory={inventoryForCard(selected.id)} variants={vault.catalog.variants.filter((v) => v.cardId === selected.id)} initialVariantId={selectedVersionId} itemLabel={currentItemLabel} onClose={() => setSelected(null)} onQuantity={updateOwnership} onImage={addImage}/>}
  </div>;
}

function syncButtonLabel(status: ReturnType<typeof useCloudSync>['status']) {
  if (status === 'synced') return 'Synced';
  if (status === 'syncing') return 'Saving';
  if (status === 'conflict') return 'Review sync';
  if (status === 'needs-initial-upload') return 'Start backup';
  if (status === 'offline' || status === 'failed') return 'Retry sync';
  if (status === 'checking') return 'Checking';
  if (status === 'signed-out') return 'Connect sync';
  return 'On this device';
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) { return <div className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{detail}</small></div>; }
type QuantityField = 'personal' | 'duplicates' | 'incoming';
type OwnershipChange = (card: CardDefinition, field: QuantityField, quantity: number, variantId?: string) => void;
export function CardTile({ card, inventory, variants, view, showStatus, itemLabel, onOpen, onQuantity }: { card: CardDefinition; inventory: Ownership[]; variants: CardVariant[]; view: View; showStatus: boolean; itemLabel: string; onOpen: (variantId?: string) => void; onQuantity: OwnershipChange }) {
  const treatmentVariants = variants.filter((variant) => variant.treatment);
  const normalVariant = treatmentVariants.find((variant) => variant.treatment === 'normal');
  const [selectedVariantId, setSelectedVariantId] = useState(normalVariant?.id ?? treatmentVariants[0]?.id ?? '');
  useEffect(() => { setSelectedVariantId(normalVariant?.id ?? treatmentVariants[0]?.id ?? ''); }, [card.id]);
  const selectedVariant = treatmentVariants.find((variant) => variant.id === selectedVariantId) ?? normalVariant ?? treatmentVariants[0];
  const versionInventory = inventory.find((item) => item.variantId === selectedVariant?.id) ?? (!selectedVariant ? inventory.find((item) => !item.variantId) : undefined);
  const status = cardStatus(card.id, inventory);
  const treatmentSources = selectedVariant?.imageUrls ?? [];
  const sources = selectedVariant ? [...treatmentSources, ...variants.filter((variant) => !variant.treatment).flatMap((variant) => variant.imageUrls)] : variants.flatMap((variant) => variant.imageUrls);
  const imageSource = treatmentSources.find((source) => source.source === 'user-provided') ?? treatmentSources[0]
    ?? (selectedVariant?.treatment === 'normal' ? sources.find((source) => source.source === 'user-provided') : undefined)
    ?? sources[0];
  const image = imageSource?.url;
  const physicallyOwned = inventory.some((item) => item.personal + item.duplicates > 0);
  const displayName = card.name || card.number;
  return <article className={`card-tile ${view === 'list' ? 'tile-list' : ''} ${view === 'checklist' ? 'tile-check' : ''} ${physicallyOwned ? 'has-owned' : ''}`}>
    <button className="card-image" onClick={() => onOpen(selectedVariant?.id)} aria-label={`Open ${itemLabel}: ${displayName}${selectedVariant ? `, showing ${selectedVariant.name}` : ''}`}>{image ? <img src={image} alt={`${displayName}${selectedVariant ? ` · ${selectedVariant.name}` : ''}`} loading="lazy"/> : <span className="placeholder"><span className="placeholder-mark">✳</span><small>IMAGE NOT ADDED</small></span>}{showStatus && <span className={`status-tag ${status}`}>{status}</span>}</button>
    <div className="tile-info"><div className="tile-title-line"><button className="tile-title" onClick={() => onOpen(selectedVariant?.id)}>{displayName}</button><span className="tile-number" title={`Number ${card.number}`} aria-label={`Number ${card.number}`}>{card.number}</span></div><span>{card.rarity || card.category || 'No rarity'}</span>{view !== 'checklist' && treatmentVariants.length > 1 && <div className="tile-versions" role="group" aria-label={`${displayName} version`}>{treatmentVariants.map((variant) => <button key={variant.id} className={variant.id === selectedVariant?.id ? 'active' : ''} aria-pressed={variant.id === selectedVariant?.id} aria-label={`Show ${variant.name} version`} onClick={() => setSelectedVariantId(variant.id)}>{variant.name}</button>)}</div>}{selectedVariant?.imageNote && view !== 'checklist' && <small className="tile-variant-note" title={selectedVariant.imageNote}>Foil finish not pictured</small>}</div>
    <div className="tile-qty"><Quantity label={selectedVariant ? `${selectedVariant.name.toUpperCase()} · PERSONAL` : 'PERSONAL'} value={versionInventory?.personal ?? 0} onChange={(n) => onQuantity(card, 'personal', n, selectedVariant?.id)}/><Quantity label={selectedVariant ? `${selectedVariant.name.toUpperCase()} · DUPES` : 'DUPES'} value={versionInventory?.duplicates ?? 0} unknown={versionInventory?.duplicatesKnown === false} onChange={(n) => onQuantity(card, 'duplicates', n, selectedVariant?.id)}/><button className="incoming-action" onClick={() => onQuantity(card, 'incoming', (versionInventory?.incoming ?? 0) + 1, selectedVariant?.id)}>+ {selectedVariant?.name ?? ''} incoming {versionInventory?.incoming ? `(${versionInventory.incoming})` : ''}</button></div>
  </article>;
}
function CardDetail({ card, inventory, variants, initialVariantId, itemLabel, onClose, onQuantity, onImage }: { card: CardDefinition; inventory: Ownership[]; variants: CardVariant[]; initialVariantId?: string; itemLabel: string; onClose: () => void; onQuantity: OwnershipChange; onImage: (c: CardDefinition, url: string, kind: 'verified-remote' | 'user-provided', variantId?: string) => void }) {
  const treatmentVariants = variants.filter((variant) => variant.treatment);
  const normalVariant = treatmentVariants.find((variant) => variant.treatment === 'normal');
  const [selectedVariantId, setSelectedVariantId] = useState(initialVariantId ?? normalVariant?.id ?? treatmentVariants[0]?.id ?? '');
  const [url, setUrl] = useState(''); const [kind, setKind] = useState<'verified-remote' | 'user-provided'>('user-provided');
  useEffect(() => { setSelectedVariantId(initialVariantId ?? normalVariant?.id ?? treatmentVariants[0]?.id ?? ''); setUrl(''); }, [card.id, initialVariantId]);
  const selectedVariant = treatmentVariants.find((variant) => variant.id === selectedVariantId) ?? normalVariant ?? treatmentVariants[0];
  const itemInventory = inventory.find((item) => item.variantId === selectedVariant?.id) ?? (!selectedVariant ? inventory.find((item) => !item.variantId) : undefined);
  const imageVariants = selectedVariant ? [selectedVariant, ...variants.filter((variant) => variant !== selectedVariant && !variant.treatment)] : variants;
  const sources = imageVariants.flatMap((variant) => variant.imageUrls);
  const image = (sources.find((source) => source.source === 'user-provided') ?? sources[0])?.url;
  const displayName = card.name || card.number;
  const imageLabel = itemLabel === 'DVD' ? 'DVD cover' : itemLabel === 'card' ? 'Card image' : 'Item image';
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button className="modal-close" aria-label={`Close ${itemLabel} detail`} onClick={onClose}><X size={18}/></button><div className="detail-image">{image ? <img src={image} alt={`${displayName}${selectedVariant ? ` · ${selectedVariant.name}` : ''}`}/> : <div className="placeholder"><span className="placeholder-mark">✳</span><small>NO IMAGE YET</small></div>}</div><div className="detail-content"><div className="eyebrow">{itemLabel.toUpperCase()} DETAIL · {card.number}</div><h2 id="detail-title">{displayName}</h2><p className="detail-rarity">{card.rarity || card.category || 'No details assigned'} <span>·</span> {card.id}</p>{treatmentVariants.length > 0 && <div className="variant-picker" role="group" aria-label="Card version">{treatmentVariants.map((variant) => <button key={variant.id} className={variant.id === selectedVariant?.id ? 'active' : ''} aria-pressed={variant.id === selectedVariant?.id} onClick={() => setSelectedVariantId(variant.id)}>{variant.name}</button>)}</div>}{selectedVariant?.imageNote && <p className="variant-note">{selectedVariant.imageNote}</p>}<div className="detail-counts"><Quantity label="PERSONAL" value={itemInventory?.personal ?? 0} onChange={(n) => onQuantity(card, 'personal', n, selectedVariant?.id)}/><Quantity label="DUPES" value={itemInventory?.duplicates ?? 0} unknown={itemInventory?.duplicatesKnown === false} onChange={(n) => onQuantity(card, 'duplicates', n, selectedVariant?.id)}/><Quantity label="INCOMING" value={itemInventory?.incoming ?? 0} onChange={(n) => onQuantity(card, 'incoming', n, selectedVariant?.id)}/></div>{card.sourceNote && <p className="detail-rarity">Source note: {card.sourceNote}</p>}<div className="image-editor"><strong>{selectedVariant ? `${selectedVariant.name} ${imageLabel.toLowerCase()}` : imageLabel}</strong><p>Only add a verified URL when you’ve confirmed it shows this exact item.</p><div className="image-add-row"><input aria-label="Image URL" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)}/><select aria-label="Image source" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="user-provided">My image</option><option value="verified-remote">Verified URL</option></select><button className="button primary" disabled={!url} onClick={() => { onImage(card, url, kind, selectedVariant?.id); setUrl(''); }}>Save</button></div></div></div></section></div>;
}
function Quantity({ label, value, onChange, unknown = false }: { label: string; value: number; onChange: (n: number) => void; unknown?: boolean }) { return <div><small>{unknown ? `${label} · UNKNOWN` : label}</small><span><button aria-label={unknown ? `Mark ${label.toLowerCase()} as zero` : `Decrease ${label.toLowerCase()}`} onClick={() => onChange(unknown ? 0 : value - 1)}>−</button><b>{unknown ? '?' : value}</b><button aria-label={unknown ? `Set ${label.toLowerCase()} to one` : `Increase ${label.toLowerCase()}`} onClick={() => onChange(unknown ? 1 : value + 1)}>+</button></span></div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="form-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="modal-close" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>{children}</section></div>; }
function download(name: string, value: string, mime: string) { const url = URL.createObjectURL(new Blob([value], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function csvCell(value: string | number | boolean) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function categoryLabel(category: CollectionCategory) { return categories.find((item) => item.id === category)?.label ?? 'Cards'; }
function itemsLabel(category: CollectionCategory) { return category === 'cards' ? 'cards' : category === 'media' ? 'DVDs' : 'items'; }
function slugify(value: string) { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function mergeVault(local: VaultData, remote: VaultData): VaultData {
  const mergeById = <T extends { id: string }>(a: T[], b: T[]) => [...a, ...b.filter((y) => !a.some((x) => x.id === y.id))];
  const ownership = [...local.catalog.ownership]; for (const incoming of remote.catalog.ownership) if (!ownership.some((x) => x.cardId === incoming.cardId && (x.variantId ?? null) === (incoming.variantId ?? null))) ownership.push(incoming);
  return { schemaVersion: local.schemaVersion, updatedAt: new Date().toISOString(), catalog: { publishers: mergeById(local.catalog.publishers, remote.catalog.publishers), franchises: mergeById(local.catalog.franchises, remote.catalog.franchises), series: mergeById(local.catalog.series, remote.catalog.series), sets: mergeById(local.catalog.sets, remote.catalog.sets), cards: mergeById(local.catalog.cards, remote.catalog.cards), variants: mergeById(local.catalog.variants, remote.catalog.variants), ownership, acquisitions: mergeById(local.catalog.acquisitions, remote.catalog.acquisitions) } };
}
