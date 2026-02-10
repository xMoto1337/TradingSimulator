import { useState, useRef, useEffect } from 'react';

export interface ActiveIndicators {
  sma: boolean;
  ema: boolean;
  rsi: boolean;
  macd: boolean;
  bollinger: boolean;
}

interface IndicatorMenuProps {
  indicators: ActiveIndicators;
  onToggle: (indicator: keyof ActiveIndicators) => void;
}

const INDICATOR_INFO = [
  { key: 'sma' as const, label: 'SMA (20)', color: '#ffcc00', desc: 'Simple Moving Average' },
  { key: 'ema' as const, label: 'EMA (50)', color: '#00aaff', desc: 'Exponential Moving Average' },
  { key: 'rsi' as const, label: 'RSI (14)', color: '#aa00ff', desc: 'Relative Strength Index' },
  { key: 'macd' as const, label: 'MACD', color: '#00ffff', desc: '12 / 26 / 9' },
  { key: 'bollinger' as const, label: 'Bollinger', color: '#ff9500', desc: 'Period 20, StdDev 2' },
];

export function IndicatorMenu({ indicators, onToggle }: IndicatorMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const activeCount = Object.values(indicators).filter(Boolean).length;

  return (
    <div className="indicator-menu" ref={menuRef}>
      <button
        className={`tool-btn indicator-btn ${activeCount > 0 ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Indicators"
      >
        fx
        {activeCount > 0 && <span className="indicator-count">{activeCount}</span>}
      </button>
      {open && (
        <div className="indicator-dropdown">
          <div className="indicator-dropdown-header">Indicators</div>
          {INDICATOR_INFO.map((ind) => (
            <button
              key={ind.key}
              className={`indicator-option ${indicators[ind.key] ? 'active' : ''}`}
              onClick={() => onToggle(ind.key)}
            >
              <span className="indicator-color" style={{ background: ind.color }} />
              <div className="indicator-option-text">
                <span className="indicator-label">{ind.label}</span>
                <span className="indicator-desc">{ind.desc}</span>
              </div>
              {indicators[ind.key] && <span className="indicator-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
