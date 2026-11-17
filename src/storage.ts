import { emptyVault, migrateVault, type VaultData } from './domain';

const DB_NAME = 'card-vault';
const STORE = 'vault';
const KEY = 'current';
const RECOVERY_KEY = 'before-private-refresh';

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadVault(): Promise<VaultData> {
  if (!('indexedDB' in globalThis)) return emptyVault();
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const get = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    get.onsuccess = () => { try { resolve(get.result ? migrateVault(get.result) : emptyVault()); } catch (error) { reject(error); } db.close(); };
    get.onerror = () => { reject(get.error); db.close(); };
  });
}

export async function saveVault(data: VaultData): Promise<void> {
  if (!('indexedDB' in globalThis)) throw new Error('IndexedDB is unavailable in this browser. Export a backup before closing this page.');
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveRecoveryVault(data: VaultData): Promise<void> {
  if (!('indexedDB' in globalThis)) throw new Error('IndexedDB is unavailable in this browser.');
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, RECOVERY_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadRecoveryVault(): Promise<VaultData | null> {
  if (!('indexedDB' in globalThis)) return null;
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const get = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECOVERY_KEY);
    get.onsuccess = () => { try { resolve(get.result ? migrateVault(get.result) : null); } catch (error) { reject(error); } db.close(); };
    get.onerror = () => { reject(get.error); db.close(); };
  });
}

export async function hasRecoveryVault(): Promise<boolean> {
  if (!('indexedDB' in globalThis)) return false;
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const get = db.transaction(STORE, 'readonly').objectStore(STORE).getKey(RECOVERY_KEY);
    get.onsuccess = () => { resolve(get.result !== undefined); db.close(); };
    get.onerror = () => { reject(get.error); db.close(); };
  });
}
