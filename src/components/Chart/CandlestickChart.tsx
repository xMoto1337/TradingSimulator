import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  Time,
  ColorType,
  LineStyle,
  LineType,
  IPriceLine,
} from 'lightweight-charts';
import { useTradingStore } from '../../stores/tradingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Candle, Timeframe, ChartType } from '../../types/trading';
import { ChartTools, DrawingTool } from './ChartTools';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '../../utils/indicators';
import type { ActiveIndicators } from './IndicatorMenu';

const toChartCandle = (candle: Candle): CandlestickData<Time> => ({
  time: (candle.time / 1000) as Time,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
});

const toVolumeData = (candle: Candle): HistogramData<Time> => ({
  time: (candle.time / 1000) as Time,
  value: candle.volume || 0,
  color: candle.close >= candle.open ? 'rgba(0, 255, 65, 0.5)' : 'rgba(255, 0, 64, 0.5)',
});

const toLineData = (candle: Candle) => ({
  time: (candle.time / 1000) as Time,
  value: candle.close,
});

// 12-hour AM/PM time formatting
function formatTime12h(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Calculate appropriate precision based on price magnitude
function getPricePrecision(price: number): number {
  if (price >= 10000) return 2;
  if (price >= 100) return 4;
  if (price >= 1) return 6;
  if (price >= 0.01) return 8;
  if (price >= 0.0001) return 10;
  return 12; // For very small prices like memecoins
}

interface Drawing {
  id: string;
  type: DrawingTool;
  points: { time: Time; price: number }[];
  series?: ISeriesApi<'Line'>;
  priceLine?: IPriceLine;
  priceLines?: IPriceLine[]; // For Fib which creates multiple lines
}

interface CandlestickChartProps {
  frozenData?: {
    candles: Candle[];
    currentPrice: number;
    currentTimeframe: Timeframe;
    currentSymbol: string;
  };
}

export function CandlestickChart({ frozenData }: CandlestickChartProps) {
  const isFrozen = !!frozenData;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const chartTypeRef = useRef<ChartType>('candlestick');

  const storeCandles = useTradingStore((state) => state.candles);
  const storeCurrentPrice = useTradingStore((state) => state.currentPrice);
  const storeTimeframe = useTradingStore((state) => state.currentTimeframe);
  const storeSymbol = useTradingStore((state) => state.currentSymbol);

  const chartType = useSettingsStore((state) => state.chartType);
  const setChartType = useSettingsStore((state) => state.setChartType);

  const candles = frozenData?.candles ?? storeCandles;
  const currentPrice = frozenData?.currentPrice ?? storeCurrentPrice;
  const currentTimeframe = frozenData?.currentTimeframe ?? storeTimeframe;
  const currentSymbol = frozenData?.currentSymbol ?? storeSymbol;

  const prevTimeframeRef = useRef(currentTimeframe);
  const prevSymbolRef = useRef(currentSymbol);
  const initialLoadRef = useRef(true);

  // Drawing state
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [pendingPoints, setPendingPoints] = useState<{ time: Time; price: number }[]>([]);
  const drawingsRef = useRef<Drawing[]>([]);
  const previewSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Indicator state
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicators>({
    sma: false, ema: false, rsi: false, macd: false, bollinger: false,
  });
  const indicatorSeriesRef = useRef<{
    sma?: ISeriesApi<'Line'>;
    ema?: ISeriesApi<'Line'>;
    rsi?: ISeriesApi<'Line'>;
    macdLine?: ISeriesApi<'Line'>;
    macdSignal?: ISeriesApi<'Line'>;
    macdHistogram?: ISeriesApi<'Histogram'>;
    bollingerUpper?: ISeriesApi<'Line'>;
    bollingerMiddle?: ISeriesApi<'Line'>;
    bollingerLower?: ISeriesApi<'Line'>;
  }>({});

  const handleToggleIndicator = useCallback((key: keyof ActiveIndicators) => {
    setActiveIndicators(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Keep ref in sync
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor: '#999999',
        fontSize: 12,
      },
      localization: {
        timeFormatter: (ts: number) => {
          const d = new Date(ts * 1000);
          return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${formatTime12h(d)}`;
        },
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)', style: 1 },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)', style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#00ff41',
          width: 1,
          style: 3,
          labelBackgroundColor: '#00ff41',
        },
        horzLine: {
          color: '#00ff41',
          width: 1,
          style: 3,
          labelBackgroundColor: '#00ff41',
        },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        scaleMargins: { top: 0.1, bottom: 0.2 },
        borderVisible: true,
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
        borderVisible: true,
        rightOffset: 5,
        barSpacing: 8,
        minBarSpacing: 4,
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          const d = new Date(time * 1000);
          // 0=Year, 1=Month, 2=DayOfMonth, 3=Time, 4=TimeWithSeconds
          if (tickMarkType >= 3) return formatTime12h(d);
          if (tickMarkType === 2) return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()} ${formatTime12h(d)}`;
          if (tickMarkType === 1) return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
          return d.getFullYear().toString();
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    // Volume series (always present regardless of chart type)
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      borderVisible: false,
    });

    chartRef.current = chart;
    volumeSeriesRef.current = volumeSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      indicatorSeriesRef.current = {};
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Create/recreate main series when chart type changes
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    // Remove old main series if exists
    if (mainSeriesRef.current) {
      // Clear drawings since they reference the old series
      drawings.forEach(drawing => {
        if (drawing.series) { try { chart.removeSeries(drawing.series); } catch {} }
        if (drawing.priceLine && mainSeriesRef.current) {
          try { (mainSeriesRef.current as any).removePriceLine(drawing.priceLine); } catch {}
        }
        if (drawing.priceLines && mainSeriesRef.current) {
          drawing.priceLines.forEach(pl => { try { (mainSeriesRef.current as any).removePriceLine(pl); } catch {} });
        }
      });
      setDrawings([]);
      setPendingPoints([]);
      if (previewSeriesRef.current) {
        try { chart.removeSeries(previewSeriesRef.current); } catch {}
        previewSeriesRef.current = null;
      }

      try { chart.removeSeries(mainSeriesRef.current as any); } catch {}
      mainSeriesRef.current = null;
    }

    chartTypeRef.current = chartType;
    const firstPrice = candles.length > 0 ? candles[0].close : 1;
    const precision = getPricePrecision(firstPrice);
    const priceFormat = { type: 'price' as const, precision, minMove: Math.pow(10, -precision) };

    if (chartType === 'line') {
      mainSeriesRef.current = chart.addLineSeries({
        color: '#00ffff',
        lineWidth: 2,
        lineType: LineType.Curved,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineColor: '#00ffff',
        priceLineStyle: 2,
        priceFormat,
      });
    } else if (chartType === 'area') {
      mainSeriesRef.current = chart.addAreaSeries({
        lineColor: '#00ffff',
        topColor: 'rgba(0, 255, 255, 0.28)',
        bottomColor: 'rgba(0, 255, 255, 0.02)',
        lineWidth: 2,
        lineType: LineType.Curved,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineColor: '#00ffff',
        priceLineStyle: 2,
        priceFormat,
      });
    } else {
      mainSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#00ff41',
        downColor: '#ff0040',
        borderUpColor: '#00ff41',
        borderDownColor: '#ff0040',
        wickUpColor: '#00ff41',
        wickDownColor: '#ff0040',
        priceLineVisible: true,
        priceLineWidth: 1,
        priceLineColor: '#00ff41',
        priceLineStyle: 2,
        lastValueVisible: true,
        priceFormat,
      });
    }

    // Set data on the new series
    if (candles.length > 0 && mainSeriesRef.current) {
      if (chartType === 'candlestick') {
        (mainSeriesRef.current as ISeriesApi<'Candlestick'>).setData(candles.map(toChartCandle));
      } else {
        (mainSeriesRef.current as any).setData(candles.map(toLineData));
      }
      volumeSeriesRef.current?.setData(candles.map(toVolumeData));
    }

    // Fit content after type switch
    if (candles.length > 0) {
      chart.timeScale().fitContent();
    }
  }, [chartType]);

  // Scroll-back pagination: load older candles when user scrolls to the left edge
  useEffect(() => {
    if (!chartRef.current || isFrozen) return;

    const isDex = currentSymbol.toLowerCase().startsWith('dex:');
    if (isDex) return; // Only Coinbase crypto for now

    const productId = currentSymbol.endsWith('USDT')
      ? currentSymbol.replace('USDT', '-USD')
      : null;
    if (!productId) return;

    const granularityMap: Record<string, number> = {
      '1m': 60, '3m': 60, '5m': 300, '15m': 900, '30m': 900,
      '1h': 3600, '4h': 21600, '1d': 86400, '1w': 86400, '1M': 86400,
    };
    const granularity = granularityMap[currentTimeframe] || 3600;

    let lastFetch = 0;
    let isFetching = false;
    const MAX_CANDLES = 2000;

    const handleRangeChange = () => {
      if (isFetching) return;

      const currentCandles = useTradingStore.getState().candles;
      if (currentCandles.length === 0 || currentCandles.length >= MAX_CANDLES) return;

      // Check if the first candle is visible
      const chart = chartRef.current;
      if (!chart) return;
      const visibleRange = chart.timeScale().getVisibleRange();
      if (!visibleRange) return;

      const firstCandleTime = currentCandles[0].time / 1000;
      if ((visibleRange.from as number) > firstCandleTime) return;

      // Throttle: 2s cooldown
      const now = Date.now();
      if (now - lastFetch < 2000) return;
      lastFetch = now;
      isFetching = true;

      const end = Math.floor(currentCandles[0].time / 1000);
      const start = end - (granularity * 300);

      fetch(`https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${granularity}&start=${start}&end=${end}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then((data: number[][]) => {
          const existing = useTradingStore.getState().candles;
          const olderCandles: Candle[] = data
            .map(c => ({ time: c[0] * 1000, open: c[3], high: c[2], low: c[1], close: c[4], volume: c[5] }))
            .sort((a, b) => a.time - b.time)
            .filter(c => c.time < existing[0].time);

          if (olderCandles.length > 0) {
            const merged = [...olderCandles, ...existing].slice(-MAX_CANDLES);
            useTradingStore.getState().setCandles(merged);
            console.log(`[Chart] Loaded ${olderCandles.length} older candles (total: ${merged.length})`);
          }
        })
        .catch(e => console.error('[Chart] Scroll-back fetch error:', e))
        .finally(() => { isFetching = false; });
    };

    chartRef.current.timeScale().subscribeVisibleTimeRangeChange(handleRangeChange);

    return () => {
      chartRef.current?.timeScale().unsubscribeVisibleTimeRangeChange(handleRangeChange);
    };
  }, [currentSymbol, currentTimeframe, isFrozen]);

  // Handle drawing clicks
  const handleChartClick = useCallback((e: MouseEvent) => {
    if (!chartRef.current || !mainSeriesRef.current || activeTool === 'none' || activeTool === 'crosshair') return;

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert coordinates to price and time
    const timeCoord = chartRef.current.timeScale().coordinateToTime(x);
    const priceCoord = mainSeriesRef.current.coordinateToPrice(y);

    if (timeCoord === null || priceCoord === null) return;

    const point = { time: timeCoord as Time, price: priceCoord };

    if (activeTool === 'hline') {
      // Horizontal line only needs one click
      const priceLine = mainSeriesRef.current.createPriceLine({
        price: priceCoord,
        color: '#ffcc00',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '',
      });

      const drawing: Drawing = {
        id: Date.now().toString(),
        type: 'hline',
        points: [point],
        priceLine,
      };

      setDrawings(prev => [...prev, drawing]);
    } else if (activeTool === 'trendline' || activeTool === 'ray' || activeTool === 'fib') {
      // Two-point drawings
      const newPending = [...pendingPoints, point];
      setPendingPoints(newPending);

      if (newPending.length === 2) {
        // Complete the drawing
        const lineSeries = chartRef.current!.addLineSeries({
          color: activeTool === 'fib' ? '#ff9800' : '#ffcc00',
          lineWidth: 1,
          lineStyle: activeTool === 'ray' ? LineStyle.Dashed : LineStyle.Solid,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        });

        // Sort points by time
        const sortedPoints = [...newPending].sort((a, b) => (a.time as number) - (b.time as number));

        if (activeTool === 'fib') {
          // Draw Fibonacci levels
          const startPrice = sortedPoints[0].price;
          const endPrice = sortedPoints[1].price;
          const diff = endPrice - startPrice;
          const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
          const fibPriceLines: IPriceLine[] = [];

          fibLevels.forEach(level => {
            const price = startPrice + diff * level;
            const priceLine = mainSeriesRef.current!.createPriceLine({
              price,
              color: level === 0.618 ? '#ff9800' : 'rgba(255, 152, 0, 0.5)',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: `${(level * 100).toFixed(1)}%`,
            });
            fibPriceLines.push(priceLine);
          });

          // Store Fib drawing with all price lines
          const fibDrawing: Drawing = {
            id: Date.now().toString(),
            type: 'fib',
            points: sortedPoints,
            series: lineSeries,
            priceLines: fibPriceLines,
          };

          setDrawings(prev => [...prev, fibDrawing]);
          setPendingPoints([]);

          // Remove preview and the unused line series
          if (previewSeriesRef.current) {
            chartRef.current!.removeSeries(previewSeriesRef.current);
            previewSeriesRef.current = null;
          }
          chartRef.current!.removeSeries(lineSeries);
          return;
        } else if (activeTool === 'ray') {
          // Extend the line to the right
          const timeRange = (sortedPoints[1].time as number) - (sortedPoints[0].time as number);
          const priceRange = sortedPoints[1].price - sortedPoints[0].price;
          const slope = priceRange / timeRange;

          // Extend 1000 bars to the right
          const extendedTime = (sortedPoints[1].time as number) + timeRange * 10;
          const extendedPrice = sortedPoints[1].price + slope * timeRange * 10;

          lineSeries.setData([
            { time: sortedPoints[0].time, value: sortedPoints[0].price },
            { time: extendedTime as Time, value: extendedPrice },
          ]);
        } else {
          // Regular trend line
          lineSeries.setData([
            { time: sortedPoints[0].time, value: sortedPoints[0].price },
            { time: sortedPoints[1].time, value: sortedPoints[1].price },
          ]);
        }

        const drawing: Drawing = {
          id: Date.now().toString(),
          type: activeTool,
          points: sortedPoints,
          series: lineSeries,
        };

        setDrawings(prev => [...prev, drawing]);
        setPendingPoints([]);

        // Remove preview
        if (previewSeriesRef.current) {
          chartRef.current!.removeSeries(previewSeriesRef.current);
          previewSeriesRef.current = null;
        }
      }
    } else if (activeTool === 'rectangle') {
      // Rectangle needs two points
      const newPending = [...pendingPoints, point];
      setPendingPoints(newPending);

      if (newPending.length === 2) {
        // Create rectangle using two horizontal lines and visual feedback
        const sortedPoints = [...newPending].sort((a, b) => (a.time as number) - (b.time as number));
        const minPrice = Math.min(sortedPoints[0].price, sortedPoints[1].price);
        const maxPrice = Math.max(sortedPoints[0].price, sortedPoints[1].price);

        // Add lines for top and bottom
        const topLine = mainSeriesRef.current!.createPriceLine({
          price: maxPrice,
          color: 'rgba(255, 204, 0, 0.5)',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
        });

        const bottomLine = mainSeriesRef.current!.createPriceLine({
          price: minPrice,
          color: 'rgba(255, 204, 0, 0.5)',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
        });

        const drawing: Drawing = {
          id: Date.now().toString(),
          type: 'rectangle',
          points: sortedPoints,
          priceLines: [topLine, bottomLine], // Store both lines for proper cleanup
        };

        setDrawings(prev => [...prev, drawing]);
        setPendingPoints([]);
      }
    }
  }, [activeTool, pendingPoints]);

  // Handle mouse move for preview
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!chartRef.current || !mainSeriesRef.current || pendingPoints.length === 0) return;
    if (activeTool !== 'trendline' && activeTool !== 'ray') return;

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const timeCoord = chartRef.current.timeScale().coordinateToTime(x);
    const priceCoord = mainSeriesRef.current.coordinateToPrice(y);

    if (timeCoord === null || priceCoord === null) return;

    // Create or update preview line
    if (!previewSeriesRef.current) {
      previewSeriesRef.current = chartRef.current.addLineSeries({
        color: 'rgba(255, 204, 0, 0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }

    const sortedPoints = [pendingPoints[0], { time: timeCoord as Time, price: priceCoord }]
      .sort((a, b) => (a.time as number) - (b.time as number));

    previewSeriesRef.current.setData([
      { time: sortedPoints[0].time, value: sortedPoints[0].price },
      { time: sortedPoints[1].time, value: sortedPoints[1].price },
    ]);
  }, [activeTool, pendingPoints]);

  // Handle ESC key to cancel drawing
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setPendingPoints([]);
      setActiveTool('none');
      if (previewSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(previewSeriesRef.current);
        previewSeriesRef.current = null;
      }
    }
  }, []);

  // Add event listeners (skip for frozen/inactive charts)
  useEffect(() => {
    if (isFrozen) return;
    const container = chartContainerRef.current;
    if (!container) return;

    container.addEventListener('click', handleChartClick);
    container.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('click', handleChartClick);
      container.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFrozen, handleChartClick, handleMouseMove, handleKeyDown]);

  // Clear drawings
  const handleClearDrawings = useCallback(() => {
    drawings.forEach(drawing => {
      if (drawing.series && chartRef.current) {
        try {
          chartRef.current.removeSeries(drawing.series);
        } catch {}
      }
      if (drawing.priceLine && mainSeriesRef.current) {
        try {
          mainSeriesRef.current.removePriceLine(drawing.priceLine);
        } catch {}
      }
      // Handle Fib drawings with multiple price lines
      if (drawing.priceLines && mainSeriesRef.current) {
        drawing.priceLines.forEach(pl => {
          try {
            mainSeriesRef.current!.removePriceLine(pl);
          } catch {}
        });
      }
    });
    setDrawings([]);
    setPendingPoints([]);

    if (previewSeriesRef.current && chartRef.current) {
      chartRef.current.removeSeries(previewSeriesRef.current);
      previewSeriesRef.current = null;
    }
  }, [drawings]);

  // Undo last drawing
  const handleUndo = useCallback(() => {
    if (pendingPoints.length > 0) {
      setPendingPoints([]);
      if (previewSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(previewSeriesRef.current);
        previewSeriesRef.current = null;
      }
      return;
    }

    if (drawings.length === 0) return;

    const lastDrawing = drawings[drawings.length - 1];

    if (lastDrawing.series && chartRef.current) {
      try {
        chartRef.current.removeSeries(lastDrawing.series);
      } catch {}
    }
    if (lastDrawing.priceLine && mainSeriesRef.current) {
      try {
        mainSeriesRef.current.removePriceLine(lastDrawing.priceLine);
      } catch {}
    }
    // Handle Fib drawings with multiple price lines
    if (lastDrawing.priceLines && mainSeriesRef.current) {
      lastDrawing.priceLines.forEach(pl => {
        try {
          mainSeriesRef.current!.removePriceLine(pl);
        } catch {}
      });
    }

    setDrawings(prev => prev.slice(0, -1));
  }, [drawings, pendingPoints]);

  // Clear drawings on symbol change
  useEffect(() => {
    if (prevSymbolRef.current !== currentSymbol) {
      handleClearDrawings();
    }
  }, [currentSymbol, handleClearDrawings]);

  // Update chart data when candles change
  useEffect(() => {
    if (!mainSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    // Set price precision based on the price magnitude
    const firstPrice = candles[0]?.close || 1;
    const precision = getPricePrecision(firstPrice);
    (mainSeriesRef.current as any).applyOptions({
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: Math.pow(10, -precision),
      },
    });

    if (chartType === 'candlestick') {
      (mainSeriesRef.current as ISeriesApi<'Candlestick'>).setData(candles.map(toChartCandle));
    } else {
      (mainSeriesRef.current as any).setData(candles.map(toLineData));
    }
    volumeSeriesRef.current.setData(candles.map(toVolumeData));

    // Only fitContent on initial load, timeframe change, or symbol change
    const timeframeChanged = prevTimeframeRef.current !== currentTimeframe;
    const symbolChanged = prevSymbolRef.current !== currentSymbol;
    if (chartRef.current && (initialLoadRef.current || timeframeChanged || symbolChanged)) {
      chartRef.current.timeScale().fitContent();
      initialLoadRef.current = false;
      prevTimeframeRef.current = currentTimeframe;
      prevSymbolRef.current = currentSymbol;
    }
  }, [candles.length, currentTimeframe, currentSymbol, chartType]);

  // Update last candle in real-time with current price (without re-fitting)
  useEffect(() => {
    if (!mainSeriesRef.current || !volumeSeriesRef.current || candles.length === 0 || !currentPrice) return;

    const lastCandle = candles[candles.length - 1];

    // Update the last candle with the current live price
    const updatedCandle: Candle = {
      ...lastCandle,
      close: currentPrice,
      high: Math.max(lastCandle.high, currentPrice),
      low: Math.min(lastCandle.low, currentPrice),
    };

    if (chartType === 'candlestick') {
      (mainSeriesRef.current as ISeriesApi<'Candlestick'>).update(toChartCandle(updatedCandle));
    } else {
      (mainSeriesRef.current as any).update(toLineData(updatedCandle));
    }
    volumeSeriesRef.current.update(toVolumeData(updatedCandle));
  }, [candles, currentPrice, chartType]);

  // Update cursor based on tool
  useEffect(() => {
    if (!chartContainerRef.current) return;
    chartContainerRef.current.style.cursor = activeTool !== 'none' && activeTool !== 'crosshair' ? 'crosshair' : 'default';
  }, [activeTool]);

  // Manage indicator series and data (skip for frozen/inactive charts)
  useEffect(() => {
    if (isFrozen || !chartRef.current || candles.length === 0) return;
    const chart = chartRef.current;
    const refs = indicatorSeriesRef.current;

    // Adjust main chart margins based on panel indicators
    const hasRSI = activeIndicators.rsi;
    const hasMACD = activeIndicators.macd;
    let mainBottom = 0.2;
    if (hasRSI && hasMACD) mainBottom = 0.45;
    else if (hasRSI || hasMACD) mainBottom = 0.32;

    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.1, bottom: mainBottom },
    });

    // --- SMA ---
    if (activeIndicators.sma) {
      if (!refs.sma) {
        refs.sma = chart.addLineSeries({
          color: '#ffcc00', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
      }
      const data = calculateSMA(candles, 20);
      refs.sma.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.value })));
    } else if (refs.sma) {
      chart.removeSeries(refs.sma);
      delete refs.sma;
    }

    // --- EMA ---
    if (activeIndicators.ema) {
      if (!refs.ema) {
        refs.ema = chart.addLineSeries({
          color: '#00aaff', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
      }
      const data = calculateEMA(candles, 50);
      refs.ema.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.value })));
    } else if (refs.ema) {
      chart.removeSeries(refs.ema);
      delete refs.ema;
    }

    // --- Bollinger Bands ---
    if (activeIndicators.bollinger) {
      if (!refs.bollingerUpper) {
        refs.bollingerUpper = chart.addLineSeries({
          color: 'rgba(255, 149, 0, 0.7)', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        refs.bollingerMiddle = chart.addLineSeries({
          color: 'rgba(255, 149, 0, 0.35)', lineWidth: 1, lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        refs.bollingerLower = chart.addLineSeries({
          color: 'rgba(255, 149, 0, 0.7)', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
      }
      const data = calculateBollingerBands(candles, 20, 2);
      refs.bollingerUpper!.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.upper })));
      refs.bollingerMiddle!.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.middle })));
      refs.bollingerLower!.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.lower })));
    } else {
      if (refs.bollingerUpper) { chart.removeSeries(refs.bollingerUpper); delete refs.bollingerUpper; }
      if (refs.bollingerMiddle) { chart.removeSeries(refs.bollingerMiddle); delete refs.bollingerMiddle; }
      if (refs.bollingerLower) { chart.removeSeries(refs.bollingerLower); delete refs.bollingerLower; }
    }

    // --- RSI ---
    if (activeIndicators.rsi) {
      if (!refs.rsi) {
        refs.rsi = chart.addLineSeries({
          color: '#aa00ff', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
          priceScaleId: 'rsi',
        });
        refs.rsi.createPriceLine({ price: 70, color: 'rgba(170, 0, 255, 0.3)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        refs.rsi.createPriceLine({ price: 30, color: 'rgba(170, 0, 255, 0.3)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      }
      chart.priceScale('rsi').applyOptions({
        scaleMargins: hasMACD ? { top: 0.58, bottom: 0.22 } : { top: 0.72, bottom: 0.02 },
        borderVisible: false,
      });
      const data = calculateRSI(candles, 14);
      refs.rsi.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.value })));
    } else if (refs.rsi) {
      chart.removeSeries(refs.rsi);
      delete refs.rsi;
    }

    // --- MACD ---
    if (activeIndicators.macd) {
      if (!refs.macdLine) {
        refs.macdLine = chart.addLineSeries({
          color: '#00ffff', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
          priceScaleId: 'macd',
        });
        refs.macdSignal = chart.addLineSeries({
          color: '#ff9500', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
          priceScaleId: 'macd',
        });
        refs.macdHistogram = chart.addHistogramSeries({
          priceScaleId: 'macd',
          lastValueVisible: false,
          priceLineVisible: false,
        });
      }
      chart.priceScale('macd').applyOptions({
        scaleMargins: hasRSI ? { top: 0.82, bottom: 0.02 } : { top: 0.72, bottom: 0.02 },
        borderVisible: false,
      });
      const data = calculateMACD(candles, 12, 26, 9);
      refs.macdLine!.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.macd })));
      refs.macdSignal!.setData(data.map(p => ({ time: (p.time / 1000) as Time, value: p.signal })));
      refs.macdHistogram!.setData(data.map(p => ({
        time: (p.time / 1000) as Time,
        value: p.histogram,
        color: p.histogram >= 0 ? 'rgba(0, 255, 65, 0.5)' : 'rgba(255, 0, 64, 0.5)',
      })));
    } else {
      if (refs.macdLine) { chart.removeSeries(refs.macdLine); delete refs.macdLine; }
      if (refs.macdSignal) { chart.removeSeries(refs.macdSignal); delete refs.macdSignal; }
      if (refs.macdHistogram) { chart.removeSeries(refs.macdHistogram); delete refs.macdHistogram; }
    }
  }, [isFrozen, activeIndicators, candles.length, currentTimeframe, currentSymbol]);

  return (
    <div className="chart-wrapper">
      {!isFrozen && (
        <ChartTools
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          onClearDrawings={handleClearDrawings}
          onUndo={handleUndo}
          activeIndicators={activeIndicators}
          onToggleIndicator={handleToggleIndicator}
          chartType={chartType}
          onChartTypeChange={setChartType}
        />
      )}
      <div
        className={`chart-container ${!isFrozen && activeTool !== 'none' ? 'drawing-mode' : ''}`}
        ref={chartContainerRef}
      />
      {!isFrozen && pendingPoints.length > 0 && (
        <div className="drawing-hint">
          Click to set {activeTool === 'fib' ? 'Fibonacci' : activeTool} end point (ESC to cancel)
        </div>
      )}
    </div>
  );
}
