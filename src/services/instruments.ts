/**
 * Instrument classification.
 *
 * Bitget lists precious metals as USDT perpetuals (XAUUSDT, XAGUSDT, XPTUSDT, XPDUSDT) — spot
 * carries only the gold-backed tokens. Positions in them arrive through exactly the same
 * futures endpoints as crypto perps, so they need no special handling to trade; they need
 * naming and grouping so a commodity book does not read as a pile of unknown coins.
 */

export type AssetClass = 'crypto' | 'metal';

const METALS: Record<string, string> = {
  XAU: 'Gold',
  XAG: 'Silver',
  XPT: 'Platinum',
  XPD: 'Palladium',
};

/** Gold-backed tokens track the metal but settle as crypto, so they stay in the crypto class. */
const METAL_TOKENS: Record<string, string> = {
  PAXG: 'PAX Gold',
  XAUT: 'Tether Gold',
};

/** The tradable metal contracts, in the symbol form Bitget uses. */
export const METAL_SYMBOLS = Object.keys(METALS).map(base => `${base}USDT`);

/** Strips the side suffix, the PERP suffix and the quote currency from any symbol shape. */
export function instrumentBase(symbol: string) {
  const cleaned = symbol.trim().toUpperCase().replace(/-(LONG|SHORT|CLOSED)$/, '').replace(/PERP$/, '');
  return cleaned.replace(/USDT$/, '') || cleaned;
}

export function assetClass(symbol: string): AssetClass {
  return instrumentBase(symbol) in METALS ? 'metal' : 'crypto';
}

export function isMetal(symbol: string) {
  return assetClass(symbol) === 'metal';
}

/** Human name for an instrument: "Gold" reads better than "XAU" on a commodity book. */
export function instrumentName(symbol: string) {
  const base = instrumentBase(symbol);
  return METALS[base] ?? METAL_TOKENS[base] ?? base;
}

export function assetClassLabel(value: AssetClass) {
  return value === 'metal' ? 'Precious metals' : 'Crypto';
}
