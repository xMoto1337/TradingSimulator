import { useEffect, useRef } from 'react';
import { fetchStockCandles, fetchStockQuote } from '../api';
import { useTradingStore } from '../stores/tradingStore';
import type { Candle, Timeframe } from '../types/trading';

// Map timeframes to Yahoo Finance intervals
const INTERVAL_MAP: Record<Timeframe, string> = {
  '1m': '1m',
  '3m': '5m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '1h',
  '1d': '1d',
  '1w': '1wk',
  '1M': '1mo',
};

const RANGE_MAP: Record<Timeframe, string> = {
  '1m': '1d',
  '3m': '5d',
  '5m': '5d',
  '15m': '5d',
  '30m': '1mo',
  '1h': '1mo',
  '4h': '3mo',
  '1d': '1y',
  '1w': '5y',
  '1M': '10y',
};

export function useYahooFinanceData(disabled = false) {
  const currentSymbol = useTradingStore((s) => s.currentSymbol);
  const currentTimeframe = useTradingStore((s) => s.currentTimeframe);
  const setCandles = useTradingStore((s) => s.setCandles);
  const setCurrentPrice = useTradingStore((s) => s.setCurrentPrice);
  const setTicker = useTradingStore((s) => s.setTicker);
  const setConnectionStatus = useTradingStore((s) => s.setConnectionStatus);

  const lastPriceRef = useRef<number>(0);
  const candlesRef = useRef<Candle[]>([]);

  // Check if this is a stock symbol
  const isStock = !currentSymbol.endsWith('USDT') && !currentSymbol.toLowerCase().startsWith('dex:');

  useEffect(() => {
    console.log('[Yahoo] Hook called:', { disabled, isStock, currentSymbol });

    if (disabled || !isStock) {
      return;
    }

    console.log('[Yahoo] Starting for:', currentSymbol);

    // Fetch candles (less frequently)
    const fetchCandles = async () => {
      try {
        const interval = INTERVAL_MAP[currentTimeframe];
        const range = RANGE_MAP[currentTimeframe];

        console.log(`[Yahoo] Fetching candles for ${currentSymbol}`);

        const response = await fetchStockCandles(currentSymbol, interval, range);

        if (response.candles.length > 0) {
          const candles: Candle[] = response.candles.map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          }));

          candlesRef.current = candles;
          setCandles(candles);
          console.log(`[Yahoo] Loaded ${candles.length} candles`);
        }
      } catch (error) {
        console.error('[Yahoo] Candles error:', error);
      }
    };

    // Fetch quote (more frequently - includes extended hours)
    const fetchQuote = async () => {
      try {
        console.log(`[Yahoo] Fetching quote for ${currentSymbol}`);

        const quote = await fetchStockQuote(currentSymbol);

        console.log(`[Yahoo] Quote response:`, quote);

        if (quote.price > 0) {
          // Log price changes
          if (quote.price !== lastPriceRef.current) {
            console.log(`[Yahoo] Price: $${lastPriceRef.current.toFixed(2)} -> $${quote.price.toFixed(2)}`);
            lastPriceRef.current = quote.price;
          }

          setCurrentPrice(quote.price);

          // Update last candle with current price
          if (candlesRef.current.length > 0) {
            const updatedCandles = [...candlesRef.current];
            const lastCandle = { ...updatedCandles[updatedCandles.length - 1] };
            lastCandle.close = quote.price;
            lastCandle.high = Math.max(lastCandle.high, quote.price);
            lastCandle.low = Math.min(lastCandle.low, quote.price);
            updatedCandles[updatedCandles.length - 1] = lastCandle;
            setCandles(updatedCandles);
          }

          setTicker({
            symbol: currentSymbol,
            price: quote.price,
            change24h: quote.change,
            changePercent24h: quote.change_percent,
            high24h: quote.high,
            low24h: quote.low,
            volume24h: quote.volume,
            marketStatus: quote.market_status,
          });

          setConnectionStatus('connected');
        }
      } catch (error) {
        console.error('[Yahoo] Quote error:', error);
        if (!lastPriceRef.current) {
          setConnectionStatus('error');
        }
      }
    };

    // Fetch candles immediately, then every 30 seconds
    fetchCandles();
    const candleInterval = setInterval(fetchCandles, 30000);

    // Fetch quote immediately, then every 2 seconds
    fetchQuote();
    const quoteInterval = setInterval(fetchQuote, 2000);

    return () => {
      console.log('[Yahoo] Cleanup for:', currentSymbol);
      clearInterval(candleInterval);
      clearInterval(quoteInterval);
    };
  }, [currentSymbol, currentTimeframe, isStock, disabled, setCandles, setCurrentPrice, setTicker, setConnectionStatus]);

  return { isStock };
}
