import { CapacitorHttp } from '@capacitor/core';
import { invoke } from '@tauri-apps/api/core';
import type { FuturesBalance, MarketCoin, PortfolioResponse, ProfitHistoryEntry } from '../types';

interface Credentials { apiKey: string; apiSecret: string; passphrase: string }
interface ApiEnvelope<T> { code: string | number; msg?: string; message?: string; data?: T | null }
interface SpotAsset { coin: string; available: string; frozen: string; locked: string }
interface SpotTicker { symbol: string; lastPr: string; openUtc: string; quoteVolume: string; high24h: string; low24h: string }
interface FuturesPosition { symbol: string; holdSide: string; marginSize: string; total: string; unrealizedPL: string; markPrice: string }
interface UtaFuturesPosition { symbol: string; posSide: string; positionBalance: string; total: string; unrealisedPnl: string; markPrice: string }
interface UtaPositionData { list: UtaFuturesPosition[] }
interface UtaAsset { coin: string; balance: string; available: string; locked: string }
interface UtaAccountData { accountEquity: string; usdtEquity: string; unrealisedPnl: string; usdtUnrealisedPnl: string; assets: UtaAsset[] }
interface FuturesTicker { symbol: string; openUtc: string; markPrice: string }
interface FuturesBill { symbol: string; amount: string; fee: string; businessType: string }
interface FuturesAccount { marginCoin: string; available?: string; locked?: string; accountEquity?: string; unrealizedPL?: string; maxTransferOut?: string }
interface MobileVault { salt: string; iv: string; ciphertext: string }

const BASE_URL = 'https://api.bitget.com';
const VAULT_KEY = 'trading-journal-bitget-vault';
const HISTORY_KEY = 'trading-journal-profit-history';
let mobileCredentials: Credentials | undefined;

function isTauriDesktop() {
  return '__TAURI_INTERNALS__' in window;
}

function number(value?: string) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
export function canonicalFuturesSymbol(value: string) { return value.trim().toUpperCase().replace(/PERP$/, ''); }
function bytesToBase64(bytes: Uint8Array) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value: string) { const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0)); }

