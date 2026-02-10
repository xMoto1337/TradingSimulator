// Vercel serverless function — proxies Yahoo Finance chart API (CORS-blocked from browser)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { symbol, interval, range } = req.query;
  if (!symbol || !interval || !range) {
    return res.status(400).json({ error: 'Missing symbol, interval, or range' });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}&_t=${timestamp}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const data = await response.json();

    const result = data.chart?.result?.[0];
    if (!result) {
      return res.status(404).json({ error: 'No data from Yahoo Finance' });
    }

    const meta = result.meta;
    const regularPrice = meta.regularMarketPrice ?? 0;
    const previousClose = meta.previousClose ?? 0;
    const dayHigh = meta.regularMarketDayHigh ?? 0;
    const dayLow = meta.regularMarketDayLow ?? 0;
    const volume = meta.regularMarketVolume ?? 0;
    const currentPrice = meta.postMarketPrice ?? meta.preMarketPrice ?? regularPrice;

    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];
    const candles: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];

    if (quote) {
      for (let i = 0; i < timestamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        if (o != null && h != null && l != null && c != null) {
          candles.push({
            time: timestamps[i] * 1000,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: quote.volume?.[i] ?? 0,
          });
        }
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      candles,
      current_price: currentPrice,
      previous_close: previousClose,
      day_high: dayHigh,
      day_low: dayLow,
      volume,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
