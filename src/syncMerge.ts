import { emptyVault, type Catalog, type VaultData } from './domain';

export type MergeChoice = 'device' | 'private';
export type MergeConflict = {
  key: string;
  collection: keyof Catalog;
  id: string;
  deviceRecord: Record<string, unknown>;
  privateRecord: Record<string, unknown>;
};
export type VaultMergePlan = {
  merged: VaultData;
  conflicts: MergeConflict[];
  deviceOnly: number;
  privateOnly: number;
};

type SyncRecord = Record<string, unknown> & { id?: string; cardId?: string };
const collections: (keyof Catalog)[] = ['publishers', 'franchises', 'series', 'sets', 'cards', 'variants', 'ownership', 'acquisitions'];

function keyOf(collection: keyof Catalog, row: SyncRecord): string {
  return String(collection === 'ownership' ? JSON.stringify([row.cardId, row.variantId ?? null]) : row.id);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function vaultsEqual(left: VaultData, right: VaultData): boolean {
  return same(left, right);
}

export function isPristineVault(value: VaultData): boolean {
  return same(value.catalog, emptyVault().catalog);
}

export function shouldSaveRecoveryBeforeRemoteRefresh(device: VaultData, privateCopy: VaultData): boolean {
  return !isPristineVault(device) && !same(device.catalog, privateCopy.catalog);
}

/**
 * Builds a non-destructive union. Records present on only one side are kept;
 * changed records with the same stable identity need an explicit choice.
 */
export function prepareVaultMerge(device: VaultData, privateCopy: VaultData): VaultMergePlan {
  const merged = { ...privateCopy, catalog: { ...privateCopy.catalog } } as VaultData;
  const catalog = merged.catalog as unknown as Record<keyof Catalog, SyncRecord[]>;
  const conflicts: MergeConflict[] = [];
  let deviceOnly = 0;
  let privateOnly = 0;

  for (const collection of collections) {
    const localRows = (device.catalog[collection] as unknown as SyncRecord[]) ?? [];
    const privateRows = (privateCopy.catalog[collection] as unknown as SyncRecord[]) ?? [];
    const localByKey = new Map(localRows.map((row) => [keyOf(collection, row), row]));
    const privateByKey = new Map(privateRows.map((row) => [keyOf(collection, row), row]));
    const order = [...localRows.map((row) => keyOf(collection, row)), ...privateRows.map((row) => keyOf(collection, row)).filter((key) => !localByKey.has(key))];
    const result: SyncRecord[] = [];

    for (const id of order) {
      const localRow = localByKey.get(id);
      const privateRow = privateByKey.get(id);
      if (localRow && privateRow) {
        if (!same(localRow, privateRow)) conflicts.push({ key: `${collection}:${id}`, collection, id, deviceRecord: localRow, privateRecord: privateRow });
        result.push(privateRow);
      } else if (localRow) {
        result.push(localRow);
        deviceOnly++;
      } else if (privateRow) {
        result.push(privateRow);
        privateOnly++;
      }
    }
    catalog[collection] = result;
  }
  return { merged, conflicts, deviceOnly, privateOnly };
}

export function applyVaultMerge(plan: VaultMergePlan, choices: Record<string, MergeChoice>, updatedAt = new Date().toISOString()): VaultData {
  const merged = JSON.parse(JSON.stringify(plan.merged)) as VaultData;
  const catalog = merged.catalog as unknown as Record<keyof Catalog, SyncRecord[]>;
  const unresolved = plan.conflicts.filter((conflict) => !choices[conflict.key]);
  if (unresolved.length) throw new Error(`Choose a copy for all ${unresolved.length} changed record${unresolved.length === 1 ? '' : 's'} before merging.`);

  for (const conflict of plan.conflicts) {
    const rows = catalog[conflict.collection];
    const index = rows.findIndex((row) => keyOf(conflict.collection, row) === conflict.id);
    if (index < 0) throw new Error(`Could not find ${conflict.collection} record ${conflict.id} in the merge preview.`);
    rows[index] = choices[conflict.key] === 'device' ? conflict.deviceRecord : conflict.privateRecord;
  }
  merged.updatedAt = updatedAt;
  return merged;
}
