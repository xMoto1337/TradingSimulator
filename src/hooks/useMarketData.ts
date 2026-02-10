import { useEffect, useRef } from 'react';
import { apiUrl, isTauri } from '../api';
import { useTradingStore } from '../stores/tradingStore';
import type { Candle, Timeframe } from '../types/trading';

// Coinbase API (works well in US, no auth needed for public data)
const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com';

// Map symbols to Coinbase product IDs
const COINBASE_PRODUCTS: Record<string, string> = {
  'BTCUSDT': 'BTC-USD',
  'ETHUSDT': 'ETH-USD',
  'SOLUSDT': 'SOL-USD',
  'XRPUSDT': 'XRP-USD',
  'ADAUSDT': 'ADA-USD',
  'DOGEUSDT': 'DOGE-USD',
  'LTCUSDT': 'LTC-USD',
  'LINKUSDT': 'LINK-USD',
};

// Coinbase only supports these granularities (in seconds):
// 60, 300, 900, 3600, 21600, 86400
// Map our timeframes to the closest supported Coinbase granularity
const COINBASE_GRANULARITY: Record<Timeframe, number> = {
  '1m': 60,
  '3m': 300,      // Use 5m data
  '5m': 300,
  '15m': 900,
  '30m': 3600,    // Use 1h data
  '1h': 3600,
  '4h': 21600,    // Use 6h data
  '1d': 86400,
  '1w': 86400,    // Use 1d data (will show ~300 days)
  '1M': 86400,    // Use 1d data
};

// How many candles to fetch for each timeframe
const CANDLE_COUNT: Record<Timeframe, number> = {
  '1m': 300,
  '3m': 300,
  '5m': 300,
  '15m': 300,
  '30m': 300,
  '1h': 300,
  '4h': 300,
  '1d': 300,
  '1w': 300,
  '1M': 300,
};

