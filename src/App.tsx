import { useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveRestore, ArrowDownRight, ArrowUpRight, BarChart3, Bell, BookOpen, CalendarDays, ChevronDown, CircleHelp, Cloud, Command, Expand, Gauge, History, KeyRound, LayoutGrid, List, LogOut, NotebookPen, Radio, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, WalletCards, Wifi, WifiOff, X } from 'lucide-react';
import { HeatMap } from './components/HeatMap';
import { Sparkline } from './components/Sparkline';
import { TradingNotes } from './components/TradingNotes';
import { TradeLog } from './components/TradeLog';
import { Reports } from './components/Reports';
import { Playbooks } from './components/Playbooks';
import { CloudAccount } from './components/CloudAccount';
import { RemoteSyncModal } from './components/RemoteSyncModal';
import { BackupModal } from './components/BackupModal';
import { useMarkets } from './hooks/useMarkets';
import { clearProfitHistory, connectBitgetAccount, deleteSavedBitgetLogin, disconnectBitgetAccount, hasSavedBitgetLogin, loadProfitHistory, loginBitgetAccount, mergeLiveContracts, refreshBitgetAccount, refreshBitgetContracts } from './services/accountBridge';
import { connectRemoteHub, disconnectRemoteHub, loadSavedRemoteHub, refreshRemoteHub, type RemoteSyncEnvelope } from './services/remoteSync';
import { ageSeconds, isNewerCapture, isStale, resolveCaptureTimes } from './services/freshness';
import { instrumentName, isMetal } from './services/instruments';
import type { Exchange, FuturesBalance, MarketCoin, PortfolioResponse, ProfitHistoryEntry, SizeMetric, TimeRange } from './types';
import './styles.css';

const ranges: TimeRange[] = ['1H', '4H', '1D', '1W'];
const CONTRACT_REFRESH_MS = 2_000;
const ACCOUNT_REFRESH_MS = 30_000;

