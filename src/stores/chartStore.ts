import { create } from 'zustand';
import type { Candle, Timeframe, Ticker } from '../types/trading';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ChartLayout = '1x1' | '1x2' | '2x2';

export interface SlotState {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number;
  ticker: Ticker | null;
  connectionStatus: ConnectionStatus;
}

interface ChartLayoutState {
  layout: ChartLayout;
  activeSlotId: string;
  slots: Record<string, SlotState>;

  setLayout: (layout: ChartLayout) => void;
  setActiveSlot: (id: string) => void;
  saveSlotData: (id: string, data: Partial<SlotState>) => void;
}

function createSlot(symbol: string): SlotState {
  return {
    symbol,
    timeframe: '1m',
    candles: [],
    currentPrice: 0,
    ticker: null,
    connectionStatus: 'disconnected',
  };
}

export const useChartStore = create<ChartLayoutState>()((set, get) => ({
  layout: '1x1',
  activeSlotId: '0',
  slots: {
    '0': createSlot('BTCUSDT'),
    '1': createSlot('ETHUSDT'),
    '2': createSlot('SOLUSDT'),
    '3': createSlot('XRPUSDT'),
  },

  setLayout: (layout) => {
    const state = get();
    const maxSlots = layout === '1x1' ? 1 : layout === '1x2' ? 2 : 4;
    const activeIdx = parseInt(state.activeSlotId);
    set({
      layout,
      activeSlotId: activeIdx >= maxSlots ? '0' : state.activeSlotId,
    });
  },

  setActiveSlot: (id) => set({ activeSlotId: id }),

  saveSlotData: (id, data) => set((state) => ({
    slots: {
      ...state.slots,
      [id]: { ...state.slots[id], ...data },
    },
  })),
}));
