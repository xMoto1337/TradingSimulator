/**
 * API abstraction layer — detects Tauri vs browser environment.
 * In Tauri: uses invoke() to call Rust backend.
 * In web/PWA: uses direct fetch() or proxy.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTauri = !!(window as any).__TAURI__;

// Proxy URL for CORS-blocked APIs. Set via env or defaults to relative /api.
const PROXY_BASE = import.meta.env.VITE_PROXY_URL || '/api';

/**
 * Only proxy hosts that actually block CORS in the browser.
 * DexScreener, GeckoTerminal, Jupiter, Raydium all support CORS — fetch direct.
 * In Tauri mode, returns the URL unchanged (webview doesn't enforce CORS).
 */
const PROXY_HOSTS = new Set([
  'api.exchange.coinbase.com',
]);

export function apiUrl(url: string): string {
  if (isTauri) return url;
  try {
    const host = new URL(url).hostname;
    if (PROXY_HOSTS.has(host)) {
      return `${PROXY_BASE}/proxy?url=${encodeURIComponent(url)}`;
    }
  } catch { /* invalid URL, return as-is */ }
  return url;
}

// ─── Types ───────────────────────────────────────────────────────────

export interface StockChartResponse {
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  current_price: number;
  previous_close: number;
  day_high: number;
  day_low: number;
  volume: number;
}

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  change_percent: number;
  high: number;
  low: number;
  volume: number;
  market_status: 'pre' | 'regular' | 'post' | 'closed';
}

export interface DexPriceResult {
  price: number;
  change_24h: number;
  volume_24h: number;
  pair_address: string;
  source: string;
}

export interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  new_version: string | null;
  notes: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const CHAIN_TO_GECKO: Record<string, string> = {
  solana: 'solana',
  ethereum: 'eth',
  bsc: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  avalanche: 'avax',
  optimism: 'optimism',
};

async function tryFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal, ...options });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Stock APIs (Yahoo Finance — needs proxy in web) ────────────────

export async function fetchStockCandles(
  symbol: string,
  interval: string,
  range: string,
): Promise<StockChartResponse> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<StockChartResponse>('fetch_stock_candles', { symbol, interval, range });
  }

  // Web: proxy through serverless function
  const params = new URLSearchParams({ symbol, interval, range });
  return tryFetchJson<StockChartResponse>(`${PROXY_BASE}/stock/candles?${params}`);
}

export async function fetchStockQuote(symbol: string): Promise<StockQuote> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<StockQuote>('fetch_stock_quote', { symbol });
  }

  const params = new URLSearchParams({ symbol });
  return tryFetchJson<StockQuote>(`${PROXY_BASE}/stock/quote?${params}`);
}

// ─── DEX Price APIs (direct fetch from browser — CORS OK) ──────────

async function tryJupiter(address: string): Promise<DexPriceResult> {
  const data = await tryFetchJson<Record<string, { usdPrice?: number; priceChange24h?: number }>>(
    `https://api.jup.ag/price/v3?ids=${address}`,
  );
  const token = data[address];
  if (!token?.usdPrice || token.usdPrice <= 0) throw new Error('Jupiter: no price');
  return {
    price: token.usdPrice,
    change_24h: token.priceChange24h ?? 0,
    volume_24h: 0,
    pair_address: '',
    source: 'jupiter',
  };
}

async function tryRaydium(address: string): Promise<DexPriceResult> {
  const data = await tryFetchJson<{ data?: Record<string, string> }>(
    `https://api-v3.raydium.io/mint/price?mints=${address}`,
  );
  const priceStr = data.data?.[address];
  if (!priceStr) throw new Error('Raydium: no data');
  const price = parseFloat(priceStr);
  if (!price || price <= 0) throw new Error('Raydium: invalid price');
  return { price, change_24h: 0, volume_24h: 0, pair_address: '', source: 'raydium' };
}

interface DexScreenerPair {
  chainId?: string;
  pairAddress?: string;
  priceUsd?: string;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
}

