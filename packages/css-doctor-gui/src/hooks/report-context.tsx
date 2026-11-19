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
  clearNotice: () => void;
  /** Soft refresh of the in-memory session report (does not re-analyze). */
  refresh: () => Promise<unknown>;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [source, setSource] = useState<ReportSessionSource | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef<Promise<unknown> | null>(null);
  const readyReport = useRef<GuiReport | null>(null);

  const clearNotice = useCallback(() => setNotice(null), []);

  const applyLoadedReport = useCallback(
    (report: GuiReport, nextSource?: ReportSessionSource | null) => {
      readyReport.current = report;
      setState({ status: "ready", report });
      if (nextSource !== undefined) {
        setSource(nextSource);
      }
      setNotice(null);
    },
    [],
  );

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
      if (readyReport.current) {
        setNotice(result.message);
        setState({ status: "ready", report: readyReport.current });
        return result;
      }
      setState({
        status: "error",
        message: result.message,
        code: result.code,
      });
      return result;
    })();

    inflight.current = task.finally(() => {
      inflight.current = null;
      setBusy(false);
    });
    return inflight.current;
  }, [applyLoadedReport]);

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
      clearNotice,
      refresh,
    }),
    [state, source, notice, busy, clearNotice, refresh],
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
