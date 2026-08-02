import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBinance, fetchBitget, fetchMarkets } from './exchanges';

afterEach(() => vi.unstubAllGlobals());

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
    expect(rows[0].dailyPnl).toBe(1620);
    expect(rows[1].dailyPnl).toBe(-437);
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
    expect(rows[0].dailyPnl).toBe(810);
  });

  it('returns a populated demo portfolio when a public endpoint is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await fetchMarkets('bitget');
    expect(result.live).toBe(false);
    expect(result.data).toHaveLength(20);
    expect(result.data.every(row => Number.isFinite(row.dailyPnl))).toBe(true);
  });
});