export function useMarketData(disabled = false) {
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const candleRef = useRef<Candle | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCleaningUp = useRef(false);

  const currentSymbol = useTradingStore((state) => state.currentSymbol);
  const currentTimeframe = useTradingStore((state) => state.currentTimeframe);
  const setCandles = useTradingStore((state) => state.setCandles);
  const updateLastCandle = useTradingStore((state) => state.updateLastCandle);
  const setCurrentPrice = useTradingStore((state) => state.setCurrentPrice);
  const setTicker = useTradingStore((state) => state.setTicker);
  const setConnectionStatus = useTradingStore((state) => state.setConnectionStatus);

  useEffect(() => {
    if (disabled) {
      // Clean up any existing connection when disabled
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      return;
    }

    isCleaningUp.current = false;
    const productId = COINBASE_PRODUCTS[currentSymbol] || 'BTC-USD';
    const granularity = COINBASE_GRANULARITY[currentTimeframe];
    const candleCount = CANDLE_COUNT[currentTimeframe];

    console.log(`[Market] Connecting to ${productId} @ ${currentTimeframe} (granularity: ${granularity}s)...`);

    // Fetch historical candles from Coinbase
    const fetchHistoricalData = async () => {
      try {
        // Calculate time range
        const now = Math.floor(Date.now() / 1000);
        const start = now - (granularity * candleCount);

        const url = `https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${granularity}&start=${start}&end=${now}`;
        console.log('[Market] Fetching:', url);

        const response = await fetch(apiUrl(url));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log(`[Market] Received ${data.length} candles`);

        // Coinbase returns [timestamp, low, high, open, close, volume]
        // Timestamp is in SECONDS, newest first
        const candles: Candle[] = data
          .map((c: number[]) => ({
            time: c[0] * 1000, // Convert seconds to milliseconds
            open: c[3],
            high: c[2],
            low: c[1],
            close: c[4],
            volume: c[5],
          }))
          .sort((a: Candle, b: Candle) => a.time - b.time); // Sort oldest to newest

        console.log(`[Market] First candle: ${new Date(candles[0]?.time).toISOString()}`);
        console.log(`[Market] Last candle: ${new Date(candles[candles.length - 1]?.time).toISOString()}`);

        setCandles(candles);

        if (candles.length > 0) {
          const last = candles[candles.length - 1];
          setCurrentPrice(last.close);
          candleRef.current = { ...last };
          setTicker({
            symbol: currentSymbol,
            price: last.close,
            change24h: 0,
            changePercent24h: 0,
            high24h: last.high,
            low24h: last.low,
            volume24h: last.volume || 0,
          });
        }
      } catch (error) {
        console.error('[Market] Error fetching historical data:', error);
      }
    };

    // Cleanup previous connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionStatus('connecting');
    fetchHistoricalData();

    if (isTauri) {
      // ── Tauri: WebSocket for real-time updates (no CORS in webview) ──
      const ws = new WebSocket(COINBASE_WS);

      ws.onopen = () => {
        console.log('[Market] WebSocket connected, subscribing...');
        ws.send(JSON.stringify({
          type: 'subscribe',
          product_ids: [productId],
          channels: ['ticker'],
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'subscriptions') {
            console.log('[Market] Subscribed successfully');
            setConnectionStatus('connected');
          }

          if (data.type === 'ticker' && data.product_id === productId) {
            const price = parseFloat(data.price);
            const tradeTime = new Date(data.time).getTime();

            setCurrentPrice(price);

            setTicker({
              symbol: currentSymbol,
              price: price,
              change24h: price - parseFloat(data.open_24h || price),
              changePercent24h: data.open_24h
                ? ((price - parseFloat(data.open_24h)) / parseFloat(data.open_24h)) * 100
                : 0,
              high24h: parseFloat(data.high_24h || price),
              low24h: parseFloat(data.low_24h || price),
              volume24h: parseFloat(data.volume_24h || 0),
            });

            if (candleRef.current) {
              const candleInterval = granularity * 1000;
              const currentCandleStart = Math.floor(tradeTime / candleInterval) * candleInterval;

              if (candleRef.current.time === currentCandleStart) {
                candleRef.current = {
                  time: currentCandleStart,
                  open: candleRef.current.open,
                  high: Math.max(candleRef.current.high, price),
                  low: Math.min(candleRef.current.low, price),
                  close: price,
                  volume: candleRef.current.volume,
                };
                updateLastCandle(candleRef.current);
              } else if (currentCandleStart > candleRef.current.time) {
                console.log(`[Market] New candle at ${new Date(currentCandleStart).toISOString()}`);
                candleRef.current = {
                  time: currentCandleStart,
                  open: price,
                  high: price,
                  low: price,
                  close: price,
                  volume: 0,
                };
                updateLastCandle(candleRef.current);
              }
            }
          }
        } catch (error) {
          console.error('[Market] Parse error:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[Market] WebSocket error:', error);
        setConnectionStatus('error');
      };

      ws.onclose = (event) => {
        console.log(`[Market] WebSocket closed: ${event.code}`);
        setConnectionStatus('disconnected');

        if (!isCleaningUp.current && event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isCleaningUp.current) {
              console.log('[Market] Reconnecting...');
              setConnectionStatus('connecting');
            }
          }, 3000);
        }
      };

      wsRef.current = ws;
    } else {
      // ── Web/PWA: REST polling (WebSocket unreliable across browsers) ──
      const pollPrice = async () => {
        try {
          const statsUrl = `https://api.exchange.coinbase.com/products/${productId}/stats`;
          const response = await fetch(apiUrl(statsUrl));
          if (!response.ok) return;
          const stats = await response.json();

          const price = parseFloat(stats.last);
          if (!price || isNaN(price)) return;

          setCurrentPrice(price);
          setConnectionStatus('connected');

          const openPrice = parseFloat(stats.open);
          setTicker({
            symbol: currentSymbol,
            price,
            change24h: openPrice ? price - openPrice : 0,
            changePercent24h: openPrice ? ((price - openPrice) / openPrice) * 100 : 0,
            high24h: parseFloat(stats.high) || price,
            low24h: parseFloat(stats.low) || price,
            volume24h: parseFloat(stats.volume) || 0,
          });

          // Update last candle with live price
          if (candleRef.current) {
            const tradeTime = Date.now();
            const candleInterval = granularity * 1000;
            const currentCandleStart = Math.floor(tradeTime / candleInterval) * candleInterval;

            if (candleRef.current.time === currentCandleStart) {
              candleRef.current = {
                time: currentCandleStart,
                open: candleRef.current.open,
                high: Math.max(candleRef.current.high, price),
                low: Math.min(candleRef.current.low, price),
                close: price,
                volume: candleRef.current.volume,
              };
              updateLastCandle(candleRef.current);
            } else if (currentCandleStart > candleRef.current.time) {
              candleRef.current = {
                time: currentCandleStart,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 0,
              };
              updateLastCandle(candleRef.current);
            }
          }
        } catch (error) {
          console.error('[Market] Poll error:', error);
        }
      };

      pollPrice();
      pollRef.current = setInterval(pollPrice, 2000);
    }

    return () => {
      console.log('[Market] Cleaning up...');
      isCleaningUp.current = true;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [currentSymbol, currentTimeframe, disabled]);

  return {};
}
