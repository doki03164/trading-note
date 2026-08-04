import type { PortfolioResponse } from '../types';

/**
 * Freshness policy for exchange data.
 *
 * Every number the dashboard shows is stamped with when Bitget was actually read, never with
 * when the response reached the UI. Keeping that distinction in one place is what stops a slow
 * refresh, a throttled background tab, or a paired desktop that stopped polling from being
 * presented as live data.
 */

/** Past this age the "live" claim is no longer honest. */
export const STALE_AFTER_MS = 15_000;

export interface CaptureTimes {
  /** When the full account read was issued. */
  capturedAt: number;
  /** When the fast contract layer sitting on top of it was read. */
  contractsCapturedAt: number;
}

/**
 * Capture times for a snapshot, tolerating a peer that predates them. A desktop older than sync
 * version 0.4.0 sends neither field, so the caller's fallback — the envelope build time — is the
 * closest estimate available.
 */
export function resolveCaptureTimes(snapshot: Pick<PortfolioResponse, 'capturedAt' | 'contractsCapturedAt'>, fallback: number): CaptureTimes {
  const capturedAt = snapshot.capturedAt || fallback;
  return { capturedAt, contractsCapturedAt: snapshot.contractsCapturedAt || capturedAt };
}

/**
 * Whether an arriving read is at least as new as what is already on screen. Responses can land
 * out of order — the 30-second account read is far slower than the 2-second contract read — and
 * applying the older one rewinds the displayed P&L.
 */
export function isNewerCapture(applied: number, incoming: number) {
  return incoming >= applied;
}

export function isStale(capturedAt: number | undefined, now: number, staleAfterMs = STALE_AFTER_MS) {
  return capturedAt != null && now - capturedAt > staleAfterMs;
}

export function ageSeconds(capturedAt: number | undefined, now: number) {
  return capturedAt == null ? null : Math.max(0, Math.floor((now - capturedAt) / 1_000));
}
