import type { TradingNote } from '../types';

const DB_NAME = 'trading-journal-local';
const STORE_NAME = 'trading-notes';
const DB_VERSION = 1;

export type TradingNoteDraft = Omit<TradingNote, 'id' | 'createdAt'>;

export function createTradingNote(draft: TradingNoteDraft, id: string = crypto.randomUUID(), createdAt = Date.now()): TradingNote {
  return {
    ...draft,
    id,
    createdAt,
    title: draft.title.trim(),
    symbol: draft.symbol.trim().toUpperCase(),
    setup: draft.setup.trim(),
    notes: draft.notes.trim(),
  };
}

export function newestFirst(notes: TradingNote[]): TradingNote[] {
  return notes.slice().sort((a, b) => b.createdAt - a.createdAt);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Trading note database failed to open'));
  });
}

export async function loadTradingNotes(): Promise<TradingNote[]> {
  const database = await openDatabase();
  return new Promise<TradingNote[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(newestFirst(request.result as TradingNote[]));
    request.onerror = () => reject(request.error ?? new Error('Trading notes failed to load'));
  }).finally(() => database.close());
}

export async function saveTradingNote(note: TradingNote): Promise<void> {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(note);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Trading note failed to save'));
  }).finally(() => database.close());
}

export async function deleteTradingNote(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Trading note failed to delete'));
  }).finally(() => database.close());
}

export async function importTradingNotes(notes: TradingNote[], replace: boolean): Promise<void> {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    if (replace) store.clear();
    notes.forEach(note => store.put(note));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Trading notes failed to import'));
  }).finally(() => database.close());
}

export function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Screenshot failed to load'));
    reader.readAsDataURL(file);
  });
}
