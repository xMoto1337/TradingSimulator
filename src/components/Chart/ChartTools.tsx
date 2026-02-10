import { IndicatorMenu, type ActiveIndicators } from './IndicatorMenu';

export type DrawingTool = 'none' | 'crosshair' | 'hline' | 'trendline' | 'ray' | 'rectangle' | 'fib';

interface ChartToolsProps {
  activeTool: DrawingTool;
  setActiveTool: (tool: DrawingTool) => void;
  onClearDrawings: () => void;
  onUndo: () => void;
  activeIndicators: ActiveIndicators;
  onToggleIndicator: (key: keyof ActiveIndicators) => void;
}

export function ChartTools({ activeTool, setActiveTool, onClearDrawings, onUndo, activeIndicators, onToggleIndicator }: ChartToolsProps) {
  const tools: { id: DrawingTool; icon: string; label: string }[] = [
    { id: 'crosshair', icon: '┼', label: 'Crosshair' },
    { id: 'hline', icon: '―', label: 'Horizontal Line' },
    { id: 'trendline', icon: '╱', label: 'Trend Line' },
    { id: 'ray', icon: '→', label: 'Ray' },
    { id: 'rectangle', icon: '▢', label: 'Rectangle' },
    { id: 'fib', icon: 'Fib', label: 'Fibonacci' },
  ];

  return (
    <div className="chart-tools">
      <div className="tools-group">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => setActiveTool(activeTool === tool.id ? 'none' : tool.id)}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <div className="tools-group">
        <IndicatorMenu indicators={activeIndicators} onToggle={onToggleIndicator} />
      </div>
      <div className="tools-group">
        <button className="tool-btn" onClick={onUndo} title="Undo Last">
          ↩
        </button>
        <button className="tool-btn danger" onClick={onClearDrawings} title="Clear All">
          ✕
        </button>
      </div>
    </div>
  );
}
