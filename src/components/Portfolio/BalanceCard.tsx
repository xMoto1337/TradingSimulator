import { useTradingStore } from '../../stores/tradingStore';

export function BalanceCard() {
  const { portfolio } = useTradingStore();

  const formatCurrency = (value: number) =>
    value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const formatChange = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${formatCurrency(value)}`;
  };

  const totalUnrealizedPnL = portfolio.positions.reduce(
    (sum, pos) => sum + pos.unrealizedPnL,
    0
  );

  const openPositionsValue = portfolio.positions.reduce(
    (sum, pos) => sum + pos.currentPrice * pos.quantity,
    0
  );

  return (
    <div className="balance-card">
      <div className="balance-main">
        <span className="balance-label">Portfolio Value</span>
        <span className="balance-value">{formatCurrency(portfolio.equity)}</span>
        {(portfolio.totalPnL !== 0 || totalUnrealizedPnL !== 0) && (
          <span className={`balance-change ${(portfolio.totalPnL + totalUnrealizedPnL) >= 0 ? 'positive' : 'negative'}`}>
            {formatChange(portfolio.totalPnL + totalUnrealizedPnL)} all time
          </span>
        )}
      </div>

      <div className="balance-stats">
        <div className="stat">
          <span className="stat-label">Cash</span>
          <span className="stat-value">{formatCurrency(portfolio.balance)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Positions</span>
          <span className="stat-value">
            {portfolio.positions.length > 0 ? formatCurrency(openPositionsValue) : '--'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Unrealized</span>
          <span className={`stat-value ${totalUnrealizedPnL >= 0 ? 'positive' : 'negative'}`}>
            {totalUnrealizedPnL !== 0 ? formatChange(totalUnrealizedPnL) : '--'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Realized</span>
          <span className={`stat-value ${portfolio.totalPnL >= 0 ? 'positive' : 'negative'}`}>
            {portfolio.totalPnL !== 0 ? formatChange(portfolio.totalPnL) : '--'}
          </span>
        </div>
      </div>
    </div>
  );
}
