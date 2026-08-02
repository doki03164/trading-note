import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export function Sparkline({ positive = true }: { positive?: boolean }) {
  const values = positive ? [32, 30, 36, 35, 42, 40, 46, 44, 51, 55, 53, 62] : [63, 59, 61, 52, 55, 48, 51, 43, 45, 38, 40, 34];
  const data = values.map((value, i) => ({ i, value }));
  const stroke = positive ? '#52e69b' : '#ff6b78';
  return <ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id={`g${positive}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={stroke} stopOpacity={0.32}/><stop offset="1" stopColor={stroke} stopOpacity={0}/></linearGradient></defs><Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={2} fill={`url(#g${positive})`} /></AreaChart></ResponsiveContainer>;
}
