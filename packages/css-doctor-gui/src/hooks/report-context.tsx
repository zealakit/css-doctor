import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Lib } from "@/lib";
import type { ReportSessionSource } from "@/lib/apis";
import { loadGuiSettings, type GuiSettings } from "@/lib/gui-settings";
import { rememberReport } from "@/lib/recent-reports";
import type { GuiReport } from "@shared/report-model";

export type ReportState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string; code?: string }
  | { status: "ready"; report: GuiReport };

type ReportContextValue = {
  state: ReportState;
  source: ReportSessionSource | null;
  notice: string | null;
  busy: boolean;
  reportRevision: number;
  clearNotice: () => void;
  /** Soft refresh of the in-memory session report (does not re-analyze). */
  refresh: () => Promise<unknown>;
  /** Reload from disk when the session source is a file path. */
  reloadFromDisk: () => Promise<unknown>;
  applyLoadedReport: (
    report: GuiReport,
    source?: ReportSessionSource | null,
  ) => void;
  /** Surface a load failure without discarding the current ready report. */
  reportLoadFailure: (message: string, code?: string) => void;
  clearSession: () => Promise<unknown>;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [source, setSource] = useState<ReportSessionSource | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportRevision, setReportRevision] = useState(0);
  const inflight = useRef<Promise<unknown> | null>(null);
  const readyReport = useRef<GuiReport | null>(null);

  const clearNotice = useCallback(() => setNotice(null), []);

  const remember = useCallback((report: GuiReport) => {
    const settings: GuiSettings = loadGuiSettings();
    rememberReport(report, {
      enabled: settings.recentHistoryEnabled,
      path: report.source.path,
    });
  }, []);

  const applyLoadedReport = useCallback(
    (report: GuiReport, nextSource?: ReportSessionSource | null) => {
      readyReport.current = report;
      setState({ status: "ready", report });
      if (nextSource !== undefined) {
        setSource(nextSource);
      }
      setNotice(null);
      setReportRevision((value) => value + 1);
      remember(report);
    },
    [remember],
  );

  const reportLoadFailure = useCallback((message: string, code?: string) => {
    if (readyReport.current) {
      setNotice(message);
      setState({ status: "ready", report: readyReport.current });
      return;
    }
    setState({ status: "error", message, code });
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      return inflight.current;
    }
    const keepReady = readyReport.current !== null;
    if (!keepReady) {
      setState({ status: "loading" });
    } else {
      setBusy(true);
    }

    const task = (async () => {
      const result = await Lib.apis.fetchReport();
      if (result.ok) {
        applyLoadedReport(result.report, result.source ?? null);
        return result;
      }
      if (result.code === "no_report" || result.code === "http_404") {
        readyReport.current = null;
        setSource(null);
        setState({ status: "empty" });
        return result;
      }
      reportLoadFailure(result.message, result.code);
      return result;
    })();

    inflight.current = task.finally(() => {
      inflight.current = null;
      setBusy(false);
    });
    return inflight.current;
  }, [applyLoadedReport, reportLoadFailure]);

  const reloadFromDisk = useCallback(async () => {
    if (inflight.current) {
      return inflight.current;
    }
    setBusy(true);
    const task = (async () => {
      const result = await Lib.apis.reloadReport();
      if (result.ok) {
        applyLoadedReport(result.report, result.source ?? null);
        return result;
      }
      reportLoadFailure(result.message, result.code);
      return result;
    })();
    inflight.current = task.finally(() => {
      inflight.current = null;
      setBusy(false);
    });
    return inflight.current;
  }, [applyLoadedReport, reportLoadFailure]);

  const clearSession = useCallback(async () => {
    setBusy(true);
    const result = await Lib.apis.clearReport();
    setBusy(false);
    if (!result.ok) {
      reportLoadFailure(result.message, result.code);
      return result;
    }
    readyReport.current = null;
    setSource(null);
    setNotice(null);
    setState({ status: "empty" });
    setReportRevision((value) => value + 1);
    return result;
  }, [reportLoadFailure]);

  const didHydrate = useRef(false);
  useEffect(() => {
    if (didHydrate.current) {
      return;
    }
    didHydrate.current = true;
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      state,
      source,
      notice,
      busy,
      reportRevision,
      clearNotice,
      refresh,
      reloadFromDisk,
      applyLoadedReport,
      reportLoadFailure,
      clearSession,
    }),
    [
      state,
      source,
      notice,
      busy,
      reportRevision,
      clearNotice,
      refresh,
      reloadFromDisk,
      applyLoadedReport,
      reportLoadFailure,
      clearSession,
    ],
  );

  return (
    <ReportContext.Provider value={value}>{children}</ReportContext.Provider>
  );
}

export function useReport(): ReportContextValue {
  const context = useContext(ReportContext);
  if (!context) {
    throw new Error("useReport must be used within ReportProvider");
  }
  return context;
}
