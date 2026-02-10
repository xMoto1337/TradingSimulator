import { useEffect, useRef } from 'react';
import { fetchStockCandles, fetchStockQuote, fetchDexPrice, fetchDexStats, apiUrl, isTauri } from '../api';
import { useChartStore } from '../stores/chartStore';
import { useTradingStore } from '../stores/tradingStore';
import type { Candle, Timeframe } from '../types/trading';

const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com';

const GRANULARITY: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 21600, '1d': 86400,
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
      const productId = symbol.replace('USDT', '-USD');
      const granularity = GRANULARITY[timeframe] || 3600;

      saveSlotData(slotId, { connectionStatus: 'connecting' });

      // Fetch historical candles
      try {
        const now = Math.floor(Date.now() / 1000);
        const start = now - granularity * 300;
        const url = `https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${granularity}&start=${start}&end=${now}`;
        const response = await fetch(apiUrl(url));
        if (cancelled) return;

        if (response.ok) {
          const data = await response.json();
          const candles: Candle[] = data
            .map((c: number[]) => ({
              time: c[0] * 1000,
              open: c[3],
              high: c[2],
              low: c[1],
              close: c[4],
              volume: c[5],
            }))
            .sort((a: Candle, b: Candle) => a.time - b.time);

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
        }
      } catch (e) {
        console.log(`[Slot ${slotId}] Candle fetch error:`, e);
      }

      if (cancelled) return;

      if (isTauri) {
        // Tauri: WebSocket for live updates
        const ws = new WebSocket(COINBASE_WS);

        ws.onopen = () => {
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
              saveSlotData(slotId, { connectionStatus: 'connected' });
            }

            if (data.type === 'ticker' && data.product_id === productId) {
              const price = parseFloat(data.price);
              const tradeTime = new Date(data.time).getTime();

              const ticker = {
                symbol,
                price,
                change24h: price - parseFloat(data.open_24h || String(price)),
                changePercent24h: data.open_24h
                  ? ((price - parseFloat(data.open_24h)) / parseFloat(data.open_24h)) * 100
                  : 0,
                high24h: parseFloat(data.high_24h || String(price)),
                low24h: parseFloat(data.low_24h || String(price)),
                volume24h: parseFloat(data.volume_24h || '0'),
              };

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
                } else if (currentCandleStart > candleRef.current.time) {
                  candleRef.current = {
                    time: currentCandleStart,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: 0,
                  };
                }
              }

              const now = Date.now();
              if (now - lastCandleSyncRef.current > 500 && candleRef.current) {
                lastCandleSyncRef.current = now;
                const currentSlot = useChartStore.getState().slots[slotId];
                const candles = [...currentSlot.candles];
                if (candles.length > 0 && candles[candles.length - 1].time === candleRef.current.time) {
                  candles[candles.length - 1] = candleRef.current;
                } else {
                  candles.push(candleRef.current);
                }
                saveSlotData(slotId, { currentPrice: price, ticker, candles });
              } else {
                saveSlotData(slotId, { currentPrice: price, ticker });
              }
            }
          } catch { /* ignore parse errors */ }
        };

        ws.onerror = () => saveSlotData(slotId, { connectionStatus: 'error' });
        ws.onclose = () => saveSlotData(slotId, { connectionStatus: 'disconnected' });

        wsRef.current = ws;
      } else {
        // Web: REST polling for live price updates
        const pollPrice = async () => {
          try {
            const statsUrl = `https://api.exchange.coinbase.com/products/${productId}/stats`;
            const response = await fetch(apiUrl(statsUrl));
            if (!response.ok || cancelled) return;
            const stats = await response.json();

            const price = parseFloat(stats.last);
            if (!price || isNaN(price)) return;

            const openPrice = parseFloat(stats.open);
            const ticker = {
              symbol,
              price,
              change24h: openPrice ? price - openPrice : 0,
              changePercent24h: openPrice ? ((price - openPrice) / openPrice) * 100 : 0,
              high24h: parseFloat(stats.high) || price,
              low24h: parseFloat(stats.low) || price,
              volume24h: parseFloat(stats.volume) || 0,
            };

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
              } else if (currentCandleStart > candleRef.current.time) {
                candleRef.current = {
                  time: currentCandleStart,
                  open: price,
                  high: price,
                  low: price,
                  close: price,
                  volume: 0,
                };
              }
            }

            const currentSlot = useChartStore.getState().slots[slotId];
            const candles = [...currentSlot.candles];
            if (candles.length > 0 && candleRef.current) {
              if (candles[candles.length - 1].time === candleRef.current.time) {
                candles[candles.length - 1] = candleRef.current;
              } else {
                candles.push(candleRef.current);
              }
            }

            saveSlotData(slotId, {
              currentPrice: price,
              ticker,
              candles: candles.length > 0 ? candles : undefined,
              connectionStatus: 'connected',
            });
          } catch { /* ignore poll errors */ }
        };

        pollPrice();
        pollRef.current = setInterval(pollPrice, 3000);
      }
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
