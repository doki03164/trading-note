import { CapacitorHttp } from '@capacitor/core';
import { invoke } from '@tauri-apps/api/core';
import type { FuturesBalance, LiveContracts, MarketCoin, PortfolioResponse, ProfitHistoryEntry } from '../types';

interface Credentials { apiKey: string; apiSecret: string; passphrase: string }
interface ApiEnvelope<T> { code: string | number; msg?: string; message?: string; data?: T | null }
interface SpotAsset { coin: string; available: string; frozen: string; locked: string }
interface SpotTicker { symbol: string; lastPr: string; openUtc: string; quoteVolume: string; high24h: string; low24h: string }
interface FuturesPosition {
  symbol: string;
  holdSide: string;
  marginSize: string;
  total: string;
  unrealizedPL: string;
  markPrice: string;
  openPriceAvg?: string;
  leverage?: string;
  liquidationPrice?: string;
  marginMode?: string;
  profitRate?: string;
  uTime?: string;
}
interface UtaFuturesPosition {
  symbol: string;
  posSide: string;
  positionBalance: string;
  total: string;
  unrealisedPnl: string;
  markPrice: string;
  avgPrice?: string;
  leverage?: string;
  liquidationPrice?: string;
  marginMode?: string;
  profitRate?: string;
  updatedTime?: string;
}
interface UtaPositionData { list: UtaFuturesPosition[] }
interface UtaAsset { coin: string; balance: string; available: string; locked: string }
interface UtaAccountData { accountEquity: string; usdtEquity: string; unrealisedPnl: string; usdtUnrealisedPnl: string; assets: UtaAsset[] }
interface FuturesTicker { symbol: string; openUtc: string; markPrice: string }
interface FuturesBill { symbol: string; amount: string; fee: string; businessType: string }
interface FuturesBillData { bills: FuturesBill[]; endId?: string }
interface UtaFinancialRecord { symbol?: string; amount?: string; fee?: string; type?: string }
interface UtaFinancialData { list: UtaFinancialRecord[]; cursor?: string }
interface FuturesAccount { marginCoin: string; available?: string; locked?: string; accountEquity?: string; unrealizedPL?: string; crossedUnrealizedPL?: string; isolatedUnrealizedPL?: string; maxTransferOut?: string }
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
  const value = type.toLowerCase();
  return !value.startsWith('trans_') && !value.startsWith('transfer_') && !value.startsWith('user_exchange_') && !['append_margin', 'adjust_down_lever_append_margin', 'reduce_margin', 'auto_append_margin', 'cash_gift_issue', 'cash_gift_recycle', 'bonus_issue', 'bonus_recycle', 'bonus_expired', 'risk_captital_user_transfer', 'risk_capital_user_transfer'].includes(value);
}

export function futuresAccountUnrealized(account: FuturesAccount) {
  return account.unrealizedPL?.trim() ? number(account.unrealizedPL) : number(account.crossedUnrealizedPL) + number(account.isolatedUnrealizedPL);
}

export function actualFuturesPnl(unrealizedPnl: number, realizedPnl?: number | null) { return unrealizedPnl + (realizedPnl ?? 0); }

export function normalizeUtaPosition(position: UtaFuturesPosition): FuturesPosition {
  return {
    symbol: position.symbol,
    holdSide: position.posSide,
    marginSize: position.positionBalance,
    total: position.total,
    unrealizedPL: position.unrealisedPnl,
    markPrice: position.markPrice,
    openPriceAvg: position.avgPrice,
    leverage: position.leverage,
    liquidationPrice: position.liquidationPrice,
    marginMode: position.marginMode,
    profitRate: position.profitRate,
    uTime: position.updatedTime,
  };
}

