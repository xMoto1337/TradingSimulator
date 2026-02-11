import { useEffect, useRef } from 'react';
import { useTradingStore } from '../stores/tradingStore';
import type { Candle, Timeframe } from '../types/trading';

// Binance — CORS OK, real-time WebSocket, no proxy needed
const BINANCE_WS = 'wss://stream.binance.com:9443';
const BINANCE_REST = 'https://api.binance.com/api/v3';
const BINANCE_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w', '1M': '1M',
};
const CANDLE_COUNT = 300;

export function useMarketData(disabled = false) {
  const wsRef = useRef<WebSocket | null>(null);
  const candleRef = useRef<Candle | null>(null);
  const wsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCleaningUp = useRef(false);

  const currentSymbol = useTradingStore((s) => s.currentSymbol);
  const currentTimeframe = useTradingStore((s) => s.currentTimeframe);
  const setCandles = useTradingStore((s) => s.setCandles);
  const updateLastCandle = useTradingStore((s) => s.updateLastCandle);
  const setCurrentPrice = useTradingStore((s) => s.setCurrentPrice);
  const setTicker = useTradingStore((s) => s.setTicker);
  const setConnectionStatus = useTradingStore((s) => s.setConnectionStatus);

  useEffect(() => {
    if (disabled) {
      cleanup();
      return;
    }

    isCleaningUp.current = false;
    cleanup();
    setConnectionStatus('connecting');

    const symbol = currentSymbol; // Already in Binance format (BTCUSDT)
    const interval = BINANCE_INTERVAL[currentTimeframe];

    console.log(`[Binance] Connecting: ${symbol} @ ${interval}...`);

    // 1. Fetch historical candles (direct REST, CORS OK)
    (async () => {
      try {
        const url = `${BINANCE_REST}/klines?symbol=${symbol}&interval=${interval}&limit=${CANDLE_COUNT}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const candles: Candle[] = data.map((k: (string | number)[]) => ({
          time: Number(k[0]),
          open: parseFloat(k[1] as string),
          high: parseFloat(k[2] as string),
          low: parseFloat(k[3] as string),
          close: parseFloat(k[4] as string),
          volume: parseFloat(k[5] as string),
        }));

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
      } catch (err) {
        console.error('[Binance] Candle fetch error:', err);
      }
    })();

    // 2. Connect WebSocket (combined ticker + kline stream)
    const streams = `${symbol.toLowerCase()}@kline_${interval}/${symbol.toLowerCase()}@ticker`;
    const ws = new WebSocket(`${BINANCE_WS}/stream?streams=${streams}`);

    wsTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log('[Binance] WS timeout');
        ws.close();
        setConnectionStatus('error');
      }
    }, 5000);

    ws.onopen = () => {
      console.log('[Binance] WebSocket connected');
      if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const d = msg.data;
        if (!d) return;

        if (d.e === '24hrTicker') {
          const price = parseFloat(d.c);
          setCurrentPrice(price);
          setTicker({
            symbol: currentSymbol,
            price,
            change24h: parseFloat(d.p || '0'),
            changePercent24h: parseFloat(d.P || '0'),
            high24h: parseFloat(d.h || String(price)),
            low24h: parseFloat(d.l || String(price)),
            volume24h: parseFloat(d.v || '0'),
          });
        }

        if (d.e === 'kline' && d.k) {
          const k = d.k;
          const candle: Candle = {
            time: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };
          candleRef.current = candle;
          updateLastCandle(candle);
        }
      } catch (err) {
        console.error('[Binance] Parse error:', err);
      }
    };

    ws.onerror = () => {
      console.error('[Binance] WebSocket error');
      if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
      setConnectionStatus('error');
    };

    ws.onclose = (event) => {
      if (!isCleaningUp.current && event.code !== 1000) {
        setConnectionStatus('disconnected');
      }
    };

    wsRef.current = ws;

    return () => {
      isCleaningUp.current = true;
      cleanup();
    };

    function cleanup() {
      if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
      if (wsRef.current) { wsRef.current.close(1000); wsRef.current = null; }
    }
  }, [currentSymbol, currentTimeframe, disabled]);

  return {};
}
