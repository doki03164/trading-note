import type { JournalTrade, Playbook, ProfitHistoryEntry, TradingNote } from '../types';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { importProfitHistory, loadProfitHistory } from './accountBridge';
import { importPlaybooks, importTrades, listPlaybooks, listTrades } from './journalData';
import { importTradingNotes, loadTradingNotes } from './tradingNotes';

export const JOURNAL_BACKUP_EXTENSION = '.tradingjournal';
export const JOURNAL_BACKUP_MIME = 'application/vnd.trading-journal.backup';
const MAGIC = 'TRADING_JOURNAL_SECURE_BACKUP';
const FORMAT_VERSION = 1;
const KDF_ITERATIONS = 310_000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

export interface JournalArchiveData {
  schemaVersion: 1;
  exportedAt: number;
  appVersion: string;
  trades: JournalTrade[];
  playbooks: Playbook[];
  tradingNotes: TradingNote[];
  profitHistory: ProfitHistoryEntry[];
}

interface SecureEnvelope {
  magic: typeof MAGIC;
  formatVersion: 1;
  createdAt: number;
  appVersion: string;
  kdf: { name: 'PBKDF2-SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; iv: string };
  ciphertext: string;
}

export interface BackupSummary { trades: number; playbooks: number; tradingNotes: number; profitHistory: number }
export type ImportMode = 'merge' | 'replace';

function bytesToBase64(bytes: Uint8Array) {
  let value = '';
  for (let index = 0; index < bytes.length; index += 32_768) value += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  return btoa(value);
}
function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function validString(value: unknown, max = 100_000) { return typeof value === 'string' && value.length <= max; }
function validNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value); }

export function validateJournalArchive(value: unknown): JournalArchiveData {
  if (!value || typeof value !== 'object') throw new Error('Backup payload is not an object');
  const data = value as Partial<JournalArchiveData>;
  if (data.schemaVersion !== 1 || !validNumber(data.exportedAt) || !validString(data.appVersion, 32)) throw new Error('Unsupported Trading Journal backup schema');
  if (!Array.isArray(data.trades) || data.trades.length > 100_000) throw new Error('Backup trade list is invalid or too large');
  if (!Array.isArray(data.playbooks) || data.playbooks.length > 10_000) throw new Error('Backup playbook list is invalid or too large');
  if (!Array.isArray(data.tradingNotes) || data.tradingNotes.length > 10_000) throw new Error('Backup trading-note list is invalid or too large');
  if (!Array.isArray(data.profitHistory) || data.profitHistory.length > 100_000) throw new Error('Backup profit-history list is invalid or too large');

  for (const trade of data.trades) {
    if (!trade || !validString(trade.id, 200) || !validString(trade.symbol, 50) || !['LONG', 'SHORT'].includes(trade.side) || !validNumber(trade.entryPrice) || !validNumber(trade.exitPrice) || !validNumber(trade.quantity) || !Array.isArray(trade.tags)) throw new Error('Backup contains an invalid trade');
  }
  for (const playbook of data.playbooks) {
    if (!playbook || !validString(playbook.id, 200) || !validString(playbook.name, 500) || !validNumber(playbook.createdAt) || !Array.isArray(playbook.rules)) throw new Error('Backup contains an invalid playbook');
  }
  for (const note of data.tradingNotes) {
    const validScreenshot = note?.screenshot === '' || (validString(note?.screenshot, 50 * 1024 * 1024) && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(note.screenshot));
    if (!note || !validString(note.id, 200) || !validString(note.title, 2_000) || !validNumber(note.createdAt) || !validScreenshot) throw new Error('Backup contains an invalid trading note or screenshot');
  }
  for (const entry of data.profitHistory) {
    if (!entry || !validNumber(entry.timestamp) || !validNumber(entry.totalPnl) || !validNumber(entry.portfolioValue) || !Array.isArray(entry.positions)) throw new Error('Backup contains an invalid profit-history entry');
  }
  return data as JournalArchiveData;
}

