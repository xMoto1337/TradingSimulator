use tauri::{Manager, Emitter};
use tauri_plugin_updater::UpdaterExt;
use std::sync::Mutex;
use serde::{Serialize, Deserialize};

// Store update state
struct UpdateState {
    update_available: Mutex<Option<UpdateInfo>>,
}

#[derive(Clone, Serialize)]
struct UpdateInfo {
    current_version: String,
    new_version: String,
    notes: String,
}

#[derive(Clone, Serialize)]
struct UpdateCheckResult {
    available: bool,
    current_version: String,
    new_version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            let info = UpdateInfo {
                current_version: update.current_version.to_string(),
                new_version: update.version.clone(),
                notes: update.body.clone().unwrap_or_default(),
            };

            // Store the update info for later
            if let Some(state) = app.try_state::<UpdateState>() {
                *state.update_available.lock().unwrap() = Some(info.clone());
            }

            Ok(UpdateCheckResult {
                available: true,
                current_version: info.current_version,
                new_version: Some(info.new_version),
                notes: Some(info.notes),
            })
        }
        Ok(None) => {
            // No update available - get current version from Cargo.toml
            let current = env!("CARGO_PKG_VERSION").to_string();
            Ok(UpdateCheckResult {
                available: false,
                current_version: current,
                new_version: None,
                notes: None,
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle, window: tauri::Window) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        // Emit progress events to the frontend
        let window_clone = window.clone();

        update.download_and_install(
            move |downloaded, total| {
                let progress = if let Some(total) = total {
                    if total > 0 {
                        (downloaded as f64 / total as f64 * 100.0) as u32
                    } else {
                        0
                    }
                } else {
                    0
                };
                let _ = window_clone.emit("update-progress", progress);
            },
            || {
                // Download complete
            }
        ).await.map_err(|e| e.to_string())?;

        // Restart the app
        app.restart();
    }

    Ok(())
}

#[tauri::command]
fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_changelog() -> String {
    include_str!("../../CHANGELOG.md").to_string()
}

// Yahoo Finance response structures
#[derive(Debug, Deserialize)]
struct YahooChartResponse {
    chart: YahooChartResult,
}

#[derive(Debug, Deserialize)]
struct YahooChartResult {
    result: Option<Vec<YahooChartData>>,
}

// Trading period info
#[derive(Debug, Deserialize)]
struct TradingPeriod {
    start: i64,
    end: i64,
}

#[derive(Debug, Deserialize)]
struct CurrentTradingPeriod {
    pre: TradingPeriod,
    regular: TradingPeriod,
    post: TradingPeriod,
}

#[derive(Debug, Deserialize)]
struct YahooChartMeta {
    symbol: Option<String>,
    #[serde(rename = "regularMarketPrice")]
    regular_market_price: Option<f64>,
    #[serde(rename = "previousClose")]
    previous_close: Option<f64>,
    #[serde(rename = "regularMarketDayHigh")]
    regular_market_day_high: Option<f64>,
    #[serde(rename = "regularMarketDayLow")]
    regular_market_day_low: Option<f64>,
    #[serde(rename = "regularMarketVolume")]
    regular_market_volume: Option<i64>,
    // Extended hours
    #[serde(rename = "postMarketPrice")]
    post_market_price: Option<f64>,
    #[serde(rename = "preMarketPrice")]
    pre_market_price: Option<f64>,
    #[serde(rename = "postMarketChange")]
    post_market_change: Option<f64>,
    #[serde(rename = "preMarketChange")]
    pre_market_change: Option<f64>,
    #[serde(rename = "currentTradingPeriod")]
    current_trading_period: Option<CurrentTradingPeriod>,
}

#[derive(Debug, Deserialize)]
struct YahooChartData {
    meta: YahooChartMeta,
    timestamp: Option<Vec<i64>>,
    indicators: YahooIndicators,
}

#[derive(Debug, Deserialize)]
struct YahooIndicators {
    quote: Vec<YahooQuoteData>,
}

