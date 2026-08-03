import type { JournalTrade, Playbook } from '../types';

const TRADES_KEY = 'trading-journal-trades-v1';
const PLAYBOOKS_KEY = 'trading-journal-playbooks-v1';

function read<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as T[]; } catch { return []; }
}

function write<T>(key: string, values: T[]) { localStorage.setItem(key, JSON.stringify(values)); }

export function tradePnl(trade: JournalTrade) {
  const movement = trade.side === 'LONG' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice;
  return movement * trade.quantity - trade.fees;
}

export function tradeRMultiple(trade: JournalTrade) {
  const risk = Math.abs(trade.entryPrice - trade.stopLoss) * trade.quantity;
  return risk > 0 ? tradePnl(trade) / risk : 0;
}

export function listTrades() { return read<JournalTrade>(TRADES_KEY).sort((a, b) => b.closedAt.localeCompare(a.closedAt)); }
export function saveTrade(trade: JournalTrade) { const values = listTrades().filter(item => item.id !== trade.id); values.push(trade); write(TRADES_KEY, values); }
export function deleteTrade(id: string) { write(TRADES_KEY, listTrades().filter(item => item.id !== id)); }
export function listPlaybooks() { return read<Playbook>(PLAYBOOKS_KEY).sort((a, b) => b.createdAt - a.createdAt); }
export function savePlaybook(playbook: Playbook) { const values = listPlaybooks().filter(item => item.id !== playbook.id); values.push(playbook); write(PLAYBOOKS_KEY, values); }
export function deletePlaybook(id: string) { write(PLAYBOOKS_KEY, listPlaybooks().filter(item => item.id !== id)); }
export function mergeCloudTrades(values: JournalTrade[]) { const merged = new Map(listTrades().map(item => [item.id, item])); values.forEach(item => merged.set(item.id, item)); write(TRADES_KEY, [...merged.values()]); }
export function mergeCloudPlaybooks(values: Playbook[]) { const merged = new Map(listPlaybooks().map(item => [item.id, item])); values.forEach(item => merged.set(item.id, item)); write(PLAYBOOKS_KEY, [...merged.values()]); }
export function importTrades(values: JournalTrade[], replace: boolean) {
  if (replace) write(TRADES_KEY, values);
  else mergeCloudTrades(values);
}
export function importPlaybooks(values: Playbook[], replace: boolean) {
  if (replace) write(PLAYBOOKS_KEY, values);
  else mergeCloudPlaybooks(values);
}
