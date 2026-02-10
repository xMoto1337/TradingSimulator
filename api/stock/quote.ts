// Vercel serverless function — proxies Yahoo Finance quote API (CORS-blocked from browser)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol' });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true&_t=${timestamp}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const data = await response.json();

    const result = data.chart?.result?.[0];
    if (!result) {
      return res.status(404).json({ error: 'No quote data from Yahoo Finance' });
    }

    const meta = result.meta;
    const regularPrice = meta.regularMarketPrice ?? 0;
    const previousClose = meta.previousClose ?? regularPrice;

    // Determine market status
    const now = timestamp;
    let marketStatus = 'regular';
    const period = meta.currentTradingPeriod;
    if (period) {
      if (now >= period.pre?.start && now < period.pre?.end) marketStatus = 'pre';
      else if (now >= period.regular?.start && now < period.regular?.end) marketStatus = 'regular';
      else if (now >= period.post?.start && now < period.post?.end) marketStatus = 'post';
      else marketStatus = 'closed';
    }

    // Get last candle price
    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];
    let lastCandlePrice = regularPrice;
    if (quote?.close) {
      for (let i = timestamps.length - 1; i >= 0; i--) {
        if (quote.close[i] != null) {
          lastCandlePrice = quote.close[i];
          break;
        }
      }
    }

    let price: number;
    let change: number;
    if (marketStatus === 'post') {
      price = meta.postMarketPrice ?? lastCandlePrice;
      change = meta.postMarketChange ?? price - previousClose;
    } else if (marketStatus === 'pre') {
      price = meta.preMarketPrice ?? lastCandlePrice;
      change = meta.preMarketChange ?? price - previousClose;
    } else if (marketStatus === 'closed') {
      price = regularPrice;
      change = regularPrice - previousClose;
    } else {
      price = regularPrice;
      change = regularPrice - previousClose;
    }

    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      symbol: meta.symbol ?? symbol,
      price,
      change,
      change_percent: changePercent,
      high: meta.regularMarketDayHigh ?? 0,
      low: meta.regularMarketDayLow ?? 0,
      volume: meta.regularMarketVolume ?? 0,
      market_status: marketStatus,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
