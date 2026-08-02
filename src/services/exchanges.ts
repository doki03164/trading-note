import type { Exchange, MarketCoin } from '../types';

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

export async function fetchMarkets(exchange: Exchange, signal?: AbortSignal): Promise<{ data: MarketCoin[]; live: boolean }> {
  const data = exchange === 'binance' ? await fetchBinance(signal) : await fetchBitget(signal);
  if (!data.length) throw new Error('Empty response');
  return { data, live: true };
}
