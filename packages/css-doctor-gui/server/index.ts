export { createGuiHttpServer } from "./create-server";
export {
  DEFAULT_HOST,
  FALLBACK_PORT_MAX,
  PREFERRED_PORT,
  listenGuiServer,
} from "./listen";
export { startGuiServer } from "./start";
export { openBrowser } from "./services/open-browser";
export { launchDesktopApp, resolveDesktopApp } from "./desktop";
export type { DesktopLaunchResult } from "./desktop";
export { loadReportFromFile } from "./report/load-file";
export { generateCheckReport } from "./report/generate-check";
export {
  clearReportSession,
  getCurrentReport,
  getReportSession,
  getReportSessionSource,
  setCurrentReport,
} from "./report/session";
export type { GuiReportSessionSource } from "./report/session";
export type {
  GuiHealthResponse,
  GuiServerListenResult,
  GuiServerOptions,
} from "./types";
export type { StartGuiServerOptions } from "./start";
export type {
  GuiReport,
  GuiReportLoadResult,
  GuiDiagnostic,
} from "../shared/report-model";
export { GUI_REPORT_SCHEMA_VERSION } from "../shared/report-model";
