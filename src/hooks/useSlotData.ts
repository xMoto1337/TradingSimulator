import { useEffect, useRef } from 'react';
import { fetchStockCandles, fetchStockQuote, fetchDexPrice, fetchDexStats, apiUrl } from '../api';
import { useChartStore } from '../stores/chartStore';
import { useTradingStore } from '../stores/tradingStore';
import type { Candle, Timeframe } from '../types/trading';

const BINANCE_WS = 'wss://stream.binance.com:9443';
const BINANCE_REST = 'https://api.binance.com/api/v3';
const BINANCE_INTERVAL: Record<string, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w', '1M': '1M',
};

const YAHOO_PARAMS: Record<string, { interval: string; range: string }> = {
  '1m': { interval: '1m', range: '1d' },
  '5m': { interval: '5m', range: '5d' },
  '15m': { interval: '15m', range: '1mo' },
  '1h': { interval: '1h', range: '1mo' },
  '4h': { interval: '1h', range: '3mo' },
  '1d': { interval: '1d', range: '1y' },
};

const GECKO_NETWORK: Record<string, string> = {
  'solana': 'solana', 'ethereum': 'eth', 'bsc': 'bsc', 'base': 'base',
  'arbitrum': 'arbitrum', 'polygon': 'polygon_pos', 'avalanche': 'avax',
};

const GECKO_TF: Record<string, { tf: string; aggregate: number }> = {
  '1m': { tf: 'minute', aggregate: 1 }, '5m': { tf: 'minute', aggregate: 5 },
  '15m': { tf: 'minute', aggregate: 15 }, '1h': { tf: 'hour', aggregate: 1 },
  '4h': { tf: 'hour', aggregate: 4 }, '1d': { tf: 'day', aggregate: 1 },
};

/**
 * Per-slot data hook. Each chart slot independently fetches candles and
 * connects to live data, writing directly to chartStore.
 * When the slot is active, this hook is skipped (global hooks in App.tsx handle it).
 */