export function futuresPositionToMarketCoin(position: FuturesPosition, realizedPnl?: number, fallbackMark = 0): MarketCoin | null {
  const quantity = number(position.total), margin = number(position.marginSize);
  // Only a closed-out position is worth dropping. Bitget intermittently returns a live position
  // with a blank markPrice, and discarding those made open contracts vanish from the grid for
  // one refresh even though the exchange still reported them.
  if (quantity <= 0) return null;
  const entryPrice = number(position.openPriceAvg);
  const markPrice = [number(position.markPrice), fallbackMark, entryPrice].find(value => value > 0) ?? 0;
  const symbol = canonicalFuturesSymbol(position.symbol);
  const side = position.holdSide.trim().toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const unrealizedPnl = number(position.unrealizedPL);
  const suppliedRoi = number(position.profitRate) * 100;
  const roi = position.profitRate?.trim() ? suppliedRoi : margin > 0 ? unrealizedPnl / margin * 100 : 0;
  const base = symbol.replace(/USDT$/, '').toUpperCase();
  const liquidation = number(position.liquidationPrice);
  const updatedAt = number(position.uTime);
  return {
    symbol: `${symbol}-${side}`,
    base: `${base}·${side === 'SHORT' ? 'S' : 'L'}`,
    exchange: 'bitget',
    price: markPrice,
    change24h: roi,
    quoteVolume: 0,
    high24h: markPrice,
    low24h: entryPrice,
    positionValue: quantity * markPrice,
    dailyPnl: actualFuturesPnl(unrealizedPnl, realizedPnl),
    unrealizedPnl,
    realizedPnl,
    pnlSource: 'exchange',
    side,
    quantity,
    margin,
    entryPrice,
    markPrice: markPrice > 0 ? markPrice : undefined,
    leverage: number(position.leverage),
    liquidationPrice: liquidation > 0 ? liquidation : null,
    marginMode: position.marginMode?.toUpperCase() || undefined,
    roi,
    positionUpdatedAt: updatedAt > 0 ? updatedAt : null,
  };
}

export function mergeLiveContracts(previous: MarketCoin[], liveContracts: MarketCoin[]) {
  const priorContracts = new Map(previous.filter(item => item.side).map(item => [item.symbol, item]));
  const retained = previous.filter(item => !item.side);
  const merged = liveContracts.map(item => {
    const prior = priorContracts.get(item.symbol);
    const realizedPnl = prior?.realizedPnl;
    return { ...item, realizedPnl, dailyPnl: actualFuturesPnl(item.unrealizedPnl ?? 0, realizedPnl) };
  });
  return [...retained, ...merged].sort((a, b) => b.positionValue - a.positionValue);
}

export function classicPositionList(data: FuturesPosition[] | { list?: FuturesPosition[] }) {
  return Array.isArray(data) ? data : data.list ?? [];
}

/**
 * Positions plus whether an empty list is trustworthy. Bitget serves the same account through a
 * Classic and a Unified endpoint; when one is empty and the other errors we cannot tell a flat
 * account from a half-failed read, and wiping the grid on that guess is what made positions
 * blink out.
 */
export interface PositionFetch { positions: FuturesPosition[]; degraded?: string }

async function mobileFuturesPositions(credentials: Credentials): Promise<PositionFetch> {
  let filtered: FuturesPosition[] | undefined, filteredError = '';
  try {
    filtered = classicPositionList(await request<FuturesPosition[] | { list?: FuturesPosition[] }>('/api/v2/mix/position/all-position', 'productType=USDT-FUTURES&marginCoin=USDT', credentials));
    if (filtered.length) return { positions: filtered };
  } catch (error) { filteredError = error instanceof Error ? error.message : String(error); }

  let unfiltered: FuturesPosition[] | undefined, unfilteredError = '';
  try {
    unfiltered = classicPositionList(await request<FuturesPosition[] | { list?: FuturesPosition[] }>('/api/v2/mix/position/all-position', 'productType=USDT-FUTURES', credentials));
    if (unfiltered.length) return { positions: unfiltered };
  } catch (error) { unfilteredError = error instanceof Error ? error.message : String(error); }

  let utaError = '';
  try {
    // Unified answered, so its list is authoritative whether or not it is empty.
    const unified = await request<UtaPositionData>('/api/v3/position/current-position', 'category=USDT-FUTURES', credentials);
    return { positions: unified.list.map(normalizeUtaPosition) };
  } catch (error) { utaError = error instanceof Error ? error.message : String(error); }
  // Classic returned nothing and Unified could not confirm it, so "no positions" here may be a
  // false negative rather than a flat account.
  const degraded = `Unified position check failed: ${utaError}`;
  if (unfiltered) return { positions: unfiltered, degraded };
  if (filtered) return { positions: filtered, degraded };
  throw new Error(`Classic USDT: ${filteredError}; Classic all margins: ${unfilteredError}; Unified: ${utaError}`);
}

/**
 * Last mark price we saw per contract, used so a position whose markPrice comes back blank is
 * still valued at something sensible instead of disappearing.
 */
