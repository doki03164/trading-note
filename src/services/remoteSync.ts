import { invoke } from '@tauri-apps/api/core';
import type { PortfolioResponse, ProfitHistoryEntry } from '../types';

export interface RemoteSyncEnvelope {
  version: string;
  generatedAt: number;
  snapshot: PortfolioResponse | null;
  history: ProfitHistoryEntry[];
}

export interface SyncGatewayStatus {
  running: boolean;
  port: number;
  localUrl: string;
  pairingToken: string;
  tunnelCommand: string;
}

export interface SavedRemoteHub { url: string; token: string }

const SAVED_HUB_KEY = 'trading-journal-remote-hub';
let activeHub: SavedRemoteHub | undefined;

export function isTauriDesktop() { return '__TAURI_INTERNALS__' in window; }

export function normalizeRemoteHubUrl(value: string) {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Public sync URL must use HTTPS');
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

async function fetchEnvelope(hub: SavedRemoteHub): Promise<RemoteSyncEnvelope> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${hub.url}/v1/sync`, {
      headers: { Authorization: `Bearer ${hub.token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error('Pairing token is incorrect');
    if (!response.ok) throw new Error(`Desktop sync HTTP ${response.status}`);
    const payload = await response.json() as RemoteSyncEnvelope;
    if (!payload.snapshot) throw new Error('Desktop is connected, but Bitget data is not loaded yet');
    return payload;
  } finally { globalThis.clearTimeout(timeout); }
}

export async function connectRemoteHub(url: string, token: string, remember = false) {
  const hub = { url: normalizeRemoteHubUrl(url), token: token.trim() };
  if (hub.token.length < 24) throw new Error('Enter the full pairing token shown on the desktop');
  const payload = await fetchEnvelope(hub);
  activeHub = hub;
  if (remember) localStorage.setItem(SAVED_HUB_KEY, JSON.stringify(hub));
  else localStorage.removeItem(SAVED_HUB_KEY);
  return payload;
}

export async function refreshRemoteHub() {
  if (!activeHub) throw new Error('Desktop sync is not connected');
  return fetchEnvelope(activeHub);
}

export function loadSavedRemoteHub(): SavedRemoteHub | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_HUB_KEY) || 'null') as SavedRemoteHub | null;
    if (!saved?.url || !saved?.token) return undefined;
    return { url: normalizeRemoteHubUrl(saved.url), token: saved.token };
  } catch { return undefined; }
}

export function disconnectRemoteHub(forget = false) {
  activeHub = undefined;
  if (forget) localStorage.removeItem(SAVED_HUB_KEY);
}

export async function startSyncGateway(port = 45831) {
  return invoke<SyncGatewayStatus>('start_sync_gateway', { port });
}
export async function getSyncGatewayStatus() { return invoke<SyncGatewayStatus | null>('sync_gateway_status'); }
export async function stopSyncGateway() { return invoke('stop_sync_gateway'); }
