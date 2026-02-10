import { useEffect, useRef } from 'react';
import { apiUrl } from '../api';
import { useTradingStore } from '../stores/tradingStore';
import type { Candle, Timeframe } from '../types/trading';

// Map our timeframes to GeckoTerminal timeframes
const TIMEFRAME_MAP: Record<Timeframe, { tf: string; aggregate: number }> = {
  '1m': { tf: 'minute', aggregate: 1 },
  '3m': { tf: 'minute', aggregate: 1 }, // Will aggregate 3 candles
  '5m': { tf: 'minute', aggregate: 5 },
  '15m': { tf: 'minute', aggregate: 15 },
  '30m': { tf: 'minute', aggregate: 15 }, // Will aggregate 2 candles
  '1h': { tf: 'hour', aggregate: 1 },
  '4h': { tf: 'hour', aggregate: 4 },
  '1d': { tf: 'day', aggregate: 1 },
  '1w': { tf: 'day', aggregate: 1 }, // Will aggregate 7 candles
  '1M': { tf: 'day', aggregate: 1 }, // Will aggregate 30 candles
};

// Map chain IDs to GeckoTerminal network names
const NETWORK_MAP: Record<string, string> = {
  'solana': 'solana',
  'ethereum': 'eth',
  'bsc': 'bsc',
  'base': 'base',
  'arbitrum': 'arbitrum',
  'polygon': 'polygon_pos',
  'avalanche': 'avax',
};

interface OhlcvData {
  data: {
    attributes: {
      ohlcv_list: [number, number, number, number, number, number][]; // [timestamp, open, high, low, close, volume]
    };
  };
}

export function useDexChartData(disabled = false) {
  const {
    currentSymbol,
    currentTimeframe,
    setCandles,
    setConnectionStatus,
    watchlists
  } = useTradingStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchRef = useRef<number>(0);

  // Check if this is a DEX token
  const isDexToken = currentSymbol.toLowerCase().startsWith('dex:');

  useEffect(() => {
    if (disabled || !isDexToken) {
      return;
    }

    // Parse the symbol: dex:chainId:tokenAddress
    const parts = currentSymbol.split(':');
    if (parts.length !== 3) {
      return;
    }

    const [, chainId, tokenAddress] = parts;
    const network = NETWORK_MAP[chainId.toLowerCase()];

    if (!network) {
      console.error('Unsupported network for charts:', chainId);
      return;
    }

    // Get pool address from watchlist if stored (format: "TICKER|Name|PoolAddress")
    const watchlistItem = watchlists
      .flatMap(w => w.items)
      .find(item => item.symbol.toLowerCase() === currentSymbol.toLowerCase());

    let poolAddress = '';
    if (watchlistItem?.name?.includes('|')) {
      const nameParts = watchlistItem.name.split('|');
      if (nameParts.length >= 3 && nameParts[2]) {
        poolAddress = nameParts[2];
        console.log('Using stored pool address:', poolAddress.slice(0, 10) + '...');
      }
    }

    const fetchChartData = async () => {
      // Rate limit: don't fetch more than once per 5 seconds for chart data
      const now = Date.now();
      if (now - lastFetchRef.current < 5000) {
        return;
      }
      lastFetchRef.current = now;

      try {
        // If we don't have a pool address, we need to find one first
        if (!poolAddress) {
          // Use DEXScreener to find the best pool
          const dexResponse = await fetch(
            apiUrl(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`),
            { cache: 'no-store' }
          );
          const dexData = await dexResponse.json();

          if (dexData.pairs && dexData.pairs.length > 0) {
            // Find the best pair on the right chain
            const pair = dexData.pairs.find((p: { chainId: string }) =>
              p.chainId.toLowerCase() === chainId.toLowerCase()
            ) || dexData.pairs[0];

            poolAddress = pair.pairAddress;
          }
        }

        if (!poolAddress) {
          console.error('Could not find pool address for token');
          return;
        }

        const tfConfig = TIMEFRAME_MAP[currentTimeframe];

        // Fetch OHLCV data from GeckoTerminal
        const response = await fetch(
          apiUrl(`https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}/ohlcv/${tfConfig.tf}?aggregate=${tfConfig.aggregate}&limit=300`),
          { cache: 'no-store' }
        );

        if (!response.ok) {
          throw new Error(`GeckoTerminal API error: ${response.status}`);
        }

        const data: OhlcvData = await response.json();

        if (data.data?.attributes?.ohlcv_list) {
          const candles: Candle[] = data.data.attributes.ohlcv_list
            .map(([timestamp, open, high, low, close, volume]) => ({
              time: timestamp * 1000, // Convert seconds to milliseconds (matches Binance format)
              open,
              high,
              low,
              close,
              volume,
            }))
            .sort((a, b) => a.time - b.time); // Sort oldest first

          if (candles.length > 0) {
            setCandles(candles);
            setConnectionStatus('connected');
            console.log(`Loaded ${candles.length} candles from GeckoTerminal`);
          }
        }
      } catch (error) {
        console.error('GeckoTerminal fetch error:', error);
        // Don't set error status - price data might still work
      }
    };

    // Fetch immediately
    fetchChartData();

    // Poll every 15 seconds for chart updates
    intervalRef.current = setInterval(fetchChartData, 15000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [currentSymbol, currentTimeframe, isDexToken, disabled, setCandles, setConnectionStatus, watchlists]);

  return { isDexToken };
}
