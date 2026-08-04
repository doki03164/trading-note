import { useMemo } from 'react';
import { listTrades, tradePnl } from '../services/journalData';
import { assetClass, assetClassLabel, instrumentName } from '../services/instruments';

export function Reports() {
  const trades = listTrades();
  const stats = useMemo(() => {
    const pnls = trades.map(tradePnl), wins = pnls.filter(value => value > 0), losses = pnls.filter(value => value < 0);
    const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    return { net: pnls.reduce((a, b) => a + b, 0), wins: wins.length, winRate: trades.length ? wins.length / trades.length * 100 : 0, profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0, averageWin: wins.length ? grossWin / wins.length : 0, averageLoss: losses.length ? grossLoss / losses.length : 0, expectancy: trades.length ? pnls.reduce((a, b) => a + b, 0) / trades.length : 0 };
  }, [trades]);
  const byStrategy = useMemo(() => Object.entries(trades.reduce<Record<string, { pnl: number; count: number }>>((map, trade) => { const key = trade.strategy || 'Unassigned'; const value = map[key] ?? { pnl: 0, count: 0 }; value.pnl += tradePnl(trade); value.count++; map[key] = value; return map; }, {})).sort((a, b) => b[1].pnl - a[1].pnl), [trades]);
  // A book that spans crypto perps and metal perps needs them separated: the same net number
  // can hide a losing commodity leg behind a winning crypto one.
  const byInstrument = useMemo(() => Object.entries(trades.reduce<Record<string, { pnl: number; count: number; group: string }>>((map, trade) => {
    const key = trade.symbol || 'Unassigned';
    const value = map[key] ?? { pnl: 0, count: 0, group: assetClassLabel(assetClass(key)) };
    value.pnl += tradePnl(trade); value.count++; map[key] = value; return map;
  }, {})).sort((a, b) => b[1].pnl - a[1].pnl), [trades]);
  let running = 0; const curve = trades.slice().reverse().map(trade => running += tradePnl(trade)); const max = Math.max(...curve.map(Math.abs), 1);
  return <section className="clone-page reports-page">
    <div className="report-cards"><article><span>NET P&amp;L</span><strong className={stats.net >= 0 ? 'positive' : 'negative'}>{stats.net >= 0 ? '+' : '−'}${Math.abs(stats.net).toFixed(2)}</strong></article><article><span>WIN RATE</span><strong>{stats.winRate.toFixed(1)}%</strong><small>{stats.wins}/{trades.length} winning trades</small></article><article><span>PROFIT FACTOR</span><strong>{Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}</strong></article><article><span>EXPECTANCY</span><strong>${stats.expectancy.toFixed(2)}</strong><small>per trade</small></article><article><span>AVG WIN</span><strong className="positive">+${stats.averageWin.toFixed(2)}</strong></article><article><span>AVG LOSS</span><strong className="negative">−${stats.averageLoss.toFixed(2)}</strong></article></div>
    <div className="report-grid"><article className="equity-card"><div><span>PERFORMANCE</span><strong>Cumulative equity curve</strong></div><div className="equity-curve">{curve.map((value, index) => <i key={index} className={value >= 0 ? 'positive-bar' : 'negative-bar'} style={{height:`${Math.max(Math.abs(value) / max * 85, 3)}%`}} title={`$${value.toFixed(2)}`}/>)}</div></article><article className="strategy-card"><div><span>PLAYBOOK REPORT</span><strong>Performance by strategy</strong></div>{byStrategy.map(([name, value]) => <div className="strategy-row" key={name}><span>{name}<small>{value.count} trades</small></span><strong className={value.pnl >= 0 ? 'positive' : 'negative'}>{value.pnl >= 0 ? '+' : '−'}${Math.abs(value.pnl).toFixed(2)}</strong></div>)}{!byStrategy.length && <div className="clone-empty">Add trades to generate reports.</div>}</article><article className="strategy-card"><div><span>INSTRUMENT REPORT</span><strong>Performance by market</strong></div>{byInstrument.map(([symbol, value]) => <div className="strategy-row" key={symbol}><span>{instrumentName(symbol)}<small>{value.group} · {value.count} trades</small></span><strong className={value.pnl >= 0 ? 'positive' : 'negative'}>{value.pnl >= 0 ? '+' : '−'}${Math.abs(value.pnl).toFixed(2)}</strong></div>)}{!byInstrument.length && <div className="clone-empty">Add trades to compare crypto against commodities.</div>}</article></div>
  </section>;
}