#[derive(Debug, Deserialize)]
struct YahooQuoteData {
    open: Vec<Option<f64>>,
    high: Vec<Option<f64>>,
    low: Vec<Option<f64>>,
    close: Vec<Option<f64>>,
    volume: Vec<Option<i64>>,
}

#[derive(Debug, Serialize)]
struct StockCandle {
    time: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: i64,
}

#[derive(Debug, Serialize)]
struct StockChartResponse {
    candles: Vec<StockCandle>,
    current_price: f64,
    previous_close: f64,
    day_high: f64,
    day_low: f64,
    volume: i64,
}

#[derive(Debug, Serialize)]
struct StockQuote {
    symbol: String,
    price: f64,
    change: f64,
    change_percent: f64,
    high: f64,
    low: f64,
    volume: i64,
    market_status: String, // "pre", "regular", "post", "closed"
}


#[tauri::command]
async fn fetch_stock_candles(symbol: String, interval: String, range: String) -> Result<StockChartResponse, String> {
    // Add timestamp to bust cache
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval={}&range={}&_t={}",
        symbol, interval, range, timestamp
    );

    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: YahooChartResponse = response.json().await.map_err(|e| e.to_string())?;

    if let Some(results) = data.chart.result {
        if let Some(result) = results.first() {
            let meta = &result.meta;
            let regular_price = meta.regular_market_price.unwrap_or(0.0);
            let previous_close = meta.previous_close.unwrap_or(0.0);
            let day_high = meta.regular_market_day_high.unwrap_or(0.0);
            let day_low = meta.regular_market_day_low.unwrap_or(0.0);
            let volume = meta.regular_market_volume.unwrap_or(0);

            // Use extended hours price if available, otherwise regular market price
            let current_price = meta.post_market_price
                .or(meta.pre_market_price)
                .unwrap_or(regular_price);

            if let Some(timestamps) = &result.timestamp {
                if let Some(quote) = result.indicators.quote.first() {
                    let mut candles = Vec::new();

                    for i in 0..timestamps.len() {
                        if let (Some(open), Some(high), Some(low), Some(close)) = (
                            quote.open.get(i).and_then(|v| *v),
                            quote.high.get(i).and_then(|v| *v),
                            quote.low.get(i).and_then(|v| *v),
                            quote.close.get(i).and_then(|v| *v),
                        ) {
                            candles.push(StockCandle {
                                time: timestamps[i] * 1000, // Convert to milliseconds
                                open,
                                high,
                                low,
                                close,
                                volume: quote.volume.get(i).and_then(|v| *v).unwrap_or(0),
                            });
                        }
                    }

                    return Ok(StockChartResponse {
                        candles,
                        current_price,
                        previous_close,
                        day_high,
                        day_low,
                        volume,
                    });
                }
            }
        }
    }

    Err("No data returned from Yahoo Finance".to_string())
}

