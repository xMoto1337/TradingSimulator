import { useSettingsStore } from '../stores/settingsStore';
import { isTauri } from '../api';

interface PanelConfig {
  width: number;
  height: number;
  title: string;
  hideFromMain: boolean;
}

const PANEL_CONFIGS: Record<string, PanelConfig> = {
  watchlist: { width: 260, height: 800, title: 'Watchlist', hideFromMain: true },
  trading: { width: 320, height: 900, title: 'Trading Panel', hideFromMain: true },
  chart: { width: 1000, height: 700, title: 'Chart', hideFromMain: false },
};

export async function detachPanel(panel: string) {
  if (!isTauri) return; // Not available in web/PWA mode

  const config = PANEL_CONFIGS[panel];
  if (!config) return;

  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = `panel-${panel}`;

  // Check if already open
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow(label, {
    url: `/?panel=${panel}`,
    title: config.title,
    width: config.width,
    height: config.height,
    resizable: true,
    decorations: true,
    center: true,
  });

  // Only hide from main window for sidebar panels (not chart - it stays)
  if (config.hideFromMain) {
    useSettingsStore.getState().setDetached(panel, true);
  }
}

// Check if a detached panel window still exists
export async function isDetachedWindowOpen(panel: string): Promise<boolean> {
  if (!isTauri) return false;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel(`panel-${panel}`);
  return !!win;
}
