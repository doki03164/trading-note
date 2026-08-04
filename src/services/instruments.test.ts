import { describe, expect, it } from 'vitest';
import { METAL_SYMBOLS, assetClass, assetClassLabel, instrumentBase, instrumentName, isMetal } from './instruments';

describe('instrument classification', () => {
  it('covers the precious metals Bitget lists as USDT perpetuals', () => {
    expect(METAL_SYMBOLS).toEqual(['XAUUSDT', 'XAGUSDT', 'XPTUSDT', 'XPDUSDT']);
    expect(METAL_SYMBOLS.every(isMetal)).toBe(true);
  });

  it('recognises a metal through every symbol shape the app produces', () => {
    // Positions arrive as SYMBOL-SIDE, closed rows as SYMBOL-CLOSED, tickers as SYMBOLPERP.
    expect(assetClass('XAUUSDT')).toBe('metal');
    expect(assetClass('XAUUSDT-LONG')).toBe('metal');
    expect(assetClass('XPDUSDT-SHORT')).toBe('metal');
    expect(assetClass('XAGUSDT-CLOSED')).toBe('metal');
    expect(assetClass('xptusdtperp')).toBe('metal');
    expect(assetClass('BTCUSDT-LONG')).toBe('crypto');
  });

  it('names metals so a commodity book does not read as unknown coins', () => {
    expect(instrumentName('XAUUSDT')).toBe('Gold');
    expect(instrumentName('XPDUSDT-SHORT')).toBe('Palladium');
    expect(instrumentName('XAGUSDT')).toBe('Silver');
    expect(instrumentName('XPTUSDT')).toBe('Platinum');
    expect(instrumentName('BTCUSDT')).toBe('BTC');
  });

  it('keeps gold-backed tokens in the crypto class while still naming them', () => {
    // PAXG and XAUT track gold but settle as crypto, so they are not commodity contracts.
    expect(assetClass('PAXGUSDT')).toBe('crypto');
    expect(assetClass('XAUTUSDT')).toBe('crypto');
    expect(instrumentName('PAXGUSDT')).toBe('PAX Gold');
    expect(instrumentName('XAUTUSDT')).toBe('Tether Gold');
  });

  it('strips quote currency and suffixes without eating the base', () => {
    expect(instrumentBase('XAUUSDT-LONG')).toBe('XAU');
    expect(instrumentBase('  btcusdt  ')).toBe('BTC');
    expect(instrumentBase('USDT')).toBe('USDT');
  });

  it('labels the two classes for grouped reporting', () => {
    expect(assetClassLabel('metal')).toBe('Precious metals');
    expect(assetClassLabel('crypto')).toBe('Crypto');
  });
});
