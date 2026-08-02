import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Bell, BookOpen, CalendarDays, ChevronDown, CircleHelp, Cloud, Command, Expand, History, KeyRound, LayoutGrid, List, ListFilter, LogOut, NotebookPen, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { HeatMap } from './components/HeatMap';
import { Sparkline } from './components/Sparkline';
import { TradingNotes } from './components/TradingNotes';
import { TradeLog } from './components/TradeLog';
import { Reports } from './components/Reports';
import { Playbooks } from './components/Playbooks';
import { CloudAccount } from './components/CloudAccount';
import { useMarkets } from './hooks/useMarkets';
import { clearProfitHistory, connectBitgetAccount, deleteSavedBitgetLogin, disconnectBitgetAccount, hasSavedBitgetLogin, loadProfitHistory, loginBitgetAccount, refreshBitgetAccount } from './services/accountBridge';
import type { Exchange, FuturesBalance, MarketCoin, ProfitHistoryEntry, SizeMetric, TimeRange } from './types';
import './styles.css';

const ranges: TimeRange[] = ['1H', '4H', '1D', '1W'];

function fmtCompact(n: number) { return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
function fmtPnl(n: number) { return `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }

export default function App() {
  const [view, setView] = useState<'heatmap' | 'trades' | 'reports' | 'history' | 'notes' | 'playbooks' | 'cloud'>('heatmap');
  const [exchange, setExchange] = useState<Exchange>('binance');
  const [range, setRange] = useState<TimeRange>('1D');
  const [sizeMetric, setSizeMetric] = useState<SizeMetric>('position');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MarketCoin>();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [saveLogin, setSaveLogin] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [hasSavedLogin, setHasSavedLogin] = useState(false);
  const [useSavedLogin, setUseSavedLogin] = useState(false);
  const [apiError, setApiError] = useState('');
  const [apiLoading, setApiLoading] = useState(false);
  const [apiData, setApiData] = useState<MarketCoin[]>([]);
  const [futuresBalance, setFuturesBalance] = useState<FuturesBalance>();
  const [bitgetConnected, setBitgetConnected] = useState(false);
  const [accountLive, setAccountLive] = useState(false);
  const [apiUpdatedAt, setApiUpdatedAt] = useState<Date>();
  const [history, setHistory] = useState<ProfitHistoryEntry[]>([]);
  const [historySnapshot, setHistorySnapshot] = useState<ProfitHistoryEntry>();
  const market = useMarkets(exchange);
  const usingAccount = exchange === 'bitget' && bitgetConnected;
  const data = usingAccount ? apiData : market.data;
  const loading = usingAccount ? apiLoading : market.loading;
  const live = usingAccount ? accountLive : market.live;
  const updatedAt = usingAccount ? apiUpdatedAt : market.updatedAt;

  async function loadHistory() {
    try { const items = await loadProfitHistory(); setHistory(items); setHistorySnapshot(current => current ?? items.at(-1)); } catch { setHistory([]); }
  }

  useEffect(() => { loadHistory(); hasSavedBitgetLogin().then(saved => { setHasSavedLogin(saved); setUseSavedLogin(saved); }).catch(() => {}); }, []);

  useEffect(() => {
    if (!bitgetConnected) return;
    let refreshing = false;
    const poll = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const snapshot = await refreshBitgetAccount();
        setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setApiUpdatedAt(new Date()); setApiError(''); setAccountLive(true); await loadHistory();
      } catch (error) { setApiError(String(error)); setAccountLive(false); }
      finally { refreshing = false; }
    };
    const timer = window.setInterval(poll, 10_000);
    return () => window.clearInterval(timer);
  }, [bitgetConnected]);

  async function connectBitget(event: React.FormEvent) {
    event.preventDefault(); setApiError(''); setApiLoading(true);
    try {
      const snapshot = await connectBitgetAccount({ apiKey, apiSecret, passphrase }, saveLogin, saveLogin ? loginPassword : null);
      setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setBitgetConnected(true); setAccountLive(true); setApiUpdatedAt(new Date()); setExchange('bitget');
      await loadHistory();
      if (saveLogin) setHasSavedLogin(true);
      setApiKey(''); setApiSecret(''); setPassphrase(''); setLoginPassword(''); setConnectOpen(false);
    } catch (error) { setApiError(String(error)); }
    finally { setApiLoading(false); }
  }

  async function loginSavedBitget(event: React.FormEvent) {
    event.preventDefault(); setApiError(''); setApiLoading(true);
    try {
      const snapshot = await loginBitgetAccount(loginPassword);
      setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setBitgetConnected(true); setAccountLive(true); setApiUpdatedAt(new Date()); setExchange('bitget');
      setLoginPassword(''); setConnectOpen(false); await loadHistory();
    } catch (error) { setApiError(String(error)); }
    finally { setApiLoading(false); }
  }

  async function forgetSavedLogin() {
    await deleteSavedBitgetLogin(); setHasSavedLogin(false); setUseSavedLogin(false); setLoginPassword(''); setApiError('');
  }

  async function refresh() {
    if (!usingAccount) { await market.refresh(); return; }
    setApiLoading(true); setApiError('');
    try { const snapshot = await refreshBitgetAccount(); setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setApiUpdatedAt(new Date()); setAccountLive(true); await loadHistory(); }
    catch (error) { setApiError(String(error)); setAccountLive(false); }
    finally { setApiLoading(false); }
  }

  async function disconnectBitget() {
    await disconnectBitgetAccount(); setBitgetConnected(false); setAccountLive(false); setApiData([]); setFuturesBalance(undefined); setExchange('binance');
  }

  async function clearHistory() {
    if (!window.confirm('Delete all saved profit history?')) return;
    await clearProfitHistory(); setHistory([]);
  }

  const filtered = useMemo(() => data.filter(c => c.base.toLowerCase().includes(query.toLowerCase())), [data, query]);
  const stats = useMemo(() => {
    const value = data.reduce((a, c) => a + c.positionValue, 0);
    const exchangeRows = data.filter(c => c.pnlSource === 'exchange');
    const positionUnrealized = exchangeRows.reduce((sum, item) => sum + (item.unrealizedPnl ?? 0), 0);
    const unrealized = exchangeRows.length ? positionUnrealized : (futuresBalance?.unrealizedPnl ?? 0);
    const realizedValues = exchangeRows.filter(item => item.realizedPnl != null).map(item => item.realizedPnl!);
    const realized = futuresBalance?.realizedPnl ?? (realizedValues.length ? realizedValues.reduce((sum, item) => sum + item, 0) : null);
    const marketPnl = data.reduce((a, c) => a + c.quoteVolume, 0) ? data.reduce((a, c) => a + c.change24h * c.quoteVolume, 0) / data.reduce((a, c) => a + c.quoteVolume, 0) : 0;
    return { value, unrealized, realized, pnl: usingAccount ? unrealized + (realized ?? 0) : marketPnl, gainers: data.filter(c => c.dailyPnl > 0).length, losers: data.filter(c => c.dailyPnl < 0).length };
  }, [data, usingAccount, futuresBalance]);

  const chartHistory = history.filter(entry => entry.unrealizedPnl != null).slice(-60);
  const maxHistoryPnl = Math.max(...chartHistory.map(h => Math.abs(h.totalPnl)), 1);
  const currentContracts = apiData.filter(item => item.symbol.includes('-') && !item.symbol.endsWith('-CLOSED'));
  const cryptoHoldings = apiData.filter(item => !item.symbol.includes('-'));
  const quantity = (item: MarketCoin) => item.price > 0 ? item.positionValue / item.price : 0;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Activity size={18}/></div><span>Trading <span>Journal</span></span></div>
      <nav className={mobileMenu ? 'open' : ''}>
        <button className={view === 'heatmap' ? 'nav-active' : ''} onClick={() => setView('heatmap')}><LayoutGrid size={16}/> Heatmap</button>
        <button className={view === 'trades' ? 'nav-active' : ''} onClick={() => setView('trades')}><List size={16}/> Trade Log</button>
        <button className={view === 'reports' ? 'nav-active' : ''} onClick={() => setView('reports')}><BarChart3 size={16}/> Reports</button>
        <button className={view === 'history' ? 'nav-active' : ''} onClick={() => { setView('history'); loadHistory(); }}><History size={16}/> History</button>
        <button className={view === 'notes' ? 'nav-active' : ''} onClick={() => setView('notes')}><NotebookPen size={16}/> Trading Notes</button>
        <button className={view === 'playbooks' ? 'nav-active' : ''} onClick={() => setView('playbooks')}><BookOpen size={16}/> Playbooks</button>
        <button className={view === 'cloud' ? 'nav-active' : ''} onClick={() => setView('cloud')}><Cloud size={16}/> Cloud</button>
      </nav>
      <div className="top-actions">
        {bitgetConnected
          ? <button className="api-connected" onClick={disconnectBitget}><ShieldCheck size={14}/> Bitget connected <LogOut size={13}/></button>
          : <button className="connect-api" onClick={() => { setUseSavedLogin(hasSavedLogin); setConnectOpen(true); }}><KeyRound size={14}/> {hasSavedLogin ? 'Unlock Bitget' : 'Connect Bitget'}</button>}
        <button className="icon-button"><Search size={18}/></button><button className="icon-button"><Bell size={18}/><i/></button>
        <button className="avatar">AG</button>
        <button className="menu-toggle" onClick={() => setMobileMenu(v => !v)}>{mobileMenu ? <X/> : <Command/>}</button>
      </div>
    </header>

    <main>
      <section className="page-heading">
        <div><div className="eyebrow"><span/> TRADING PERFORMANCE INTELLIGENCE</div><h1>{{heatmap:'Daily Profit Heatmap',trades:'Trade Log',reports:'Performance Reports',history:'Profit History',notes:'Trading Notes',playbooks:'Strategy Playbooks',cloud:'Cloud Database'}[view]}</h1><p>{{heatmap:'See exactly where today’s portfolio profit and loss comes from.',trades:'Log executions, fees, risk and setup context in one searchable database.',reports:'Measure win rate, expectancy, profit factor and strategy performance.',history:'Review locally saved Bitget P&L snapshots over time.',notes:'Upload chart screenshots and review your past trading decisions.',playbooks:'Define repeatable setups and review their actual results.',cloud:'Synchronize your private journal across every installed device.'}[view]}</p></div>
        <div className={`connection ${live ? '' : 'offline'}`}>{live ? <Wifi size={14}/> : <WifiOff size={14}/>}<span>{usingAccount ? `Bitget actual data · ${live ? '10s live refresh' : 'refresh paused'}` : live ? `Live ${exchange} market data` : "Can't connect to API"}</span><small>{updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></div>
      </section>

      {view === 'heatmap' ? <>
      {!usingAccount && market.error && <div className="market-api-error"><WifiOff size={18}/><div><strong>Can't connect to API</strong><span>{market.error}</span></div><button onClick={market.refresh}>Retry</button></div>}
      {usingAccount && apiError && <div className="market-api-error"><WifiOff size={18}/><div><strong>Bitget live refresh paused</strong><span>{apiError} · showing data confirmed at {apiUpdatedAt?.toLocaleTimeString()}</span></div><button onClick={refresh}>Retry</button></div>}
      <section className={`stat-row ${usingAccount ? 'account-stats' : ''}`}>
        {usingAccount ? <>
          <article><div><span>UNREALIZED P&amp;L</span><strong className={stats.unrealized >= 0 ? 'profit-text' : 'loss-text'}>{fmtPnl(stats.unrealized)}</strong><em className="muted">Direct from open Bitget positions</em></div><div className="mini-chart"><Sparkline positive={stats.unrealized >= 0}/></div></article>
          <article><div><span>UTC REALIZED P&amp;L</span>{stats.realized == null ? <strong className="muted">N/A</strong> : <strong className={stats.realized >= 0 ? 'profit-text' : 'loss-text'}>{fmtPnl(stats.realized)}</strong>}<em className="muted">Closed P&amp;L + fees + funding</em></div></article>
          <article><div><span>ACTUAL NET P&amp;L</span>{stats.realized == null ? <strong className="muted">N/A</strong> : <strong className={stats.pnl >= 0 ? 'profit-text' : 'loss-text'}>{fmtPnl(stats.pnl)}</strong>}<em className="muted">Unrealized + UTC realized</em></div><div className="mini-chart"><Sparkline positive={stats.pnl >= 0}/></div></article>
          <article><div><span>ACCOUNT EQUITY</span><strong>${futuresBalance ? futuresBalance.accountEquity.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A'}</strong><em className="muted">Bitget USDT futures equity</em></div></article>
        </> : <>
          <article><div><span>VOLUME-WEIGHTED 24H CHANGE</span><strong className={stats.pnl >= 0 ? 'profit-text' : 'loss-text'}>{stats.pnl >= 0 ? '+' : '−'}{Math.abs(stats.pnl).toFixed(2)}%</strong><em className="muted">Calculated from live exchange tickers</em></div><div className="mini-chart"><Sparkline positive={stats.pnl >= 0}/></div></article>
          <article><div><span>24H QUOTE VOLUME</span><strong>${fmtCompact(stats.value)}</strong><em className="muted">Live USDT markets</em></div><div className="mini-chart"><Sparkline positive={stats.pnl >= 0}/></div></article>
          <article><div><span>MARKET CONTRIBUTORS</span><strong>{stats.gainers} <small>/ {stats.losers}</small></strong><em className="muted">Up / Down</em></div><div className="breadth"><i style={{width:`${(stats.gainers / Math.max(stats.gainers + stats.losers, 1)) * 100}%`}}/></div></article>
        </>}
      </section>

      {usingAccount && <section className="account-overview">
        <div className="balance-header">
          <div><span>USDT FUTURES ACCOUNT</span><strong>Futures balance</strong></div>
          <small>Bitget · USDT-M perpetual</small>
        </div>
        {futuresBalance ? <div className="balance-grid">
          <article><span>ACCOUNT EQUITY</span><strong>{futuresBalance.accountEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
          <article><span>AVAILABLE</span><strong>{futuresBalance.available.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
          <article><span>ORDER LOCKED</span><strong>{futuresBalance.locked.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
          <article><span>MAX TRANSFER OUT</span><strong>{futuresBalance.maxTransferOut.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
        </div> : <div className="balance-unavailable">USDT futures balance is unavailable. Confirm that the Bitget API key has futures read permission.</div>}

        <div className="inventory-grid">
          <div className="inventory-card">
            <div className="inventory-title"><div><span>CURRENT CONTRACTS</span><strong>Open USDT futures</strong></div><em>{currentContracts.length}</em></div>
            <div className="inventory-table">
              <div className="inventory-row contracts header"><span>Contract</span><span>Side</span><span>Quantity</span><span>Value</span><span>Unrealized</span><span>UTC Realized</span></div>
              {currentContracts.map(item => { const side = item.symbol.endsWith('-SHORT') ? 'SHORT' : 'LONG'; return <button className="inventory-row contracts" key={item.symbol} onClick={() => setSelected(item)}><strong>{item.symbol.split('-')[0]}</strong><span className={side === 'LONG' ? 'long-side' : 'short-side'}>{side}</span><span>{quantity(item).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span><span>${fmtCompact(item.positionValue)}</span><span className={(item.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtPnl(item.unrealizedPnl ?? 0)}</span><span className={item.realizedPnl == null ? 'muted' : item.realizedPnl >= 0 ? 'positive' : 'negative'}>{item.realizedPnl == null ? 'N/A' : fmtPnl(item.realizedPnl)}</span></button> })}
              {!currentContracts.length && <div className="inventory-empty">No open USDT futures contracts</div>}
            </div>
          </div>
          <div className="inventory-card">
            <div className="inventory-title"><div><span>CRYPTO HOLDINGS</span><strong>Spot assets held</strong></div><em>{cryptoHoldings.length}</em></div>
            <div className="inventory-table">
              <div className="inventory-row header"><span>Asset</span><span>Quantity</span><span>Price</span><span>Value</span><span>Market 24H</span></div>
              {cryptoHoldings.map(item => <button className="inventory-row" key={item.symbol} onClick={() => setSelected(item)}><strong>{item.base}</strong><span>{quantity(item).toLocaleString(undefined, { maximumFractionDigits: 8 })}</span><span>${item.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span><span>${fmtCompact(item.positionValue)}</span><span className={item.change24h >= 0 ? 'positive' : 'negative'}>{item.change24h >= 0 ? '+' : ''}{item.change24h.toFixed(2)}%</span></button>)}
              {!cryptoHoldings.length && <div className="inventory-empty">No spot crypto holdings</div>}
            </div>
          </div>
        </div>
      </section>}

      <section className="workspace">
        <div className="toolbar">
          <div className="segmented exchange-tabs"><button className={exchange === 'binance' ? 'active' : ''} onClick={() => setExchange('binance')}><b className="binance-dot">◆</b> Binance</button><button className={exchange === 'bitget' ? 'active' : ''} onClick={() => setExchange('bitget')}><b className="bitget-dot">⇄</b> Bitget {bitgetConnected && <i className="account-dot"/>}</button></div>
          <div className="toolbar-right">
            <div className="searchbox"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search asset"/><kbd>⌘K</kbd></div>
            <div className="segmented range-tabs">{ranges.map(r => <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r}</button>)}</div>
            <button className="control" onClick={() => setSizeMetric(sizeMetric === 'position' ? 'profit' : 'position')}><SlidersHorizontal size={15}/> Size: {sizeMetric === 'position' ? 'Position' : 'Actual P&L'}<ChevronDown size={14}/></button>
            <button className="icon-button refresh" onClick={refresh} aria-label="Refresh"><RefreshCw size={16} className={loading ? 'spinning' : ''}/></button>
          </div>
        </div>

        <div className={`map-card ${loading && !data.length ? 'loading' : ''}`}>
          <HeatMap data={filtered} sizeMetric={sizeMetric} selected={selected} onSelect={setSelected} valueMode={usingAccount ? 'pnl' : 'change'}/>
          {!filtered.length && <div className="empty">No matching assets</div>}
          <div className="map-footer"><div className="legend"><span>{usingAccount ? 'Actual net P&L' : '24h market change'}</span><div className="legend-bar"/><span>Loss</span><span>Flat</span><span>Profit</span></div><button><Expand size={14}/> Fullscreen</button></div>
        </div>
      </section>
      </> : view === 'history' ? <section className="history-workspace">
        <div className="history-toolbar"><div><CalendarDays size={17}/><span>Saved locally</span><small>Automatic snapshot every 5 minutes while connected</small></div><div><button onClick={loadHistory}><RefreshCw size={14}/> Reload</button><button className="danger" onClick={clearHistory}><Trash2 size={14}/> Clear history</button></div></div>
        {history.length ? <>
          <div className="history-summary"><article><span>SNAPSHOTS</span><strong>{history.length}</strong></article><article><span>LATEST UNREALIZED</span><strong className={(history.at(-1)!.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{history.at(-1)!.unrealizedPnl == null ? 'Legacy' : fmtPnl(history.at(-1)!.unrealizedPnl!)}</strong></article><article><span>LATEST REALIZED</span><strong className={history.at(-1)!.realizedPnl == null ? 'muted' : history.at(-1)!.realizedPnl! >= 0 ? 'positive' : 'negative'}>{history.at(-1)!.realizedPnl == null ? 'N/A' : fmtPnl(history.at(-1)!.realizedPnl!)}</strong></article><article><span>TRACKING SINCE</span><strong>{new Date(history[0].timestamp).toLocaleDateString()}</strong></article></div>
          {historySnapshot && <div className="history-heatmap-section"><div className="history-map-title"><div><span>SAVED HEATMAP</span><strong>{new Date(historySnapshot.timestamp).toLocaleString()}</strong></div><em className={historySnapshot.unrealizedPnl == null ? 'muted' : historySnapshot.totalPnl >= 0 ? 'positive' : 'negative'}>{historySnapshot.unrealizedPnl == null ? 'Legacy estimated snapshot' : `${fmtPnl(historySnapshot.totalPnl)} actual net P&L`}</em></div><div className="history-heatmap"><HeatMap data={historySnapshot.positions} sizeMetric="position" selected={selected} onSelect={setSelected}/></div></div>}
          <div className="history-chart" aria-label="Saved profit history chart">
            <div className="zero-line"/>
            {chartHistory.map(entry => <button key={entry.timestamp} onClick={() => setHistorySnapshot(entry)} className={`history-bar-wrap ${historySnapshot?.timestamp === entry.timestamp ? 'active' : ''}`} title={`${new Date(entry.timestamp).toLocaleString()} · actual ${entry.totalPnl.toFixed(2)} USDT`}><i className={entry.totalPnl >= 0 ? 'gain' : 'loss'} style={{height:`${Math.max(Math.abs(entry.totalPnl) / maxHistoryPnl * 46, 2)}%`}}/></button>)}
          </div>
          <div className="history-table"><div className="history-row header"><span>Saved time</span><span>Net P&amp;L</span><span>Unrealized</span><span>Realized</span><span>Assets</span><span>Source</span><span/></div>{history.slice().reverse().slice(0,100).map(entry => <div className={`history-row ${historySnapshot?.timestamp === entry.timestamp ? 'selected' : ''}`} key={entry.timestamp}><span>{new Date(entry.timestamp).toLocaleString()}</span><strong className={entry.unrealizedPnl == null ? 'muted' : entry.totalPnl >= 0 ? 'positive' : 'negative'}>{entry.unrealizedPnl == null ? 'Legacy' : fmtPnl(entry.totalPnl)}</strong><span className={(entry.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{entry.unrealizedPnl == null ? '—' : fmtPnl(entry.unrealizedPnl)}</span><span className={entry.realizedPnl == null ? 'muted' : entry.realizedPnl >= 0 ? 'positive' : 'negative'}>{entry.realizedPnl == null ? 'N/A' : fmtPnl(entry.realizedPnl)}</span><span>{entry.positions.length}</span><span>{entry.unrealizedPnl == null ? 'Legacy estimate' : 'Bitget API'}</span><button onClick={() => setHistorySnapshot(entry)}><LayoutGrid size={12}/> View</button></div>)}</div>
        </> : <div className="history-empty"><History size={28}/><h3>No saved snapshots yet</h3><p>Connect Bitget once; Trading Journal will save the first record immediately.</p><button onClick={() => { setView('heatmap'); setConnectOpen(true); }}><KeyRound size={14}/> Connect Bitget</button></div>}
      </section> : view === 'notes' ? <TradingNotes/> : view === 'trades' ? <TradeLog/> : view === 'reports' ? <Reports/> : view === 'playbooks' ? <Playbooks/> : <CloudAccount/>}
    </main>

    {selected && <aside className="detail-panel">
      <button className="close" onClick={() => setSelected(undefined)}><X size={18}/></button>
      <span className="panel-label">{selected.exchange.toUpperCase()} · {selected.symbol.includes('-') ? 'FUTURES' : 'SPOT'}</span><h2>{selected.base}<small>/USDT</small></h2>
      <strong>{selected.pnlSource === 'exchange' ? fmtPnl(selected.dailyPnl) : `${selected.change24h >= 0 ? '+' : ''}${selected.change24h.toFixed(2)}%`}</strong>
      <em className={selected.pnlSource === 'exchange' ? selected.dailyPnl >= 0 ? 'positive' : 'negative' : selected.change24h >= 0 ? 'positive' : 'negative'}>{selected.pnlSource === 'exchange' ? 'Actual exchange net P&L' : 'Live 24h market change · P&L N/A'}</em>
      <div className="panel-chart"><Sparkline positive={selected.dailyPnl >= 0}/></div>
      <dl><div><dt>Position value</dt><dd>${fmtCompact(selected.positionValue)}</dd></div><div><dt>Current price</dt><dd>${selected.price.toLocaleString()}</dd></div>{selected.pnlSource === 'exchange' && <><div><dt>Unrealized P&amp;L</dt><dd className={(selected.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtPnl(selected.unrealizedPnl ?? 0)}</dd></div><div><dt>UTC realized P&amp;L</dt><dd className={selected.realizedPnl == null ? 'muted' : selected.realizedPnl >= 0 ? 'positive' : 'negative'}>{selected.realizedPnl == null ? 'N/A' : fmtPnl(selected.realizedPnl)}</dd></div></>}<div><dt>Last confirmed</dt><dd>{updatedAt?.toLocaleTimeString() ?? '—'}</dd></div></dl>
      <button className="primary-action"><ListFilter size={16}/> Add to watchlist</button>
    </aside>}

    {connectOpen && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setConnectOpen(false)}>
      <form className="api-modal" onSubmit={useSavedLogin ? loginSavedBitget : connectBitget}>
        <button type="button" className="close" onClick={() => setConnectOpen(false)}><X size={18}/></button>
        <div className="modal-icon"><KeyRound size={20}/></div>
        <span className="panel-label">SECURE EXCHANGE CONNECTION</span>
        <h2>{useSavedLogin ? 'Unlock Bitget' : 'Connect Bitget'}</h2>
        <p>{useSavedLogin ? 'Enter your Trading Journal login password to decrypt the saved Bitget connection.' : 'Load Bitget spot assets and USDT futures positions using a read-only API.'}</p>
        {useSavedLogin ? <>
          <label>Trading Journal login password<input type="password" autoFocus autoComplete="current-password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Your private login password" required/></label>
        </> : <>
          <label>API Key<input autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Bitget API key" required/></label>
          <label>Secret Key<input type="password" autoComplete="off" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="Bitget secret key" required/></label>
          <label>Bitget API passphrase<input type="password" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Passphrase created with the API key" required/></label>
          <label className="save-login-toggle"><input type="checkbox" checked={saveLogin} onChange={e => setSaveLogin(e.target.checked)}/><span><strong>Save encrypted API login</strong><small>Unlock it with one password next time</small></span></label>
          {saveLogin && <label>New Trading Journal login password<input type="password" autoComplete="new-password" minLength={8} value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Minimum 8 characters" required/></label>}
        </>}
        {apiError && <div className="api-error">{apiError}</div>}
        <div className="security-note"><ShieldCheck size={15}/><span>{useSavedLogin ? 'The password is never saved. It only decrypts your API vault in memory.' : 'Use read-only permissions. API data is encrypted with AES-256-GCM when saved.'}</span></div>
        <button className="connect-submit" disabled={apiLoading}>{apiLoading ? <><RefreshCw size={15} className="spinning"/> Connecting…</> : <><KeyRound size={15}/> {useSavedLogin ? 'Login & load portfolio' : 'Connect & load portfolio'}</>}</button>
        {useSavedLogin && <div className="saved-login-actions"><button type="button" onClick={() => { setUseSavedLogin(false); setLoginPassword(''); setApiError(''); }}>Use different API</button><button type="button" onClick={forgetSavedLogin}>Forget saved login</button></div>}
      </form>
    </div>}

    <footer><span><CircleHelp size={14}/> Live data refreshes every 10 seconds</span><span><Settings2 size={14}/> v0.2.3</span></footer>
  </div>;
}
