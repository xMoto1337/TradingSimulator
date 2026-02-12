import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChartType } from '../types/trading';

interface PanelVisibility {
  leftSidebar: boolean;
  rightSidebar: boolean;
}

interface SettingsState {
  // UI settings
  showSettings: boolean;
  lastSeenVersion: string;
  panelVisibility: PanelVisibility;
  detachedPanels: Record<string, boolean>;
  chartType: ChartType;

  // Actions
  setShowSettings: (show: boolean) => void;
  setLastSeenVersion: (version: string) => void;
  togglePanel: (panel: keyof PanelVisibility) => void;
  setDetached: (panel: string, detached: boolean) => void;
  setChartType: (type: ChartType) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showSettings: false,
      lastSeenVersion: '',
      panelVisibility: { leftSidebar: true, rightSidebar: true },
      detachedPanels: {},
      chartType: 'candlestick' as ChartType,

      setShowSettings: (show) => set({ showSettings: show }),
      setLastSeenVersion: (version) => set({ lastSeenVersion: version }),
      togglePanel: (panel) =>
        set((state) => ({
          panelVisibility: {
            ...state.panelVisibility,
            [panel]: !state.panelVisibility[panel],
          },
        })),
      setDetached: (panel, detached) =>
        set((state) => ({
          detachedPanels: { ...state.detachedPanels, [panel]: detached },
        })),
      setChartType: (chartType) => set({ chartType }),
    }),
    {
      name: 'tradesim-settings',
      partialize: (state) => ({
        lastSeenVersion: state.lastSeenVersion,
        panelVisibility: state.panelVisibility,
        chartType: state.chartType,
      }),
    }
  )
);