export function useSlotData(slotId: string, symbol: string, timeframe: Timeframe, isActive: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const candleRef = useRef<Candle | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCandleSyncRef = useRef(0);
  const saveSlotData = useChartStore((s) => s.saveSlotData);

  useEffect(() => {
    // Active slot is handled by global hooks in App.tsx
    if (isActive) {
      doCleanup();
      return;
    }

    let cancelled = false;
    const isCrypto = symbol.endsWith('USDT');
    const isDex = symbol.toLowerCase().startsWith('dex:');

    if (isCrypto) {
      setupCrypto();
    } else if (isDex) {
      setupDex();
    } else {
      setupStock();
    }

    return () => {
      cancelled = true;
      doCleanup();
    };

    function doCleanup() {
      if (wsTimeoutRef.current) {
        clearTimeout(wsTimeoutRef.current);
        wsTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    }

    async function setupCrypto() {
      const binanceSymbol = symbol.toLowerCase();
      const interval = BINANCE_INTERVAL[timeframe] || '1h';

      saveSlotData(slotId, { connectionStatus: 'connecting' });

      // 1. Fetch historical candles from Binance REST (CORS OK)
      try {
        const url = `${BINANCE_REST}/klines?symbol=${symbol}&interval=${interval}&limit=300`;
        const res = await fetch(url);
        if (cancelled) return;
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

        if (candles.length > 0 && !cancelled) {
          const last = candles[candles.length - 1];
          candleRef.current = { ...last };
          saveSlotData(slotId, {
            candles,
            currentPrice: last.close,
            ticker: {
              symbol,
              price: last.close,
              change24h: 0,
              changePercent24h: 0,
              high24h: last.high,
              low24h: last.low,
              volume24h: last.volume || 0,
            },
          });
        }
      } catch (e) {
        console.log(`[Slot ${slotId}] Candle fetch error:`, e);
      }

      if (cancelled) return;

      // 2. Connect Binance WebSocket (combined ticker + kline stream)
      const streams = `${binanceSymbol}@kline_${interval}/${binanceSymbol}@ticker`;
      const ws = new WebSocket(`${BINANCE_WS}/stream?streams=${streams}`);

      wsTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log(`[Slot ${slotId}] WebSocket timeout`);
          ws.close();
          saveSlotData(slotId, { connectionStatus: 'error' });
        }
      }, 5000);

      ws.onopen = () => {
        if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
        saveSlotData(slotId, { connectionStatus: 'connected' });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const d = msg.data;
          if (!d) return;

          if (d.e === '24hrTicker') {
            const price = parseFloat(d.c);
            saveSlotData(slotId, {
              currentPrice: price,
              ticker: {
                symbol,
                price,
                change24h: parseFloat(d.p || '0'),
                changePercent24h: parseFloat(d.P || '0'),
                high24h: parseFloat(d.h || String(price)),
                low24h: parseFloat(d.l || String(price)),
                volume24h: parseFloat(d.v || '0'),
              },
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

            const now = Date.now();
            if (now - lastCandleSyncRef.current > 500) {
              lastCandleSyncRef.current = now;
              const currentSlot = useChartStore.getState().slots[slotId];
              const slotCandles = [...currentSlot.candles];
              if (slotCandles.length > 0 && slotCandles[slotCandles.length - 1].time === candle.time) {
                slotCandles[slotCandles.length - 1] = candle;
              } else {
                slotCandles.push(candle);
              }
              saveSlotData(slotId, { candles: slotCandles });
            }
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {
        if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
        saveSlotData(slotId, { connectionStatus: 'error' });
      };

      ws.onclose = (event) => {
        if (!cancelled && event.code !== 1000) {
          saveSlotData(slotId, { connectionStatus: 'disconnected' });
        }
      };

      wsRef.current = ws;
    }

    async function setupStock() {
      const params = YAHOO_PARAMS[timeframe] || { interval: '1h', range: '1mo' };
      saveSlotData(slotId, { connectionStatus: 'connecting' });

      // Fetch initial candles
      try {
        const result = await fetchStockCandles(symbol, params.interval, params.range);
        if (cancelled) return;

        const candles: Candle[] = result.candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        if (candles.length > 0) {
          saveSlotData(slotId, {
            candles,
            currentPrice: result.current_price,
            ticker: {
              symbol,
              price: result.current_price,
              change24h: result.current_price - result.previous_close,
              changePercent24h: result.previous_close > 0
                ? ((result.current_price - result.previous_close) / result.previous_close) * 100
                : 0,
              high24h: result.day_high,
              low24h: result.day_low,
              volume24h: result.volume,
            },
            connectionStatus: 'connected',
          });
        }
      } catch (e) {
        console.log(`[Slot ${slotId}] Stock fetch error:`, e);
        saveSlotData(slotId, { connectionStatus: 'error' });
        return;
      }

      if (cancelled) return;

      // Poll for price updates
      pollRef.current = setInterval(async () => {
        try {
          const quote = await fetchStockQuote(symbol);
          saveSlotData(slotId, {
            currentPrice: quote.price,
            ticker: {
              symbol,
              price: quote.price,
              change24h: quote.change,
              changePercent24h: quote.change_percent,
              high24h: quote.high,
              low24h: quote.low,
              volume24h: quote.volume,
              marketStatus: quote.market_status as 'pre' | 'regular' | 'post' | 'closed',
            },
          });
        } catch { /* ignore poll errors */ }
      }, 5000);
    }

    async function setupDex() {
      const parts = symbol.split(':');
      if (parts.length !== 3) return;
      const [, chainId, tokenAddress] = parts;
      const network = GECKO_NETWORK[chainId.toLowerCase()];

      saveSlotData(slotId, { connectionStatus: 'connecting' });

      // Find pool address from watchlist metadata
      let poolAddress = '';
      const watchlists = useTradingStore.getState().watchlists;
      const item = watchlists.flatMap((w) => w.items)
        .find((i) => i.symbol.toLowerCase() === symbol.toLowerCase());
      if (item?.name?.includes('|')) {
        const nameParts = item.name.split('|');
        if (nameParts.length >= 3 && nameParts[2]) poolAddress = nameParts[2];
      }

      // Fetch chart candles from GeckoTerminal
      if (network) {
        try {
          if (!poolAddress) {
            const dexResp = await fetch(apiUrl(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`), { cache: 'no-store' });
            const dexData = await dexResp.json();
            if (dexData.pairs?.length > 0) {
              const pair = dexData.pairs.find((p: { chainId: string }) =>
                p.chainId.toLowerCase() === chainId.toLowerCase()
              ) || dexData.pairs[0];
              poolAddress = pair.pairAddress;
            }
          }
          if (poolAddress && !cancelled) {
            const tfConfig = GECKO_TF[timeframe] || { tf: 'hour', aggregate: 1 };
            const resp = await fetch(
              apiUrl(`https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}/ohlcv/${tfConfig.tf}?aggregate=${tfConfig.aggregate}&limit=300`),
              { cache: 'no-store' }
            );
            if (resp.ok && !cancelled) {
              const data = await resp.json();
              if (data.data?.attributes?.ohlcv_list) {
                const candles: Candle[] = data.data.attributes.ohlcv_list
                  .map(([ts, o, h, l, c, v]: number[]) => ({
                    time: ts * 1000, open: o, high: h, low: l, close: c, volume: v,
                  }))
                  .sort((a: Candle, b: Candle) => a.time - b.time);
                if (candles.length > 0) {
                  saveSlotData(slotId, { candles, currentPrice: candles[candles.length - 1].close });
                }
              }
            }
          }
        } catch (e) {
          console.log(`[Slot ${slotId}] DEX candle fetch error:`, e);
        }
      }

      if (cancelled) return;

      // Cached 24h stats (filled by slower DexScreener poll)
      let cachedStats = { change_24h: 0, volume_24h: 0 };
      let preferredSource = '';
      let pollCount = 0;

      // Fast price poll (every 1s) - caches working source to avoid hammering failed APIs
      const fetchPrice = async () => {
        pollCount++;
        if (pollCount % 60 === 0) preferredSource = '';
        try {
          const result = await fetchDexPrice(
            chainId, tokenAddress, poolAddress || null, preferredSource || null,
          );

          const price = result.price;
          if (result.source !== preferredSource) {
            console.log(`[Slot ${slotId}] DEX price: $${price} via ${result.source}`);
          }
          if (!price || isNaN(price) || cancelled) return;
          preferredSource = result.source;

          if (result.pair_address && !poolAddress) poolAddress = result.pair_address;
          if (result.change_24h !== 0 || result.volume_24h !== 0) {
            cachedStats = { change_24h: result.change_24h, volume_24h: result.volume_24h };
          }

          // Update last candle with live price
          const currentSlot = useChartStore.getState().slots[slotId];
          const candles = [...currentSlot.candles];
          if (candles.length > 0) {
            const last = candles[candles.length - 1];
            candles[candles.length - 1] = {
              ...last,
              close: price,
              high: Math.max(last.high, price),
              low: Math.min(last.low, price),
            };
          }

          saveSlotData(slotId, {
            currentPrice: price,
            candles: candles.length > 0 ? candles : undefined,
            ticker: {
              symbol,
              price,
              change24h: price * ((cachedStats.change_24h ?? 0) / 100),
              changePercent24h: cachedStats.change_24h ?? 0,
              high24h: price * (1 + Math.abs(cachedStats.change_24h ?? 0) / 100),
              low24h: price * (1 - Math.abs(cachedStats.change_24h ?? 0) / 100),
              volume24h: cachedStats.volume_24h ?? 0,
            },
            connectionStatus: 'connected',
          });
        } catch { /* ignore poll errors */ }
      };

      // Slow stats poll (every 30s) - always DexScreener for 24h change/volume
      const fetchStats = async () => {
        try {
          const result = await fetchDexStats(
            chainId, tokenAddress, poolAddress || null,
          );
          if (result.pair_address && !poolAddress) poolAddress = result.pair_address;
          cachedStats = { change_24h: result.change_24h, volume_24h: result.volume_24h };
        } catch { /* non-critical */ }
      };

      fetchPrice();
      fetchStats();
      pollRef.current = setInterval(fetchPrice, 1000);
      statsIntervalRef.current = setInterval(fetchStats, 30000);
    }
  }, [slotId, symbol, timeframe, isActive, saveSlotData]);
}
