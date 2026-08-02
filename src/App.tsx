import { useEffect, useMemo, useState } from 'react';
import { Activity, Bell, CalendarDays, ChevronDown, CircleHelp, Command, Expand, History, KeyRound, LayoutGrid, ListFilter, LogOut, NotebookPen, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, WalletCards, Wifi, WifiOff, X } from 'lucide-react';
import { HeatMap } from './components/HeatMap';
import { Sparkline } from './components/Sparkline';
import { TradingNotes } from './components/TradingNotes';
import { useMarkets } from './hooks/useMarkets';
import { clearProfitHistory, connectBitgetAccount, deleteSavedBitgetLogin, disconnectBitgetAccount, hasSavedBitgetLogin, loadProfitHistory, loginBitgetAccount, refreshBitgetAccount } from './services/accountBridge';
import type { Exchange, FuturesBalance, MarketCoin, ProfitHistoryEntry, SizeMetric, TimeRange } from './types';
import './styles.css';

const ranges: TimeRange[] = ['1H', '4H', '1D', '1W'];

function fmtCompact(n: number) { return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n); }

export default function App() {
  const [view, setView] = useState<'heatmap' | 'history' | 'notes'>('heatmap');
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
  const [apiUpdatedAt, setApiUpdatedAt] = useState<Date>();
  const [history, setHistory] = useState<ProfitHistoryEntry[]>([]);
  const [historySnapshot, setHistorySnapshot] = useState<ProfitHistoryEntry>();
  const market = useMarkets(exchange);
  const usingAccount = exchange === 'bitget' && bitgetConnected;
  const data = usingAccount ? apiData : market.data;
  const loading = usingAccount ? apiLoading : market.loading;
  const live = usingAccount || market.live;
  const updatedAt = usingAccount ? apiUpdatedAt : market.updatedAt;

  async function loadHistory() {
    try { const items = await loadProfitHistory(); setHistory(items); setHistorySnapshot(current => current ?? items.at(-1)); } catch { setHistory([]); }
  }

  useEffect(() => { loadHistory(); hasSavedBitgetLogin().then(saved => { setHasSavedLogin(saved); setUseSavedLogin(saved); }).catch(() => {}); }, []);

  useEffect(() => {
    if (!bitgetConnected) return;
    const timer = window.setInterval(async () => {
      try {
        const snapshot = await refreshBitgetAccount();
        setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setApiUpdatedAt(new Date()); await loadHistory();
      } catch { /* next scheduled refresh retries */ }
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [bitgetConnected]);

  async function connectBitget(event: React.FormEvent) {
    event.preventDefault(); setApiError(''); setApiLoading(true);
    try {
      const snapshot = await connectBitgetAccount({ apiKey, apiSecret, passphrase }, saveLogin, saveLogin ? loginPassword : null);
      setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setBitgetConnected(true); setApiUpdatedAt(new Date()); setExchange('bitget');
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
      setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setBitgetConnected(true); setApiUpdatedAt(new Date()); setExchange('bitget');
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
    try { const snapshot = await refreshBitgetAccount(); setApiData(snapshot.positions); setFuturesBalance(snapshot.futuresBalance ?? undefined); setApiUpdatedAt(new Date()); await loadHistory(); }
    catch (error) { setApiError(String(error)); }
    finally { setApiLoading(false); }
  }

  async function disconnectBitget() {
    await disconnectBitgetAccount(); setBitgetConnected(false); setApiData([]); setFuturesBalance(undefined); setExchange('binance');
  }

  async function clearHistory() {
    if (!window.confirm('Delete all saved profit history?')) return;
    await clearProfitHistory(); setHistory([]);
  }

  const filtered = useMemo(() => data.filter(c => c.base.toLowerCase().includes(query.toLowerCase())), [data, query]);
  const stats = useMemo(() => ({
    value: data.reduce((a, c) => a + c.positionValue, 0),
    pnl: data.reduce((a, c) => a + c.dailyPnl, 0),
    gainers: data.filter(c => c.dailyPnl > 0).length,
    losers: data.filter(c => c.dailyPnl < 0).length,
    average: data.reduce((a, c) => a + c.positionValue, 0) ? data.reduce((a, c) => a + c.dailyPnl, 0) / data.reduce((a, c) => a + c.positionValue, 0) * 100 : 0
  }), [data]);

  const chartHistory = history.slice(-60);
  const maxHistoryPnl = Math.max(...chartHistory.map(h => Math.abs(h.totalPnl)), 1);
  const currentContracts = apiData.filter(item => item.symbol.includes('-') && !item.symbol.endsWith('-CLOSED'));
  const cryptoHoldings = apiData.filter(item => !item.symbol.includes('-'));
  const quantity = (item: MarketCoin) => item.price > 0 ? item.positionValue / item.price : 0;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Activity size={18}/></div><span>Trading <span>Journal</span></span></div>
      <nav className={mobileMenu ? 'open' : ''}>
        <button className={view === 'heatmap' ? 'nav-active' : ''} onClick={() => setView('heatmap')}><LayoutGrid size={16}/> Heatmap</button>
        <button className={view === 'history' ? 'nav-active' : ''} onClick={() => { setView('history'); loadHistory(); }}><History size={16}/> History</button>
        <button className={view === 'notes' ? 'nav-active' : ''} onClick={() => setView('notes')}><NotebookPen size={16}/> Trading Notes</button>
        <button><WalletCards size={16}/> Watchlist</button>
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
        <div><div className="eyebrow"><span/> DAILY PORTFOLIO INTELLIGENCE</div><h1>{view === 'heatmap' ? 'Daily Profit Heatmap' : view === 'history' ? 'Profit History' : 'Trading Notes'}</h1><p>{view === 'heatmap' ? 'See exactly where today’s portfolio profit and loss comes from.' : view === 'history' ? 'Review locally saved Bitget P&L snapshots over time.' : 'Upload chart screenshots and review your past trading decisions.'}</p></div>
        <div className={`connection ${live ? '' : 'offline'}`}>{live ? <Wifi size={14}/> : <WifiOff size={14}/>}<span>{usingAccount ? 'Bitget account · UTC daily P&L' : live ? 'Live prices · demo positions' : 'Demo portfolio'}</span><small>{updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
      </section>

      {view === 'heatmap' ? <>
      <section className="stat-row">
        <article><div><span>{usingAccount ? "UTC TODAY'S NET P&L" : "TODAY'S PROFIT"}</span><strong className={stats.pnl >= 0 ? 'profit-text' : 'loss-text'}>{stats.pnl >= 0 ? '+' : '−'}${fmtCompact(Math.abs(stats.pnl))}</strong><em className={stats.pnl >= 0 ? 'positive' : 'negative'}>{stats.average >= 0 ? '+' : ''}{stats.average.toFixed(2)}% today</em></div><div className="mini-chart"><Sparkline positive={stats.pnl >= 0}/></div></article>
        <article><div><span>PORTFOLIO VALUE</span><strong>${fmtCompact(stats.value)}</strong><em className="muted">Connected spot assets</em></div><div className="mini-chart"><Sparkline positive={stats.pnl >= 0}/></div></article>
        <article><div><span>PROFIT CONTRIBUTORS</span><strong>{stats.gainers} <small>/ {stats.losers}</small></strong><em className="muted">Profitable / Losing</em></div><div className="breadth"><i style={{width:`${(stats.gainers / Math.max(stats.gainers + stats.losers, 1)) * 100}%`}}/></div></article>
      </section>

      {usingAccount && <section className="account-overview">
        <div className="balance-header">
          <div><span>USDT FUTURES ACCOUNT</span><strong>Futures balance</strong></div>
          <small>Bitget · USDT-M perpetual</small>
        </div>
        {futuresBalance ? <div className="balance-grid">
          <article><span>ACCOUNT EQUITY</span><strong>{futuresBalance.accountEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
          <article><span>AVAILABLE</span><strong>{futuresBalance.available.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
          <article><span>LOCKED MARGIN</span><strong>{futuresBalance.locked.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
          <article><span>UNREALIZED P&amp;L</span><strong className={futuresBalance.unrealizedPnl >= 0 ? 'positive' : 'negative'}>{futuresBalance.unrealizedPnl >= 0 ? '+' : '−'}{Math.abs(futuresBalance.unrealizedPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
        </div> : <div className="balance-unavailable">USDT futures balance is unavailable. Confirm that the Bitget API key has futures read permission.</div>}

        <div className="inventory-grid">
          <div className="inventory-card">
            <div className="inventory-title"><div><span>CURRENT CONTRACTS</span><strong>Open USDT futures</strong></div><em>{currentContracts.length}</em></div>
            <div className="inventory-table">
              <div className="inventory-row header"><span>Contract</span><span>Side</span><span>Quantity</span><span>Value</span><span>Daily P&amp;L</span></div>
              {currentContracts.map(item => { const side = item.symbol.endsWith('-SHORT') ? 'SHORT' : 'LONG'; return <button className="inventory-row" key={item.symbol} onClick={() => setSelected(item)}><strong>{item.symbol.split('-')[0]}</strong><span className={side === 'LONG' ? 'long-side' : 'short-side'}>{side}</span><span>{quantity(item).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span><span>${fmtCompact(item.positionValue)}</span><span className={item.dailyPnl >= 0 ? 'positive' : 'negative'}>{item.dailyPnl >= 0 ? '+' : '−'}${Math.abs(item.dailyPnl).toFixed(2)}</span></button> })}
              {!currentContracts.length && <div className="inventory-empty">No open USDT futures contracts</div>}
            </div>
          </div>
          <div className="inventory-card">
            <div className="inventory-title"><div><span>CRYPTO HOLDINGS</span><strong>Spot assets held</strong></div><em>{cryptoHoldings.length}</em></div>
            <div className="inventory-table">
              <div className="inventory-row header"><span>Asset</span><span>Quantity</span><span>Price</span><span>Value</span><span>Daily P&amp;L</span></div>
              {cryptoHoldings.map(item => <button className="inventory-row" key={item.symbol} onClick={() => setSelected(item)}><strong>{item.base}</strong><span>{quantity(item).toLocaleString(undefined, { maximumFractionDigits: 8 })}</span><span>${item.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span><span>${fmtCompact(item.positionValue)}</span><span className={item.dailyPnl >= 0 ? 'positive' : 'negative'}>{item.dailyPnl >= 0 ? '+' : '−'}${Math.abs(item.dailyPnl).toFixed(2)}</span></button>)}
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
            <button className="control" onClick={() => setSizeMetric(sizeMetric === 'position' ? 'profit' : 'position')}><SlidersHorizontal size={15}/> Size: {sizeMetric === 'position' ? 'Position' : 'Daily P&L'}<ChevronDown size={14}/></button>
            <button className="icon-button refresh" onClick={refresh} aria-label="Refresh"><RefreshCw size={16} className={loading ? 'spinning' : ''}/></button>
          </div>
        </div>

        <div className={`map-card ${loading && !data.length ? 'loading' : ''}`}>
          <HeatMap data={filtered} sizeMetric={sizeMetric} selected={selected} onSelect={setSelected}/>
          {!filtered.length && <div className="empty">No matching assets</div>}
          <div className="map-footer"><div className="legend"><span>Daily profit</span><div className="legend-bar"/><span>Loss</span><span>Flat</span><span>Profit</span></div><button><Expand size={14}/> Fullscreen</button></div>
        </div>
      </section>
      </> : view === 'history' ? <section className="history-workspace">
        <div className="history-toolbar"><div><CalendarDays size={17}/><span>Saved locally</span><small>Automatic snapshot every 5 minutes while connected</small></div><div><button onClick={loadHistory}><RefreshCw size={14}/> Reload</button><button className="danger" onClick={clearHistory}><Trash2 size={14}/> Clear history</button></div></div>
        {history.length ? <>
          <div className="history-summary"><article><span>SNAPSHOTS</span><strong>{history.length}</strong></article><article><span>LATEST NET P&L</span><strong className={history.at(-1)!.totalPnl >= 0 ? 'positive' : 'negative'}>{history.at(-1)!.totalPnl >= 0 ? '+' : '−'}${Math.abs(history.at(-1)!.totalPnl).toFixed(2)}</strong></article><article><span>TRACKING SINCE</span><strong>{new Date(history[0].timestamp).toLocaleDateString()}</strong></article></div>
          {historySnapshot && <div className="history-heatmap-section"><div className="history-map-title"><div><span>SAVED HEATMAP</span><strong>{new Date(historySnapshot.timestamp).toLocaleString()}</strong></div><em className={historySnapshot.totalPnl >= 0 ? 'positive' : 'negative'}>{historySnapshot.totalPnl >= 0 ? '+' : '−'}${Math.abs(historySnapshot.totalPnl).toFixed(2)} net P&amp;L</em></div><div className="history-heatmap"><HeatMap data={historySnapshot.positions} sizeMetric="position" selected={selected} onSelect={setSelected}/></div></div>}
          <div className="history-chart" aria-label="Saved profit history chart">
            <div className="zero-line"/>
            {chartHistory.map(entry => <button key={entry.timestamp} onClick={() => setHistorySnapshot(entry)} className={`history-bar-wrap ${historySnapshot?.timestamp === entry.timestamp ? 'active' : ''}`} title={`${new Date(entry.timestamp).toLocaleString()} · ${entry.totalPnl.toFixed(2)} USDT`}><i className={entry.totalPnl >= 0 ? 'gain' : 'loss'} style={{height:`${Math.max(Math.abs(entry.totalPnl) / maxHistoryPnl * 46, 2)}%`}}/></button>)}
          </div>
          <div className="history-table"><div className="history-row header"><span>Saved time</span><span>Net P&L</span><span>Portfolio value</span><span>Assets</span><span>Top contributor</span><span/></div>{history.slice().reverse().slice(0,100).map(entry => { const top = entry.positions.slice().sort((a,b) => Math.abs(b.dailyPnl)-Math.abs(a.dailyPnl))[0]; return <div className={`history-row ${historySnapshot?.timestamp === entry.timestamp ? 'selected' : ''}`} key={entry.timestamp}><span>{new Date(entry.timestamp).toLocaleString()}</span><strong className={entry.totalPnl >= 0 ? 'positive' : 'negative'}>{entry.totalPnl >= 0 ? '+' : '−'}${Math.abs(entry.totalPnl).toFixed(2)}</strong><span>${fmtCompact(entry.portfolioValue)}</span><span>{entry.positions.length}</span><span>{top ? `${top.base} ${top.dailyPnl >= 0 ? '+' : '−'}$${Math.abs(top.dailyPnl).toFixed(2)}` : '—'}</span><button onClick={() => setHistorySnapshot(entry)}><LayoutGrid size={12}/> View</button></div>})}</div>
        </> : <div className="history-empty"><History size={28}/><h3>No saved snapshots yet</h3><p>Connect Bitget once; Trading Journal will save the first record immediately.</p><button onClick={() => { setView('heatmap'); setConnectOpen(true); }}><KeyRound size={14}/> Connect Bitget</button></div>}
      </section> : <TradingNotes/>}
    </main>

    {selected && <aside className="detail-panel">
      <button className="close" onClick={() => setSelected(undefined)}><X size={18}/></button>
      <span className="panel-label">{selected.exchange.toUpperCase()} · {selected.symbol.includes('-') ? 'FUTURES' : 'SPOT'}</span><h2>{selected.base}<small>/USDT</small></h2>
      <strong>{selected.dailyPnl >= 0 ? '+' : '−'}${Math.abs(selected.dailyPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
      <em className={selected.dailyPnl >= 0 ? 'positive' : 'negative'}>{selected.change24h >= 0 ? '+' : ''}{selected.change24h.toFixed(2)}% today</em>
      <div className="panel-chart"><Sparkline positive={selected.dailyPnl >= 0}/></div>
      <dl><div><dt>Position value</dt><dd>${fmtCompact(selected.positionValue)}</dd></div><div><dt>Current price</dt><dd>${selected.price.toLocaleString()}</dd></div><div><dt>24h volume</dt><dd>${fmtCompact(selected.quoteVolume)}</dd></div></dl>
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

    <footer><span><CircleHelp size={14}/> Data refreshes every 30 seconds</span><span><Settings2 size={14}/> v0.1.0</span></footer>
  </div>;
}
