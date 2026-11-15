import { emptyVault, migrateVault, type VaultData } from './domain';

const DB_NAME = 'card-vault';
const STORE = 'vault';
const KEY = 'current';

export async function loadVault(): Promise<VaultData> {
  if (!('indexedDB' in globalThis)) return emptyVault();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      get.onsuccess = () => { try { resolve(get.result ? migrateVault(get.result) : emptyVault()); } catch (error) { reject(error); } db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}

export async function saveVault(data: VaultData): Promise<void> {
  if (!('indexedDB' in globalThis)) throw new Error('IndexedDB is unavailable in this browser. Export a backup before closing this page.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
