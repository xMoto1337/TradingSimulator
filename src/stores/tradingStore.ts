import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Candle,
  Order,
  Position,
  Portfolio,
  Timeframe,
  Ticker,
  TradeRecord,
  Watchlist
} from '../types/trading';

interface TradingState {
  // Market Data
  currentSymbol: string;
  currentTimeframe: Timeframe;
  candles: Candle[];
  currentPrice: number;
  ticker: Ticker | null;

  // Connection
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';

  // Portfolio
  portfolio: Portfolio;

  // Orders
  openOrders: Order[];
  orderHistory: Order[];

  // Trade History
  tradeHistory: TradeRecord[];

  // Watchlists
  watchlists: Watchlist[];

  // UI State
  selectedPanel: 'orders' | 'positions' | 'history';

  // Actions
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setCandles: (candles: Candle[]) => void;
  addCandle: (candle: Candle) => void;
  updateLastCandle: (candle: Candle) => void;
  setCurrentPrice: (price: number) => void;
  setTicker: (ticker: Ticker) => void;
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;
  updatePortfolio: (portfolio: Partial<Portfolio>) => void;
  addOrder: (order: Order) => void;
  updateOrder: (orderId: string, updates: Partial<Order>) => void;
  cancelOrder: (orderId: string) => void;
  addPosition: (position: Position) => void;
  updatePosition: (symbol: string, updates: Partial<Position>) => void;
  closePosition: (symbol: string) => void;
  executeMarketOrder: (side: 'buy' | 'sell', qty: number, price: number) => void;
  setBalance: (balance: number) => void;
  addTradeRecord: (trade: TradeRecord) => void;
  setSelectedPanel: (panel: 'orders' | 'positions' | 'history') => void;
  addCustomSymbol: (symbol: string, name: string, market: 'crypto' | 'stock') => void;
  removeCustomSymbol: (symbol: string) => void;
}

const INITIAL_BALANCE = 100000;

