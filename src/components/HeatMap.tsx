import type { MarketCoin, SizeMetric } from '../types';

interface Props { data: MarketCoin[]; sizeMetric: SizeMetric; selected?: MarketCoin; onSelect: (coin: MarketCoin) => void; valueMode?: 'pnl' | 'change' }

function color(pnl: number, position: number) {
  const strength = Math.min(Math.abs(pnl) / Math.max(position * 0.08, 1), 1);
  return pnl >= 0
    ? `hsl(${153 - strength * 7} 72% ${23 + strength * 10}%)`
    : `hsl(${355 + strength * 3} 65% ${24 + strength * 8}%)`;
}

function fmtPrice(price: number) {
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${price.toPrecision(3)}`;
}

export function HeatMap({ data, sizeMetric, selected, onSelect, valueMode = 'pnl' }: Props) {
  const max = Math.max(...data.map(d => sizeMetric === 'position' ? d.positionValue : Math.abs(d.dailyPnl)), 1);
  return (
    <div className="heat-grid" aria-label="Market heat map">
      {data.slice(0, 24).map((coin, index) => {
        const metric = sizeMetric === 'position' ? coin.positionValue : Math.abs(coin.dailyPnl);
        const weight = 0.78 + (metric / max) * 1.8;
        return (
          <button
            key={coin.symbol}
            className={`heat-tile tile-${Math.min(index, 11)} ${selected?.symbol === coin.symbol ? 'selected' : ''}`}
            style={{ background: color(coin.dailyPnl, coin.positionValue), flexGrow: weight }}
            onClick={() => onSelect(coin)}
          >
            <span className="coin-symbol">{coin.base}</span>
            <span className="coin-price">{fmtPrice(coin.price)}</span>
            <span className={`coin-pnl ${coin.dailyPnl >= 0 ? 'up' : 'down'}`}>{coin.dailyPnl >= 0 ? '+' : '−'}{valueMode === 'pnl' ? '$' : ''}{Math.abs(coin.dailyPnl).toLocaleString(undefined, { maximumFractionDigits: valueMode === 'pnl' ? 0 : 2 })}{valueMode === 'change' ? '%' : ''}</span>
            <span className="coin-change">{coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(2)}%</span>
          </button>
        );
      })}
    </div>
  );
}
