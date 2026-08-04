import { useEffect, useMemo, useState } from 'react';
import { Apple, ArrowRight, Check, Download, ExternalLink, Globe2, Laptop, MonitorDown, Radio, ShieldCheck, Smartphone } from 'lucide-react';
import './install.css';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const releaseBase = 'https://github.com/doki03164/trading-note/releases/latest/download';
const releasePage = 'https://github.com/doki03164/trading-note/releases/latest';

export function InstallPortal() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent>();
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches);
  const isIos = useMemo(() => /iPhone|iPad|iPod/i.test(navigator.userAgent), []);
  const isAndroid = useMemo(() => /Android/i.test(navigator.userAgent), []);
  const profileUrl = `${import.meta.env.BASE_URL}Trading-Journal.mobileconfig`;

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installedHandler = () => { setInstalled(true); setInstallPrompt(undefined); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  async function installWebApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === 'accepted') setInstalled(true);
      setInstallPrompt(undefined);
      return;
    }
    document.getElementById('manual-install')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return <main className="install-page">
    <div className="install-glow install-glow-one" />
    <div className="install-glow install-glow-two" />

    <nav className="install-nav">
      <a className="install-brand" href={import.meta.env.BASE_URL}>
        <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="Trading Journal" />
        <span><strong>Trading Journal</strong><small>Web 安裝中心</small></span>
      </a>
      <a className="release-link" href={releasePage} target="_blank" rel="noreferrer">所有版本 <ExternalLink size={15} /></a>
    </nav>

    <section className="install-hero">
      <div className="install-kicker"><span className="live-dot" /> Web App 已就緒</div>
      <h1>任何裝置，<br /><span>打開就是交易日誌。</span></h1>
      <p>免 App Store，直接使用完整 Web Dashboard。也可以加入 iPhone、iPad 或 Android 主畫面，並透過加密配對連接 PC／Mac 的即時持倉資料。</p>
      <div className="install-actions">
        <a className="install-primary" href={import.meta.env.BASE_URL}>開啟 Web App <ArrowRight size={18} /></a>
        <button className="install-secondary" onClick={installWebApp} disabled={installed}>
          {installed ? <><Check size={18} /> 已加入主畫面</> : <><MonitorDown size={18} /> 安裝 Web App</>}
        </button>
      </div>
      <div className="install-trust"><ShieldCheck size={17} /><span>資料保存在目前裝置；API 失敗時不顯示模擬持倉</span></div>
    </section>

    <section className="install-preview" aria-label="Web dashboard preview">
      <div className="browser-frame">
        <div className="browser-bar"><i /><i /><i /><span>doki03164.github.io/trading-note</span></div>
        <div className="preview-content">
          <div className="preview-sidebar"><img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="" /><b>Trading Journal</b>{['Dashboard', 'Trade Log', 'Reports', 'Trading Notes'].map(item => <span key={item}>{item}</span>)}</div>
          <div className="preview-main">
            <div className="preview-heading"><div><small>OPEN CONTRACT P&amp;L</small><strong>+$128.42</strong></div><em>LIVE · 2s</em></div>
            <div className="preview-stats"><span><small>Positions</small><b>3</b></span><span><small>Margin used</small><b>$1,840</b></span><span><small>Win rate</small><b>68.4%</b></span></div>
            <div className="preview-chart">{Array.from({ length: 30 }, (_, index) => <i key={index} style={{ height: `${22 + ((index * 17) % 64)}%` }} />)}</div>
          </div>
        </div>
      </div>
    </section>

    <section className="install-sync-callout">
      <div><Radio size={22}/><span><small>PC / MAC DATA SYNC</small><strong>API Secret 留在桌面，Web 版只讀取即時結果</strong><p>桌面同步閘道 + HTTPS Tunnel + 48 位配對 Token，每 2 秒同步持倉、合約收益、餘額與過往盈虧。</p></span></div>
      <a href={`${import.meta.env.BASE_URL}?sync=1`}>連接桌面資料 <ArrowRight size={16}/></a>
    </section>

    <section className="install-options">
      <header><span>選擇安裝方式</span><h2>Web、描述檔或原生 App</h2><p>Web 版適合快速使用；描述檔會在 iOS 主畫面建立 Web App；IPA 適合自行簽名安裝。</p></header>
      <div className="install-grid">
        <article className="install-card recommended">
          <div className="recommended-label">推薦</div><Globe2 size={26} />
          <h3>Web App</h3><p>永遠使用最新版本，不需要下載更新。</p>
          <button onClick={installWebApp}>{installed ? '已安裝' : '加入主畫面'} <ArrowRight size={16} /></button>
        </article>
        <article className={`install-card ${isIos ? 'detected' : ''}`}>
          <Apple size={26} /><h3>iOS 描述檔</h3><p>建立 Trading Journal 主畫面捷徑，直接開啟 Web Dashboard。</p>
          <a href={profileUrl}>下載 .mobileconfig <Download size={16} /></a>
        </article>
        <article className="install-card">
          <Smartphone size={26} /><h3>iOS 原生 IPA</h3><p>arm64 原生包，需要 Apple Developer、AltStore 或 Sideloadly 簽名。</p>
          <a href={`${releaseBase}/Trading-Journal-iOS-unsigned.ipa`}>下載 IPA <Download size={16} /></a>
        </article>
        <article className={`install-card ${isAndroid ? 'detected' : ''}`}>
          <Smartphone size={26} /><h3>Android APK</h3><p>下載後允許瀏覽器安裝未知來源 App。</p>
          <a href={`${releaseBase}/Trading-Journal-Android-debug.apk`}>下載 APK <Download size={16} /></a>
        </article>
        <article className="install-card wide">
          <Laptop size={26} /><div><h3>Windows 與 macOS</h3><p>前往 GitHub Release 下載 EXE、MSI 或 Universal DMG。</p></div>
          <a href={releasePage}>桌面版本 <ExternalLink size={16} /></a>
        </article>
      </div>
    </section>

    <section className="manual-install" id="manual-install">
      <header><span>加入主畫面</span><h2>{isIos ? 'iPhone / iPad 安裝步驟' : isAndroid ? 'Android 安裝步驟' : '手機安裝步驟'}</h2></header>
      <ol>
        <li><b>1</b><div><strong>用手機瀏覽器開啟本頁</strong><span>iOS 請使用 Safari；Android 建議使用 Chrome。</span></div></li>
        <li><b>2</b><div><strong>{isIos ? '點擊 Safari 的分享按鈕' : '開啟瀏覽器選單'}</strong><span>{isIos ? '向下滑動並選擇「加入主畫面」。' : '選擇「安裝應用程式」或「加入主畫面」。'}</span></div></li>
        <li><b>3</b><div><strong>確認 Trading Journal</strong><span>完成後從主畫面啟動，即可用全螢幕 Web App。</span></div></li>
      </ol>
    </section>

    <footer className="install-footer"><span>Trading Journal v0.4.0</span><span>Web · Windows · macOS · iOS · Android</span></footer>
  </main>;
}
