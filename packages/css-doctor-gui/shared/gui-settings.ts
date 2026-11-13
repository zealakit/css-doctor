export type GuiThemePreference = "system" | "dark" | "light";

export type GuiSettings = {
  theme: GuiThemePreference;
  recentHistoryEnabled: boolean;
  showFullPaths: boolean;
  reduceMotion: boolean;
};

export const DEFAULT_GUI_SETTINGS: GuiSettings = {
  theme: "dark",
  recentHistoryEnabled: true,
  showFullPaths: false,
  reduceMotion: false,
};

const STORAGE_KEY = "css-doctor-gui.settings.v1";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function storage(): StorageLike | null {
  try {
    const candidate = (globalThis as { localStorage?: StorageLike })
      .localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

export function loadGuiSettings(): GuiSettings {
  const localStorage = storage();
  if (!localStorage) {
    return { ...DEFAULT_GUI_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_GUI_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<GuiSettings>;
    return {
      theme:
        parsed.theme === "system" ||
        parsed.theme === "dark" ||
        parsed.theme === "light"
          ? parsed.theme
          : DEFAULT_GUI_SETTINGS.theme,
      recentHistoryEnabled:
        typeof parsed.recentHistoryEnabled === "boolean"
          ? parsed.recentHistoryEnabled
          : DEFAULT_GUI_SETTINGS.recentHistoryEnabled,
      showFullPaths:
        typeof parsed.showFullPaths === "boolean"
          ? parsed.showFullPaths
          : DEFAULT_GUI_SETTINGS.showFullPaths,
      reduceMotion:
        typeof parsed.reduceMotion === "boolean"
          ? parsed.reduceMotion
          : DEFAULT_GUI_SETTINGS.reduceMotion,
    };
  } catch {
    return { ...DEFAULT_GUI_SETTINGS };
  }
}

export function saveGuiSettings(settings: GuiSettings): void {
  const localStorage = storage();
  if (!localStorage) {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
