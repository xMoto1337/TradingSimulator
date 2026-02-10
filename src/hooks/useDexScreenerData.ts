import { useEffect, useRef } from 'react';
import { fetchDexPrice, fetchDexStats } from '../api';
import { useTradingStore } from '../stores/tradingStore';

export function useDexScreenerData(disabled = false) {
  const { currentSymbol, setCurrentPrice, setTicker, setConnectionStatus, updateLastCandle, watchlists } = useTradingStore();
  const priceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPriceRef = useRef<number>(0);
  const pairAddressRef = useRef<string>('');
  const statsRef = useRef<{ change_24h: number; volume_24h: number }>({ change_24h: 0, volume_24h: 0 });
  const preferredSourceRef = useRef<string>('');

  const isDexToken = currentSymbol.toLowerCase().startsWith('dex:');

  useEffect(() => {
    if (disabled || !isDexToken) {
      return;
    }

    const parts = currentSymbol.split(':');
    if (parts.length !== 3) {
      setConnectionStatus('error');
      return;
    }

    const [, chainId, tokenAddress] = parts;

    // Try to get pair address from watchlist metadata
    pairAddressRef.current = '';
    const item = watchlists.flatMap((w) => w.items)
      .find((i) => i.symbol.toLowerCase() === currentSymbol.toLowerCase());
    if (item?.name?.includes('|')) {
      const nameParts = item.name.split('|');
      if (nameParts.length >= 3 && nameParts[2]) {
        pairAddressRef.current = nameParts[2];
      }
    }

    // Reset preferred source on symbol change
    preferredSourceRef.current = '';
    let pollCount = 0;

    // Fast price polling (every 1s) - uses cached preferred source to avoid hammering failed APIs
    const fetchPrice = async () => {
      // Every 60 polls (~60s), reset preferred source to re-discover fastest API
      pollCount++;
      if (pollCount % 60 === 0) preferredSourceRef.current = '';
      try {
        const result = await fetchDexPrice(
          chainId,
          tokenAddress,
          pairAddressRef.current || null,
          preferredSourceRef.current || null,
        );

        const price = result.price;
        if (result.source !== preferredSourceRef.current) {
          console.log(`[DEX price] $${price} via ${result.source} (${chainId}/${tokenAddress.slice(0, 8)}...)`);
        }
        if (!price || isNaN(price)) return;

        // Cache which source works — subsequent polls will try it first (single request)
        preferredSourceRef.current = result.source;

        if (result.pair_address && !pairAddressRef.current) {
          pairAddressRef.current = result.pair_address;
        }

        // Use 24h stats from DexScreener if available, otherwise use cached stats
        if (result.change_24h !== 0 || result.volume_24h !== 0) {
          statsRef.current = { change_24h: result.change_24h, volume_24h: result.volume_24h };
        }

        lastPriceRef.current = price;
        setCurrentPrice(price);

        // Update the last candle with live price
        const candles = useTradingStore.getState().candles;
        if (candles.length > 0) {
          const last = candles[candles.length - 1];
          updateLastCandle({
            ...last,
            close: price,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
          });
        }

        const stats = statsRef.current;
        setTicker({
          symbol: currentSymbol,
          price,
          change24h: price * ((stats.change_24h ?? 0) / 100),
          changePercent24h: stats.change_24h ?? 0,
          high24h: price * (1 + Math.abs(stats.change_24h ?? 0) / 100),
          low24h: price * (1 - Math.abs(stats.change_24h ?? 0) / 100),
          volume24h: stats.volume_24h ?? 0,
        });

        setConnectionStatus('connected');
      } catch (error) {
        console.error(`[DEX price] Error for ${chainId}/${tokenAddress.slice(0, 8)}:`, error);
        if (!lastPriceRef.current) setConnectionStatus('error');
      }
    };

    // Slow stats polling (every 30s) - always from DexScreener for 24h change/volume
    const fetchStats = async () => {
      try {
        const result = await fetchDexStats(
          chainId,
          tokenAddress,
          pairAddressRef.current || null,
        );

        if (result.pair_address && !pairAddressRef.current) {
          pairAddressRef.current = result.pair_address;
        }

        statsRef.current = { change_24h: result.change_24h, volume_24h: result.volume_24h };
      } catch { /* stats fetch is non-critical */ }
    };

    // Start both polling loops
    fetchPrice();
    fetchStats();
    priceIntervalRef.current = setInterval(fetchPrice, 1000);
    statsIntervalRef.current = setInterval(fetchStats, 30000);

    return () => {
      if (priceIntervalRef.current) {
        clearInterval(priceIntervalRef.current);
        priceIntervalRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, [currentSymbol, isDexToken, disabled, setCurrentPrice, setTicker, setConnectionStatus]);

  return { isDexToken };
}
