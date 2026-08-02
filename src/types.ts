export type Exchange = 'binance' | 'bitget';
export type PnlSource = 'exchange' | 'market-change' | 'not-applicable';

export interface MarketCoin {
  symbol: string;
  base: string;
  exchange: Exchange;
  price: number;
  change24h: number;
  quoteVolume: number;
  high24h?: number;
  low24h?: number;
  positionValue: number;
  dailyPnl: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  pnlSource?: PnlSource;
}

export interface FuturesBalance {
  marginCoin: string;
  available: number;
  locked: number;
  accountEquity: number;
  unrealizedPnl: number;
  realizedPnl?: number | null;
  maxTransferOut: number;
}

export interface PortfolioResponse {
  positions: MarketCoin[];
  futuresBalance?: FuturesBalance | null;
}

export interface ProfitHistoryEntry {
  timestamp: number;
  totalPnl: number;
  unrealizedPnl?: number;
  realizedPnl?: number | null;
  portfolioValue: number;
  positions: MarketCoin[];
}

export type TimeRange = '1H' | '4H' | '1D' | '1W';
export type SizeMetric = 'position' | 'profit';

export type TradeDirection = 'LONG' | 'SHORT' | 'OBSERVATION';
export type TradeMarket = 'USDT Futures' | 'Spot';

export interface TradingNote {
  id: string;
  createdAt: number;
  tradeDate: string;
  title: string;
  symbol: string;
  market: TradeMarket;
  direction: TradeDirection;
  setup: string;
  notes: string;
  screenshot: string;
  screenshotName: string;
}

export type TradeSide = 'LONG' | 'SHORT';

export interface JournalTrade {
  id: string;
  openedAt: string;
  closedAt: string;
  symbol: string;
  side: TradeSide;
  strategy: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  stopLoss: number;
  fees: number;
  notes: string;
  tags: string[];
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  rules: string[];
  createdAt: number;
}