function recalcPortfolio(balance: number, positions: Position[]): Pick<Portfolio, 'equity' | 'buyingPower'> {
  // Balance already has position costs subtracted, so add back market value
  const positionMarketValue = positions.reduce((sum, pos) => {
    return sum + pos.currentPrice * pos.quantity;
  }, 0);
  const equity = balance + positionMarketValue;
  return { equity, buyingPower: balance };
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set, get) => ({
  // Initial Market Data
  currentSymbol: 'BTCUSDT',
  currentTimeframe: '1m',
  candles: [],
  currentPrice: 0,
  ticker: null,

  // Connection
  isConnected: false,
  connectionStatus: 'disconnected',

  // Portfolio
  portfolio: {
    balance: INITIAL_BALANCE,
    equity: INITIAL_BALANCE,
    buyingPower: INITIAL_BALANCE,
    positions: [],
    dailyPnL: 0,
    totalPnL: 0,
  },

  // Orders
  openOrders: [],
  orderHistory: [],

  // Trade History
  tradeHistory: [],

  // Watchlists
  watchlists: [
    {
      id: 'default',
      name: 'Favorites',
      items: [
        { symbol: 'BTCUSDT', market: 'crypto' },
        { symbol: 'ETHUSDT', market: 'crypto' },
        { symbol: 'SOLUSDT', market: 'crypto' },
      ],
    },
    {
      id: 'custom',
      name: 'Custom',
      items: [],
    },
  ],

  // UI State
  selectedPanel: 'positions',

  // Actions
  setSymbol: (symbol) => set({ currentSymbol: symbol, candles: [] }),

  setTimeframe: (timeframe) => set({ currentTimeframe: timeframe, candles: [] }),

  setCandles: (candles) => set({ candles }),

  addCandle: (candle) => set((state) => ({
    candles: [...state.candles, candle],
  })),

  updateLastCandle: (candle) => set((state) => {
    const candles = [...state.candles];
    if (candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      if (lastCandle.time === candle.time) {
        candles[candles.length - 1] = candle;
      } else {
        candles.push(candle);
      }
    } else {
      candles.push(candle);
    }
    return { candles };
  }),

  setCurrentPrice: (price) => {
    set({ currentPrice: price });
    // Update unrealized P&L for positions with matching symbol
    const state = get();
    const positions = state.portfolio.positions.map((pos) => {
      if (pos.symbol === state.currentSymbol) {
        const unrealizedPnL = pos.side === 'buy'
          ? (price - pos.avgEntryPrice) * pos.quantity
          : (pos.avgEntryPrice - price) * pos.quantity;
        const unrealizedPnLPercent = (unrealizedPnL / (pos.avgEntryPrice * pos.quantity)) * 100;
        return { ...pos, currentPrice: price, unrealizedPnL, unrealizedPnLPercent };
      }
      return pos;
    });

    const { equity, buyingPower } = recalcPortfolio(state.portfolio.balance, positions);

    set({
      portfolio: {
        ...state.portfolio,
        positions,
        equity,
        buyingPower,
      },
    });
  },

  setTicker: (ticker) => set({ ticker }),

  setConnectionStatus: (status) => set({
    connectionStatus: status,
    isConnected: status === 'connected',
  }),

  updatePortfolio: (portfolio) => set((state) => ({
    portfolio: { ...state.portfolio, ...portfolio },
  })),

  addOrder: (order) => set((state) => ({
    orderHistory: [order, ...state.orderHistory],
  })),

  updateOrder: (orderId, updates) => set((state) => {
    const openOrders = state.openOrders.map((o) =>
      o.id === orderId ? { ...o, ...updates } : o
    );

    const filledOrCancelled = openOrders.filter(
      (o) => o.status === 'filled' || o.status === 'cancelled'
    );
    const stillOpen = openOrders.filter(
      (o) => o.status !== 'filled' && o.status !== 'cancelled'
    );

    return {
      openOrders: stillOpen,
      orderHistory: [...state.orderHistory, ...filledOrCancelled],
    };
  }),

  cancelOrder: (orderId) => set((state) => ({
    openOrders: state.openOrders.map((o) =>
      o.id === orderId ? { ...o, status: 'cancelled' as const } : o
    ),
  })),

  addPosition: (position) => set((state) => ({
    portfolio: {
      ...state.portfolio,
      positions: [...state.portfolio.positions, position],
    },
  })),

  updatePosition: (symbol, updates) => set((state) => ({
    portfolio: {
      ...state.portfolio,
      positions: state.portfolio.positions.map((p) =>
        p.symbol === symbol ? { ...p, ...updates } : p
      ),
    },
  })),

  closePosition: (symbol) => {
    const state = get();
    const position = state.portfolio.positions.find((p) => p.symbol === symbol);
    if (!position) return;

    const price = state.currentPrice;
    const realizedPnL = position.side === 'buy'
      ? (price - position.avgEntryPrice) * position.quantity
      : (position.avgEntryPrice - price) * position.quantity;

    // Return original cost + P&L to balance
    const positionCost = position.avgEntryPrice * position.quantity;
    const newBalance = state.portfolio.balance + positionCost + realizedPnL;
    const newPositions = state.portfolio.positions.filter((p) => p.symbol !== symbol);
    const { equity, buyingPower } = recalcPortfolio(newBalance, newPositions);

    // Create trade record
    const trade: TradeRecord = {
      id: crypto.randomUUID(),
      symbol,
      side: position.side === 'buy' ? 'sell' : 'buy',
      quantity: position.quantity,
      price,
      pnl: realizedPnL,
      timestamp: Date.now(),
    };

    // Create order record
    const order: Order = {
      id: crypto.randomUUID(),
      symbol,
      side: position.side === 'buy' ? 'sell' : 'buy',
      type: 'market',
      quantity: position.quantity,
      status: 'filled',
      filledQuantity: position.quantity,
      avgFillPrice: price,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    set({
      portfolio: {
        ...state.portfolio,
        balance: newBalance,
        equity,
        buyingPower,
        positions: newPositions,
        totalPnL: state.portfolio.totalPnL + realizedPnL,
        dailyPnL: state.portfolio.dailyPnL + realizedPnL,
      },
      tradeHistory: [trade, ...state.tradeHistory],
      orderHistory: [order, ...state.orderHistory],
    });
  },

  executeMarketOrder: (side, qty, price) => {
    const state = get();
    const orderValue = qty * price;
    const symbol = state.currentSymbol;
    const existingPosition = state.portfolio.positions.find((p) => p.symbol === symbol);

    let newBalance = state.portfolio.balance;
    let newPositions = [...state.portfolio.positions];
    let realizedPnL = 0;
    let tradeRecords: TradeRecord[] = [];

    const now = Date.now();
    const tradeId = crypto.randomUUID();

    if (existingPosition) {
      if (existingPosition.side === side) {
        // Adding to existing position (same direction)
        const newQty = existingPosition.quantity + qty;
        const newAvgPrice = (existingPosition.avgEntryPrice * existingPosition.quantity + price * qty) / newQty;

        // Deduct cost
        newBalance -= orderValue;

        newPositions = newPositions.map((p) =>
          p.symbol === symbol
            ? {
                ...p,
                quantity: newQty,
                avgEntryPrice: newAvgPrice,
                currentPrice: price,
                unrealizedPnL: (price - newAvgPrice) * newQty * (side === 'buy' ? 1 : -1),
                unrealizedPnLPercent: ((price - newAvgPrice) / newAvgPrice) * 100 * (side === 'buy' ? 1 : -1),
              }
            : p
        );

        tradeRecords.push({
          id: tradeId,
          symbol,
          side,
          quantity: qty,
          price,
          pnl: 0,
          timestamp: now,
        });
      } else {
        // Opposite direction - reducing or flipping
        if (qty < existingPosition.quantity) {
          // Partial close
          const closedQty = qty;
          const remainingQty = existingPosition.quantity - closedQty;

          realizedPnL = existingPosition.side === 'buy'
            ? (price - existingPosition.avgEntryPrice) * closedQty
            : (existingPosition.avgEntryPrice - price) * closedQty;

          // Return closed portion cost + P&L
          newBalance += (existingPosition.avgEntryPrice * closedQty) + realizedPnL;

          const unrealizedPnL = existingPosition.side === 'buy'
            ? (price - existingPosition.avgEntryPrice) * remainingQty
            : (existingPosition.avgEntryPrice - price) * remainingQty;
          const unrealizedPnLPercent = (unrealizedPnL / (existingPosition.avgEntryPrice * remainingQty)) * 100;

          newPositions = newPositions.map((p) =>
            p.symbol === symbol
              ? {
                  ...p,
                  quantity: remainingQty,
                  currentPrice: price,
                  unrealizedPnL,
                  unrealizedPnLPercent,
                }
              : p
          );

          tradeRecords.push({
            id: tradeId,
            symbol,
            side,
            quantity: closedQty,
            price,
            pnl: realizedPnL,
            timestamp: now,
          });
        } else if (qty === existingPosition.quantity) {
          // Full close
          realizedPnL = existingPosition.side === 'buy'
            ? (price - existingPosition.avgEntryPrice) * existingPosition.quantity
            : (existingPosition.avgEntryPrice - price) * existingPosition.quantity;

          // Return full cost + P&L
          newBalance += (existingPosition.avgEntryPrice * existingPosition.quantity) + realizedPnL;

          newPositions = newPositions.filter((p) => p.symbol !== symbol);

          tradeRecords.push({
            id: tradeId,
            symbol,
            side,
            quantity: existingPosition.quantity,
            price,
            pnl: realizedPnL,
            timestamp: now,
          });
        } else {
          // Close existing + open opposite direction with remainder
          const closedQty = existingPosition.quantity;
          const newQty = qty - closedQty;

          realizedPnL = existingPosition.side === 'buy'
            ? (price - existingPosition.avgEntryPrice) * closedQty
            : (existingPosition.avgEntryPrice - price) * closedQty;

          // Return full close cost + P&L, then deduct new position cost
          newBalance += (existingPosition.avgEntryPrice * closedQty) + realizedPnL;
          newBalance -= newQty * price;

          // Remove old, add new opposite position
          newPositions = newPositions.filter((p) => p.symbol !== symbol);
          newPositions.push({
            symbol,
            side,
            quantity: newQty,
            avgEntryPrice: price,
            currentPrice: price,
            unrealizedPnL: 0,
            unrealizedPnLPercent: 0,
            realizedPnL: 0,
          });

          tradeRecords.push({
            id: tradeId,
            symbol,
            side: existingPosition.side === 'buy' ? 'sell' : 'buy',
            quantity: closedQty,
            price,
            pnl: realizedPnL,
            timestamp: now,
          });
          tradeRecords.push({
            id: crypto.randomUUID(),
            symbol,
            side,
            quantity: newQty,
            price,
            pnl: 0,
            timestamp: now,
          });
        }
      }
    } else {
      // New position
      newBalance -= orderValue;

      newPositions.push({
        symbol,
        side,
        quantity: qty,
        avgEntryPrice: price,
        currentPrice: price,
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        realizedPnL: 0,
      });

      tradeRecords.push({
        id: tradeId,
        symbol,
        side,
        quantity: qty,
        price,
        pnl: 0,
        timestamp: now,
      });
    }

    const { equity, buyingPower } = recalcPortfolio(newBalance, newPositions);

    // Create order record
    const order: Order = {
      id: crypto.randomUUID(),
      symbol,
      side,
      type: 'market',
      quantity: qty,
      status: 'filled',
      filledQuantity: qty,
      avgFillPrice: price,
      createdAt: now,
      updatedAt: now,
    };

    set({
      portfolio: {
        ...state.portfolio,
        balance: newBalance,
        equity,
        buyingPower,
        positions: newPositions,
        totalPnL: state.portfolio.totalPnL + realizedPnL,
        dailyPnL: state.portfolio.dailyPnL + realizedPnL,
      },
      tradeHistory: [...tradeRecords, ...state.tradeHistory],
      orderHistory: [order, ...state.orderHistory],
    });
  },

  setBalance: (balance) => {
    const state = get();
    const { equity, buyingPower } = recalcPortfolio(balance, state.portfolio.positions);
    set({
      portfolio: { ...state.portfolio, balance, equity, buyingPower },
    });
  },

  addTradeRecord: (trade) => set((state) => ({
    tradeHistory: [trade, ...state.tradeHistory],
  })),

  setSelectedPanel: (panel) => set({ selectedPanel: panel }),

  addCustomSymbol: (symbol, name, market) => set((state) => {
    // Don't uppercase DEX tokens - addresses are case-sensitive
    const normalizedSymbol = symbol.startsWith('dex:') ? symbol.trim() : symbol.toUpperCase().trim();
    const customWatchlist = state.watchlists.find((w) => w.id === 'custom');

    // Check if already exists in any watchlist
    const exists = state.watchlists.some((w) =>
      w.items.some((item) => item.symbol === normalizedSymbol)
    );
    if (exists) return state;

    if (customWatchlist) {
      return {
        watchlists: state.watchlists.map((w) =>
          w.id === 'custom'
            ? { ...w, items: [...w.items, { symbol: normalizedSymbol, market, name }] }
            : w
        ),
      };
    }
    return state;
  }),

  removeCustomSymbol: (symbol) => set((state) => ({
    watchlists: state.watchlists.map((w) =>
      w.id === 'custom'
        ? { ...w, items: w.items.filter((item) => item.symbol !== symbol) }
        : w
    ),
  })),
}),
    {
      name: 'tradesim-trading',
      partialize: (state) => ({
        // Persist portfolio state (balance, positions, P&L)
        portfolio: state.portfolio,
        // Persist trade and order history
        tradeHistory: state.tradeHistory,
        orderHistory: state.orderHistory,
        // Persist watchlists (including custom symbols)
        watchlists: state.watchlists,
        // Persist last viewed symbol and timeframe
        currentSymbol: state.currentSymbol,
        currentTimeframe: state.currentTimeframe,
      }),
    }
  )
);
