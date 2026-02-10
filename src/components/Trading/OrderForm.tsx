import { useState, useMemo } from 'react';
import { useTradingStore } from '../../stores/tradingStore';
import type { OrderSide, OrderType, Watchlist } from '../../types/trading';

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

export function OrderForm() {
  const { currentSymbol, currentPrice, portfolio, executeMarketOrder, closePosition, watchlists } = useTradingStore();
  const displaySymbol = (sym: string) => getDisplaySymbol(sym, watchlists);

  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [inputMode, setInputMode] = useState<'qty' | 'usd'>('qty');
  const [usdAmount, setUsdAmount] = useState('');
  const [sellAll, setSellAll] = useState(false);

  const existingPosition = useMemo(
    () => portfolio.positions.find((p) => p.symbol === currentSymbol),
    [portfolio.positions, currentSymbol]
  );

  const effectivePrice = orderType === 'market' ? currentPrice : parseFloat(limitPrice || '0');

  // Calculate quantity - if sellAll, use exact position qty
  const effectiveQty = sellAll && existingPosition
    ? existingPosition.quantity
    : inputMode === 'usd'
      ? (effectivePrice > 0 ? parseFloat(usdAmount || '0') / effectivePrice : 0)
      : parseFloat(quantity || '0');

  const totalValue = effectiveQty * effectivePrice;

  const maxBuyQty = effectivePrice > 0 ? portfolio.buyingPower / effectivePrice : 0;

  const setPercentage = (pct: number) => {
    setSellAll(false);
    if (side === 'buy') {
      const qty = maxBuyQty * (pct / 100);
      if (inputMode === 'usd') {
        setUsdAmount((portfolio.buyingPower * (pct / 100)).toFixed(2));
      } else {
        setQuantity(qty > 0 ? qty.toPrecision(6) : '');
      }
    } else {
      if (existingPosition) {
        if (pct === 100) {
          // Use exact position quantity at execution time
          setSellAll(true);
          setQuantity(existingPosition.quantity.toString());
          setUsdAmount((existingPosition.quantity * effectivePrice).toFixed(2));
        } else {
          const qty = existingPosition.quantity * (pct / 100);
          if (inputMode === 'usd') {
            setUsdAmount((qty * effectivePrice).toFixed(2));
          } else {
            setQuantity(qty > 0 ? qty.toPrecision(6) : '');
          }
        }
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentPrice <= 0) return;

    const price = orderType === 'market' ? currentPrice : parseFloat(limitPrice);
    if (!price || price <= 0) return;

    // If selling all, use closePosition for exact accounting
    if (side === 'sell' && sellAll && existingPosition) {
      closePosition(currentSymbol);
      setQuantity('');
      setUsdAmount('');
      setSellAll(false);
      return;
    }

    if (effectiveQty <= 0) return;

    // Clamp sell quantity to position size to avoid dust issues
    let qty = effectiveQty;
    if (side === 'sell' && existingPosition) {
      if (qty > existingPosition.quantity) qty = existingPosition.quantity;
      // If within 0.01% of full position, treat as full close
      if (qty > existingPosition.quantity * 0.9999) {
        closePosition(currentSymbol);
        setQuantity('');
        setUsdAmount('');
        setSellAll(false);
        return;
      }
    }

    const orderValue = qty * price;

    // Validation
    if (side === 'buy' && orderValue > portfolio.buyingPower) return;
    if (side === 'sell' && !existingPosition) return;

    if (orderType === 'market') {
      executeMarketOrder(side, qty, price);
    }

    // Reset form
    setQuantity('');
    setUsdAmount('');
    setLimitPrice('');
    setStopPrice('');
    setSellAll(false);
  };

  // Clear sellAll when user manually types
  const handleQuantityChange = (value: string) => {
    setSellAll(false);
    setQuantity(value);
  };

  const handleUsdChange = (value: string) => {
    setSellAll(false);
    setUsdAmount(value);
  };

  // Determine if submit should be disabled
  const isDisabled = (() => {
    if (currentPrice <= 0) return true;
    if (sellAll && existingPosition) return false;
    if (effectiveQty <= 0) return true;
    if (side === 'buy' && totalValue > portfolio.buyingPower) return true;
    if (side === 'sell' && !existingPosition) return true;
    return false;
  })();

  // Button label
  const buttonLabel = (() => {
    if (side === 'buy') {
      if (existingPosition && existingPosition.side === 'sell') return `Buy to Close ${displaySymbol(currentSymbol)}`;
      if (existingPosition && existingPosition.side === 'buy') return `Buy More ${displaySymbol(currentSymbol)}`;
      return `Buy ${displaySymbol(currentSymbol)}`;
    } else {
      if (!existingPosition) return `No Position to Sell`;
      if (sellAll) return `Close ${displaySymbol(currentSymbol)}`;
      if (effectiveQty > 0 && effectiveQty < existingPosition.quantity * 0.9999) return `Sell Partial ${displaySymbol(currentSymbol)}`;
      return `Sell ${displaySymbol(currentSymbol)}`;
    }
  })();

  return (
    <form className="order-form" onSubmit={handleSubmit}>
      <div className="order-side-tabs">
        <button
          type="button"
          className={`side-tab buy ${side === 'buy' ? 'active' : ''}`}
          onClick={() => { setSide('buy'); setSellAll(false); }}
        >
          Buy
        </button>
        <button
          type="button"
          className={`side-tab sell ${side === 'sell' ? 'active' : ''}`}
          onClick={() => setSide('sell')}
        >
          Sell
        </button>
      </div>

      <div className="order-type-select">
        <select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
          <option value="stop_limit">Stop Limit</option>
        </select>
      </div>

      {/* Input mode toggle */}
      <div className="input-mode-toggle">
        <button
          type="button"
          className={`mode-btn ${inputMode === 'qty' ? 'active' : ''}`}
          onClick={() => { setInputMode('qty'); setUsdAmount(''); setSellAll(false); }}
        >
          Quantity
        </button>
        <button
          type="button"
          className={`mode-btn ${inputMode === 'usd' ? 'active' : ''}`}
          onClick={() => { setInputMode('usd'); setQuantity(''); setSellAll(false); }}
        >
          USD
        </button>
      </div>

      {inputMode === 'qty' ? (
        <div className="order-input-group">
          <label>Quantity</label>
          <input
            type="number"
            step="any"
            placeholder="0.00"
            value={sellAll && existingPosition ? existingPosition.quantity.toString() : quantity}
            onChange={(e) => handleQuantityChange(e.target.value)}
          />
        </div>
      ) : (
        <div className="order-input-group">
          <label>Amount (USD)</label>
          <input
            type="number"
            step="any"
            placeholder="0.00"
            value={usdAmount}
            onChange={(e) => handleUsdChange(e.target.value)}
          />
        </div>
      )}

      {/* Percentage buttons */}
      <div className="pct-buttons">
        {[25, 50, 75, 100].map((pct) => (
          <button key={pct} type="button" className="pct-btn" onClick={() => setPercentage(pct)}>
            {pct}%
          </button>
        ))}
      </div>

      {(orderType === 'limit' || orderType === 'stop_limit') && (
        <div className="order-input-group">
          <label>Limit Price</label>
          <input
            type="number"
            step="any"
            placeholder={currentPrice.toFixed(2)}
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
          />
        </div>
      )}

      {(orderType === 'stop' || orderType === 'stop_limit') && (
        <div className="order-input-group">
          <label>Stop Price</label>
          <input
            type="number"
            step="any"
            placeholder={currentPrice.toFixed(2)}
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
          />
        </div>
      )}

      {/* Position info when exists */}
      {existingPosition && (
        <div className="position-info-bar">
          <div className="position-info-row">
            <span>Position</span>
            <span className={existingPosition.side === 'buy' ? 'positive' : 'negative'}>
              {existingPosition.side === 'buy' ? 'LONG' : 'SHORT'} {existingPosition.quantity.toPrecision(6)}
            </span>
          </div>
          <div className="position-info-row">
            <span>Avg Entry</span>
            <span>${existingPosition.avgEntryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="position-info-row">
            <span>Unrealized P&L</span>
            <span className={existingPosition.unrealizedPnL >= 0 ? 'positive' : 'negative'}>
              {existingPosition.unrealizedPnL >= 0 ? '+' : ''}${existingPosition.unrealizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      <div className="order-summary">
        <div className="summary-row">
          <span>Market Price</span>
          <span>${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        {effectiveQty > 0 && inputMode === 'usd' && (
          <div className="summary-row">
            <span>Qty</span>
            <span>{effectiveQty.toPrecision(6)}</span>
          </div>
        )}
        {effectiveQty > 0 && inputMode === 'qty' && (
          <div className="summary-row">
            <span>Est. Total</span>
            <span>${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
        <div className="summary-row">
          <span>Available</span>
          <span>
            {side === 'buy'
              ? `$${portfolio.buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : existingPosition
                ? `${existingPosition.quantity.toPrecision(6)} ${displaySymbol(currentSymbol)}`
                : 'No position'
            }
          </span>
        </div>
      </div>

      <button type="submit" className={`order-submit-btn ${side}`} disabled={isDisabled}>
        {buttonLabel}
      </button>

      {/* Close Position shortcut */}
      {existingPosition && side === 'sell' && !sellAll && (
        <button
          type="button"
          className="close-all-btn"
          onClick={() => {
            closePosition(currentSymbol);
            setQuantity('');
            setUsdAmount('');
            setSellAll(false);
          }}
        >
          Close Entire Position
        </button>
      )}
    </form>
  );
}
