import { describe, expect, it } from 'vitest';
import type { JournalArchiveData } from './journalBackup';
import { backupSummary, decryptJournalBackup, encryptJournalPayload, JOURNAL_BACKUP_EXTENSION, validateJournalArchive } from './journalBackup';

const archive: JournalArchiveData = {
  schemaVersion: 1, exportedAt: 1, appVersion: '0.3.2',
  trades: [{ id: 't1', openedAt: '2026-01-01', closedAt: '2026-01-02', symbol: 'BTCUSDT', side: 'LONG', strategy: 'Breakout', entryPrice: 100, exitPrice: 110, quantity: 1, stopLoss: 95, fees: 1, notes: 'private lesson', tags: ['A+'] }],
  playbooks: [{ id: 'p1', name: 'Breakout', description: '', rules: ['Wait'], createdAt: 1 }],
  tradingNotes: [{ id: 'n1', createdAt: 1, tradeDate: '2026-01-02', title: 'Review', symbol: 'BTCUSDT', market: 'USDT Futures', direction: 'LONG', setup: 'Breakout', notes: 'review', screenshot: 'data:image/png;base64,AA==', screenshotName: 'chart.png' }],
  profitHistory: [{ timestamp: 1, totalPnl: 9, unrealizedPnl: 4, realizedPnl: 5, portfolioValue: 100, positions: [] }],
};

describe('encrypted Trading Journal backup', () => {
  it('uses the dedicated extension and counts every dataset', () => {
    expect(JOURNAL_BACKUP_EXTENSION).toBe('.tradingjournal');
    expect(backupSummary(archive)).toEqual({ trades: 1, playbooks: 1, tradingNotes: 1, profitHistory: 1 });
  });

  it('encrypts contents and authenticates the password', async () => {
    const encrypted = await encryptJournalPayload(archive, 'strong-pass', new Uint8Array(16).fill(7), new Uint8Array(12).fill(9));
    expect(encrypted).not.toContain('private lesson');
    expect(encrypted).not.toContain('BTCUSDT');
    expect(await decryptJournalBackup(encrypted, 'strong-pass')).toEqual(archive);
    await expect(decryptJournalBackup(encrypted, 'wrong-pass')).rejects.toThrow('Incorrect backup password');
  });

  it('rejects invalid screenshots and unsupported schemas', () => {
    expect(() => validateJournalArchive({ ...archive, schemaVersion: 2 })).toThrow('Unsupported');
    expect(() => validateJournalArchive({ ...archive, tradingNotes: [{ ...archive.tradingNotes[0], screenshot: 'data:text/html;base64,AA==' }] })).toThrow('invalid trading note');
  });
});
