import { useState } from 'react';
import { useTradingStore } from '../../stores/tradingStore';

const CRYPTO_SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', name: 'Ethereum' },
  { symbol: 'SOLUSDT', name: 'Solana' },
  { symbol: 'XRPUSDT', name: 'XRP' },
  { symbol: 'ADAUSDT', name: 'Cardano' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin' },
  { symbol: 'LTCUSDT', name: 'Litecoin' },
  { symbol: 'LINKUSDT', name: 'Chainlink' },
];

const STOCK_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'SPY', name: 'S&P 500 ETF' },
];

const CHAINS = [
  { id: 'solana', name: 'Solana', placeholder: 'Token address...' },
  { id: 'ethereum', name: 'Ethereum', placeholder: '0x address...' },
  { id: 'bsc', name: 'BSC', placeholder: '0x address...' },
  { id: 'base', name: 'Base', placeholder: '0x address...' },
];

// Symbols that are crypto (contain USDT suffix or are on-chain)
export function isCryptoSymbol(symbol: string): boolean {
  return symbol.endsWith('USDT') || symbol.toLowerCase().startsWith('dex:');
}

interface DexScreenerToken {
  chainId: string;
  tokenAddress: string;
  pairAddress: string;
  symbol: string;
  name: string;
  priceUsd: string;
}

