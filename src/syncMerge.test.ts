import { describe, expect, it } from 'vitest';
import { emptyVault, type VaultData } from './domain';
import { applyVaultMerge, isPristineVault, prepareVaultMerge } from './syncMerge';

function vault(): VaultData {
  const result = emptyVault();
  result.catalog.cards.push({ id: 'set:kayou-naruto-nrea02:01', setId: 'set:kayou-naruto-nrea02', number: '01', name: 'Card one' });
  return result;
}

describe('private sync merge review', () => {
  it('recognizes a fresh local vault as safe to populate from the private copy', () => {
    expect(isPristineVault(emptyVault())).toBe(true);
    const changed = vault();
    expect(isPristineVault(changed)).toBe(false);
  });

  it('keeps records unique to either copy and reports same-ID changes', () => {
    const device = vault();
    const remote = vault();
    device.catalog.cards[0] = { ...device.catalog.cards[0], name: 'Device name' };
    remote.catalog.cards.push({ id: 'set:kayou-naruto-nrea02:02', setId: 'set:kayou-naruto-nrea02', number: '02', name: 'Remote-only card' });
    device.catalog.ownership.push({ cardId: device.catalog.cards[0].id, personal: 1, duplicates: 0, incoming: 0, updatedAt: '2026-01-01T00:00:00.000Z' });

    const plan = prepareVaultMerge(device, remote);
    expect(plan.conflicts.map((item) => item.key)).toContain('cards:set:kayou-naruto-nrea02:01');
    expect(plan.deviceOnly).toBe(1);
    expect(plan.privateOnly).toBe(1);
    expect(plan.merged.catalog.cards.map((item) => item.id)).toEqual([
      'set:kayou-naruto-nrea02:01', 'set:kayou-naruto-nrea02:02',
    ]);
    expect(plan.merged.catalog.ownership).toHaveLength(1);
  });

  it('requires explicit choices and applies the reviewed device record', () => {
    const device = vault();
    const remote = vault();
    device.catalog.cards[0] = { ...device.catalog.cards[0], name: 'Device name' };
    remote.catalog.cards[0] = { ...remote.catalog.cards[0], name: 'Private name' };
    const plan = prepareVaultMerge(device, remote);

    expect(() => applyVaultMerge(plan, {})).toThrow('Choose a copy');
    const merged = applyVaultMerge(plan, { 'cards:set:kayou-naruto-nrea02:01': 'device' }, '2026-11-16T12:00:00.000Z');
    expect(merged.catalog.cards[0].name).toBe('Device name');
    expect(merged.updatedAt).toBe('2026-11-16T12:00:00.000Z');
  });

  it('keeps ownership for different card versions separate during sync merge', () => {
    const device = vault();
    const remote = vault();
    device.catalog.ownership.push({ cardId: device.catalog.cards[0].id, variantId: `${device.catalog.cards[0].id}:normal`, personal: 1, duplicates: 0, incoming: 0, updatedAt: 'device' });
    remote.catalog.ownership.push({ cardId: remote.catalog.cards[0].id, variantId: `${remote.catalog.cards[0].id}:foil`, personal: 2, duplicates: 0, incoming: 0, updatedAt: 'private' });
    const plan = prepareVaultMerge(device, remote);
    expect(plan.conflicts).toEqual([]);
    expect(plan.merged.catalog.ownership.map((item) => item.variantId)).toEqual([
      `${device.catalog.cards[0].id}:normal`, `${remote.catalog.cards[0].id}:foil`,
    ]);
  });

  it('flags competing quantity edits to the same card version for review', () => {
    const device = vault();
    const remote = vault();
    const cardId = device.catalog.cards[0].id;
    const variantId = `${cardId}:foil`;
    device.catalog.ownership.push({ cardId, variantId, personal: 1, duplicates: 0, incoming: 0, updatedAt: 'device' });
    remote.catalog.ownership.push({ cardId, variantId, personal: 2, duplicates: 0, incoming: 0, updatedAt: 'private' });
    const plan = prepareVaultMerge(device, remote);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].collection).toBe('ownership');
    const merged = applyVaultMerge(plan, { [plan.conflicts[0].key]: 'device' });
    expect(merged.catalog.ownership[0].personal).toBe(1);
  });
});
