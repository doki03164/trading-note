import { describe, expect, it } from 'vitest';
import { STALE_AFTER_MS, ageSeconds, isNewerCapture, isStale, resolveCaptureTimes } from './freshness';

describe('exchange data freshness', () => {
  it('measures age from the exchange read, not from when the response arrived', () => {
    const readAt = 1_000_000;
    // The desktop answers a paired phone instantly even when it last reached Bitget minutes
    // ago; reporting the response time here is what made stale data look live.
    expect(ageSeconds(readAt, readAt + 240_000)).toBe(240);
    expect(isStale(readAt, readAt + 240_000)).toBe(true);
    expect(isStale(readAt, readAt + 2_000)).toBe(false);
    expect(isStale(readAt, readAt + STALE_AFTER_MS + 1)).toBe(true);
  });

  it('reports no age at all before the first confirmed read', () => {
    expect(ageSeconds(undefined, Date.now())).toBeNull();
    expect(isStale(undefined, Date.now())).toBe(false);
  });

  it('never reports a negative age when clocks disagree', () => {
    expect(ageSeconds(2_000, 1_000)).toBe(0);
  });

  it('refuses a read older than what is already on screen', () => {
    // The 30-second account read is far slower than the 2-second contract read, so it can
    // resolve after a fresher one and would otherwise rewind the displayed P&L.
    expect(isNewerCapture(5_000, 4_999)).toBe(false);
    expect(isNewerCapture(5_000, 5_000)).toBe(true);
    expect(isNewerCapture(5_000, 5_001)).toBe(true);
    expect(isNewerCapture(0, 1)).toBe(true);
  });

  it('falls back to the envelope time for a desktop that predates capture stamps', () => {
    expect(resolveCaptureTimes({ capturedAt: 700, contractsCapturedAt: 900 }, 1_500)).toEqual({ capturedAt: 700, contractsCapturedAt: 900 });
    expect(resolveCaptureTimes({}, 1_500)).toEqual({ capturedAt: 1_500, contractsCapturedAt: 1_500 });
    // A snapshot that never had its fast layer refreshed is only as fresh as the full read.
    expect(resolveCaptureTimes({ capturedAt: 700 }, 1_500)).toEqual({ capturedAt: 700, contractsCapturedAt: 700 });
  });
});
