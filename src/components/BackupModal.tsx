import { useRef, useState } from 'react';
import { Archive, CheckCircle2, Download, FileKey2, FolderOpen, Import, KeyRound, LockKeyhole, ShieldCheck, Upload, X } from 'lucide-react';
import { createJournalBackup, importJournalBackup, JOURNAL_BACKUP_EXTENSION, saveJournalBackupFile, type BackupSummary, type ImportMode } from '../services/journalBackup';

interface Props { onClose(): void; onImported(): void }

function Summary({ value }: { value: BackupSummary }) {
  return <div className="backup-summary"><span><b>{value.trades}</b> Trades</span><span><b>{value.playbooks}</b> Playbooks</span><span><b>{value.tradingNotes}</b> Notes</span><span><b>{value.profitHistory}</b> P&amp;L records</span></div>;
}

export function BackupModal({ onClose, onImported }: Props) {
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [file, setFile] = useState<File>();
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [summary, setSummary] = useState<BackupSummary>();
  const fileInput = useRef<HTMLInputElement>(null);

  function switchTab(value: 'export' | 'import') {
    setTab(value); setPassword(''); setConfirmPassword(''); setError(''); setSuccess(''); setSummary(undefined);
  }

  async function exportBackup(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSuccess(''); setSummary(undefined);
    if (password !== confirmPassword) { setError('Backup passwords do not match'); return; }
    setBusy(true);
    try {
      const result = await createJournalBackup(password);
      await saveJournalBackupFile(result.file);
      setSummary(result.summary); setSuccess(`${result.file.name} created successfully.`);
      setPassword(''); setConfirmPassword('');
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function importBackup(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSuccess(''); setSummary(undefined);
    if (!file) { setError(`Choose a ${JOURNAL_BACKUP_EXTENSION} file`); return; }
    setBusy(true);
    try {
      const result = await importJournalBackup(file, password, mode);
      setSummary(result); setSuccess(`${file.name} imported in ${mode} mode.`); setPassword(''); onImported();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className="backup-modal">
      <button type="button" className="close" onClick={onClose} disabled={busy}><X size={18}/></button>
      <div className="modal-icon"><Archive size={20}/></div>
      <span className="panel-label">PRIVATE JOURNAL ARCHIVE</span>
      <h2>匯入與匯出資料</h2>
      <p>專用 <code>{JOURNAL_BACKUP_EXTENSION}</code> 加密檔案可在 Trading Journal 的 Windows、macOS、Web、iOS 和 Android 版本之間移動資料。</p>

      <div className="backup-tabs">
        <button className={tab === 'export' ? 'active' : ''} onClick={() => switchTab('export')}><Download size={15}/> Export</button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => switchTab('import')}><Upload size={15}/> Import</button>
      </div>

      {tab === 'export' ? <form className="backup-form" onSubmit={exportBackup}>
        <div className="backup-file-visual"><FileKey2 size={26}/><div><strong>Trading-Journal-日期{JOURNAL_BACKUP_EXTENSION}</strong><span>AES-256-GCM encrypted archive</span></div></div>
        <label>Backup password<div className="backup-input"><KeyRound size={15}/><input type="password" minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Minimum 8 characters" required/></div></label>
        <label>Confirm password<div className="backup-input"><LockKeyhole size={15}/><input type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter the same password again" required/></div></label>
        <div className="backup-includes"><span>Included</span><ul><li>Trade Log</li><li>Strategy Playbooks</li><li>Trading Notes + chart images</li><li>Profit heatmap history</li></ul></div>
        <div className="backup-excludes"><ShieldCheck size={15}/><span>Bitget API Key、Secret、Passphrase、登入密碼與 Cloud session 永遠不會寫入備份。</span></div>
        <button className="backup-submit" disabled={busy}>{busy ? 'Encrypting…' : <><Download size={15}/> Create encrypted backup</>}</button>
      </form> : <form className="backup-form" onSubmit={importBackup}>
        <input ref={fileInput} className="backup-hidden-file" type="file" accept={`${JOURNAL_BACKUP_EXTENSION},application/vnd.trading-journal.backup`} onChange={event => { setFile(event.target.files?.[0]); setError(''); setSuccess(''); }}/>
        <button className={`backup-drop ${file ? 'selected' : ''}`} type="button" onClick={() => fileInput.current?.click()}><FolderOpen size={25}/><span><strong>{file?.name ?? `Choose ${JOURNAL_BACKUP_EXTENSION} file`}</strong><small>{file ? `${(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB` : 'Files from other apps are rejected'}</small></span></button>
        <label>Backup password<div className="backup-input"><KeyRound size={15}/><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password used during export" required/></div></label>
        <fieldset className="import-mode"><legend>Import mode</legend>
          <label className={mode === 'merge' ? 'active' : ''}><input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')}/><span><strong>Merge</strong><small>Keep existing data; matching IDs use the imported copy.</small></span></label>
          <label className={mode === 'replace' ? 'active danger' : ''}><input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')}/><span><strong>Replace</strong><small>Delete current journal data and restore this backup.</small></span></label>
        </fieldset>
        <div className="backup-excludes"><ShieldCheck size={15}/><span>檔案格式、密碼、AES-GCM 驗證及每筆資料都會在寫入前檢查。</span></div>
        <button className="backup-submit" disabled={busy || !file}>{busy ? 'Decrypting…' : <><Import size={15}/> Import journal data</>}</button>
      </form>}

      {error && <div className="backup-message error">{error}</div>}
      {success && <div className="backup-message success"><CheckCircle2 size={15}/><span>{success}</span></div>}
      {summary && <Summary value={summary}/>}
    </section>
  </div>;
}