export async function bitgetSignature(secret: string, timestamp: string, path: string, query: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = `${timestamp}GET${path}${query ? `?${query}` : ''}`;
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

export function parseBitgetResponse<T>(raw: unknown, status = 200): T {
  let payload: ApiEnvelope<T> | undefined;
  try { payload = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ApiEnvelope<T>; } catch { /* handled below */ }
  const code = payload?.code == null ? '' : String(payload.code);
  const apiMessage = payload?.msg || payload?.message;
  if (status < 200 || status >= 300) throw new Error(apiMessage ? `Bitget HTTP ${status} ${code}: ${apiMessage}` : `Bitget HTTP ${status}`);
  if (!payload) throw new Error('Bitget response is not JSON');
  if (code !== '00000') throw new Error(apiMessage || `Bitget error ${code}`);
  if (payload.data == null) throw new Error('Bitget success response has no data');
  return payload.data;
}

async function request<T>(path: string, query = '', credentials?: Credentials): Promise<T> {
  const timestamp = Date.now().toString();
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', locale: 'en-US' };
  if (credentials) {
    headers['ACCESS-KEY'] = credentials.apiKey;
    headers['ACCESS-PASSPHRASE'] = credentials.passphrase;
    headers['ACCESS-TIMESTAMP'] = timestamp;
    headers['ACCESS-SIGN'] = await bitgetSignature(credentials.apiSecret, timestamp, path, query);
  }
  const response = await CapacitorHttp.request({ method: 'GET', url: `${BASE_URL}${path}${query ? `?${query}` : ''}`, headers });
  return parseBitgetResponse<T>(response.data, response.status);
}

function isPnlBill(type: string) {
  return !type.startsWith('trans_') && !['append_margin', 'adjust_down_lever_append_margin', 'reduce_margin', 'auto_append_margin', 'cash_gift_issue', 'cash_gift_recycle', 'bonus_issue', 'bonus_recycle', 'bonus_expired'].includes(type);
}

export function normalizeUtaPosition(position: UtaFuturesPosition): FuturesPosition {
  return { symbol: position.symbol, holdSide: position.posSide, marginSize: position.positionBalance, total: position.total, unrealizedPL: position.unrealisedPnl, markPrice: position.markPrice };
}

export function classicPositionList(data: FuturesPosition[] | { list?: FuturesPosition[] }) {
  return Array.isArray(data) ? data : data.list ?? [];
}

async function mobileFuturesPositions(credentials: Credentials) {
  let filtered: FuturesPosition[] | undefined, filteredError = '';
  try {
    filtered = classicPositionList(await request<FuturesPosition[] | { list?: FuturesPosition[] }>('/api/v2/mix/position/all-position', 'productType=USDT-FUTURES&marginCoin=USDT', credentials));
    if (filtered.length) return filtered;
  } catch (error) { filteredError = error instanceof Error ? error.message : String(error); }

  let unfiltered: FuturesPosition[] | undefined, unfilteredError = '';
  try {
    unfiltered = classicPositionList(await request<FuturesPosition[] | { list?: FuturesPosition[] }>('/api/v2/mix/position/all-position', 'productType=USDT-FUTURES', credentials));
    if (unfiltered.length) return unfiltered;
  } catch (error) { unfilteredError = error instanceof Error ? error.message : String(error); }

  let utaError = '';
  try {
    const unified = await request<UtaPositionData>('/api/v3/position/current-position', 'category=USDT-FUTURES', credentials);
    return unified.list.map(normalizeUtaPosition);
  } catch (error) { utaError = error instanceof Error ? error.message : String(error); }
  if (unfiltered) return unfiltered;
  if (filtered) return filtered;
  throw new Error(`Classic USDT: ${filteredError}; Classic all margins: ${unfilteredError}; Unified: ${utaError}`);
}

async function mobilePortfolio(credentials: Credentials): Promise<PortfolioResponse> {
  const dayStart = Date.now() - Date.now() % 86_400_000;
  const [tickers, futuresTickers, classicAssets, futuresResult, billsResult, classicAccounts, utaAccount] = await Promise.all([
    request<SpotTicker[]>('/api/v2/spot/market/tickers'),
    request<FuturesTicker[]>('/api/v2/mix/market/tickers', 'productType=USDT-FUTURES'),
    request<SpotAsset[]>('/api/v2/spot/account/assets', 'assetType=hold_only', credentials).catch(() => []),
    mobileFuturesPositions(credentials),
    request<{ bills: FuturesBill[] }>('/api/v2/mix/account/bill', `productType=USDT-FUTURES&startTime=${dayStart}&endTime=${Date.now()}&limit=100`, credentials).catch(() => ({ bills: [] })),
    request<FuturesAccount[]>('/api/v2/mix/account/accounts', 'productType=USDT-FUTURES', credentials).catch(() => []),
    request<UtaAccountData>('/api/v3/account/assets', '', credentials).catch(() => undefined),
  ]);
  const assetsResult: SpotAsset[] = classicAssets.length ? classicAssets : (utaAccount?.assets ?? []).map(asset => ({ coin: asset.coin, available: asset.available, frozen: '0', locked: asset.locked }));
  if (!assetsResult.length && !futuresResult.length && !classicAccounts.length && !utaAccount) throw new Error('No Bitget holdings returned. Check API read permissions.');

  const tickerMap = new Map(tickers.map(ticker => [ticker.symbol, ticker]));
  const futuresTickerMap = new Map(futuresTickers.map(ticker => [canonicalFuturesSymbol(ticker.symbol), ticker]));
  const realized = new Map<string, number>();
  for (const bill of billsResult.bills.filter(bill => isPnlBill(bill.businessType))) {
    if (bill.symbol) { const symbol = canonicalFuturesSymbol(bill.symbol); realized.set(symbol, (realized.get(symbol) ?? 0) + number(bill.amount) + number(bill.fee)); }
  }

  const positions: MarketCoin[] = [];
  for (const asset of assetsResult) {
    const base = asset.coin.toUpperCase();
    const quantity = number(asset.available) + number(asset.frozen) + number(asset.locked);
    if (quantity <= 0) continue;
    if (base === 'USDT' || base === 'USDC') {
      positions.push({ symbol: `${base}USDT`, base, exchange: 'bitget', price: 1, change24h: 0, quoteVolume: 0, high24h: 1, low24h: 1, positionValue: quantity, dailyPnl: 0 });
      continue;
    }
    const ticker = tickerMap.get(`${base}USDT`);
    if (!ticker) continue;
    const price = number(ticker.lastPr), open = number(ticker.openUtc), value = quantity * price;
    if (price <= 0 || value < .01) continue;
    positions.push({ symbol: `${base}USDT`, base, exchange: 'bitget', price, change24h: open > 0 ? (price / open - 1) * 100 : 0, quoteVolume: number(ticker.quoteVolume), high24h: number(ticker.high24h), low24h: number(ticker.low24h), positionValue: value, dailyPnl: open > 0 ? quantity * (price - open) : 0 });
  }
  for (const position of futuresResult) {
    const total = number(position.total), margin = number(position.marginSize);
    const symbol = canonicalFuturesSymbol(position.symbol);
    const ticker = futuresTickerMap.get(symbol);
    const mark = number(ticker?.markPrice) || number(position.markPrice), open = number(ticker?.openUtc);
    if (total <= 0 || mark <= 0) continue;
    const side = position.holdSide.toUpperCase();
    const realizedToday = realized.get(symbol) ?? 0;
    realized.delete(symbol);
    const pnl = (open > 0 ? total * (side === 'SHORT' ? open - mark : mark - open) : number(position.unrealizedPL)) + realizedToday;
    const base = symbol.replace(/USDT$/, '').toUpperCase();
    positions.push({ symbol: `${symbol}-${side}`, base: `${base}·${side === 'SHORT' ? 'S' : 'L'}`, exchange: 'bitget', price: mark, change24h: margin > 0 ? pnl / margin * 100 : 0, quoteVolume: 0, high24h: mark, low24h: open, positionValue: total * mark, dailyPnl: pnl });
  }
  for (const [symbol, pnl] of realized) {
    if (Math.abs(pnl) < .000001) continue;
    const mark = number(futuresTickerMap.get(symbol)?.markPrice), base = symbol.replace(/USDT$/, '').toUpperCase();
    positions.push({ symbol: `${symbol}-CLOSED`, base: `${base}·R`, exchange: 'bitget', price: mark, change24h: 0, quoteVolume: 0, high24h: mark, low24h: mark, positionValue: Math.max(Math.abs(pnl), 1), dailyPnl: pnl });
  }
  positions.sort((a, b) => b.positionValue - a.positionValue);

  const account = classicAccounts.find(item => item.marginCoin.toUpperCase() === 'USDT');
  const utaUsdt = utaAccount?.assets.find(asset => asset.coin.toUpperCase() === 'USDT');
  const futuresBalance: FuturesBalance | undefined = account
    ? { marginCoin: account.marginCoin, available: number(account.available), locked: number(account.locked), accountEquity: number(account.accountEquity), unrealizedPnl: number(account.unrealizedPL), maxTransferOut: number(account.maxTransferOut) }
    : utaAccount ? { marginCoin: 'USDT', available: number(utaUsdt?.available), locked: number(utaUsdt?.locked), accountEquity: number(utaAccount.usdtEquity || utaAccount.accountEquity), unrealizedPnl: number(utaAccount.usdtUnrealisedPnl || utaAccount.unrealisedPnl), maxTransferOut: number(utaUsdt?.available) } : undefined;
  return { positions, futuresBalance };
}

function readMobileHistory(): ProfitHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as ProfitHistoryEntry[]; } catch { return []; }
}
function saveMobileSnapshot(positions: MarketCoin[]) {
  const history = readMobileHistory(), timestamp = Date.now();
  const entry: ProfitHistoryEntry = { timestamp, totalPnl: positions.reduce((sum, item) => sum + item.dailyPnl, 0), portfolioValue: positions.reduce((sum, item) => sum + item.positionValue, 0), positions };
  if (history.at(-1)?.timestamp && Math.floor(history.at(-1)!.timestamp / 300_000) === Math.floor(timestamp / 300_000)) history.pop();
  history.push(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-10_000)));
}

