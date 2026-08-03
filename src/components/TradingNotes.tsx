import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Camera, Clock3, FileImage, Plus, Save, Search, Trash2, X } from 'lucide-react';
import type { TradeDirection, TradeMarket, TradingNote } from '../types';
import { createTradingNote, deleteTradingNote, imageFileToDataUrl, loadTradingNotes, saveTradingNote } from '../services/tradingNotes';

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TradingNotes() {
  const [notes, setNotes] = useState<TradingNote[]>([]);
  const [selected, setSelected] = useState<TradingNote>();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tradeDate, setTradeDate] = useState(localDateTime);
  const [market, setMarket] = useState<TradeMarket>('USDT Futures');
  const [direction, setDirection] = useState<TradeDirection>('LONG');
  const [setup, setSetup] = useState('');
  const [body, setBody] = useState('');
  const [screenshot, setScreenshot] = useState('');
  const [screenshotName, setScreenshotName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function reload() {
    try { setNotes(await loadTradingNotes()); setError(''); }
    catch (reason) { setError(String(reason)); }
  }

  useEffect(() => {
    reload();
    const imported = () => { reload(); setSelected(undefined); };
    window.addEventListener('trading-journal:data-imported', imported);
    return () => window.removeEventListener('trading-journal:data-imported', imported);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter(note => [note.title, note.symbol, note.setup, note.notes].some(value => value.toLowerCase().includes(needle)));
  }, [notes, query]);

  function resetForm() {
    setTitle(''); setSymbol(''); setTradeDate(localDateTime()); setMarket('USDT Futures'); setDirection('LONG');
    setSetup(''); setBody(''); setScreenshot(''); setScreenshotName(''); setError('');
  }

  async function chooseScreenshot(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file for the chart screenshot.'); return; }
    if (file.size > 15 * 1024 * 1024) { setError('Screenshot must be 15 MB or smaller.'); return; }
    try { setScreenshot(await imageFileToDataUrl(file)); setScreenshotName(file.name); setError(''); }
    catch (reason) { setError(String(reason)); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!screenshot) { setError('Upload a chart screenshot before saving.'); return; }
    setSaving(true); setError('');
    try {
      const note = createTradingNote({ tradeDate, title, symbol, market, direction, setup, notes: body, screenshot, screenshotName });
      await saveTradingNote(note);
      await reload();
      resetForm(); setEditing(false); setSelected(note);
    } catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  }

  async function remove(note: TradingNote) {
    if (!window.confirm(`Delete trading note “${note.title}”?`)) return;
    try {
      await deleteTradingNote(note.id);
      if (selected?.id === note.id) setSelected(undefined);
      await reload();
    } catch (reason) { setError(String(reason)); }
  }

  return <section className="notes-workspace">
    <div className="notes-toolbar">
      <div><FileImage size={17}/><span>Saved on this device</span><small>Chart screenshots and review notes</small></div>
      <div className="notes-actions"><label><Search size={14}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes"/></label><button onClick={() => { resetForm(); setEditing(true); }}><Plus size={14}/> New trading note</button></div>
    </div>

    {error && !editing && <div className="notes-error">{error}</div>}
    {notes.length ? <div className="notes-layout">
      <div className="notes-history">
        <div className="notes-history-heading"><span>TRADING NOTE HISTORY</span><strong>{filtered.length} saved</strong></div>
        <div className="note-card-grid">
          {filtered.map(note => <article className={`note-card ${selected?.id === note.id ? 'selected' : ''}`} key={note.id}>
            <button className="note-review" onClick={() => setSelected(note)}>
              <img src={note.screenshot} alt={`${note.symbol} chart`}/>
              <div className="note-card-body"><div><span className={`direction ${note.direction.toLowerCase()}`}>{note.direction}</span><small>{note.market}</small></div><h3>{note.title}</h3><strong>{note.symbol || 'GENERAL'}</strong><p>{note.notes || note.setup || 'Chart review saved.'}</p><time><Clock3 size={11}/>{new Date(note.tradeDate).toLocaleString()}</time></div>
            </button>
            <button className="note-delete" aria-label={`Delete ${note.title}`} onClick={() => remove(note)}><Trash2 size={13}/></button>
          </article>)}
          {!filtered.length && <div className="notes-no-match">No trading notes match your search.</div>}
        </div>
      </div>

      <aside className="note-review-panel">
        {selected ? <>
          <div className="review-heading"><div><span>PAST TRADING NOTE</span><h2>{selected.title}</h2></div><button onClick={() => setSelected(undefined)}><X size={16}/></button></div>
          <img className="review-chart" src={selected.screenshot} alt={`${selected.symbol} saved chart screenshot`}/>
          <div className="review-tags"><span className={`direction ${selected.direction.toLowerCase()}`}>{selected.direction}</span><span>{selected.market}</span><strong>{selected.symbol || 'GENERAL'}</strong></div>
          <dl className="review-details"><div><dt><CalendarDays size={12}/> Trade date</dt><dd>{new Date(selected.tradeDate).toLocaleString()}</dd></div><div><dt>Setup</dt><dd>{selected.setup || '—'}</dd></div></dl>
          <div className="review-notes"><span>REVIEW NOTES</span><p>{selected.notes || 'No written review for this chart.'}</p></div>
        </> : <div className="review-placeholder"><Camera size={30}/><h3>Select a trading note</h3><p>Open a past screenshot and review your trade plan.</p></div>}
      </aside>
    </div> : <div className="notes-empty"><Camera size={32}/><h3>No trading notes yet</h3><p>Upload your first chart screenshot and save the trade for later review.</p><button onClick={() => setEditing(true)}><Plus size={14}/> Create trading note</button></div>}

    {editing && <div className="note-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setEditing(false)}>
      <form className="note-form" onSubmit={submit}>
        <button type="button" className="close" onClick={() => setEditing(false)}><X size={18}/></button>
        <div className="note-form-heading"><div className="modal-icon"><Camera size={20}/></div><div><span>NEW TRADING NOTE</span><h2>Save chart for review</h2></div></div>
        <div className="note-form-grid">
          <div className="screenshot-field">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => chooseScreenshot(event.target.files?.[0])}/>
            {screenshot ? <div className="screenshot-preview"><img src={screenshot} alt="Chart upload preview"/><button type="button" onClick={() => fileInput.current?.click()}><Camera size={14}/> Replace</button></div> : <button type="button" className="screenshot-drop" onClick={() => fileInput.current?.click()}><FileImage size={28}/><strong>Upload chart screenshot</strong><span>PNG, JPG, WEBP or GIF · max 15 MB</span></button>}
          </div>
          <div className="note-fields">
            <label>Note title<input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. BTC breakout review" required/></label>
            <div className="field-pair"><label>Symbol<input value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="BTCUSDT"/></label><label>Trade date<input type="datetime-local" value={tradeDate} onChange={event => setTradeDate(event.target.value)} required/></label></div>
            <div className="field-pair"><label>Market<select value={market} onChange={event => setMarket(event.target.value as TradeMarket)}><option>USDT Futures</option><option>Spot</option></select></label><label>Direction<select value={direction} onChange={event => setDirection(event.target.value as TradeDirection)}><option>LONG</option><option>SHORT</option><option>OBSERVATION</option></select></label></div>
            <label>Setup / strategy<input value={setup} onChange={event => setSetup(event.target.value)} placeholder="Breakout, pullback, reversal…"/></label>
            <label>Review notes<textarea value={body} onChange={event => setBody(event.target.value)} placeholder="Why did you enter? What worked? What should change next time?" rows={5}/></label>
          </div>
        </div>
        {error && <div className="api-error">{error}</div>}
        <div className="note-form-footer"><small>Saved privately in Trading Journal on this device.</small><button disabled={saving}><Save size={14}/>{saving ? 'Saving…' : 'Save trading note'}</button></div>
      </form>
    </div>}
  </section>;
}
