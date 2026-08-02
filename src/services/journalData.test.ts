import { describe, expect, it } from 'vitest';
import type { JournalTrade } from '../types';
import { tradePnl, tradeRMultiple } from './journalData';

const trade: JournalTrade = { id: '1', openedAt: '', closedAt: '', symbol: 'BTCUSDT', side: 'LONG', strategy: 'Breakout', entryPrice: 100, exitPrice: 112, quantity: 2, stopLoss: 95, fees: 4, notes: '', tags: [] };

describe('journal trade calculations', () => {
  it('calculates net P&L after fees', () => expect(tradePnl(trade)).toBe(20));
  it('calculates risk multiple', () => expect(tradeRMultiple(trade)).toBe(2));
  it('reverses price movement for short trades', () => expect(tradePnl({ ...trade, side: 'SHORT', entryPrice: 112, exitPrice: 100 })).toBe(20));
});
