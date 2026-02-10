import { useCallback, useEffect } from 'react';
import { useChartStore, type ChartLayout } from '../../stores/chartStore';
import { useTradingStore } from '../../stores/tradingStore';
import { useSlotData } from '../../hooks/useSlotData';
import { CandlestickChart } from './CandlestickChart';
import { ChartControls } from './ChartControls';
import { detachPanel } from '../../utils/detachPanel';

const LAYOUT_SLOT_IDS: Record<ChartLayout, string[]> = {
  '1x1': ['0'],
  '1x2': ['0', '1'],
  '2x2': ['0', '1', '2', '3'],
};

export function ChartGrid() {
  const layout = useChartStore((s) => s.layout);
  const activeSlotId = useChartStore((s) => s.activeSlotId);
  const setActiveSlot = useChartStore((s) => s.setActiveSlot);
  const saveSlotData = useChartStore((s) => s.saveSlotData);
  const setLayout = useChartStore((s) => s.setLayout);

  const slotIds = LAYOUT_SLOT_IDS[layout];

  // Sync slot 0 symbol/timeframe from tradingStore on mount
  useEffect(() => {
    const trading = useTradingStore.getState();
    saveSlotData('0', {
      symbol: trading.currentSymbol,
      timeframe: trading.currentTimeframe,
    });
  }, [saveSlotData]);

  // Keep active slot data in sync with tradingStore
  useEffect(() => {
    const unsub = useTradingStore.subscribe((state) => {
      const currentActive = useChartStore.getState().activeSlotId;
      saveSlotData(currentActive, {
        candles: state.candles,
        currentPrice: state.currentPrice,
        ticker: state.ticker,
        connectionStatus: state.connectionStatus,
        symbol: state.currentSymbol,
        timeframe: state.currentTimeframe,
      });
    });
    return unsub;
  }, [saveSlotData]);

  const handleSlotClick = useCallback((slotId: string) => {
    if (slotId === activeSlotId) return;

    // Save current active slot's data from tradingStore
    const trading = useTradingStore.getState();
    saveSlotData(activeSlotId, {
      symbol: trading.currentSymbol,
      timeframe: trading.currentTimeframe,
      candles: trading.candles,
      currentPrice: trading.currentPrice,
      ticker: trading.ticker,
      connectionStatus: trading.connectionStatus,
    });

    // Load the clicked slot's data into tradingStore
    const newSlot = useChartStore.getState().slots[slotId];
    useTradingStore.setState({
      currentSymbol: newSlot.symbol,
      currentTimeframe: newSlot.timeframe,
      candles: newSlot.candles,
      currentPrice: newSlot.currentPrice,
      ticker: newSlot.ticker,
      connectionStatus: newSlot.connectionStatus,
    });

    setActiveSlot(slotId);
  }, [activeSlotId, saveSlotData, setActiveSlot]);

  const handlePopout = useCallback(() => detachPanel('chart'), []);

  // 1x1: render without grid wrapper (same as before)
  if (layout === '1x1') {
    return (
      <section className="chart-section">
        <ChartControls layout={layout} onLayoutChange={setLayout} onPopout={handlePopout} />
        <CandlestickChart />
      </section>
    );
  }

  return (
    <section className="chart-section chart-section-grid">
      <div className={`chart-grid chart-grid-${layout}`}>
        {slotIds.map((slotId) => (
          <ChartSlot
            key={slotId}
            slotId={slotId}
            isActive={slotId === activeSlotId}
            layout={layout}
            setLayout={setLayout}
            onPopout={handlePopout}
            onClick={slotId !== activeSlotId ? () => handleSlotClick(slotId) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

interface ChartSlotProps {
  slotId: string;
  isActive: boolean;
  layout: ChartLayout;
  setLayout: (layout: ChartLayout) => void;
  onPopout: () => void;
  onClick?: () => void;
}

function ChartSlot({ slotId, isActive, layout, setLayout, onPopout, onClick }: ChartSlotProps) {
  // Per-slot selector: only re-renders when THIS slot's data changes
  const slot = useChartStore((s) => s.slots[slotId]);

  // Per-slot data hook: manages its own WebSocket/polling when not active
  useSlotData(slotId, slot.symbol, slot.timeframe, isActive);

  return (
    <div
      className={`chart-slot ${isActive ? 'slot-active' : 'slot-inactive'}`}
      onClick={onClick}
    >
      {isActive ? (
        <>
          <ChartControls layout={layout} onLayoutChange={setLayout} onPopout={onPopout} />
          <CandlestickChart />
        </>
      ) : (
        <>
          <ChartControls
            frozenData={{
              symbol: slot.symbol,
              timeframe: slot.timeframe,
              ticker: slot.ticker,
              connectionStatus: slot.connectionStatus,
            }}
          />
          <CandlestickChart
            frozenData={{
              candles: slot.candles,
              currentPrice: slot.currentPrice,
              currentTimeframe: slot.timeframe,
              currentSymbol: slot.symbol,
            }}
          />
        </>
      )}
    </div>
  );
}
