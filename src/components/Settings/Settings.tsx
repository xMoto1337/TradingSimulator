import { useState, useEffect } from 'react';
import { isTauri, getVersion } from '../../api';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTradingStore } from '../../stores/tradingStore';

interface SettingsProps {
  updateAvailable?: boolean;
  newVersion?: string;
}

export function Settings({ updateAvailable = false, newVersion = '' }: SettingsProps) {
  const { showSettings, setShowSettings } = useSettingsStore();
  const balance = useTradingStore((s) => s.portfolio.balance);
  const setBalance = useTradingStore((s) => s.setBalance);

  // Update state
  const [currentVersion, setCurrentVersion] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');

  // Get current version on mount
  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  // Sync balance input when settings opens
  useEffect(() => {
    if (showSettings) setBalanceInput(balance.toFixed(2));
  }, [showSettings, balance]);

  // Listen for update progress (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<number>('update-progress', (event) => {
        setUpdateProgress(event.payload);
      }).then((fn) => { unlisten = fn; });
    });
    return () => unlisten?.();
  }, []);

  const installUpdate = async () => {
    if (!isTauri) return;
    setIsUpdating(true);
    setUpdateProgress(0);
    setUpdateError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_update');
    } catch (e) {
      setUpdateError(String(e));
      setIsUpdating(false);
    }
  };

  const handleResetApp = () => {
    // Clear all localStorage data
    localStorage.clear();
    // Reload the app
    window.location.reload();
  };

  if (!showSettings) return null;

  return (
    <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={() => setShowSettings(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-content">
          {/* Prominent Update Banner */}
          {updateAvailable && !isUpdating && (
            <div className="update-banner-prominent">
              <div className="update-banner-content">
                <div className="update-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
                <div className="update-text">
                  <span className="update-title">Update Available</span>
                  <span className="update-version">v{newVersion}</span>
                </div>
              </div>
              <button className="update-now-btn" onClick={installUpdate}>
                Update Now
              </button>
            </div>
          )}

          {/* Updating Progress */}
          {isUpdating && (
            <div className="update-progress-section">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${updateProgress}%` }} />
              </div>
              <span className="progress-text">Installing update... {updateProgress}%</span>
            </div>
          )}

          {/* Update Error */}
          {updateError && (
            <div className="update-error">{updateError}</div>
          )}

          {/* Version Info */}
          <div className="settings-section">
            <h3>About</h3>
            <div className="version-info">
              <span className="version-label">Version</span>
              <span className="version-value">v{currentVersion || '...'}</span>
            </div>
          </div>

          {/* Data Sources Info */}
          <div className="settings-section">
            <h3>Data Sources</h3>
            <div className="data-sources-list">
              <div className="data-source">
                <span className="source-name">Binance</span>
                <span className="source-desc">Major crypto pairs (real-time)</span>
              </div>
              <div className="data-source">
                <span className="source-name">DEXScreener</span>
                <span className="source-desc">On-chain tokens</span>
              </div>
              <div className="data-source">
                <span className="source-name">Yahoo Finance</span>
                <span className="source-desc">US stocks</span>
              </div>
            </div>
          </div>

          {/* Account Balance */}
          <div className="settings-section">
            <h3>Account Balance</h3>
            <p className="settings-description">Set your paper trading cash balance.</p>
            <div className="balance-input-row">
              <span className="balance-dollar">$</span>
              <input
                type="text"
                className="balance-input"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseFloat(balanceInput.replace(/,/g, ''));
                    if (!isNaN(val) && val >= 0) setBalance(val);
                  }
                }}
              />
              <button
                className="btn-primary"
                onClick={() => {
                  const val = parseFloat(balanceInput.replace(/,/g, ''));
                  if (!isNaN(val) && val >= 0) setBalance(val);
                }}
              >
                Set
              </button>
            </div>
          </div>

          {/* Reset App Section */}
          <div className="settings-section">
            <h3>Reset</h3>
            <p className="settings-description">
              Clear all data including portfolio, trade history, and watchlists.
            </p>
            {!showResetConfirm ? (
              <button className="btn-danger" onClick={() => setShowResetConfirm(true)}>
                Reset App
              </button>
            ) : (
              <div className="reset-confirm">
                <span>Are you sure?</span>
                <button className="btn-danger" onClick={handleResetApp}>
                  Yes, Reset
                </button>
                <button className="btn-secondary" onClick={() => setShowResetConfirm(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-primary" onClick={() => setShowSettings(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
