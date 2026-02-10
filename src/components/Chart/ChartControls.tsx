import { useEffect, useRef, useState } from 'react';
import { useTradingStore } from '../../stores/tradingStore';
import { TIMEFRAME_LABELS, type Timeframe, type Ticker } from '../../types/trading';
import type { ChartLayout } from '../../stores/chartStore';

// Only show timeframes that Coinbase actually supports differently
// Coinbase granularities: 60, 300, 900, 3600, 21600, 86400
const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const LAYOUTS: ChartLayout[] = ['1x1', '1x2', '2x2'];

function formatSymbolDisplay(symbol: string): string {
  // DEX tokens: dex:chainId:address -> show shortened address
  if (symbol.startsWith('dex:')) {
    const parts = symbol.split(':');
    const chain = parts[1]?.toUpperCase() || '';
    const address = parts[2] || '';
    const shortAddr = address.length > 8 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
    return `${chain}/${shortAddr}`;
  }
  // Crypto symbols end with USDT, show as BTC/USD etc.
  if (symbol.endsWith('USDT')) {
    return symbol.replace('USDT', '/USD');
  }
  return symbol;
}

interface FrozenControlsData {
  symbol: string;
  timeframe: Timeframe;
  ticker: Ticker | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
}

interface ChartControlsProps {
  frozenData?: FrozenControlsData;
  layout?: ChartLayout;
  onLayoutChange?: (layout: ChartLayout) => void;
  onPopout?: () => void;
}

export function ChartControls({ frozenData, layout, onLayoutChange, onPopout }: ChartControlsProps) {
  const isFrozen = !!frozenData;

  // Always call hooks (React rules) but use frozenData when available
  const storeSymbol = useTradingStore((s) => s.currentSymbol);
  const storeTimeframe = useTradingStore((s) => s.currentTimeframe);
  const storeTicker = useTradingStore((s) => s.ticker);
  const storeConnectionStatus = useTradingStore((s) => s.connectionStatus);
  const setTimeframe = useTradingStore((s) => s.setTimeframe);
  const watchlists = useTradingStore((s) => s.watchlists);
  const positions = useTradingStore((s) => s.portfolio.positions);

  const currentSymbol = frozenData?.symbol ?? storeSymbol;
  const currentTimeframe = frozenData?.timeframe ?? storeTimeframe;
  const ticker = frozenData?.ticker ?? storeTicker;
  const connectionStatus = frozenData?.connectionStatus ?? storeConnectionStatus;

  const isDexToken = currentSymbol.toLowerCase().startsWith('dex:');

  // Flash effect when price changes
  const [flashClass, setFlashClass] = useState('');
  const prevPriceRef = useRef<number>(0);

  useEffect(() => {
    if (isFrozen) return;
    if (ticker?.price && prevPriceRef.current > 0) {
      if (ticker.price > prevPriceRef.current) {
        setFlashClass('flash-up');
      } else if (ticker.price < prevPriceRef.current) {
        setFlashClass('flash-down');
      }
      // Clear flash after animation
      const timeout = setTimeout(() => setFlashClass(''), 300);
      return () => clearTimeout(timeout);
    }
    if (ticker?.price) {
      prevPriceRef.current = ticker.price;
    }
  }, [ticker?.price, isFrozen]);

  // Update prev price after flash
  useEffect(() => {
    if (ticker?.price) {
      prevPriceRef.current = ticker.price;
    }
  }, [ticker?.price]);

  // Get display name from watchlist for DEX tokens
  const getDisplayName = (): string => {
    if (isDexToken) {
      // Look up the token in watchlists to get its name (case-insensitive match)
      for (const watchlist of watchlists) {
        const item = watchlist.items.find((i) => i.symbol.toLowerCase() === currentSymbol.toLowerCase());
        if (item?.name?.includes('|')) {
          return item.name.split('|')[0]; // Return the ticker part
        } else if (item?.name) {
          return item.name;
        }
      }
    }
    return formatSymbolDisplay(currentSymbol);
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.0001) return price.toFixed(6);
    return price.toFixed(10);
  };

  const formatChange = (change: number) => {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  };

  // Format market status display
  const getMarketStatusLabel = () => {
    if (!ticker?.marketStatus) return null;
    const labels: Record<string, string> = {
      pre: 'Pre-Market',
      regular: 'Market Open',
      post: 'After Hours',
      closed: 'Market Closed',
    };
    return labels[ticker.marketStatus] || null;
  };

  const isStock = !currentSymbol.endsWith('USDT') && !isDexToken;

  return (
    <div className="chart-controls">
      <div className="chart-header">
        <div className="symbol-info">
          <span className="symbol-name">{getDisplayName()}</span>
          {ticker && (
            <>
              <span className={`symbol-price ${isFrozen ? '' : flashClass}`}>{formatPrice(ticker.price)}</span>
              <span className={`symbol-change ${ticker.changePercent24h >= 0 ? 'positive' : 'negative'}`}>
                {formatChange(ticker.changePercent24h)}
              </span>
              {isStock && ticker.marketStatus && (
                <span className={`market-status ${ticker.marketStatus}`}>
                  {getMarketStatusLabel()}
                </span>
              )}
            </>
          )}
          {(() => {
            const pos = positions.find((p) => p.symbol === currentSymbol);
            if (!pos) return null;
            const isLong = pos.side === 'buy';
            const sign = pos.unrealizedPnL >= 0 ? '+' : '';
            return (
              <span className="position-pnl-tag">
                <span className={`pnl-side ${isLong ? 'long' : 'short'}`}>
                  {isLong ? 'LONG' : 'SHORT'}
                </span>
                <span className={pos.unrealizedPnL >= 0 ? 'positive' : 'negative'}>
                  {sign}${Math.abs(pos.unrealizedPnL).toFixed(2)} ({sign}{pos.unrealizedPnLPercent.toFixed(2)}%)
                </span>
              </span>
            );
          })()}
        </div>
        <div className="chart-header-right">
          {layout && onLayoutChange && (
            <div className="layout-selector">
              {LAYOUTS.map((l) => (
                <button
                  key={l}
                  className={`layout-btn ${layout === l ? 'active' : ''}`}
                  onClick={() => onLayoutChange(l)}
                  title={`${l} Layout`}
                >
                  <LayoutIcon layout={l} />
                </button>
              ))}
            </div>
          )}
          {onPopout && (
            <button className="popout-btn" onClick={onPopout} title="Pop out chart">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 2h5v5M14 2L8 8M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" />
              </svg>
            </button>
          )}
          <div className="connection-status">
            <span className={`status-dot ${connectionStatus}`}></span>
            <span className="status-text">{connectionStatus}</span>
          </div>
        </div>
      </div>

      {!isFrozen && (
        <div className="timeframe-selector">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              className={`timeframe-btn ${currentTimeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {TIMEFRAME_LABELS[tf]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LayoutIcon({ layout }: { layout: ChartLayout }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      {layout === '1x1' && (
        <rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
      {layout === '1x2' && (
        <>
          <rect x="1" y="1" width="6" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="1" width="6" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
      {layout === '2x2' && (
        <>
          <rect x="1" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="1" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}
