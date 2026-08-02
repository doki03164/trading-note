import { createClient, type Session } from '@supabase/supabase-js';
import type { JournalTrade, Playbook, TradingNote } from '../types';
import { listPlaybooks, listTrades, mergeCloudPlaybooks, mergeCloudTrades } from './journalData';
import { loadTradingNotes, saveTradingNote } from './tradingNotes';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const cloudConfigured = Boolean(url && key);
export const cloud = cloudConfigured ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : undefined;

export async function cloudSession(): Promise<Session | null> { if (!cloud) return null; return (await cloud.auth.getSession()).data.session; }
export async function cloudSignUp(email: string, password: string) { if (!cloud) throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY first.'); const { error } = await cloud.auth.signUp({ email, password }); if (error) throw error; }
export async function cloudSignIn(email: string, password: string) { if (!cloud) throw new Error('Cloud database is not configured.'); const { error } = await cloud.auth.signInWithPassword({ email, password }); if (error) throw error; }
export async function cloudSignOut() { if (cloud) await cloud.auth.signOut(); }

function dataUrlBlob(dataUrl: string) { const [header, encoded] = dataUrl.split(','); const mime = header.match(/data:(.*?);/)?.[1] || 'image/png'; const binary = atob(encoded); return new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: mime }); }
function blobDataUrl(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }

export async function syncCloudJournal() {
  if (!cloud) throw new Error('Cloud database is not configured.');
  const session = await cloudSession(); if (!session) throw new Error('Sign in before syncing.'); const userId = session.user.id;
  const rows: { id: string; user_id: string; kind: string; payload: JournalTrade | Playbook | Omit<TradingNote, 'screenshot'>; asset_path?: string | null; client_updated_at: string }[] = [];
  listTrades().forEach(item => rows.push({ id: item.id, user_id: userId, kind: 'trade', payload: item, client_updated_at: item.closedAt || item.openedAt }));
  listPlaybooks().forEach(item => rows.push({ id: item.id, user_id: userId, kind: 'playbook', payload: item, client_updated_at: new Date(item.createdAt).toISOString() }));
  for (const note of await loadTradingNotes()) {
    const { screenshot, ...payload } = note; let assetPath: string | null = null;
    if (screenshot?.startsWith('data:')) { assetPath = `${userId}/${note.id}`; const { error } = await cloud.storage.from('trade-screenshots').upload(assetPath, dataUrlBlob(screenshot), { upsert: true, contentType: screenshot.slice(5, screenshot.indexOf(';')) }); if (error) throw error; }
    rows.push({ id: note.id, user_id: userId, kind: 'note', payload, asset_path: assetPath, client_updated_at: new Date(note.createdAt).toISOString() });
  }
  if (rows.length) { const { error } = await cloud.from('journal_items').upsert(rows, { onConflict: 'user_id,id' }); if (error) throw error; }
  const { data, error } = await cloud.from('journal_items').select('id,kind,payload,asset_path').order('client_updated_at', { ascending: false }); if (error) throw error;
  mergeCloudTrades((data ?? []).filter(row => row.kind === 'trade').map(row => row.payload as JournalTrade));
  mergeCloudPlaybooks((data ?? []).filter(row => row.kind === 'playbook').map(row => row.payload as Playbook));
  for (const row of (data ?? []).filter(row => row.kind === 'note')) {
    let screenshot = ''; if (row.asset_path) { const download = await cloud.storage.from('trade-screenshots').download(row.asset_path); if (!download.error) screenshot = await blobDataUrl(download.data); }
    await saveTradingNote({ ...(row.payload as Omit<TradingNote, 'screenshot'>), screenshot });
  }
  return { uploaded: rows.length, downloaded: data?.length ?? 0 };
}