async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: KDF_ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function encryptJournalPayload(data: JournalArchiveData, password: string, suppliedSalt?: Uint8Array, suppliedIv?: Uint8Array) {
  if (password.length < 8) throw new Error('Backup password must be at least 8 characters');
  const checked = validateJournalArchive(data);
  const salt = suppliedSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = suppliedIv ?? crypto.getRandomValues(new Uint8Array(12));
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Backup encryption parameters are invalid');
  const key = await deriveKey(password, salt, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(checked));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const envelope: SecureEnvelope = {
    magic: MAGIC,
    formatVersion: FORMAT_VERSION,
    createdAt: Date.now(),
    appVersion: '0.3.2',
    kdf: { name: 'PBKDF2-SHA-256', iterations: KDF_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-256-GCM', iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(ciphertext),
  };
  return JSON.stringify(envelope);
}

export async function decryptJournalBackup(text: string, password: string) {
  let envelope: SecureEnvelope;
  try { envelope = JSON.parse(text) as SecureEnvelope; }
  catch { throw new Error('This is not a Trading Journal backup file'); }
  if (envelope.magic !== MAGIC || envelope.formatVersion !== FORMAT_VERSION || envelope.kdf?.name !== 'PBKDF2-SHA-256' || envelope.cipher?.name !== 'AES-256-GCM') throw new Error('Unsupported or invalid .tradingjournal file');
  if (envelope.kdf.iterations !== KDF_ITERATIONS) throw new Error('Unsupported backup key settings');
  try {
    const salt = base64ToBytes(envelope.kdf.salt), iv = base64ToBytes(envelope.cipher.iv), ciphertext = base64ToBytes(envelope.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) throw new Error('damaged');
    const key = await deriveKey(password, salt, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return validateJournalArchive(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch { throw new Error('Incorrect backup password or damaged .tradingjournal file'); }
}

export function backupSummary(data: JournalArchiveData): BackupSummary {
  return { trades: data.trades.length, playbooks: data.playbooks.length, tradingNotes: data.tradingNotes.length, profitHistory: data.profitHistory.length };
}

export async function createJournalBackup(password: string) {
  const data: JournalArchiveData = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    appVersion: '0.3.2',
    trades: listTrades(),
    playbooks: listPlaybooks(),
    tradingNotes: await loadTradingNotes(),
    profitHistory: await loadProfitHistory(),
  };
  const text = await encryptJournalPayload(data, password);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  return { file: new File([text], `Trading-Journal-${stamp}${JOURNAL_BACKUP_EXTENSION}`, { type: JOURNAL_BACKUP_MIME }), summary: backupSummary(data) };
}

export async function saveJournalBackupFile(file: File) {
  if (Capacitor.isNativePlatform()) {
    const saved = await Filesystem.writeFile({
      path: file.name,
      data: await file.text(),
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: 'Trading Journal encrypted backup',
      text: 'Save this encrypted .tradingjournal archive and keep its password separately.',
      url: saved.uri,
      dialogTitle: 'Save Trading Journal backup',
    });
    return;
  }
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Trading Journal encrypted backup' });
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function importJournalBackup(file: File, password: string, mode: ImportMode) {
  if (!file.name.toLowerCase().endsWith(JOURNAL_BACKUP_EXTENSION)) throw new Error(`Choose a ${JOURNAL_BACKUP_EXTENSION} file`);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('Backup file is empty or larger than 512 MB');
  const data = await decryptJournalBackup(await file.text(), password);
  const replace = mode === 'replace';
  importTrades(data.trades, replace);
  importPlaybooks(data.playbooks, replace);
  await importTradingNotes(data.tradingNotes, replace);
  await importProfitHistory(data.profitHistory, replace);
  window.dispatchEvent(new CustomEvent('trading-journal:data-imported'));
  return backupSummary(data);
}