#[tauri::command]
async fn fetch_stock_quote(symbol: String) -> Result<StockQuote, String> {
    // Use v8 chart API instead of v6 quote (which is now blocked)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Use 1d range with 1m interval to get latest data, include extended hours
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1m&range=1d&includePrePost=true&_t={}",
        symbol, timestamp
    );

    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: YahooChartResponse = response.json().await.map_err(|e| e.to_string())?;

    if let Some(results) = data.chart.result {
        if let Some(result) = results.first() {
            let meta = &result.meta;
            let regular_price = meta.regular_market_price.unwrap_or(0.0);
            let previous_close = meta.previous_close.unwrap_or(regular_price);

            // Determine market status based on current time and trading periods
            let now = timestamp as i64;
            let market_status = if let Some(ref period) = meta.current_trading_period {
                if now >= period.pre.start && now < period.pre.end {
                    "pre"
                } else if now >= period.regular.start && now < period.regular.end {
                    "regular"
                } else if now >= period.post.start && now < period.post.end {
                    "post"
                } else {
                    "closed"
                }
            } else {
                "regular" // Default assumption
            };

            // Get the last candle's close price (most recent trading price)
            let last_candle_price = if let Some(ref timestamps) = result.timestamp {
                if let Some(quote) = result.indicators.quote.first() {
                    // Find the last valid close price
                    let mut last_price = regular_price;
                    for i in (0..timestamps.len()).rev() {
                        if let Some(Some(close)) = quote.close.get(i) {
                            last_price = *close;
                            break;
                        }
                    }
                    last_price
                } else {
                    regular_price
                }
            } else {
                regular_price
            };

            // Determine which price to use based on market status
            let (price, change) = match market_status {
                "post" => {
                    // After-hours (4-8 PM): use last candle price (most recent trade)
                    let current_price = meta.post_market_price.unwrap_or(last_candle_price);
                    let price_change = meta.post_market_change.unwrap_or(current_price - previous_close);
                    (current_price, price_change)
                }
                "pre" => {
                    // Pre-market (4-9:30 AM): use last candle price
                    let current_price = meta.pre_market_price.unwrap_or(last_candle_price);
                    let price_change = meta.pre_market_change.unwrap_or(current_price - previous_close);
                    (current_price, price_change)
                }
                "closed" => {
                    // Market closed (8 PM - 4 AM): use regular market close price
                    // (overnight/futures data not available via this API)
                    (regular_price, regular_price - previous_close)
                }
                _ => {
                    // Regular hours - use regular market price
                    (regular_price, regular_price - previous_close)
                }
            };

            let change_percent = if previous_close > 0.0 {
                (change / previous_close) * 100.0
            } else {
                0.0
            };

            return Ok(StockQuote {
                symbol: meta.symbol.clone().unwrap_or(symbol),
                price,
                change,
                change_percent,
                high: meta.regular_market_day_high.unwrap_or(0.0),
                low: meta.regular_market_day_low.unwrap_or(0.0),
                volume: meta.regular_market_volume.unwrap_or(0),
                market_status: market_status.to_string(),
            });
        }
    }

    Err("No quote data returned from Yahoo Finance".to_string())
}

