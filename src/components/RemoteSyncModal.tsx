import { useEffect, useState } from 'react';
import { Check, Clipboard, CloudCog, Link2, Play, Radio, Server, Square, X } from 'lucide-react';
import { connectRemoteHub, getSyncGatewayStatus, isTauriDesktop, startSyncGateway, stopSyncGateway, type RemoteSyncEnvelope, type SyncGatewayStatus } from '../services/remoteSync';

interface Props {
  onClose(): void;
  onRemoteConnected(payload: RemoteSyncEnvelope): void;
}

export function RemoteSyncModal({ onClose, onRemoteConnected }: Props) {
  const desktop = isTauriDesktop();
  const [gateway, setGateway] = useState<SyncGatewayStatus | null>(null);
  const [port, setPort] = useState(45831);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (desktop) getSyncGatewayStatus().then(setGateway).catch(error => setError(String(error)));
  }, [desktop]);

  async function start() {
    setBusy(true); setError('');
    try { setGateway(await startSyncGateway(port)); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true); setError('');
    try { await stopSyncGateway(); setGateway(null); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const payload = await connectRemoteHub(url, token, remember); onRemoteConnected(payload); onClose(); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }

  async function copy(value: string, name: string) {
    await navigator.clipboard.writeText(value); setCopied(name); window.setTimeout(() => setCopied(''), 1_500);
  }

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="sync-modal">
      <button type="button" className="close" onClick={onClose}><X size={18}/></button>
      <div className="modal-icon"><CloudCog size={20}/></div>
      <span className="panel-label">PC / MAC DATA HUB</span>
      <h2>{desktop ? '桌面同步閘道' : '連接桌面資料'}</h2>
      <p>{desktop ? '啟動本機唯讀資料閘道，再用 HTTPS tunnel 讓 Web App 安全讀取持倉和歷史。Bitget Secret 不會離開桌面程式。' : '輸入桌面程式顯示的 HTTPS tunnel 網址與配對 Token。Web App 將每 2 秒同步最新持倉。'}</p>

      {desktop ? <>
        {!gateway ? <div className="gateway-start">
          <label>Local gateway port<input type="number" min="1024" max="65535" value={port} onChange={event => setPort(Number(event.target.value))}/></label>
          <button disabled={busy} onClick={start}><Play size={15}/> {busy ? 'Starting…' : 'Start data hub'}</button>
        </div> : <div className="gateway-running">
          <div className="gateway-status"><Radio size={15}/><span><strong>Data hub running</strong><small>{gateway.localUrl}</small></span><i/></div>
          <label>Pairing token<div className="copy-field"><code>{gateway.pairingToken}</code><button onClick={() => copy(gateway.pairingToken, 'token')}>{copied === 'token' ? <Check/> : <Clipboard/>}</button></div></label>
          <label>Cloudflare Quick Tunnel<div className="copy-field command"><code>{gateway.tunnelCommand}</code><button onClick={() => copy(gateway.tunnelCommand, 'command')}>{copied === 'command' ? <Check/> : <Clipboard/>}</button></div></label>
          <div className="gateway-steps"><span><b>1</b> 安裝 cloudflared</span><span><b>2</b> 在 Terminal 執行上方命令</span><span><b>3</b> 將顯示的 https:// 網址與 Token 輸入 Web App</span></div>
          <button className="stop-gateway" disabled={busy} onClick={stop}><Square size={13}/> Stop data hub</button>
        </div>}
      </> : <form className="remote-connect-form" onSubmit={connect}>
        <label>HTTPS tunnel URL<div className="sync-input"><Link2 size={15}/><input type="url" inputMode="url" autoCapitalize="none" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://random-name.trycloudflare.com" required/></div></label>
        <label>Pairing token<div className="sync-input"><Server size={15}/><input type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="Paste desktop pairing token" required/></div></label>
        <label className="remember-sync"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/><span>Remember this read-only connection on this device</span></label>
        <button className="connect-submit" disabled={busy}>{busy ? 'Connecting…' : <><Radio size={15}/> Connect desktop data</>}</button>
      </form>}
      {error && <div className="sync-error">{error}</div>}
      <div className="sync-security"><Server size={15}/><span>閘道只提供持倉、餘額與歷史的唯讀 JSON；必須持有 48 位配對 Token 才能存取。</span></div>
    </section>
  </div>;
}
