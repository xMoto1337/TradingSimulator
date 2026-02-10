// Market Data Types
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Trade {
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
}

export interface Ticker {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  marketStatus?: 'pre' | 'regular' | 'post' | 'closed'; // Stock market status
}

// Order Types
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'take_profit' | 'trailing_stop';
export type OrderStatus = 'pending' | 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  trailingAmount?: number;
  trailingPercent?: number;
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BracketOrder {
  entryOrder: Order;
  stopLoss: Order;
  takeProfit: Order;
}

export interface OCOOrder {
  stopLoss: Order;
  takeProfit: Order;
}

// Position Types
export interface Position {
  symbol: string;
  side: OrderSide;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
}

// Portfolio Types
export interface Portfolio {
  balance: number;
  equity: number;
  buyingPower: number;
  positions: Position[];
  dailyPnL: number;
  totalPnL: number;
}

// Trade History
export interface TradeRecord {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  pnl: number;
  timestamp: number;
}

// Timeframe (1s not supported by Binance.US)
export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
  '1M': '1M',
};

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

// Symbol Info
export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  minQuantity: number;
  minNotional: number;
  market: 'crypto' | 'stock';
}

// Watchlist
export interface WatchlistItem {
  symbol: string;
  market: 'crypto' | 'stock';
  name?: string;
}

export interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
}
