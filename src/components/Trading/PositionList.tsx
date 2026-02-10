import { useTradingStore } from '../../stores/tradingStore';
import type { Watchlist } from '../../types/trading';

function getDisplaySymbol(symbol: string, watchlists: Watchlist[]): string {
  if (symbol.toLowerCase().startsWith('dex:')) {
    for (const watchlist of watchlists) {
      const item = watchlist.items.find((i) => i.symbol.toLowerCase() === symbol.toLowerCase());
      if (item?.name?.includes('|')) {
        return item.name.split('|')[0];
      }
    }
    const parts = symbol.split(':');
    const addr = parts[2] || '';
    return addr.length > 8 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
  }
  return symbol.endsWith('USDT') ? symbol.replace('USDT', '') : symbol;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

export function PositionList() {
  const { portfolio, closePosition, setSymbol, watchlists } = useTradingStore();
  const formatSymbol = (sym: string) => getDisplaySymbol(sym, watchlists);

  const formatCurrency = (value: number) =>
    value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const formatPnL = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${formatCompact(value)}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  if (portfolio.positions.length === 0) {
    return (
      <div className="position-list empty">
        <div className="empty-positions">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 9h18M9 3v18" />
          </svg>
          <p>No open positions</p>
          <span>Place a trade to open a position</span>
        </div>
      </div>
    );
  }

  // Calculate totals
  const totalUnrealizedPnL = portfolio.positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
  const totalMarketValue = portfolio.positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0);
  const totalCostBasis = portfolio.positions.reduce((sum, p) => sum + p.avgEntryPrice * p.quantity, 0);
  const totalReturnPct = totalCostBasis > 0 ? ((totalMarketValue - totalCostBasis) / totalCostBasis) * 100 : 0;

  return (
    <div className="position-list">
      {/* Portfolio summary bar */}
      <div className="positions-summary">
        <div className="summary-stat">
          <span className="summary-label">Total P&L</span>
          <span className={`summary-value ${totalUnrealizedPnL >= 0 ? 'positive' : 'negative'}`}>
            {formatPnL(totalUnrealizedPnL)}
          </span>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <span className="summary-label">Return</span>
          <span className={`summary-value ${totalReturnPct >= 0 ? 'positive' : 'negative'}`}>
            {formatPercent(totalReturnPct)}
          </span>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <span className="summary-label">Value</span>
          <span className="summary-value">${formatCompact(totalMarketValue)}</span>
        </div>
      </div>

      {/* Position cards */}
      {portfolio.positions.map((position) => {
        const marketValue = position.currentPrice * position.quantity;
        const costBasis = position.avgEntryPrice * position.quantity;
        const isProfit = position.unrealizedPnL >= 0;

        return (
          <div
            key={position.symbol}
            className={`position-card ${isProfit ? 'profit' : 'loss'}`}
            onClick={() => setSymbol(position.symbol)}
          >
            {/* P&L accent bar */}
            <div className={`position-accent ${isProfit ? 'positive' : 'negative'}`} />

            <div className="position-main">
              {/* Top row: symbol + side badge | P&L */}
              <div className="position-header">
                <div className="position-header-left">
                  <span className="position-symbol">{formatSymbol(position.symbol)}</span>
                  <span className={`position-side ${position.side}`}>
                    {position.side === 'buy' ? 'LONG' : 'SHORT'}
                  </span>
                </div>
                <div className="position-header-right">
                  <span className={`position-pnl-value ${isProfit ? 'positive' : 'negative'}`}>
                    {formatPnL(position.unrealizedPnL)}
                  </span>
                  <span className={`position-pnl-percent ${isProfit ? 'positive' : 'negative'}`}>
                    {formatPercent(position.unrealizedPnLPercent)}
                  </span>
                </div>
              </div>

              {/* Price row */}
              <div className="position-prices">
                <div className="price-cell">
                  <span className="price-label">Entry</span>
                  <span className="price-value">{formatCurrency(position.avgEntryPrice)}</span>
                </div>
                <div className="price-arrow">
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 8h10M9 4l4 4-4 4" />
                  </svg>
                </div>
                <div className="price-cell">
                  <span className="price-label">Current</span>
                  <span className="price-value">{formatCurrency(position.currentPrice)}</span>
                </div>
              </div>

              {/* Stats grid */}
              <div className="position-stats">
                <div className="stat-item">
                  <span className="stat-label">Quantity</span>
                  <span className="stat-value">{position.quantity.toPrecision(6)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Mkt Value</span>
                  <span className="stat-value">{formatCurrency(marketValue)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Cost</span>
                  <span className="stat-value">{formatCurrency(costBasis)}</span>
                </div>
              </div>

              {/* Close button */}
              <button
                className="close-position-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  closePosition(position.symbol);
                }}
              >
                Close Position
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
