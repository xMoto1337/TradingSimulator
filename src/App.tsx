import { useEffect, useRef, useState } from 'react';
import { isTauri, getVersion, getChangelog, checkForUpdate } from './api';
import { ChartGrid } from './components/Chart/ChartGrid';
import { OrderForm } from './components/Trading/OrderForm';
import { PositionList } from './components/Trading/PositionList';
import { TradeHistory } from './components/Trading/TradeHistory';
import { BalanceCard } from './components/Portfolio/BalanceCard';
import { Watchlist, isCryptoSymbol } from './components/Market/Watchlist';
import { Settings } from './components/Settings/Settings';
import { ChangelogModal } from './components/Settings/ChangelogModal';
import { useMarketData } from './hooks/useMarketData';
import { useYahooFinanceData } from './hooks/useYahooFinanceData';
import { useDexScreenerData } from './hooks/useDexScreenerData';
import { useDexChartData } from './hooks/useDexChartData';
import { useTradingStore } from './stores/tradingStore';
import { useSettingsStore } from './stores/settingsStore';
import { detachPanel } from './utils/detachPanel';

// Detect if this is a detached panel window
const PANEL_PARAM = new URLSearchParams(window.location.search).get('panel');

// Detached panel view - renders only the specified panel
function DetachedPanelView({ panel }: { panel: string }) {
  const { selectedPanel, setSelectedPanel, portfolio } = useTradingStore();

  // Sync symbol changes to main window (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    let cleanup: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ emit }) => {
      cleanup = useTradingStore.subscribe((state, prev) => {
        if (state.currentSymbol !== prev.currentSymbol) {
          emit('sync:symbol-changed', { symbol: state.currentSymbol });
        }
      });
    });
    return () => cleanup?.();
  }, []);

  // Listen for state updates from main window (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<Record<string, unknown>>('sync:state-update', (event) => {
        useTradingStore.setState(event.payload);
      }).then((fn) => { unlisten = fn; });
    });
    return () => unlisten?.();
  }, []);

  if (panel === 'watchlist') {
    return (
      <div className="detached-panel detached-watchlist">
        <Watchlist />
      </div>
    );
  }

  if (panel === 'trading') {
    return (
      <div className="detached-panel detached-trading">
        <BalanceCard />
        <div className="trading-panel">
          <div className="panel-tabs">
            <button
              className={`panel-tab ${selectedPanel === 'positions' ? 'active' : ''}`}
              onClick={() => setSelectedPanel('positions')}
            >
              Positions
              {portfolio.positions.length > 0 && (
                <span className="tab-badge">{portfolio.positions.length}</span>
              )}
            </button>
            <button
              className={`panel-tab ${selectedPanel === 'orders' ? 'active' : ''}`}
              onClick={() => setSelectedPanel('orders')}
            >
              Orders
            </button>
            <button
              className={`panel-tab ${selectedPanel === 'history' ? 'active' : ''}`}
              onClick={() => setSelectedPanel('history')}
            >
              History
            </button>
          </div>
          <div className="panel-content">
            {selectedPanel === 'positions' && <PositionList />}
            {selectedPanel === 'orders' && (
              <div className="orders-list empty">
                <p>No open orders</p>
              </div>
            )}
            {selectedPanel === 'history' && <TradeHistory />}
          </div>
        </div>
        <OrderForm />
      </div>
    );
  }

  if (panel === 'chart') {
    return <DetachedChartView />;
  }

  return null;
}

// Detached chart view - renders a full chart with its own data hooks
function DetachedChartView() {
  const currentSymbol = useTradingStore((s) => s.currentSymbol);
  const isCrypto = isCryptoSymbol(currentSymbol);
  const isDexToken = currentSymbol.toLowerCase().startsWith('dex:');

  // Run data hooks for this detached chart window
  useMarketData(!isCrypto || isDexToken);
  useYahooFinanceData(isCrypto);
  useDexScreenerData(!isDexToken);
  useDexChartData(!isDexToken);

  // Listen for state updates from main window (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<Record<string, unknown>>('sync:state-update', (event) => {
        useTradingStore.setState(event.payload);
      }).then((fn) => { unlisten = fn; });
    });
    return () => unlisten?.();
  }, []);

  return (
    <div className="detached-panel detached-chart">
      <ChartGrid />
    </div>
  );
}