async function tryGecko(chainId: string, address: string): Promise<DexPriceResult> {
  const network = CHAIN_TO_GECKO[chainId.toLowerCase()];
  if (!network) throw new Error('Gecko: unsupported chain');
  const data = await tryFetchJson<{
    data?: { attributes?: { token_prices?: Record<string, string | null> } };
  }>(`https://api.geckoterminal.com/api/v2/simple/networks/${network}/token_price/${address}`);
  const prices = data.data?.attributes?.token_prices;
  if (!prices) throw new Error('Gecko: no data');
  const priceStr = prices[address] ?? prices[address.toLowerCase()];
  if (!priceStr) throw new Error('Gecko: token not found');
  const price = parseFloat(priceStr);
  if (!price || price <= 0) throw new Error('Gecko: invalid price');
  return { price, change_24h: 0, volume_24h: 0, pair_address: '', source: 'gecko' };
}

async function tryDexScreener(
  chainId: string,
  address: string,
  pairAddress: string | null,
): Promise<DexPriceResult> {
  // Try pairs endpoint first if we have a pair address
  if (pairAddress) {
    try {
      const data = await tryFetchJson<{ pairs?: DexScreenerPair[]; pair?: DexScreenerPair }>(
        `https://api.dexscreener.com/latest/dex/pairs/${chainId}/${pairAddress}`,
      );
      const pair = data.pairs?.[0] ?? data.pair;
      if (pair?.priceUsd) {
        const price = parseFloat(pair.priceUsd);
        if (price > 0) {
          return {
            price,
            change_24h: pair.priceChange?.h24 ?? 0,
            volume_24h: pair.volume?.h24 ?? 0,
            pair_address: pair.pairAddress ?? '',
            source: 'dexscreener',
          };
        }
      }
    } catch { /* fall through to tokens endpoint */ }
  }

  // Tokens endpoint
  const data = await tryFetchJson<{ pairs?: DexScreenerPair[] }>(
    `https://api.dexscreener.com/latest/dex/tokens/${address}`,
  );
  if (!data.pairs?.length) throw new Error('DexScreener: no pairs');

  // Pick pair with highest liquidity on matching chain
  const best =
    data.pairs
      .filter((p) => p.chainId?.toLowerCase() === chainId.toLowerCase())
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ??
    data.pairs[0];

  if (!best.priceUsd) throw new Error('DexScreener: no price');
  const price = parseFloat(best.priceUsd);
  if (price <= 0) throw new Error('DexScreener: price zero');

  return {
    price,
    change_24h: best.priceChange?.h24 ?? 0,
    volume_24h: best.volume?.h24 ?? 0,
    pair_address: best.pairAddress ?? '',
    source: 'dexscreener',
  };
}

export async function fetchDexPrice(
  chainId: string,
  address: string,
  pairAddress: string | null,
  preferredSource: string | null,
): Promise<DexPriceResult> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<DexPriceResult>('fetch_dex_price', {
      chainId,
      address,
      pairAddress,
      preferredSource,
    });
  }

  // Web: try preferred (cached) source FIRST for fastest response
  if (preferredSource) {
    try {
      switch (preferredSource) {
        case 'jupiter': return await tryJupiter(address);
        case 'raydium': return await tryRaydium(address);
        case 'gecko': return await tryGecko(chainId, address);
        case 'dexscreener': return await tryDexScreener(chainId, address, pairAddress);
      }
    } catch { /* preferred source failed, fall through to full chain */ }
  }

  // Full fallback chain
  const isSolana = chainId.toLowerCase() === 'solana';

  if (isSolana) {
    try { return await tryJupiter(address); } catch { /* next */ }
    try { return await tryRaydium(address); } catch { /* next */ }
  }

  try { return await tryGecko(chainId, address); } catch { /* next */ }
  return tryDexScreener(chainId, address, pairAddress);
}

export async function fetchDexStats(
  chainId: string,
  address: string,
  pairAddress: string | null,
): Promise<DexPriceResult> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<DexPriceResult>('fetch_dex_stats', { chainId, address, pairAddress });
  }

  // Web: always DexScreener for stats
  return tryDexScreener(chainId, address, pairAddress);
}

// ─── Version & Changelog ────────────────────────────────────────────

export async function getVersion(): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('get_current_version');
  }
  return __APP_VERSION__;
}

export async function getChangelog(): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('get_changelog');
  }
  try {
    const res = await fetch('/CHANGELOG.md');
    if (!res.ok) return '';
    return res.text();
  } catch {
    return '';
  }
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<UpdateCheckResult>('check_for_update');
  }
  // Web: no updater
  return { available: false, current_version: __APP_VERSION__, new_version: null, notes: null };
}

// ─── Tauri feature detection ────────────────────────────────────────

export { isTauri };
