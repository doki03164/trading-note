import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import type { JournalTrade, TradeSide } from '../types';
import { deleteTrade, listPlaybooks, listTrades, saveTrade, tradePnl, tradeRMultiple } from '../services/journalData';
import { METAL_SYMBOLS, instrumentName } from '../services/instruments';

function nowLocal() { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

export function TradeLog() {
  const [trades, setTrades] = useState(listTrades);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState(''); const [side, setSide] = useState<TradeSide>('LONG');
  const [openedAt, setOpenedAt] = useState(nowLocal); const [closedAt, setClosedAt] = useState(nowLocal);
  const [strategy, setStrategy] = useState(''); const [entry, setEntry] = useState(''); const [exit, setExit] = useState('');
  const [quantity, setQuantity] = useState(''); const [stop, setStop] = useState(''); const [fees, setFees] = useState('0');
  const [tags, setTags] = useState(''); const [notes, setNotes] = useState('');
  const playbooks = listPlaybooks();
  const filtered = useMemo(() => trades.filter(trade => `${trade.symbol} ${trade.strategy} ${trade.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [trades, query]);

  useEffect(() => {
    const reload = () => setTrades(listTrades());
    window.addEventListener('trading-journal:data-imported', reload);
    return () => window.removeEventListener('trading-journal:data-imported', reload);
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trade: JournalTrade = { id: crypto.randomUUID(), openedAt, closedAt, symbol: symbol.trim().toUpperCase(), side, strategy: strategy.trim(), entryPrice: Number(entry), exitPrice: Number(exit), quantity: Number(quantity), stopLoss: Number(stop), fees: Number(fees || 0), tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), notes: notes.trim() };
    if (![trade.entryPrice, trade.exitPrice, trade.quantity].every(value => Number.isFinite(value) && value > 0)) return;
    saveTrade(trade); setTrades(listTrades()); setOpen(false); setSymbol(''); setEntry(''); setExit(''); setQuantity(''); setStop(''); setFees('0'); setTags(''); setNotes('');
  }

  return <section className="clone-page">
    <div className="clone-toolbar"><div className="searchbox"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search symbol, setup or tag"/></div><button className="clone-primary" onClick={() => setOpen(value => !value)}><Plus size={15}/> Add trade</button></div>
    {open && <form className="trade-form" onSubmit={submit}>
      <div className="form-heading"><strong>Log a completed trade</strong><small>Net P&amp;L and R-multiple calculate automatically.</small></div>
      <div className="trade-fields"><label>Symbol<input required list="instrument-list" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="BTCUSDT or XAUUSDT"/><datalist id="instrument-list">{METAL_SYMBOLS.map(value => <option key={value} value={value}>{instrumentName(value)}</option>)}</datalist></label><label>Side<select value={side} onChange={e => setSide(e.target.value as TradeSide)}><option>LONG</option><option>SHORT</option></select></label><label>Strategy<input list="playbook-list" value={strategy} onChange={e => setStrategy(e.target.value)} placeholder="Breakout"/><datalist id="playbook-list">{playbooks.map(item => <option key={item.id} value={item.name}/>)}</datalist></label>
      <label>Opened<input type="datetime-local" value={openedAt} onChange={e => setOpenedAt(e.target.value)} required/></label><label>Closed<input type="datetime-local" value={closedAt} onChange={e => setClosedAt(e.target.value)} required/></label><label>Quantity<input type="number" step="any" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} required/></label>
      <label>Entry price<input type="number" step="any" min="0" value={entry} onChange={e => setEntry(e.target.value)} required/></label><label>Exit price<input type="number" step="any" min="0" value={exit} onChange={e => setExit(e.target.value)} required/></label><label>Stop loss<input type="number" step="any" min="0" value={stop} onChange={e => setStop(e.target.value)}/></label><label>Fees<input type="number" step="any" min="0" value={fees} onChange={e => setFees(e.target.value)}/></label><label className="wide">Tags<input value={tags} onChange={e => setTags(e.target.value)} placeholder="A+, disciplined, early-exit"/></label><label className="wide">Review notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Context, execution and lesson learned"/></label></div>
      <div className="trade-form-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="clone-primary">Save trade</button></div>
    </form>}
    <div className="trade-table"><div className="trade-row header"><span>Date</span><span>Symbol</span><span>Side</span><span>Setup</span><span>Net P&amp;L</span><span>R</span><span/></div>{filtered.map(trade => { const pnl = tradePnl(trade); return <div className="trade-row" key={trade.id}><span>{new Date(trade.closedAt).toLocaleDateString()}</span><strong>{trade.symbol}</strong><span className={trade.side === 'LONG' ? 'long-side' : 'short-side'}>{trade.side}</span><span>{trade.strategy || '—'}</span><strong className={pnl >= 0 ? 'positive' : 'negative'}>{pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}</strong><span>{tradeRMultiple(trade).toFixed(2)}R</span><button aria-label="Delete trade" onClick={() => { if (confirm('Delete this trade?')) { deleteTrade(trade.id); setTrades(listTrades()); } }}><Trash2 size={14}/></button></div>})}{!filtered.length && <div className="clone-empty">No journal trades match this view.</div>}</div>
  </section>;
}
