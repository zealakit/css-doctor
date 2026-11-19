import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyGuiSettingsToDocument,
  DEFAULT_GUI_SETTINGS,
  loadGuiSettings,
  saveGuiSettings,
  type GuiSettings,
} from "@/lib/gui-settings";

type SettingsContextValue = {
  settings: GuiSettings;
  updateSettings: (patch: Partial<GuiSettings>) => void;
  resetSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<GuiSettings>(() =>
    loadGuiSettings(),
  );

  useEffect(() => {
    applyGuiSettingsToDocument(settings);
    saveGuiSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (settings.theme !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyGuiSettingsToDocument(settings);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<GuiSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_GUI_SETTINGS });
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings, resetSettings }),
    [settings, updateSettings, resetSettings],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