// DexScreener response structures
#[derive(Debug, Deserialize)]
struct DexScreenerResponse {
    pairs: Option<Vec<DexPair>>,
    pair: Option<DexPair>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct DexPair {
    #[serde(rename = "chainId")]
    chain_id: Option<String>,
    #[serde(rename = "pairAddress")]
    pair_address: Option<String>,
    #[serde(rename = "priceUsd")]
    price_usd: Option<String>,
    volume: Option<DexVolume>,
    #[serde(rename = "priceChange")]
    price_change: Option<DexPriceChange>,
    liquidity: Option<DexLiquidity>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct DexVolume {
    h24: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct DexPriceChange {
    h24: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct DexLiquidity {
    usd: Option<f64>,
}

// Jupiter Lite API v3 response — top-level is HashMap<mint, data>, no "data" wrapper
#[derive(Debug, Deserialize)]
struct JupiterV3PriceData {
    #[serde(rename = "usdPrice")]
    usd_price: Option<f64>,
    #[serde(rename = "priceChange24h")]
    price_change_24h: Option<f64>,
}

// GeckoTerminal simple token price response
#[derive(Debug, Deserialize)]
struct GeckoTokenPriceResponse {
    data: Option<GeckoTokenPriceData>,
}

#[derive(Debug, Deserialize)]
struct GeckoTokenPriceData {
    attributes: Option<GeckoTokenPriceAttributes>,
}

#[derive(Debug, Deserialize)]
struct GeckoTokenPriceAttributes {
    token_prices: Option<std::collections::HashMap<String, Option<String>>>,
}

// Raydium price API response
#[derive(Debug, Deserialize)]
struct RaydiumPriceResponse {
    data: Option<std::collections::HashMap<String, String>>,
}

fn chain_to_gecko_network(chain_id: &str) -> Option<&'static str> {
    match chain_id.to_lowercase().as_str() {
        "solana" => Some("solana"),
        "ethereum" => Some("eth"),
        "bsc" => Some("bsc"),
        "base" => Some("base"),
        "arbitrum" => Some("arbitrum"),
        "polygon" => Some("polygon_pos"),
        "avalanche" => Some("avax"),
        "optimism" => Some("optimism"),
        _ => None,
    }
}

#[derive(Debug, Serialize)]
struct DexPriceResult {
    price: f64,
    change_24h: f64,
    volume_24h: f64,
    pair_address: String,
    source: String,
}

#[tauri::command]
async fn fetch_dex_price(chain_id: String, address: String, pair_address: Option<String>, preferred_source: Option<String>) -> Result<DexPriceResult, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let pref = preferred_source.as_deref().unwrap_or("");
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    // Helper closures for each source
    let try_jupiter = |client: &reqwest::Client, address: &str, pair_address: &Option<String>| {
        let client = client.clone();
        let address = address.to_string();
        let pa = pair_address.clone();
        let ua = ua.to_string();
        async move {
            // Jupiter Lite API v3 — free, no API key, 60 req/min
            // Response is top-level HashMap<mint, {usdPrice, priceChange24h, ...}>
            let url = format!("https://lite-api.jup.ag/price/v3?ids={}", address);
            let response = client.get(&url)
                .header("User-Agent", &ua)
                .header("Accept", "application/json")
                .send()
                .await.map_err(|e| format!("Jupiter request: {}", e))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("Jupiter status {}", status));
            }
            let data: std::collections::HashMap<String, JupiterV3PriceData> = response.json().await
                .map_err(|e| format!("Jupiter parse: {}", e))?;
            let token = data.get(&address).ok_or("Jupiter: token not found")?;
            let price = token.usd_price.ok_or("Jupiter: no usdPrice")?;
            if price <= 0.0 { return Err("Jupiter: price zero".to_string()); }
            let change_24h = token.price_change_24h.unwrap_or(0.0);
            eprintln!("[price] Jupiter v3 OK: ${} (24h: {:.2}%)", price, change_24h);
            Ok(DexPriceResult {
                price, change_24h, volume_24h: 0.0,
                pair_address: pa.unwrap_or_default(),
                source: "jupiter".to_string(),
            })
        }
    };