function fmtCompact(n: number) { return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
function fmtPnl(n: number) { return `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function fmtPrice(n?: number) { return n && n > 0 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })}` : '—'; }

export default function App() {
  const [view, setView] = useState<'heatmap' | 'trades' | 'reports' | 'history' | 'notes' | 'playbooks' | 'cloud'>('heatmap');
  const [exchange, setExchange] = useState<Exchange>('binance');
  const [range, setRange] = useState<TimeRange>('1D');
  const [sizeMetric, setSizeMetric] = useState<SizeMetric>('position');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MarketCoin>();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(() => new URLSearchParams(window.location.search).get('sync') === '1');
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
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
  const [accountUpdatedAt, setAccountUpdatedAt] = useState<Date>();
  const [liveSyncing, setLiveSyncing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<ProfitHistoryEntry[]>([]);
  const [historySnapshot, setHistorySnapshot] = useState<ProfitHistoryEntry>();
  // Tracked per layer: the 2-second contract poll knows nothing about spot holdings, so it must
  // not clear a partial-failure notice raised by the 30-second account read, or vice versa.
  const [accountStaleReason, setAccountStaleReason] = useState('');
  const [contractStaleReason, setContractStaleReason] = useState('');
  // One flag per poller. Sharing a single flag let the slow 30-second account read starve the
  // two-second contract refresh for its whole duration while the UI still claimed "2s live".
  const contractRequestInFlight = useRef(false);
  const accountRequestInFlight = useRef(false);
  // Newest exchange read applied to each layer. A slow response that resolves after a fresher
  // one must not overwrite it, otherwise the P&L visibly jumps backwards.
  const latestContractCaptureRef = useRef(0);
  const latestAccountCaptureRef = useRef(0);
  const apiDataRef = useRef<MarketCoin[]>([]);
  const market = useMarkets(exchange);
  const usingAccount = exchange === 'bitget' && (bitgetConnected || remoteConnected);
  const data = usingAccount ? apiData : market.data;
  const loading = usingAccount ? apiLoading : market.loading;
  const live = usingAccount ? accountLive : market.live;
  const updatedAt = usingAccount ? apiUpdatedAt : market.updatedAt;

  async function loadHistory() {
    try { const items = await loadProfitHistory(); setHistory(items); setHistorySnapshot(current => current ?? items.at(-1)); } catch { setHistory([]); }
  }

  function showPositions(positions: MarketCoin[]) {
    apiDataRef.current = positions;
    setApiData(positions);
  }

  /**
   * Every full-snapshot write goes through here so the freshness clock reflects the exchange
   * read behind the numbers rather than the moment the response happened to arrive.
   */
  function applySnapshot(snapshot: PortfolioResponse, fallbackCapturedAt = Date.now()) {
    const { capturedAt, contractsCapturedAt } = resolveCaptureTimes(snapshot, fallbackCapturedAt);
    if (!isNewerCapture(latestAccountCaptureRef.current, capturedAt)) return;
    latestAccountCaptureRef.current = capturedAt;

    if (!isNewerCapture(latestContractCaptureRef.current, contractsCapturedAt)) {
      // The live layer already on screen is newer than this snapshot. Keep it on top of the
      // freshly read spot rows and balance instead of rewinding the contract P&L.
      showPositions(mergeLiveContracts(snapshot.positions, apiDataRef.current.filter(item => item.side)));
    } else {
      latestContractCaptureRef.current = contractsCapturedAt;
      showPositions(snapshot.positions);
    }
    setFuturesBalance(snapshot.futuresBalance ?? undefined);
    setApiUpdatedAt(new Date(latestContractCaptureRef.current));
    setAccountUpdatedAt(new Date(capturedAt));
    setAccountStaleReason(snapshot.staleReason ?? '');
    setApiError(''); setAccountLive(true);
  }

  function resetFreshness() {
    latestContractCaptureRef.current = 0;
    latestAccountCaptureRef.current = 0;
    setAccountStaleReason(''); setContractStaleReason('');
  }

  function applyRemotePayload(payload: RemoteSyncEnvelope) {
    if (!payload.snapshot) return;
    setHistory(payload.history); setHistorySnapshot(current => current ?? payload.history.at(-1));
    setRemoteConnected(true); setBitgetConnected(false); setExchange('bitget');
    // The desktop answers instantly even when it has not reached Bitget for minutes, so age has
    // to come from the snapshot's own capture time, never from when the envelope was built.
    applySnapshot(payload.snapshot, payload.generatedAt || Date.now());
  }

  useEffect(() => { loadHistory(); hasSavedBitgetLogin().then(saved => { setHasSavedLogin(saved); setUseSavedLogin(saved); }).catch(() => {}); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const saved = loadSavedRemoteHub();
    if (saved) connectRemoteHub(saved.url, saved.token, true).then(applyRemotePayload).catch(() => disconnectRemoteHub(false));
  }, []);

  useEffect(() => {
    if (!remoteConnected) return;
    let stopped = false;
    const poll = async () => {
      setLiveSyncing(true);
      try { const payload = await refreshRemoteHub(); if (!stopped) applyRemotePayload(payload); }
      catch (error) { if (!stopped) { setApiError(`Desktop sync: ${String(error)}`); setAccountLive(false); } }
      finally { if (!stopped) setLiveSyncing(false); }
    };
    const timer = window.setInterval(poll, CONTRACT_REFRESH_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [remoteConnected]);

  useEffect(() => {
    if (!bitgetConnected) return;
    let stopped = false;
    const pollContracts = async () => {
      if (contractRequestInFlight.current) return;
      contractRequestInFlight.current = true;
      setLiveSyncing(true);
      try {
        const live = await refreshBitgetContracts(apiDataRef.current);
        if (stopped) return;
        setContractStaleReason(live.staleReason ?? '');
        // A slower read that resolves out of order would otherwise rewind the grid.
        if (!isNewerCapture(latestContractCaptureRef.current, live.capturedAt)) return;
        latestContractCaptureRef.current = live.capturedAt;
        showPositions(mergeLiveContracts(apiDataRef.current, live.contracts));
        setSelected(current => current?.side ? mergeLiveContracts([current], live.contracts).find(item => item.symbol === current.symbol) ?? current : current);
        setFuturesBalance(previous => previous ? { ...previous, unrealizedPnl: live.contracts.reduce((sum, item) => sum + (item.unrealizedPnl ?? 0), 0) } : previous);
        setApiUpdatedAt(new Date(live.capturedAt)); setApiError(''); setAccountLive(true);
      } catch (error) {
        if (!stopped) { setApiError(String(error)); setAccountLive(false); }
      } finally { contractRequestInFlight.current = false; if (!stopped) setLiveSyncing(false); }
    };
    const pollAccount = async () => {
      if (accountRequestInFlight.current) return;
      accountRequestInFlight.current = true;
      try {
        const snapshot = await refreshBitgetAccount();
        if (stopped) return;
        applySnapshot(snapshot);
        await loadHistory();
      } catch (error) {
        if (!stopped) { setApiError(String(error)); setAccountLive(false); }
      } finally { accountRequestInFlight.current = false; }
    };
    const contractTimer = window.setInterval(pollContracts, CONTRACT_REFRESH_MS);
    const accountTimer = window.setInterval(pollAccount, ACCOUNT_REFRESH_MS);
    return () => { stopped = true; window.clearInterval(contractTimer); window.clearInterval(accountTimer); };
  }, [bitgetConnected]);

  async function connectBitget(event: React.FormEvent) {
    event.preventDefault(); setApiError(''); setApiLoading(true);
    try {
      const snapshot = await connectBitgetAccount({ apiKey, apiSecret, passphrase }, saveLogin, saveLogin ? loginPassword : null);
      disconnectRemoteHub(false); setRemoteConnected(false);
      resetFreshness();
      setBitgetConnected(true); setExchange('bitget');
      applySnapshot(snapshot);
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
      disconnectRemoteHub(false); setRemoteConnected(false);
      resetFreshness();
      setBitgetConnected(true); setExchange('bitget');
      applySnapshot(snapshot);
      setLoginPassword(''); setConnectOpen(false); await loadHistory();
    } catch (error) { setApiError(String(error)); }
    finally { setApiLoading(false); }
  }

  async function forgetSavedLogin() {
    await deleteSavedBitgetLogin(); setHasSavedLogin(false); setUseSavedLogin(false); setLoginPassword(''); setApiError('');
  }

  async function refresh() {
    if (!usingAccount) { await market.refresh(); return; }
    if (remoteConnected) {
      setLiveSyncing(true); setApiError('');
      try { applyRemotePayload(await refreshRemoteHub()); }
      catch (error) { setApiError(`Desktop sync: ${String(error)}`); setAccountLive(false); }
      finally { setLiveSyncing(false); }
      return;
    }
    if (accountRequestInFlight.current) return;
    accountRequestInFlight.current = true;
    setApiLoading(true); setApiError('');
    try { applySnapshot(await refreshBitgetAccount()); await loadHistory(); }
    catch (error) { setApiError(String(error)); setAccountLive(false); }
    finally { accountRequestInFlight.current = false; setApiLoading(false); }
  }

  function clearAccountView() {
    resetFreshness(); setAccountLive(false); showPositions([]);
    setFuturesBalance(undefined); setApiUpdatedAt(undefined); setAccountUpdatedAt(undefined); setExchange('binance');
  }

  async function disconnectBitget() {
    await disconnectBitgetAccount(); setBitgetConnected(false); clearAccountView();
  }

  function disconnectRemote() {
    disconnectRemoteHub(false); setRemoteConnected(false); clearAccountView();
  }

  async function clearHistory() {
    if (remoteConnected) { window.alert('Remote history is read-only. Clear it from the connected desktop app.'); return; }
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
  const currentContracts = apiData.filter(item => item.side);
  const cryptoHoldings = apiData.filter(item => !item.side && !item.symbol.endsWith('-CLOSED'));
  const quantity = (item: MarketCoin) => item.quantity ?? (item.price > 0 ? item.positionValue / item.price : 0);
  const liveAge = ageSeconds(apiUpdatedAt?.getTime(), now);
  // Age is measured from the exchange read, so this catches a throttled tab or a paired desktop
  // that stopped polling — cases where the old UI kept saying "live" over frozen numbers.
  const stale = usingAccount && isStale(apiUpdatedAt?.getTime(), now);
  const confirmedLive = live && !stale;
  const staleReason = [accountStaleReason, contractStaleReason].filter(Boolean).join(' · ');
  const marginUsed = currentContracts.reduce((sum, item) => sum + (item.margin ?? 0), 0);
  const profitableContracts = currentContracts.filter(item => (item.unrealizedPnl ?? 0) >= 0).length;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><img src={`${import.meta.env.BASE_URL}app-icon.png`} alt=""/></div><span>Trading <span>Journal</span></span></div>
      <nav className={mobileMenu ? 'open' : ''}>
        <button className={view === 'heatmap' ? 'nav-active' : ''} onClick={() => setView('heatmap')}><LayoutGrid size={16}/> Heatmap</button>
        <button className={view === 'trades' ? 'nav-active' : ''} onClick={() => setView('trades')}><List size={16}/> Trade Log</button>
        <button className={view === 'reports' ? 'nav-active' : ''} onClick={() => setView('reports')}><BarChart3 size={16}/> Reports</button>
        <button className={view === 'history' ? 'nav-active' : ''} onClick={() => { setView('history'); if (!remoteConnected) loadHistory(); }}><History size={16}/> History</button>
        <button className={view === 'notes' ? 'nav-active' : ''} onClick={() => setView('notes')}><NotebookPen size={16}/> Trading Notes</button>
        <button className={view === 'playbooks' ? 'nav-active' : ''} onClick={() => setView('playbooks')}><BookOpen size={16}/> Playbooks</button>
        <button className={view === 'cloud' ? 'nav-active' : ''} onClick={() => setView('cloud')}><Cloud size={16}/> Cloud</button>
      </nav>
      <div className="top-actions">
        {remoteConnected
          ? <button className="api-connected remote-connected" onClick={disconnectRemote}><Radio size={14}/> Desktop live <LogOut size={13}/></button>
          : bitgetConnected
            ? <button className="api-connected" onClick={disconnectBitget}><ShieldCheck size={14}/> Bitget connected <LogOut size={13}/></button>
            : <button className="connect-api" onClick={() => { setUseSavedLogin(hasSavedLogin); setConnectOpen(true); }}><KeyRound size={14}/> {hasSavedLogin ? 'Unlock Bitget' : 'Connect Bitget'}</button>}
        <button className="sync-hub-button" onClick={() => setRemoteOpen(true)}><Radio size={14}/> Sync</button>
        <button className="backup-button" onClick={() => setBackupOpen(true)}><ArchiveRestore size={14}/> Backup</button>
        <button className="icon-button"><Search size={18}/></button><button className="icon-button"><Bell size={18}/><i/></button>
        <button className="avatar">AG</button>
        <button className="menu-toggle" onClick={() => setMobileMenu(v => !v)}>{mobileMenu ? <X/> : <Command/>}</button>
      </div>
    </header>

    <main>
      <section className="page-heading">
        <div><div className="eyebrow"><span/> TRADING PERFORMANCE INTELLIGENCE</div><h1>{{heatmap:'Daily Profit Heatmap',trades:'Trade Log',reports:'Performance Reports',history:'Profit History',notes:'Trading Notes',playbooks:'Strategy Playbooks',cloud:'Cloud Database'}[view]}</h1><p>{{heatmap:'See exactly where today’s portfolio profit and loss comes from.',trades:'Log executions, fees, risk and setup context in one searchable database.',reports:'Measure win rate, expectancy, profit factor and strategy performance.',history:'Review locally saved Bitget P&L snapshots over time.',notes:'Upload chart screenshots and review your past trading decisions.',playbooks:'Define repeatable setups and review their actual results.',cloud:'Synchronize your private journal across every installed device.'}[view]}</p></div>
        <div className={`connection ${confirmedLive ? '' : 'offline'} ${liveSyncing ? 'syncing' : ''}`}>{usingAccount ? <Radio size={14}/> : live ? <Wifi size={14}/> : <WifiOff size={14}/>}<span>{remoteConnected ? confirmedLive ? 'PC / Mac sync · 2s live' : stale ? 'Desktop sync stalled' : 'Desktop sync paused' : usingAccount ? confirmedLive ? 'Contract P&L · 2s live' : stale ? 'Contract data stalled' : 'Contract refresh paused' : live ? `Live ${exchange} market data` : "Can't connect to API"}</span><small>{usingAccount && liveAge != null ? `${liveAge}s ago` : updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></div>
      </section>

      {view === 'heatmap' ? <>
      {!usingAccount && market.error && <div className="market-api-error"><WifiOff size={18}/><div><strong>Can't connect to API</strong><span>{market.error}</span></div><button onClick={market.refresh}>Retry</button></div>}
      {!usingAccount && !market.error && market.warning && <div className="market-api-error"><WifiOff size={18}/><div><strong>Partial market data</strong><span>{market.warning}</span></div><button onClick={market.refresh}>Retry</button></div>}
      {usingAccount && apiError && <div className="market-api-error"><WifiOff size={18}/><div><strong>{remoteConnected ? 'Desktop sync paused' : 'Bitget live refresh paused'}</strong><span>{apiError} · showing data confirmed at {apiUpdatedAt?.toLocaleTimeString()}</span></div><button onClick={refresh}>Retry</button></div>}
      {usingAccount && !apiError && staleReason && <div className="market-api-error"><WifiOff size={18}/><div><strong>Bitget answered only partially</strong><span>{staleReason} · the last confirmed values are still shown</span></div><button onClick={refresh}>Retry</button></div>}
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

      {usingAccount && <section className="live-trading-dashboard">
        <div className={`live-pnl-hero ${stats.unrealized >= 0 ? 'is-profit' : 'is-loss'}`}>
          <div className="live-pnl-primary">
            <div className="live-kicker"><Radio size={15}/><span>OPEN CONTRACT P&amp;L</span><b>{confirmedLive ? 'LIVE' : 'STALE'}</b></div>
            <strong>{fmtPnl(stats.unrealized)}</strong>
            <p>{confirmedLive ? 'Exchange unrealized P&L · refreshed every 2 seconds' : `Last confirmed by the exchange ${liveAge == null ? 'never' : `${liveAge}s ago`} · not updating`}</p>
          </div>
          <div className="live-overview-metrics">
            <article><span>OPEN POSITIONS</span><strong>{currentContracts.length}</strong><small>USDT perpetuals</small></article>
            <article><span>IN PROFIT</span><strong>{profitableContracts}<em> / {currentContracts.length}</em></strong><small>Current contracts</small></article>
            <article><span>MARGIN USED</span><strong>{marginUsed.toLocaleString(undefined, { maximumFractionDigits: 2 })}<em> USDT</em></strong><small>Reported position margin</small></article>
            <article><span>LIVE UPDATED</span><strong>{liveAge == null ? '—' : `${liveAge}s`}</strong><small>{apiUpdatedAt?.toLocaleTimeString() ?? 'Waiting for data'}</small></article>
          </div>
        </div>

        <div className="account-overview">
          <div className="balance-header">
            <div><span>USDT FUTURES ACCOUNT</span><strong>Account balance</strong></div>
            <small>Full account snapshot {accountUpdatedAt ? accountUpdatedAt.toLocaleTimeString() : 'pending'} · every 30s</small>
          </div>
          {futuresBalance ? <div className="balance-grid">
            <article><span>ACCOUNT EQUITY</span><strong>{futuresBalance.accountEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
            <article><span>AVAILABLE</span><strong>{futuresBalance.available.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
            <article><span>ORDER LOCKED</span><strong>{futuresBalance.locked.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
            <article><span>MAX TRANSFER OUT</span><strong>{futuresBalance.maxTransferOut.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>USDT</small></strong></article>
          </div> : <div className="balance-unavailable">USDT futures balance is unavailable. Confirm that the Bitget API key has futures read permission.</div>}

          <div className="live-contracts-section">
            <div className="inventory-title"><div><span>LIVE CONTRACTS</span><strong>Open USDT futures positions</strong></div><em>{currentContracts.length}</em></div>
            {currentContracts.length ? <div className="contract-live-grid">
              {currentContracts.map(item => { const pnl = item.unrealizedPnl ?? 0; const roi = item.roi ?? item.change24h; const contract = item.symbol.replace(/-(LONG|SHORT)$/, ''); return <button className={`contract-live-card ${pnl >= 0 ? 'is-profit' : 'is-loss'}`} key={item.symbol} onClick={() => setSelected(item)}>
                <div className="contract-card-top"><div><i/><span>{contract}</span><small>{isMetal(item.symbol) ? `${instrumentName(item.symbol)} · ` : ''}{item.marginMode || 'FUTURES'} {item.leverage ? `· ${item.leverage}×` : ''}</small></div><b className={item.side === 'LONG' ? 'long-side' : 'short-side'}>{item.side === 'LONG' ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {item.side}</b></div>
                <div className="contract-live-profit"><span>LIVE UNREALIZED</span><strong>{fmtPnl(pnl)}</strong><em className={roi >= 0 ? 'positive' : 'negative'}>{roi >= 0 ? '+' : '−'}{Math.abs(roi).toFixed(2)}% ROI</em></div>
                <div className="contract-metrics"><div><span>Mark price</span><strong>{fmtPrice(item.markPrice ?? item.price)}</strong></div><div><span>Entry price</span><strong>{fmtPrice(item.entryPrice)}</strong></div><div><span>Position size</span><strong>{quantity(item).toLocaleString(undefined, { maximumFractionDigits: 6 })}</strong></div><div><span>Margin</span><strong>{item.margin?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'} USDT</strong></div></div>
                <div className="contract-card-footer"><span><Radio size={11}/> {liveAge == null ? 'Connecting' : `Updated ${liveAge}s ago`}</span><span>Liq. {fmtPrice(item.liquidationPrice ?? undefined)}</span></div>
              </button>; })}
            </div> : <div className="contract-empty"><Gauge size={24}/><strong>No open USDT futures contracts</strong><span>New positions will appear automatically on the next 2-second refresh.</span></div>}
          </div>

          <div className="inventory-card spot-inventory">
            <div className="inventory-title"><div><span>CRYPTO HOLDINGS</span><strong>Spot assets held</strong></div><em>{cryptoHoldings.length}</em></div>
            <div className="inventory-table">
              <div className="inventory-row header"><span>Asset</span><span>Quantity</span><span>Price</span><span>Value</span><span>Market 24H</span></div>
              {cryptoHoldings.map(item => <button className="inventory-row" key={item.symbol} onClick={() => setSelected(item)}><strong>{item.base}</strong><span>{quantity(item).toLocaleString(undefined, { maximumFractionDigits: 8 })}</span><span>{fmtPrice(item.price)}</span><span>${fmtCompact(item.positionValue)}</span><span className={item.change24h >= 0 ? 'positive' : 'negative'}>{item.change24h >= 0 ? '+' : ''}{item.change24h.toFixed(2)}%</span></button>)}
              {!cryptoHoldings.length && <div className="inventory-empty"><WalletCards size={18}/> No spot crypto holdings</div>}
            </div>
          </div>
        </div>
      </section>}

      <section className="workspace">
        <div className="toolbar">
          <div className="segmented exchange-tabs"><button className={exchange === 'binance' ? 'active' : ''} onClick={() => setExchange('binance')}><b className="binance-dot">◆</b> Binance</button><button className={exchange === 'bitget' ? 'active' : ''} onClick={() => setExchange('bitget')}><b className="bitget-dot">⇄</b> Bitget {(bitgetConnected || remoteConnected) && <i className="account-dot"/>}</button></div>
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
        <div className="history-toolbar"><div><CalendarDays size={17}/><span>{remoteConnected ? 'Synced from desktop' : 'Saved locally'}</span><small>Automatic snapshot every 5 minutes while connected</small></div><div><button onClick={remoteConnected ? refresh : loadHistory}><RefreshCw size={14}/> Reload</button><button className="danger" onClick={clearHistory} disabled={remoteConnected}><Trash2 size={14}/> Clear history</button></div></div>
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
      <span className="panel-label">{selected.exchange.toUpperCase()} · {isMetal(selected.symbol) ? 'COMMODITY' : selected.side ? 'LIVE FUTURES' : 'SPOT'}</span><h2>{selected.side ? selected.symbol.replace(/-(LONG|SHORT)$/, '') : selected.base}<small>{isMetal(selected.symbol) ? ` · ${instrumentName(selected.symbol)}` : ''}{selected.side ? ` · ${selected.side}` : isMetal(selected.symbol) ? '' : '/USDT'}</small></h2>
      <strong>{selected.side ? fmtPnl(selected.unrealizedPnl ?? 0) : selected.pnlSource === 'exchange' ? fmtPnl(selected.dailyPnl) : `${selected.change24h >= 0 ? '+' : ''}${selected.change24h.toFixed(2)}%`}</strong>
      <em className={selected.side ? (selected.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative' : selected.pnlSource === 'exchange' ? selected.dailyPnl >= 0 ? 'positive' : 'negative' : selected.change24h >= 0 ? 'positive' : 'negative'}>{selected.side ? `Live exchange unrealized · ${(selected.roi ?? selected.change24h).toFixed(2)}% ROI` : selected.pnlSource === 'exchange' ? 'Actual exchange net P&L' : 'Live 24h market change · P&L N/A'}</em>
      <div className="panel-chart"><Sparkline positive={selected.side ? (selected.unrealizedPnl ?? 0) >= 0 : selected.dailyPnl >= 0}/></div>
      <dl><div><dt>Position value</dt><dd>${fmtCompact(selected.positionValue)}</dd></div><div><dt>{selected.side ? 'Mark price' : 'Current price'}</dt><dd>{fmtPrice(selected.markPrice ?? selected.price)}</dd></div>{selected.side && <><div><dt>Entry price</dt><dd>{fmtPrice(selected.entryPrice)}</dd></div><div><dt>Quantity</dt><dd>{quantity(selected).toLocaleString(undefined, { maximumFractionDigits: 6 })}</dd></div><div><dt>Margin / leverage</dt><dd>{selected.margin?.toFixed(2) ?? '—'} USDT · {selected.leverage ? `${selected.leverage}×` : '—'}</dd></div><div><dt>Liquidation</dt><dd>{fmtPrice(selected.liquidationPrice ?? undefined)}</dd></div></>}{selected.pnlSource === 'exchange' && <><div><dt>Unrealized P&amp;L</dt><dd className={(selected.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtPnl(selected.unrealizedPnl ?? 0)}</dd></div><div><dt>UTC realized P&amp;L</dt><dd className={selected.realizedPnl == null ? 'muted' : selected.realizedPnl >= 0 ? 'positive' : 'negative'}>{selected.realizedPnl == null ? 'N/A' : fmtPnl(selected.realizedPnl)}</dd></div></>}<div><dt>Last confirmed</dt><dd>{updatedAt?.toLocaleTimeString() ?? '—'}</dd></div></dl>
      <button className="primary-action" onClick={refresh}><RefreshCw size={16}/> Refresh account now</button>
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

    {remoteOpen && <RemoteSyncModal onClose={() => setRemoteOpen(false)} onRemoteConnected={applyRemotePayload}/>}
    {backupOpen && <BackupModal onClose={() => setBackupOpen(false)} onImported={loadHistory}/>}

    <footer><span><CircleHelp size={14}/> Encrypted .tradingjournal import/export · no API credentials included</span><span><Settings2 size={14}/> v0.3.2</span></footer>
  </div>;
}
