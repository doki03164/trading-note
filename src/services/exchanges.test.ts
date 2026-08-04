import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBinance, fetchBitget, fetchBitgetMetals, fetchMarkets } from './exchanges';

afterEach(() => vi.unstubAllGlobals());

const SPOT_TICKERS = { code: '00000', data: [{ symbol: 'BTCUSDT', lastPr: '60000', change24h: '0.025', quoteVolume: '100', high24h: '61000', low24h: '58000' }] };
const PERP_TICKERS = { code: '00000', data: [
  { symbol: 'XAUUSDT', lastPr: '4062.29', change24h: '-0.00267', quoteVolume: '93448997', high24h: '4078.97', low24h: '4028.56' },
  { symbol: 'XPDUSDT', lastPr: '1281.79', change24h: '0.01', quoteVolume: '1000', high24h: '1300', low24h: '1250' },
  { symbol: 'DOGEUSDT', lastPr: '0.2', change24h: '0.01', quoteVolume: '9999999999', high24h: '0.3', low24h: '0.1' },
] };

/** Routes by URL so the spot and perpetual ticker feeds can be stubbed independently. */
function stubBitget(overrides: { spot?: unknown; perp?: unknown; perpFails?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/mix/market/tickers')) {
      if (overrides.perpFails) throw new Error('perp feed down');
      return { ok: true, json: async () => overrides.perp ?? PERP_TICKERS };
    }
    return { ok: true, json: async () => overrides.spot ?? SPOT_TICKERS };
  }));
}

describe('exchange market adapters', () => {
  it('normalizes, sorts, and calculates Binance daily P&L', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { symbol: 'ETHUSDT', lastPrice: '2000', priceChangePercent: '-2', quoteVolume: '50', highPrice: '2100', lowPrice: '1900' },
        { symbol: 'BTCUSDT', lastPrice: '60000', priceChangePercent: '5', quoteVolume: '100', highPrice: '61000', lowPrice: '58000' },
        { symbol: 'BTCUSD', lastPrice: '1', priceChangePercent: '1', quoteVolume: '999', highPrice: '1', lowPrice: '1' },
      ],
    }));

    const rows = await fetchBinance();
    expect(rows.map(row => row.base)).toEqual(['BTC', 'ETH']);
    expect(rows[0].dailyPnl).toBe(5);
    expect(rows[0].positionValue).toBe(100);
    expect(rows[1].dailyPnl).toBe(-2);
  });

  it('normalizes Bitget fractional 24-hour change into percent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: '00000', data: [
        { symbol: 'BTCUSDT', lastPr: '60000', change24h: '0.025', quoteVolume: '100', high24h: '61000', low24h: '58000' },
      ] }),
    }));

    const rows = await fetchBitget();
    expect(rows).toHaveLength(1);
    expect(rows[0].change24h).toBe(2.5);
    expect(rows[0].dailyPnl).toBe(2.5);
  });

  it('reports an API failure instead of returning fabricated data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchMarkets('bitget')).rejects.toThrow('offline');
  });

  it('picks the precious metals out of the perpetual feed and ignores the crypto perps', async () => {
    // Metals are only listed as USDT perpetuals, so the spot feed the heatmap is built from
    // never contained them.
    stubBitget();
    const rows = await fetchBitgetMetals();
    expect(rows.map(row => row.symbol)).toEqual(['XAUUSDT', 'XPDUSDT']);
    expect(rows[0].change24h).toBeCloseTo(-0.267, 10);
    expect(rows[0].price).toBe(4062.29);
  });

  it('shows commodities alongside crypto on the Bitget heatmap', async () => {
    stubBitget();
    const result = await fetchMarkets('bitget');
    // Metals lead so a commodity book is never pushed out by crypto volume ranking.
    expect(result.data.map(row => row.symbol)).toEqual(['XAUUSDT', 'XPDUSDT', 'BTCUSDT']);
    expect(result.warning).toBeUndefined();
  });

  it('keeps the heatmap alive but says so when only the commodity feed fails', async () => {
    stubBitget({ perpFails: true });
    const result = await fetchMarkets('bitget');
    expect(result.data.map(row => row.symbol)).toEqual(['BTCUSDT']);
    expect(result.live).toBe(true);
    expect(result.warning).toContain('Commodity prices unavailable');
  });

  it('still fails loudly when the spot feed itself is down', async () => {
    stubBitget({ spot: { code: '00000', data: [] } });
    await expect(fetchMarkets('bitget')).rejects.toThrow('Empty response');
  });
});