function App() {
  const currentSymbol = useTradingStore((s) => s.currentSymbol);
  const isCrypto = isCryptoSymbol(currentSymbol);
  const isDexToken = currentSymbol.toLowerCase().startsWith('dex:');

  // Update state
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [newVersion, setNewVersion] = useState('');

  // Changelog state
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelogText, setChangelogText] = useState('');
  const [changelogVersion, setChangelogVersion] = useState('');
  const lastSeenVersion = useSettingsStore((s) => s.lastSeenVersion);
  const setLastSeenVersion = useSettingsStore((s) => s.setLastSeenVersion);

  // Panel visibility
  const panelVisibility = useSettingsStore((s) => s.panelVisibility);
  const togglePanel = useSettingsStore((s) => s.togglePanel);
  const detachedPanels = useSettingsStore((s) => s.detachedPanels);

  // Auto-check for updates on startup + show changelog if version changed
  useEffect(() => {
    const init = async () => {
      try {
        const currentVersion = await getVersion();

        // If version changed since last seen, show changelog from CHANGELOG.md
        if (lastSeenVersion && lastSeenVersion !== currentVersion) {
          try {
            const changelog = await getChangelog();
            if (changelog) {
              setChangelogVersion(currentVersion);
              setChangelogText(changelog);
              setShowChangelog(true);
            }
          } catch (e) {
            console.log('Changelog fetch failed:', e);
          }
        }

        // Set lastSeenVersion on first run
        if (!lastSeenVersion) {
          setLastSeenVersion(currentVersion);
        }

        // Clear any stale pending-changelog from old logic
        localStorage.removeItem('pending-changelog');
      } catch (e) {
        console.log('Version check failed:', e);
      }

      // Check for updates (Tauri only)
      try {
        const result = await checkForUpdate();
        if (result.available && result.new_version) {
          setUpdateAvailable(true);
          setNewVersion(result.new_version);
        }
      } catch (e) {
        console.log('Update check failed:', e);
      }
    };
    init();
  }, []);

  // Use Coinbase for crypto, Yahoo Finance for stocks, DEXScreener for on-chain tokens
  useMarketData(!isCrypto || isDexToken);
  useYahooFinanceData(isCrypto); // Disabled for crypto (enabled for stocks)
  useDexScreenerData(!isDexToken); // Only enabled for DEX tokens (for header price)
  useDexChartData(!isDexToken); // Fetch chart data for DEX tokens

  const { selectedPanel, setSelectedPanel, portfolio } = useTradingStore();
  const setShowSettings = useSettingsStore((s) => s.setShowSettings);

  // Listen for symbol changes from detached windows (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ symbol: string }>('sync:symbol-changed', (event) => {
        const store = useTradingStore.getState();
        if (store.currentSymbol !== event.payload.symbol) {
          store.setSymbol(event.payload.symbol);
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => unlisten?.();
  }, []);

  // Poll to detect when detached windows are closed (Tauri only)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    const hasDetached = Object.values(detachedPanels).some(Boolean);
    if (!hasDetached) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(async () => {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const settings = useSettingsStore.getState();
      const panels = settings.detachedPanels;
      for (const [panel, isDetached] of Object.entries(panels)) {
        if (!isDetached) continue;
        const win = await WebviewWindow.getByLabel(`panel-${panel}`);
        if (!win) {
          settings.setDetached(panel, false);
        }
      }
    }, 1000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [detachedPanels]);

  // Broadcast state updates to detached windows (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    let cleanup: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ emit }) => {
      cleanup = useTradingStore.subscribe((state) => {
        emit('sync:state-update', {
          currentPrice: state.currentPrice,
          ticker: state.ticker,
          connectionStatus: state.connectionStatus,
        });
      });
    });
    return () => cleanup?.();
  }, []);

  const dismissChangelog = () => {
    setShowChangelog(false);
    setLastSeenVersion(changelogVersion);
  };

  const showLeftSidebar = panelVisibility.leftSidebar && !detachedPanels.watchlist;
  const showRightSidebar = panelVisibility.rightSidebar && !detachedPanels.trading;

  return (
    <div className="app">
      {/* Changelog Modal - shown after update */}
      {showChangelog && (
        <ChangelogModal
          version={changelogVersion}
          changelog={changelogText}
          onDismiss={dismissChangelog}
        />
      )}

      {/* Settings Modal - pass update info */}
      <Settings updateAvailable={updateAvailable} newVersion={newVersion} />

      {/* Floating Settings Gear */}
      <button
        className={`floating-settings ${updateAvailable ? 'has-update' : ''}`}
        onClick={() => setShowSettings(true)}
        title={updateAvailable ? `Update v${newVersion} available!` : 'Settings'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Main Content - No Header */}
      <main className="main-content no-header">
        {/* Left Sidebar - Watchlist */}
        {showLeftSidebar ? (
          <aside className="sidebar left-sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">Watchlist</span>
              <div className="sidebar-actions">
                <button
                  className="sidebar-btn"
                  onClick={() => detachPanel('watchlist')}
                  title="Pop out"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="4" width="8" height="8" rx="1" />
                    <path d="M6 4V2h8v8h-2" />
                  </svg>
                </button>
                <button
                  className="sidebar-btn"
                  onClick={() => togglePanel('leftSidebar')}
                  title="Collapse"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M10 3L5 8l5 5" />
                  </svg>
                </button>
              </div>
            </div>
            <Watchlist />
          </aside>
        ) : !detachedPanels.watchlist && (
          <div
            className="sidebar-collapsed left"
            onClick={() => togglePanel('leftSidebar')}
            title="Expand Watchlist"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 3l5 5-5 5" />
            </svg>
            <span className="collapsed-label">Watchlist</span>
          </div>
        )}

        {/* Center - Chart Area */}
        <ChartGrid />

        {/* Right Sidebar - Trading Panel */}
        {showRightSidebar ? (
          <aside className="sidebar right-sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">Trading</span>
              <div className="sidebar-actions">
                <button
                  className="sidebar-btn"
                  onClick={() => detachPanel('trading')}
                  title="Pop out"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="4" width="8" height="8" rx="1" />
                    <path d="M6 4V2h8v8h-2" />
                  </svg>
                </button>
                <button
                  className="sidebar-btn"
                  onClick={() => togglePanel('rightSidebar')}
                  title="Collapse"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M6 3l5 5-5 5" />
                  </svg>
                </button>
              </div>
            </div>
            <BalanceCard />

            <div className="trading-panel">
              <div className="panel-tabs">
                <button
                  className={`panel-tab ${selectedPanel === 'positions' ? 'active' : ''}`}
                  onClick={() => setSelectedPanel('positions')}
                >
                  Positions
                  {portfolio.positions.length > 0 && (
                    <span className="tab-badge">{portfolio.positions.length}</span>
                  )}
                </button>
                <button
                  className={`panel-tab ${selectedPanel === 'orders' ? 'active' : ''}`}
                  onClick={() => setSelectedPanel('orders')}
                >
                  Orders
                </button>
                <button
                  className={`panel-tab ${selectedPanel === 'history' ? 'active' : ''}`}
                  onClick={() => setSelectedPanel('history')}
                >
                  History
                </button>
              </div>

              <div className="panel-content">
                {selectedPanel === 'positions' && <PositionList />}
                {selectedPanel === 'orders' && (
                  <div className="orders-list empty">
                    <p>No open orders</p>
                  </div>
                )}
                {selectedPanel === 'history' && <TradeHistory />}
              </div>
            </div>

            <OrderForm />
          </aside>
        ) : !detachedPanels.trading && (
          <div
            className="sidebar-collapsed right"
            onClick={() => togglePanel('rightSidebar')}
            title="Expand Trading"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 3L5 8l5 5" />
            </svg>
            <span className="collapsed-label">Trading</span>
          </div>
        )}
      </main>
    </div>
  );
}

// Router: detached panel windows render their panel, main window renders full app
function AppRouter() {
  if (PANEL_PARAM) {
    return <DetachedPanelView panel={PANEL_PARAM} />;
  }
  return <App />;
}

export default AppRouter;