export function Watchlist() {
  const { currentSymbol, setSymbol, watchlists, addCustomSymbol, removeCustomSymbol } = useTradingStore();

  // Input mode: 'symbol' for ticker symbols, 'contract' for on-chain addresses
  const [inputMode, setInputMode] = useState<'symbol' | 'contract'>('symbol');
  const [customInput, setCustomInput] = useState('');
  const [customType, setCustomType] = useState<'crypto' | 'stock'>('crypto');
  const [selectedChain, setSelectedChain] = useState('solana');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokenInfo, setTokenInfo] = useState<DexScreenerToken | null>(null);

  const customWatchlist = watchlists.find((w) => w.id === 'custom');
  const customSymbols = customWatchlist?.items || [];

  const handleAddSymbol = () => {
    if (!customInput.trim()) return;
    setError('');

    let symbol = customInput.trim().toUpperCase();
    if (customType === 'crypto' && !symbol.endsWith('USDT')) {
      symbol = symbol + 'USDT';
    }

    addCustomSymbol(symbol, symbol, customType);
    setCustomInput('');
  };

  const lookupContract = async () => {
    if (!customInput.trim()) return;
    setError('');
    setTokenInfo(null);
    setIsLoading(true);

    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${customInput.trim()}`
      );
      const data = await response.json();

      if (data.pairs && data.pairs.length > 0) {
        // Find the pair on the selected chain, or use the first one
        const pair = data.pairs.find((p: { chainId: string }) => p.chainId === selectedChain) || data.pairs[0];
        const token = pair.baseToken.address.toLowerCase() === customInput.trim().toLowerCase()
          ? pair.baseToken
          : pair.quoteToken;

        setTokenInfo({
          chainId: pair.chainId,
          tokenAddress: token.address,
          pairAddress: pair.pairAddress,
          symbol: token.symbol,
          name: token.name,
          priceUsd: pair.priceUsd || '0',
        });
      } else {
        setError('Token not found on DEXScreener');
      }
    } catch {
      setError('Failed to lookup token');
    } finally {
      setIsLoading(false);
    }
  };

  const addContractToken = () => {
    if (!tokenInfo) return;

    // Store with dex: prefix to identify it as an on-chain token
    const symbol = `dex:${tokenInfo.chainId}:${tokenInfo.tokenAddress}`;
    // Store as "TICKER|Full Name|PairAddress" so we can use it for charts
    const displayName = `${tokenInfo.symbol}|${tokenInfo.name}|${tokenInfo.pairAddress}`;
    addCustomSymbol(symbol, displayName, 'crypto');
    setCustomInput('');
    setTokenInfo(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (inputMode === 'symbol') {
        handleAddSymbol();
      } else {
        lookupContract();
      }
    }
  };

  return (
    <div className="watchlist">
      {/* Add Asset Section */}
      <div className="custom-symbol-section">
        <h3 className="watchlist-title">Add Asset</h3>

        {/* Mode Tabs */}
        <div className="input-mode-tabs">
          <button
            className={`mode-tab ${inputMode === 'symbol' ? 'active' : ''}`}
            onClick={() => { setInputMode('symbol'); setError(''); setTokenInfo(null); }}
          >
            Ticker
          </button>
          <button
            className={`mode-tab ${inputMode === 'contract' ? 'active' : ''}`}
            onClick={() => { setInputMode('contract'); setError(''); }}
          >
            Contract
          </button>
        </div>

        {inputMode === 'symbol' ? (
          /* Symbol Input Mode */
          <div className="symbol-input-group">
            <div className="input-row">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={customType === 'crypto' ? 'BTC, DOGE, SHIB...' : 'AAPL, GME, AMD...'}
                className="symbol-input"
              />
              <button className="add-symbol-btn" onClick={handleAddSymbol}>+</button>
            </div>
            <div className="type-selector">
              <label className={`type-option ${customType === 'crypto' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="assetType"
                  value="crypto"
                  checked={customType === 'crypto'}
                  onChange={() => setCustomType('crypto')}
                />
                <span>Crypto</span>
              </label>
              <label className={`type-option ${customType === 'stock' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="assetType"
                  value="stock"
                  checked={customType === 'stock'}
                  onChange={() => setCustomType('stock')}
                />
                <span>Stock</span>
              </label>
            </div>
          </div>
        ) : (
          /* Contract Address Mode */
          <div className="contract-input-group">
            <select
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value)}
              className="chain-select"
            >
              {CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>{chain.name}</option>
              ))}
            </select>
            <div className="input-row">
              <input
                type="text"
                value={customInput}
                onChange={(e) => { setCustomInput(e.target.value); setTokenInfo(null); }}
                onKeyDown={handleKeyDown}
                placeholder={CHAINS.find(c => c.id === selectedChain)?.placeholder}
                className="contract-input"
              />
              <button
                className="lookup-btn"
                onClick={lookupContract}
                disabled={isLoading}
              >
                {isLoading ? '...' : 'Lookup'}
              </button>
            </div>

            {/* Token Preview */}
            {tokenInfo && (
              <div className="token-preview">
                <div className="token-info">
                  <span className="token-symbol">{tokenInfo.symbol}</span>
                  <span className="token-name">{tokenInfo.name}</span>
                  <span className="token-price">${parseFloat(tokenInfo.priceUsd).toFixed(6)}</span>
                </div>
                <button className="add-token-btn" onClick={addContractToken}>
                  Add to Watchlist
                </button>
              </div>
            )}

            {error && <div className="input-error">{error}</div>}

            <div className="data-source-note">
              Data from DEXScreener
            </div>
          </div>
        )}
      </div>

      {/* Custom Symbols */}
      {customSymbols.length > 0 && (
        <>
          <h3 className="watchlist-title">Custom</h3>
          <div className="watchlist-items">
            {customSymbols.map((item) => {
              const isDex = item.symbol.toLowerCase().startsWith('dex:');
              let displaySymbol: string;
              let displayName: string;

              if (isDex && item.name?.includes('|')) {
                // DEX tokens stored as "TICKER|Full Name"
                const [ticker, fullName] = item.name.split('|');
                displaySymbol = ticker;
                displayName = fullName;
              } else if (isDex) {
                // Fallback for old format
                displaySymbol = item.name || item.symbol.split(':')[2]?.slice(0, 6) + '...';
                displayName = item.symbol.split(':')[1] || 'DEX';
              } else {
                displaySymbol = item.market === 'crypto' ? item.symbol.replace('USDT', '') : item.symbol;
                displayName = item.name || item.symbol;
              }

              return (
                <button
                  key={item.symbol}
                  className={`watchlist-item ${currentSymbol === item.symbol ? 'active' : ''}`}
                  onClick={() => setSymbol(item.symbol)}
                >
                  <span className="item-symbol">{displaySymbol}</span>
                  <span className="item-name">{displayName}</span>
                  {isDex && <span className="item-badge">DEX</span>}
                  <span
                    className="remove-symbol"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCustomSymbol(item.symbol);
                    }}
                  >
                    ×
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <h3 className="watchlist-title">Crypto</h3>
      <div className="watchlist-items">
        {CRYPTO_SYMBOLS.map((item) => (
          <button
            key={item.symbol}
            className={`watchlist-item ${currentSymbol === item.symbol ? 'active' : ''}`}
            onClick={() => setSymbol(item.symbol)}
          >
            <span className="item-symbol">{item.symbol.replace('USDT', '')}</span>
            <span className="item-name">{item.name}</span>
          </button>
        ))}
      </div>

      <h3 className="watchlist-title">Stocks</h3>
      <div className="watchlist-items">
        {STOCK_SYMBOLS.map((item) => (
          <button
            key={item.symbol}
            className={`watchlist-item ${currentSymbol === item.symbol ? 'active' : ''}`}
            onClick={() => setSymbol(item.symbol)}
          >
            <span className="item-symbol">{item.symbol}</span>
            <span className="item-name">{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
