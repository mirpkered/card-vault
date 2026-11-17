import { describe, expect, it } from 'vitest';
import { emptyVault } from '../../src/domain';
import { assertExpectedRevision, migrateRemoteSnapshot } from './index';

describe('canonical private snapshots', () => {
  it('serves schema 2 snapshots as migrated data without changing their source', () => {
    const old = emptyVault();
    old.schemaVersion = 2;
    old.catalog.series = old.catalog.series
      .filter((series) => series.id !== 'series:media:snl-dvds')
      .map(({ category: _category, ...series }) => series);
    Object.assign(old.catalog, { sets: old.catalog.sets.filter((set) => set.id !== 'set:media:snl-dvds:collection').map(({ tracked: _tracked, ...set }) => set) });
    old.catalog.cards.push({ id: 'set:kayou-naruto-nrea02:R001', setId: 'set:kayou-naruto-nrea02', number: 'R001', name: 'Test card' });
    old.catalog.ownership.push({ cardId: 'set:kayou-naruto-nrea02:R001', personal: 2, duplicates: 1, incoming: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
    const original = JSON.stringify(old);

    const migrated = migrateRemoteSnapshot(old);

    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.catalog.cards).toContainEqual({ id: 'set:kayou-naruto-nrea02:R001', setId: 'set:kayou-naruto-nrea02', number: 'R001', name: 'Test card' });
    expect(migrated.catalog.ownership[0]).toMatchObject({ personal: 2, duplicates: 1, incoming: 1 });
    expect(migrated.catalog.series.find((series) => series.id === 'series:media:snl-dvds')).toMatchObject({ category: 'media' });
    expect(JSON.stringify(old)).toBe(original);
  });

  it('still rejects unsupported or invalid snapshots', () => {
    expect(() => migrateRemoteSnapshot({ schemaVersion: 99 })).toThrow('unsupported schema or invalid catalog records');
  });
});

describe('private snapshot revisions', () => {
  it('accepts the revision currently stored in the private repository', () => {
    expect(() => assertExpectedRevision('abc123', 'abc123')).not.toThrow();
  });

  it('rejects a write based on a stale revision', () => {
    expect(() => assertExpectedRevision('old-revision', 'new-revision')).toThrow('Revision conflict');
  });

  it('allows only an explicit first write when no snapshot exists', () => {
    expect(() => assertExpectedRevision(null, null)).not.toThrow();
    expect(() => assertExpectedRevision('unexpected', null)).toThrow('Revision conflict');
    expect(() => assertExpectedRevision(null, 'already-created')).toThrow('Revision conflict');
  });
});
