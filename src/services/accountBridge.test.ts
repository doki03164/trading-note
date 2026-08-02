import { describe, expect, it } from 'vitest';
import { bitgetSignature, canonicalFuturesSymbol, normalizeUtaPosition } from './accountBridge';

describe('cross-platform Bitget account bridge', () => {
  it('matches the backend HMAC signature vector', async () => {
    const signature = await bitgetSignature('test-secret', '1700000000000', '/api/v2/spot/account/assets', 'assetType=hold_only');
    expect(signature).toBe('mJG6fKy6fHL00x/I4Qp4TE+HDNDz4fYR8kovdxsxwJg=');
  });

  it('normalizes Unified Trading Account positions for the shared portfolio view', () => {
    expect(normalizeUtaPosition({ symbol: 'BTCUSDT', posSide: 'short', positionBalance: '120', total: '0.01', unrealisedPnl: '4.5', markPrice: '90000' })).toEqual({ symbol: 'BTCUSDT', holdSide: 'short', marginSize: '120', total: '0.01', unrealizedPL: '4.5', markPrice: '90000' });
  });

  it('matches TradingView perpetual labels to Bitget REST symbols', () => {
    expect(canonicalFuturesSymbol('XMRUSDTPERP')).toBe('XMRUSDT');
    expect(canonicalFuturesSymbol('xmrusdt')).toBe('XMRUSDT');
  });
});