    let try_raydium = |client: &reqwest::Client, address: &str, pair_address: &Option<String>| {
        let client = client.clone();
        let address = address.to_string();
        let pa = pair_address.clone();
        let ua = ua.to_string();
        async move {
            // Raydium API v3 — free, no API key
            let url = format!("https://api-v3.raydium.io/mint/price?mints={}", address);
            let response = client.get(&url)
                .header("User-Agent", &ua)
                .header("Accept", "application/json")
                .send()
                .await.map_err(|e| format!("Raydium request: {}", e))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("Raydium status {}", status));
            }
            let data: RaydiumPriceResponse = response.json().await
                .map_err(|e| format!("Raydium parse: {}", e))?;
            let prices = data.data.ok_or("Raydium: no data")?;
            let price_str = prices.get(&address).ok_or("Raydium: token not found")?;
            let price: f64 = price_str.parse().map_err(|_| "Raydium: invalid price")?;
            if price <= 0.0 { return Err("Raydium: price zero".to_string()); }
            eprintln!("[price] Raydium OK: ${}", price);
            Ok(DexPriceResult {
                price, change_24h: 0.0, volume_24h: 0.0,
                pair_address: pa.unwrap_or_default(),
                source: "raydium".to_string(),
            })
        }
    };

    let try_gecko = |client: &reqwest::Client, chain_id: &str, address: &str, pair_address: &Option<String>| {
        let client = client.clone();
        let address = address.to_string();
        let pa = pair_address.clone();
        let network = chain_to_gecko_network(chain_id).unwrap_or("").to_string();
        let ua = ua.to_string();
        async move {
            if network.is_empty() { return Err("Gecko: unsupported chain".to_string()); }
            let url = format!(
                "https://api.geckoterminal.com/api/v2/simple/networks/{}/token_price/{}",
                network, address
            );
            let response = client.get(&url)
                .header("User-Agent", &ua)
                .header("Accept", "application/json")
                .send()
                .await.map_err(|e| format!("Gecko request: {}", e))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("Gecko status {}", status));
            }
            let data: GeckoTokenPriceResponse = response.json().await
                .map_err(|e| format!("Gecko parse: {}", e))?;
            let price_data = data.data.ok_or("Gecko: no data")?;
            let attrs = price_data.attributes.ok_or("Gecko: no attributes")?;
            let prices = attrs.token_prices.ok_or("Gecko: no token_prices")?;
            let price_opt = prices.get(&address).or_else(|| prices.get(&address.to_lowercase()));
            let price_str = price_opt
                .and_then(|v| v.as_ref())
                .ok_or("Gecko: token not in results")?;
            let price: f64 = price_str.parse().map_err(|_| "Gecko: invalid price")?;
            if price <= 0.0 { return Err("Gecko: price zero".to_string()); }
            eprintln!("[price] GeckoTerminal OK: ${}", price);
            Ok(DexPriceResult {
                price, change_24h: 0.0, volume_24h: 0.0,
                pair_address: pa.unwrap_or_default(),
                source: "gecko".to_string(),
            })
        }
    };

    let try_dexscreener = |client: &reqwest::Client, chain_id: &str, address: &str, pair_address: &Option<String>| {
        let client = client.clone();
        let chain_id = chain_id.to_string();
        let address = address.to_string();
        let pa = pair_address.clone();
        let ua = ua.to_string();
        async move {
            // Try pairs endpoint first
            if let Some(ref pa_str) = pa {
                let url = format!("https://api.dexscreener.com/latest/dex/pairs/{}/{}", chain_id, pa_str);
                if let Ok(response) = client.get(&url)
                    .header("User-Agent", &ua)
                    .send().await
                {
                    if let Ok(data) = response.json::<DexScreenerResponse>().await {
                        let pair = data.pairs.as_ref().and_then(|p| p.first()).or(data.pair.as_ref());
                        if let Some(pair) = pair {
                            if let Some(ref ps) = pair.price_usd {
                                if let Ok(price) = ps.parse::<f64>() {
                                    if price > 0.0 {
                                        eprintln!("[price] DexScreener OK: ${}", price);
                                        return Ok(DexPriceResult {
                                            price,
                                            change_24h: pair.price_change.as_ref().and_then(|p| p.h24).unwrap_or(0.0),
                                            volume_24h: pair.volume.as_ref().and_then(|v| v.h24).unwrap_or(0.0),
                                            pair_address: pair.pair_address.clone().unwrap_or_default(),
                                            source: "dexscreener".to_string(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // Fall back to tokens endpoint
            let url = format!("https://api.dexscreener.com/latest/dex/tokens/{}", address);
            let response = client.get(&url)
                .header("User-Agent", &ua)
                .send().await.map_err(|e| format!("DexScreener: {}", e))?;
            let data: DexScreenerResponse = response.json().await
                .map_err(|e| format!("DexScreener parse: {}", e))?;
            let pairs = data.pairs.ok_or("DexScreener: no pairs")?;
            let best = pairs.iter()
                .filter(|p| p.chain_id.as_ref().map(|c| c.to_lowercase()) == Some(chain_id.to_lowercase()))
                .max_by(|a, b| {
                    let la = a.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
                    let lb = b.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
                    la.partial_cmp(&lb).unwrap_or(std::cmp::Ordering::Equal)
                })
                .or_else(|| pairs.first())
                .ok_or("DexScreener: no suitable pair")?;
            let price: f64 = best.price_usd.as_ref().ok_or("DexScreener: no price")?
                .parse().map_err(|_| "DexScreener: invalid price")?;
            eprintln!("[price] DexScreener OK: ${}", price);
            Ok(DexPriceResult {
                price,
                change_24h: best.price_change.as_ref().and_then(|p| p.h24).unwrap_or(0.0),
                volume_24h: best.volume.as_ref().and_then(|v| v.h24).unwrap_or(0.0),
                pair_address: best.pair_address.clone().unwrap_or_default(),
                source: "dexscreener".to_string(),
            })
        }
    };

    let is_solana = chain_id.to_lowercase() == "solana";

    // For Solana: ALWAYS try Jupiter first, then Raydium — both are real-time.
    // Don't let preferred_source skip them, because gecko/dexscreener are too slow.
    if is_solana {
        match try_jupiter(&client, &address, &pair_address).await {
            Ok(result) => return Ok(result),
            Err(e) => eprintln!("[price] Jupiter failed: {}", e),
        }
        match try_raydium(&client, &address, &pair_address).await {
            Ok(result) => return Ok(result),
            Err(e) => eprintln!("[price] Raydium failed: {}", e),
        }
    }

    // For non-Solana (or Solana fallback): use preferred source if we have one
    if pref == "gecko" {
        if let Ok(result) = try_gecko(&client, &chain_id, &address, &pair_address).await {
            return Ok(result);
        }
    } else if pref == "dexscreener" {
        if let Ok(result) = try_dexscreener(&client, &chain_id, &address, &pair_address).await {
            return Ok(result);
        }
    }

    // Try remaining sources in order
    if let Ok(result) = try_gecko(&client, &chain_id, &address, &pair_address).await {
        return Ok(result);
    }
    try_dexscreener(&client, &chain_id, &address, &pair_address).await
}

// Separate command for 24h stats (called less frequently)
#[tauri::command]
async fn fetch_dex_stats(chain_id: String, address: String, pair_address: Option<String>) -> Result<DexPriceResult, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // Always use DexScreener for stats (24h change, volume)
    if let Some(ref pa) = pair_address {
        let url = format!(
            "https://api.dexscreener.com/latest/dex/pairs/{}/{}",
            chain_id, pa
        );
        if let Ok(response) = client.get(&url).send().await {
            if let Ok(data) = response.json::<DexScreenerResponse>().await {
                let pair = data.pairs.as_ref().and_then(|p| p.first()).or(data.pair.as_ref());
                if let Some(pair) = pair {
                    let price = pair.price_usd.as_ref()
                        .and_then(|s| s.parse::<f64>().ok())
                        .unwrap_or(0.0);
                    return Ok(DexPriceResult {
                        price,
                        change_24h: pair.price_change.as_ref().and_then(|p| p.h24).unwrap_or(0.0),
                        volume_24h: pair.volume.as_ref().and_then(|v| v.h24).unwrap_or(0.0),
                        pair_address: pair.pair_address.clone().unwrap_or_default(),
                        source: "dexscreener".to_string(),
                    });
                }
            }
        }
    }

    // Fall back to tokens endpoint
    let url = format!("https://api.dexscreener.com/latest/dex/tokens/{}", address);
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let data: DexScreenerResponse = response.json().await.map_err(|e| e.to_string())?;
    let pairs = data.pairs.ok_or("No pairs found")?;

    let best = pairs.iter()
        .filter(|p| p.chain_id.as_ref().map(|c| c.to_lowercase()) == Some(chain_id.to_lowercase()))
        .max_by(|a, b| {
            let la = a.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
            let lb = b.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
            la.partial_cmp(&lb).unwrap_or(std::cmp::Ordering::Equal)
        })
        .or_else(|| pairs.first())
        .ok_or("No pair found")?;

    let price = best.price_usd.as_ref().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    Ok(DexPriceResult {
        price,
        change_24h: best.price_change.as_ref().and_then(|p| p.h24).unwrap_or(0.0),
        volume_24h: best.volume.as_ref().and_then(|v| v.h24).unwrap_or(0.0),
        pair_address: best.pair_address.clone().unwrap_or_default(),
        source: "dexscreener".to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(UpdateState {
            update_available: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            install_update,
            get_current_version,
            get_changelog,
            fetch_stock_candles,
            fetch_stock_quote,
            fetch_dex_price,
            fetch_dex_stats
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Set window icon (works in both dev and production)
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes: &[u8] = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
