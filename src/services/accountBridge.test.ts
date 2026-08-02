import { describe, expect, it } from 'vitest';
import { actualFuturesPnl, bitgetSignature, canonicalFuturesSymbol, classicPositionList, futuresAccountUnrealized, normalizeUtaPosition, parseBitgetResponse } from './accountBridge';

describe('cross-platform Bitget account bridge', () => {
  it('matches the backend HMAC signature vector', async () => {
    const signature = await bitgetSignature('test-secret', '1700000000000', '/api/v2/spot/account/assets', 'assetType=hold_only');
    expect(signature).toBe('mJG6fKy6fHL00x/I4Qp4TE+HDNDz4fYR8kovdxsxwJg=');
  });

  it('normalizes Unified Trading Account positions for the shared portfolio view', () => {
    expect(normalizeUtaPosition({ symbol: 'BTCUSDT', posSide: 'short', positionBalance: '120', total: '0.01', unrealisedPnl: '4.5', markPrice: '90000' })).toEqual({ symbol: 'BTCUSDT', holdSide: 'short', marginSize: '120', total: '0.01', unrealizedPL: '4.5', markPrice: '90000' });
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
});
