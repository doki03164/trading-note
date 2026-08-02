import type { Exchange, MarketCoin } from '../types';

const seed = [
  ['BTC', 67420.42, 2.84, 1820000000], ['ETH', 3478.18, 4.12, 1120000000],
  ['SOL', 187.21, 7.45, 642000000], ['BNB', 593.84, -0.72, 394000000],
  ['XRP', 0.5284, -2.91, 318000000], ['DOGE', 0.1421, 1.42, 244000000],
  ['ADA', 0.4528, -1.66, 189000000], ['AVAX', 38.76, 5.16, 177000000],
  ['LINK', 16.42, 3.28, 146000000], ['DOT', 7.18, -3.54, 126000000],
  ['MATIC', 0.722, -1.08, 118000000], ['TON', 6.92, 8.31, 112000000],
  ['SHIB', 0.0000241, 0.82, 97000000], ['LTC', 84.63, -0.44, 85000000],
  ['UNI', 10.42, 6.08, 79000000], ['ATOM', 8.76, -4.48, 71000000],
  ['NEAR', 6.18, 2.18, 65000000], ['APT', 9.21, -2.12, 59000000],
  ['ARB', 1.04, -5.23, 54000000], ['OP', 2.41, 4.74, 51000000]
] as const;

export function mockMarkets(exchange: Exchange): MarketCoin[] {
  return seed.map(([base, price, change24h, quoteVolume], index) => ({
    symbol: `${base}USDT`, base, exchange,
    price: price * (exchange === 'bitget' ? 1 + ((index % 4) - 1.5) * 0.00015 : 1),
    change24h: change24h + (exchange === 'bitget' ? ((index % 3) - 1) * 0.12 : 0),
    quoteVolume: quoteVolume * (exchange === 'bitget' ? 0.42 : 1),
    high24h: price * 1.04,
    low24h: price * 0.96,
    positionValue: [32400, 21850, 14720, 10200, 8900, 7450, 6800, 5700, 4900, 4300, 3900, 3500, 3150, 2800, 2500, 2200, 1900, 1650, 1400, 1200][index],
    dailyPnl: [32400, 21850, 14720, 10200, 8900, 7450, 6800, 5700, 4900, 4300, 3900, 3500, 3150, 2800, 2500, 2200, 1900, 1650, 1400, 1200][index] * (change24h / 100)
  }));
}
