import { describe, expect, it } from 'vitest';
import type { TradingNote } from '../types';
import { createTradingNote, newestFirst } from './tradingNotes';

describe('trading notes', () => {
  it('normalizes a note before saving', () => {
    const note = createTradingNote({
      tradeDate: '2026-08-02T10:30', title: '  Breakout review  ', symbol: ' btcusdt ',
      market: 'USDT Futures', direction: 'LONG', setup: '  breakout  ', notes: '  followed plan  ',
      screenshot: 'data:image/png;base64,abc', screenshotName: 'chart.png',
    }, 'note-1', 123);
    expect(note).toMatchObject({ id: 'note-1', createdAt: 123, title: 'Breakout review', symbol: 'BTCUSDT', setup: 'breakout', notes: 'followed plan' });
  });

  it('returns note history newest first without mutating input', () => {
    const notes = [{ id: 'old', createdAt: 1 }, { id: 'new', createdAt: 2 }] as TradingNote[];
    expect(newestFirst(notes).map(note => note.id)).toEqual(['new', 'old']);
    expect(notes.map(note => note.id)).toEqual(['old', 'new']);
  });
});
