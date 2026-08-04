import type { Exchange, MarketCoin } from '../types';
import { METAL_SYMBOLS } from './instruments';

const STABLES = ['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT'];

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchBinance(signal?: AbortSignal): Promise<MarketCoin[]> {
  type Row = { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; highPrice: string; lowPrice: string };
  const rows = await getJson<Row[]>('https://api.binance.com/api/v3/ticker/24hr', signal);
  return rows.filter(r => r.symbol.endsWith('USDT') && !STABLES.includes(r.symbol))
    .map(r => ({ symbol: r.symbol, base: r.symbol.slice(0, -4), exchange: 'binance' as const, price: +r.lastPrice, change24h: +r.priceChangePercent, quoteVolume: +r.quoteVolume, high24h: +r.highPrice, low24h: +r.lowPrice }))
    .filter(r => Number.isFinite(r.price) && r.price > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 40)
    .map(coin => ({ ...coin, positionValue: coin.quoteVolume, dailyPnl: coin.change24h, pnlSource: 'market-change' as const }));
}

export async function fetchBitget(signal?: AbortSignal): Promise<MarketCoin[]> {
  type Row = { symbol: string; lastPr: string; change24h: string; quoteVolume: string; high24h: string; low24h: string };
  type Payload = { code: string; data: Row[] };
  const payload = await getJson<Payload>('https://api.bitget.com/api/v2/spot/market/tickers', signal);
  return payload.data.filter(r => r.symbol.endsWith('USDT') && !STABLES.includes(r.symbol))
    .map(r => ({ symbol: r.symbol, base: r.symbol.slice(0, -4), exchange: 'bitget' as const, price: +r.lastPr, change24h: +r.change24h * 100, quoteVolume: +r.quoteVolume, high24h: +r.high24h, low24h: +r.low24h }))
    .filter(r => Number.isFinite(r.price) && r.price > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 40)
    .map(coin => ({ ...coin, positionValue: coin.quoteVolume, dailyPnl: coin.change24h, pnlSource: 'market-change' as const }));
}

/**
 * Precious metals trade on Bitget as USDT perpetuals, not on spot, so the spot ticker feed the
 * heatmap is built from never contained them. They are pinned in rather than left to the
 * volume ranking, so a commodity book is always visible to the trader holding it.
 */
export async function fetchBitgetMetals(signal?: AbortSignal): Promise<MarketCoin[]> {
  type Row = { symbol: string; lastPr: string; change24h: string; quoteVolume: string; high24h: string; low24h: string };
  type Payload = { code: string; data: Row[] };
  const payload = await getJson<Payload>('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES', signal);
  return payload.data.filter(r => METAL_SYMBOLS.includes(r.symbol))
    .map(r => ({ symbol: r.symbol, base: r.symbol.slice(0, -4), exchange: 'bitget' as const, price: +r.lastPr, change24h: +r.change24h * 100, quoteVolume: +r.quoteVolume, high24h: +r.high24h, low24h: +r.low24h }))
    .filter(r => Number.isFinite(r.price) && r.price > 0)
    .map(coin => ({ ...coin, positionValue: coin.quoteVolume, dailyPnl: coin.change24h, pnlSource: 'market-change' as const }));
}

export async function fetchMarkets(exchange: Exchange, signal?: AbortSignal): Promise<{ data: MarketCoin[]; live: boolean; warning?: string }> {
  if (exchange === 'binance') {
    const data = await fetchBinance(signal);
    if (!data.length) throw new Error('Empty response');
    return { data, live: true };
  }
  // A metals hiccup must not cost the whole heatmap, but it is reported rather than hidden.
  const [spot, metals] = await Promise.allSettled([fetchBitget(signal), fetchBitgetMetals(signal)]);
  if (spot.status === 'rejected') throw spot.reason;
  if (!spot.value.length) throw new Error('Empty response');
  if (metals.status === 'rejected') {
    return { data: spot.value, live: true, warning: `Commodity prices unavailable: ${metals.reason instanceof Error ? metals.reason.message : String(metals.reason)}` };
  }
  return { data: [...metals.value, ...spot.value], live: true };
}