async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 250_000 }, material, { name: 'AES-GCM', length: 256 }, false, usage);
}
async function saveMobileVault(credentials: Credentials, password: string) {
  if (password.length < 8) throw new Error('Login password must be at least 8 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(credentials))));
  localStorage.setItem(VAULT_KEY, JSON.stringify({ salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) } satisfies MobileVault));
}
async function openMobileVault(password: string): Promise<Credentials> {
  const raw = localStorage.getItem(VAULT_KEY); if (!raw) throw new Error('No saved Bitget login');
  try {
    const vault = JSON.parse(raw) as MobileVault, salt = base64ToBytes(vault.salt), iv = base64ToBytes(vault.iv);
    const key = await deriveKey(password, salt, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(vault.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext)) as Credentials;
  } catch { throw new Error('Incorrect login password'); }
}

export async function connectBitgetAccount(credentials: Credentials, saveLogin: boolean, loginPassword?: string | null) {
  if (isTauriDesktop()) return invoke<PortfolioResponse>('connect_bitget', { ...credentials, saveLogin, loginPassword });
  const snapshot = await mobilePortfolio(credentials); mobileCredentials = credentials; saveMobileSnapshot(snapshot.positions);
  if (saveLogin) await saveMobileVault(credentials, loginPassword ?? '');
  return snapshot;
}
export async function loginBitgetAccount(loginPassword: string) {
  if (isTauriDesktop()) return invoke<PortfolioResponse>('login_bitget', { loginPassword });
  const credentials = await openMobileVault(loginPassword), snapshot = await mobilePortfolio(credentials); mobileCredentials = credentials; saveMobileSnapshot(snapshot.positions); return snapshot;
}
export async function refreshBitgetAccount() {
  if (isTauriDesktop()) return invoke<PortfolioResponse>('refresh_bitget');
  if (!mobileCredentials) throw new Error('Bitget is not connected');
  const snapshot = await mobilePortfolio(mobileCredentials); saveMobileSnapshot(snapshot.positions); return snapshot;
}
export async function disconnectBitgetAccount() { if (isTauriDesktop()) await invoke('disconnect_bitget'); mobileCredentials = undefined; }
export async function hasSavedBitgetLogin() { return isTauriDesktop() ? invoke<boolean>('has_saved_login') : Boolean(localStorage.getItem(VAULT_KEY)); }
export async function deleteSavedBitgetLogin() { if (isTauriDesktop()) await invoke('delete_saved_login'); else localStorage.removeItem(VAULT_KEY); }
export async function loadProfitHistory() { return isTauriDesktop() ? invoke<ProfitHistoryEntry[]>('load_history') : readMobileHistory(); }
export async function clearProfitHistory() { if (isTauriDesktop()) await invoke('clear_history'); else localStorage.setItem(HISTORY_KEY, '[]'); }
