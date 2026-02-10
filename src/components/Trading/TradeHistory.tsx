import { useTradingStore } from '../../stores/tradingStore';
import type { Watchlist } from '../../types/trading';

function getDisplaySymbol(symbol: string, watchlists: Watchlist[]): string {
  // Handle DEX tokens - look up ticker from watchlist
  if (symbol.toLowerCase().startsWith('dex:')) {
    for (const watchlist of watchlists) {
      const item = watchlist.items.find((i) => i.symbol.toLowerCase() === symbol.toLowerCase());
      if (item?.name?.includes('|')) {
        return item.name.split('|')[0]; // Return the ticker part
      }
    }
    // Fallback: show shortened address
    const parts = symbol.split(':');
    const addr = parts[2] || '';
    return addr.length > 8 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
  }
  // Handle crypto symbols
  return symbol.endsWith('USDT') ? symbol.replace('USDT', '') : symbol;
}

export function TradeHistory() {
  const { tradeHistory, watchlists } = useTradingStore();
  const formatSymbol = (sym: string) => getDisplaySymbol(sym, watchlists);

  const formatCurrency = (value: number) =>
    value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  if (tradeHistory.length === 0) {
    return (
      <div className="trade-history empty">
        <p>No trade history</p>
      </div>
    );
  }

  return (
    <div className="trade-history">
      {tradeHistory.map((trade) => (
        <div key={trade.id} className="trade-row">
          <div className="trade-row-header">
            <div className="trade-row-left">
              <span className={`trade-side ${trade.side}`}>
                {trade.side.toUpperCase()}
              </span>
              <span className="trade-symbol">{formatSymbol(trade.symbol)}</span>
            </div>
            <span className="trade-time">{formatTime(trade.timestamp)}</span>
          </div>
          <div className="trade-row-details">
            <span>{trade.quantity.toPrecision(6)} @ {formatCurrency(trade.price)}</span>
            {trade.pnl !== 0 && (
              <span className={trade.pnl >= 0 ? 'positive' : 'negative'}>
                {trade.pnl >= 0 ? '+' : ''}{formatCurrency(trade.pnl)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
