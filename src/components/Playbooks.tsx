import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { deletePlaybook, listPlaybooks, listTrades, savePlaybook, tradePnl } from '../services/journalData';

export function Playbooks() {
  const [playbooks, setPlaybooks] = useState(listPlaybooks); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [rules, setRules] = useState('');
  useEffect(() => {
    const reload = () => setPlaybooks(listPlaybooks());
    window.addEventListener('trading-journal:data-imported', reload);
    return () => window.removeEventListener('trading-journal:data-imported', reload);
  }, []);
  function submit(event: React.FormEvent) { event.preventDefault(); savePlaybook({ id: crypto.randomUUID(), name: name.trim(), description: description.trim(), rules: rules.split('\n').map(rule => rule.trim()).filter(Boolean), createdAt: Date.now() }); setPlaybooks(listPlaybooks()); setName(''); setDescription(''); setRules(''); }
  const trades = listTrades();
  return <section className="clone-page playbook-layout"><form className="playbook-form" onSubmit={submit}><BookOpen size={22}/><h3>Create a strategy playbook</h3><p>Define the setup and checklist you expect to follow on every trade.</p><label>Name<input required value={name} onChange={e => setName(e.target.value)} placeholder="Opening range breakout"/></label><label>Description<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Market context and setup definition"/></label><label>Rules — one per line<textarea rows={7} value={rules} onChange={e => setRules(e.target.value)} placeholder={'Trend aligned\nVolume confirmation\nRisk ≤ 1%\nStop entered before execution'}/></label><button className="clone-primary"><Plus size={14}/> Save playbook</button></form><div className="playbook-list">{playbooks.map(playbook => { const linked = trades.filter(trade => trade.strategy.toLowerCase() === playbook.name.toLowerCase()); const pnl = linked.reduce((sum, trade) => sum + tradePnl(trade), 0); return <article key={playbook.id}><div className="playbook-card-head"><div><span>STRATEGY</span><h3>{playbook.name}</h3></div><button onClick={() => { if (confirm('Delete this playbook?')) { deletePlaybook(playbook.id); setPlaybooks(listPlaybooks()); } }}><Trash2 size={14}/></button></div><p>{playbook.description || 'No description yet.'}</p><ul>{playbook.rules.map(rule => <li key={rule}>{rule}</li>)}</ul><footer><span>{linked.length} linked trades</span><strong className={pnl >= 0 ? 'positive' : 'negative'}>{pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}</strong></footer></article>})}{!playbooks.length && <div className="clone-empty">Your strategy library is ready for its first playbook.</div>}</div></section>;
}
