import { describe, expect, it } from 'vitest';
import { bitgetSignature } from './accountBridge';

describe('cross-platform Bitget account bridge', () => {
  it('matches the backend HMAC signature vector', async () => {
    const signature = await bitgetSignature('test-secret', '1700000000000', '/api/v2/spot/account/assets', 'assetType=hold_only');
    expect(signature).toBe('mJG6fKy6fHL00x/I4Qp4TE+HDNDz4fYR8kovdxsxwJg=');
  });
});
