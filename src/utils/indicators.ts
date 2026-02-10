import type { Candle } from '../types/trading';

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MACDPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export function calculateSMA(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  result.push({ time: candles[period - 1].time, value: sum / period });

  for (let i = period; i < candles.length; i++) {
    sum += candles[i].close - candles[i - period].close;
    result.push({ time: candles[i].time, value: sum / period });
  }

  return result;
}

export function calculateEMA(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length < period) return result;

  // Start with SMA for the first value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let ema = sum / period;
  result.push({ time: candles[period - 1].time, value: ema });

  const multiplier = 2 / (period + 1);
  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
    result.push({ time: candles[i].time, value: ema });
  }

  return result;
}

export function calculateRSI(candles: Candle[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) });

  // Wilder's smoothing
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push({ time: candles[i].time, value: rsi });
  }

  return result;
}

function emaFromValues(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let ema = sum / period;
  // Fill with NaN for indices before the EMA starts
  for (let i = 0; i < period - 1; i++) result.push(NaN);
  result.push(ema);

  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    result.push(ema);
  }
  return result;
}

export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDPoint[] {
  const result: MACDPoint[] = [];
  if (candles.length < slowPeriod + signalPeriod) return result;

  // Calculate fast and slow EMA
  const closes = candles.map(c => c.close);
  const fastEMA = emaFromValues(closes, fastPeriod);
  const slowEMA = emaFromValues(closes, slowPeriod);

  // MACD line = fast EMA - slow EMA
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(fastEMA[i]) || isNaN(slowEMA[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(fastEMA[i] - slowEMA[i]);
    }
  }

  // Signal line = EMA of MACD line (skip NaN values)
  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalEMA = emaFromValues(validMacd, signalPeriod);

  // Build results starting from where we have all three values
  const macdStartIdx = macdLine.findIndex(v => !isNaN(v));

  for (let i = 0; i < signalEMA.length; i++) {
    if (isNaN(signalEMA[i])) continue;
    const candleIdx = macdStartIdx + i;
    if (candleIdx >= candles.length) break;

    const macdVal = validMacd[i];
    const signalVal = signalEMA[i];
    result.push({
      time: candles[candleIdx].time,
      macd: macdVal,
      signal: signalVal,
      histogram: macdVal - signalVal,
    });
  }

  return result;
}

export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerPoint[] {
  const result: BollingerPoint[] = [];
  if (candles.length < period) return result;

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    const middle = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqSum += (candles[j].close - middle) ** 2;
    }
    const stdDev = Math.sqrt(sqSum / period);

    result.push({
      time: candles[i].time,
      upper: middle + stdDevMultiplier * stdDev,
      middle,
      lower: middle - stdDevMultiplier * stdDev,
    });
  }

  return result;
}
