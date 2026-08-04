import { describe, expect, it } from 'vitest';
import { actualFuturesPnl, bitgetSignature, canonicalFuturesSymbol, classicPositionList, futuresAccountUnrealized, futuresPositionToMarketCoin, knownMarks, mergeLiveContracts, normalizeUtaPosition, parseBitgetResponse } from './accountBridge';
import type { MarketCoin } from '../types';

describe('cross-platform Bitget account bridge', () => {
  it('matches the backend HMAC signature vector', async () => {
    const signature = await bitgetSignature('test-secret', '1700000000000', '/api/v2/spot/account/assets', 'assetType=hold_only');
    expect(signature).toBe('mJG6fKy6fHL00x/I4Qp4TE+HDNDz4fYR8kovdxsxwJg=');
  });

  it('normalizes Unified Trading Account positions for the shared portfolio view', () => {
    expect(normalizeUtaPosition({ symbol: 'BTCUSDT', posSide: 'short', positionBalance: '120', total: '0.01', unrealisedPnl: '4.5', markPrice: '90000', avgPrice: '89500', leverage: '6', liquidationPrice: '101000', marginMode: 'isolated', profitRate: '0.0375', updatedTime: '1760000000000' })).toMatchObject({ symbol: 'BTCUSDT', holdSide: 'short', marginSize: '120', total: '0.01', unrealizedPL: '4.5', markPrice: '90000', openPriceAvg: '89500', leverage: '6', liquidationPrice: '101000', marginMode: 'isolated', profitRate: '0.0375', uTime: '1760000000000' });
  });

  it('normalizes multiple perpetual symbols without depending on a held contract', () => {
    expect([
      canonicalFuturesSymbol('BTCUSDTPERP'),
      canonicalFuturesSymbol('ethusdtperp'),
      canonicalFuturesSymbol('  SOLUSDT  '),
      canonicalFuturesSymbol('1000PEPEUSDTPERP'),
      canonicalFuturesSymbol('PERPUSDT'),
    ]).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', '1000PEPEUSDT', 'PERPUSDT']);
  });

  it('accepts every returned Classic position in documented and wrapped payloads', () => {
    const position = { symbol: 'BTCUSDT', holdSide: 'long', marginSize: '80', total: '0.01', unrealizedPL: '-7.25', markPrice: '64000' };
    const secondPosition = { symbol: 'ETHUSDT', holdSide: 'short', marginSize: '60', total: '0.2', unrealizedPL: '3.5', markPrice: '1900' };
    expect(classicPositionList([position])).toEqual([position]);
    expect(classicPositionList({ list: [position, secondPosition] })).toEqual([position, secondPosition]);
  });

  it('surfaces Bitget API details before parsing null error data', () => {
    expect(() => parseBitgetResponse({ code: '40014', msg: 'Parameter verification failed', data: null })).toThrow('Parameter verification failed');
    expect(() => parseBitgetResponse({ code: '40017', msg: 'Parameter error', data: null }, 400)).toThrow('Bitget HTTP 400 40017: Parameter error');
  });

  it('uses exchange unrealized P&L instead of deriving loss from UTC open price', () => {
    expect(actualFuturesPnl(-7.25, 0)).toBe(-7.25);
    expect(actualFuturesPnl(-7.25, 1.5)).toBe(-5.75);
    expect(actualFuturesPnl(-7.25, null)).toBe(-7.25);
  });

  it('includes isolated unrealized P&L when the aggregate account field is empty', () => {
    expect(futuresAccountUnrealized({ marginCoin: 'USDT', unrealizedPL: '', crossedUnrealizedPL: '-3.25', isolatedUnrealizedPL: '-2.75' })).toBe(-6);
    expect(futuresAccountUnrealized({ marginCoin: 'USDT', unrealizedPL: '-4.5', crossedUnrealizedPL: '-3.25', isolatedUnrealizedPL: '-2.75' })).toBe(-4.5);
  });

  it('maps every live contract field from the exchange position response', () => {
    const contract = futuresPositionToMarketCoin({
      symbol: 'BTCUSDT', holdSide: 'long', marginSize: '80', total: '0.01', unrealizedPL: '-7.25',
      markPrice: '64000', openPriceAvg: '64725', leverage: '8', liquidationPrice: '58000', marginMode: 'isolated', uTime: '1760000000000',
    });
    expect(contract).toMatchObject({
      symbol: 'BTCUSDT-LONG', side: 'LONG', quantity: 0.01, margin: 80, entryPrice: 64725,
      markPrice: 64000, leverage: 8, liquidationPrice: 58000, marginMode: 'ISOLATED',
      unrealizedPnl: -7.25, dailyPnl: -7.25, roi: -9.0625, positionUpdatedAt: 1760000000000,
    });
  });

  it('keeps an open position that comes back without a mark price', () => {
    // Bitget intermittently blanks markPrice on a live position. Dropping it made the contract
    // vanish from the grid for one refresh even though the exchange still reported it open.
    const blank = { symbol: 'BTCUSDT', holdSide: 'long', marginSize: '80', total: '0.01', unrealizedPL: '-7.25', markPrice: '', openPriceAvg: '64725' };
    expect(futuresPositionToMarketCoin(blank, undefined, 64_000)).toMatchObject({ symbol: 'BTCUSDT-LONG', markPrice: 64_000, positionValue: 640, unrealizedPnl: -7.25 });
    // With no fallback either, the entry price still values the position.
    expect(futuresPositionToMarketCoin(blank)).toMatchObject({ markPrice: 64_725, unrealizedPnl: -7.25 });
    // With no price reference at all it is still an open position, just an unpriced one.
    expect(futuresPositionToMarketCoin({ ...blank, openPriceAvg: '' })).toMatchObject({ markPrice: undefined, positionValue: 0, unrealizedPnl: -7.25 });
    // A genuinely closed position is the only thing worth dropping.
    expect(futuresPositionToMarketCoin({ ...blank, total: '0' }, undefined, 64_000)).toBeNull();
  });

  it('carries the last known mark forward for the next two-second refresh', () => {
    const long = futuresPositionToMarketCoin({ symbol: 'XAUUSDT', holdSide: 'long', marginSize: '80', total: '1', unrealizedPL: '2', markPrice: '4062.29' })!;
    const unpriced = futuresPositionToMarketCoin({ symbol: 'ETHUSDT', holdSide: 'short', marginSize: '50', total: '0.2', unrealizedPL: '1', markPrice: '', openPriceAvg: '' })!;
    const spot: MarketCoin = { symbol: 'SOLUSDT', base: 'SOL', exchange: 'bitget', price: 150, change24h: 1, quoteVolume: 0, positionValue: 100, dailyPnl: 0, markPrice: 150 };
    const marks = knownMarks([long, unpriced, spot]);
    expect(marks.get('XAUUSDT')).toBe(4062.29);
    expect(marks.get('ETHUSDT')).toBeUndefined();
    expect(marks.get('SOLUSDT')).toBeUndefined();
  });

  it('merges two-second contract updates without inventing or losing confirmed realized P&L', () => {
    const priorContract = futuresPositionToMarketCoin({ symbol: 'ETHUSDT', holdSide: 'short', marginSize: '50', total: '0.2', unrealizedPL: '2', markPrice: '2000' }, 1)!;
    const liveContract = futuresPositionToMarketCoin({ symbol: 'ETHUSDT', holdSide: 'short', marginSize: '50', total: '0.2', unrealizedPL: '3', markPrice: '1995' })!;
    const spot: MarketCoin = { symbol: 'BTCUSDT', base: 'BTC', exchange: 'bitget', price: 64000, change24h: 1, quoteVolume: 0, positionValue: 100, dailyPnl: 0 };
    const merged = mergeLiveContracts([priorContract, spot], [liveContract]);
    expect(merged.find(item => item.symbol === 'ETHUSDT-SHORT')).toMatchObject({ unrealizedPnl: 3, realizedPnl: 1, dailyPnl: 4, price: 1995 });
    expect(merged.find(item => item.symbol === 'BTCUSDT')).toBe(spot);
  });
});