export function knownMarks(positions: MarketCoin[]) {
  const marks = new Map<string, number>();
  for (const item of positions) {
    if (!item.side || !item.markPrice || item.markPrice <= 0) continue;
    marks.set(canonicalFuturesSymbol(item.symbol.replace(/-(LONG|SHORT)$/, '')), item.markPrice);
  }
  return marks;
}

async function classicFuturesBills(credentials: Credentials, dayStart: number, now: number) {
  const bills: FuturesBill[] = [];
  let cursor = '';
  const seen = new Set<string>();
  for (let page = 0; page < 100; page += 1) {
    const query = `productType=USDT-FUTURES&startTime=${dayStart}&endTime=${now}&limit=100${cursor ? `&idLessThan=${encodeURIComponent(cursor)}` : ''}`;
    const data = await request<FuturesBillData>('/api/v2/mix/account/bill', query, credentials);
    bills.push(...data.bills);
    if (data.bills.length < 100 || !data.endId) return bills;
    if (seen.has(data.endId)) throw new Error('Bitget Classic bills returned a repeated pagination cursor');
    seen.add(data.endId);
    cursor = data.endId;
  }
  throw new Error('Bitget Classic bills exceeded 10,000 UTC-day records');
}

async function utaFuturesBills(credentials: Credentials, dayStart: number, now: number) {
  const bills: FuturesBill[] = [];
  let cursor = '';
  const seen = new Set<string>();
  for (let page = 0; page < 100; page += 1) {
    const query = `category=USDT-FUTURES&startTime=${dayStart}&endTime=${now}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await request<UtaFinancialData>('/api/v3/account/financial-records', query, credentials);
    bills.push(...data.list.map(record => ({ symbol: record.symbol ?? '', amount: record.amount ?? '0', fee: record.fee ?? '0', businessType: record.type ?? '' })));
    if (data.list.length < 100 || !data.cursor) return bills;
    if (seen.has(data.cursor)) throw new Error('Bitget UTA records returned a repeated pagination cursor');
    seen.add(data.cursor);
    cursor = data.cursor;
  }
  throw new Error('Bitget UTA records exceeded 10,000 UTC-day records');
}

async function mobileFuturesBills(credentials: Credentials, dayStart: number, now: number) {
  try { return await classicFuturesBills(credentials, dayStart, now); }
  catch (classicError) {
    try { return await utaFuturesBills(credentials, dayStart, now); }
    catch (utaError) { throw new Error(`Classic bills: ${String(classicError)}; UTA records: ${String(utaError)}`); }
  }
}

async function mobilePortfolio(credentials: Credentials): Promise<PortfolioResponse> {
  // Stamped before the requests go out, so the reported age is never younger than the data.
  const capturedAt = Date.now();
  const now = capturedAt, dayStart = now - now % 86_400_000;
  let spotError = '';
  const [tickers, futuresTickers, classicAssets, futuresFetch, billsResult, classicAccounts, utaAccount] = await Promise.all([
    request<SpotTicker[]>('/api/v2/spot/market/tickers'),
    request<FuturesTicker[]>('/api/v2/mix/market/tickers', 'productType=USDT-FUTURES'),
    // A failed spot read used to drop every holding with no explanation; report it instead.
    request<SpotAsset[]>('/api/v2/spot/account/assets', 'assetType=hold_only', credentials).catch(error => { spotError = error instanceof Error ? error.message : String(error); return [] as SpotAsset[]; }),
    mobileFuturesPositions(credentials),
    mobileFuturesBills(credentials, dayStart, now).then(value => ({ value, available: true })).catch(() => ({ value: [] as FuturesBill[], available: false })),
    request<FuturesAccount[]>('/api/v2/mix/account/accounts', 'productType=USDT-FUTURES', credentials).catch(() => []),
    request<UtaAccountData>('/api/v3/account/assets', '', credentials).catch(() => undefined),
  ]);
  const futuresResult = futuresFetch.positions;
  const staleReason = [spotError && `Spot holdings unavailable: ${spotError}`, futuresFetch.degraded].filter(Boolean).join('; ') || null;
  const assetsResult: SpotAsset[] = classicAssets.length ? classicAssets : (utaAccount?.assets ?? []).map(asset => ({ coin: asset.coin, available: asset.available, frozen: '0', locked: asset.locked }));
  if (!assetsResult.length && !futuresResult.length && !classicAccounts.length && !utaAccount) throw new Error('No Bitget holdings returned. Check API read permissions.');

  const tickerMap = new Map(tickers.map(ticker => [ticker.symbol, ticker]));
  const futuresTickerMap = new Map(futuresTickers.map(ticker => [canonicalFuturesSymbol(ticker.symbol), ticker]));
  const realized = new Map<string, number>();
  const pnlBills = billsResult.value.filter(bill => isPnlBill(bill.businessType));
  const realizedTotal = pnlBills.reduce((sum, bill) => sum + number(bill.amount) + number(bill.fee), 0);
  for (const bill of pnlBills) {
    if (bill.symbol) { const symbol = canonicalFuturesSymbol(bill.symbol); realized.set(symbol, (realized.get(symbol) ?? 0) + number(bill.amount) + number(bill.fee)); }
  }

  const positions: MarketCoin[] = [];
  for (const asset of assetsResult) {
    const base = asset.coin.toUpperCase();
    const quantity = number(asset.available) + number(asset.frozen) + number(asset.locked);
    if (quantity <= 0) continue;
    if (base === 'USDT' || base === 'USDC') {
      positions.push({ symbol: `${base}USDT`, base, exchange: 'bitget', price: 1, change24h: 0, quoteVolume: 0, high24h: 1, low24h: 1, positionValue: quantity, dailyPnl: 0, pnlSource: 'not-applicable', quantity });
      continue;
    }
    const ticker = tickerMap.get(`${base}USDT`);
    if (!ticker) continue;
    const price = number(ticker.lastPr), open = number(ticker.openUtc), value = quantity * price;
    if (price <= 0 || value < .01) continue;
    positions.push({ symbol: `${base}USDT`, base, exchange: 'bitget', price, change24h: open > 0 ? (price / open - 1) * 100 : 0, quoteVolume: number(ticker.quoteVolume), high24h: number(ticker.high24h), low24h: number(ticker.low24h), positionValue: value, dailyPnl: 0, pnlSource: 'not-applicable', quantity });
  }
  for (const position of futuresResult) {
    const symbol = canonicalFuturesSymbol(position.symbol);
    const ticker = futuresTickerMap.get(symbol);
    const realizedToday = realized.get(symbol) ?? 0;
    const realizedPnl = billsResult.available ? realizedToday : undefined;
    const item = futuresPositionToMarketCoin(position, realizedPnl, number(ticker?.markPrice));
    if (!item) continue;
    realized.delete(symbol);
    positions.push(item);
  }
  for (const [symbol, pnl] of realized) {
    if (Math.abs(pnl) < .000001) continue;
    const mark = number(futuresTickerMap.get(symbol)?.markPrice), base = symbol.replace(/USDT$/, '').toUpperCase();
    positions.push({ symbol: `${symbol}-CLOSED`, base: `${base}·R`, exchange: 'bitget', price: mark, change24h: 0, quoteVolume: 0, high24h: mark, low24h: mark, positionValue: Math.max(Math.abs(pnl), 1), dailyPnl: pnl, unrealizedPnl: 0, realizedPnl: pnl, pnlSource: 'exchange' });
  }
  positions.sort((a, b) => b.positionValue - a.positionValue);

  const account = classicAccounts.find(item => item.marginCoin.toUpperCase() === 'USDT');
  const utaUsdt = utaAccount?.assets.find(asset => asset.coin.toUpperCase() === 'USDT');
  const positionUnrealized = futuresResult.reduce((sum, position) => sum + number(position.unrealizedPL), 0);
  const futuresBalance: FuturesBalance | undefined = account
    ? { marginCoin: account.marginCoin, available: number(account.available), locked: number(account.locked), accountEquity: number(account.accountEquity), unrealizedPnl: futuresResult.length ? positionUnrealized : futuresAccountUnrealized(account), realizedPnl: billsResult.available ? realizedTotal : null, maxTransferOut: number(account.maxTransferOut) }
    : utaAccount ? { marginCoin: 'USDT', available: number(utaUsdt?.available), locked: number(utaUsdt?.locked), accountEquity: number(utaAccount.usdtEquity || utaAccount.accountEquity), unrealizedPnl: futuresResult.length ? positionUnrealized : number(utaAccount.usdtUnrealisedPnl || utaAccount.unrealisedPnl), realizedPnl: billsResult.available ? realizedTotal : null, maxTransferOut: number(utaUsdt?.available) } : undefined;
  return { positions, futuresBalance, capturedAt, contractsCapturedAt: capturedAt, staleReason };
}

function readMobileHistory(): ProfitHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as ProfitHistoryEntry[]; } catch { return []; }
}
function saveMobileSnapshot(snapshot: PortfolioResponse) {
  const positions = snapshot.positions;
  const history = readMobileHistory(), timestamp = Date.now();
  const unrealizedPnl = snapshot.futuresBalance?.unrealizedPnl ?? positions.reduce((sum, item) => sum + (item.unrealizedPnl ?? 0), 0);
  const realizedValues = positions.filter(item => item.realizedPnl != null).map(item => item.realizedPnl!);
  const balanceRealized = snapshot.futuresBalance?.realizedPnl;
  const realizedPnl = balanceRealized != null ? balanceRealized : realizedValues.length ? realizedValues.reduce((sum, value) => sum + value, 0) : null;
  const entry: ProfitHistoryEntry = { timestamp, totalPnl: unrealizedPnl + (realizedPnl ?? 0), unrealizedPnl, realizedPnl, portfolioValue: positions.reduce((sum, item) => sum + item.positionValue, 0), positions };
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
  const snapshot = await mobilePortfolio(credentials); mobileCredentials = credentials; saveMobileSnapshot(snapshot);
  if (saveLogin) await saveMobileVault(credentials, loginPassword ?? '');
  return snapshot;
}
export async function loginBitgetAccount(loginPassword: string) {
  if (isTauriDesktop()) return invoke<PortfolioResponse>('login_bitget', { loginPassword });
  const credentials = await openMobileVault(loginPassword), snapshot = await mobilePortfolio(credentials); mobileCredentials = credentials; saveMobileSnapshot(snapshot); return snapshot;
}
export async function refreshBitgetAccount() {
  if (isTauriDesktop()) return invoke<PortfolioResponse>('refresh_bitget');
  if (!mobileCredentials) throw new Error('Bitget is not connected');
  const snapshot = await mobilePortfolio(mobileCredentials); saveMobileSnapshot(snapshot); return snapshot;
}
export async function refreshBitgetContracts(previous: MarketCoin[] = []): Promise<LiveContracts> {
  if (isTauriDesktop()) return invoke<LiveContracts>('refresh_bitget_contracts');
  if (!mobileCredentials) throw new Error('Bitget is not connected');
  const capturedAt = Date.now();
  const fetched = await mobileFuturesPositions(mobileCredentials);
  // The full snapshot values a blank markPrice from the ticker feed; this fast path has no
  // ticker call, so it reuses the last mark we saw.
  const marks = knownMarks(previous);
  const contracts = fetched.positions
    .map(position => futuresPositionToMarketCoin(position, undefined, marks.get(canonicalFuturesSymbol(position.symbol)) ?? 0))
    .filter((item): item is MarketCoin => item != null);
  // Bitget could not confirm the account is flat, so keep the last known contracts rather than
  // reporting a closed book the exchange never confirmed.
  if (!contracts.length && fetched.degraded) {
    const retained = previous.filter(item => item.side);
    // capturedAt 0 keeps the freshness clock where it was: this data is the previous read, so
    // it must not be presented as a new confirmation from the exchange.
    if (retained.length) return { contracts: retained, capturedAt: 0, staleReason: fetched.degraded };
  }
  return { contracts, capturedAt, staleReason: fetched.degraded ?? null };
}
export async function disconnectBitgetAccount() { if (isTauriDesktop()) await invoke('disconnect_bitget'); mobileCredentials = undefined; }
export async function hasSavedBitgetLogin() { return isTauriDesktop() ? invoke<boolean>('has_saved_login') : Boolean(localStorage.getItem(VAULT_KEY)); }
export async function deleteSavedBitgetLogin() { if (isTauriDesktop()) await invoke('delete_saved_login'); else localStorage.removeItem(VAULT_KEY); }
export async function loadProfitHistory() { return isTauriDesktop() ? invoke<ProfitHistoryEntry[]>('load_history') : readMobileHistory(); }
export async function clearProfitHistory() { if (isTauriDesktop()) await invoke('clear_history'); else localStorage.setItem(HISTORY_KEY, '[]'); }
export async function importProfitHistory(entries: ProfitHistoryEntry[], replace: boolean) {
  if (isTauriDesktop()) return invoke<ProfitHistoryEntry[]>('import_profit_history', { entries, replace });
  const merged = replace ? entries : [...new Map([...readMobileHistory(), ...entries].map(entry => [entry.timestamp, entry])).values()];
  merged.sort((a, b) => a.timestamp - b.timestamp);
  const result = merged.slice(-10_000);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(result));
  return result;
}
