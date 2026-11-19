import type { GuiSettings } from "@shared/gui-settings";

export {
  DEFAULT_GUI_SETTINGS,
  loadGuiSettings,
  saveGuiSettings,
  type GuiSettings,
  type GuiThemePreference,
} from "@shared/gui-settings";

export function applyGuiSettingsToDocument(settings: GuiSettings): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const theme =
    settings.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : settings.theme;
  root.dataset.theme = theme;
  root.dataset.reduceMotion = settings.reduceMotion ? "true" : "false";
}
