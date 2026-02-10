// Vercel serverless function — generic CORS proxy for APIs blocked in browsers
// Whitelists specific hosts to prevent abuse.
import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_HOSTS = [
  'api.exchange.coinbase.com',
  'api.dexscreener.com',
  'api.geckoterminal.com',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.includes(parsed.host)) {
      return res.status(403).json({ error: `Host not allowed: ${parsed.host}` });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TradingSimulator/1.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream: ${response.status}` });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
