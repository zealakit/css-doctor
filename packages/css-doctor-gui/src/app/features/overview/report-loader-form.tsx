import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Lib } from "@/lib";
import { useSettings } from "@/hooks/use-settings";
import {
  clearRecentReports,
  loadRecentReports,
  removeRecentReport,
  type RecentReportEntry,
} from "@/lib/recent-reports";
import type { GuiReport } from "@shared/report-model";
import type { DiscoveredReport, ReportSessionSource } from "@/lib/apis";

type ReportLoaderFormProps = {
  onLoaded: (report: GuiReport, source?: ReportSessionSource | null) => void;
  onError: (message: string, code?: string) => void;
};

export function ReportLoaderForm({ onLoaded, onError }: ReportLoaderFormProps) {
  const { settings } = useSettings();
  const [path, setPath] = useState("");
  const [patterns, setPatterns] = useState("**/*.css");
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState<"load" | "upload" | "generate" | null>(null);
  const [recent, setRecent] = useState<RecentReportEntry[]>(() =>
    loadRecentReports(),
  );
  const [discovered, setDiscovered] = useState<DiscoveredReport[]>([]);
  const [discoverNote, setDiscoverNote] = useState<string | null>(null);

  const recentVisible = useMemo(
    () => (settings.recentHistoryEnabled ? recent : []),
    [recent, settings.recentHistoryEnabled],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await Lib.apis.discoverReports({
        cwd: cwd.trim() || undefined,
      });
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setDiscovered([]);
        setDiscoverNote(result.message);
        return;
      }
      setDiscovered(result.reports);
      setDiscoverNote(result.note ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  async function onLoad(event: FormEvent) {
    event.preventDefault();
    setBusy("load");
    const result = await Lib.apis.loadReportFile({
      path: path.trim(),
      cwd: cwd.trim() || undefined,
    });
    setBusy(null);
    if (!result.ok) {
      onError(result.message, result.code);
      return;
    }
    onLoaded(result.report, result.source);
    setRecent(loadRecentReports());
  }

  async function onUploadFile(file: File | null) {
    if (!file) {
      return;
    }
    setBusy("upload");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text()) as unknown;
    } catch {
      setBusy(null);
      onError("Selected file is not valid JSON.", "invalid_json");
      return;
    }
    const result = await Lib.apis.uploadReportDocument({
      report: parsed,
      label: file.name,
    });
    setBusy(null);
    if (!result.ok) {
      onError(result.message, result.code);
      return;
    }
    onLoaded(result.report, result.source);
    setRecent(loadRecentReports());
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    setBusy("generate");
    const parsedPatterns = patterns
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const result = await Lib.apis.generateReport({
      patterns: parsedPatterns,
      cwd: cwd.trim() || undefined,
    });
    setBusy(null);
    if (!result.ok) {
      onError(result.message, result.code);
      return;
    }
    onLoaded(result.report, result.source);
    setRecent(loadRecentReports());
  }

  async function onOpenRecent(entry: RecentReportEntry) {
    if (!entry.path) {
      onError(
        "This recent entry was opened from a browser upload and has no server path to reload.",
        "validation_error",
      );
      return;
    }
    setBusy("load");
    const result = await Lib.apis.loadReportFile({ path: entry.path });
    setBusy(null);
    if (!result.ok) {
      onError(
        result.code === "not_found"
          ? `Recent report is missing or moved: ${entry.label}`
          : result.message,
        result.code,
      );
      return;
    }
    onLoaded(result.report, result.source);
    setRecent(loadRecentReports());
  }

  return (
    <div className="report-loader">
      <form className="report-loader__panel" onSubmit={onLoad}>
        <h2>Load JSON report</h2>
        <p>
          Server path for `check`, `health`, `optimize`, `split`, or `diff`
          `--json`.
        </p>
        <label>
          Report path
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/path/to/report.json"
            required
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={busy !== null}>
          {busy === "load" ? "Loading…" : "Load report"}
        </button>
      </form>

      <div className="report-loader__panel">
        <h2>Open from this device</h2>
        <p>
          Browser file picker uploads JSON to the local GUI server (no arbitrary
          filesystem access).
        </p>
        <label>
          Report file
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy !== null}
            onChange={(event) =>
              void onUploadFile(event.target.files?.[0] ?? null)
            }
          />
        </label>
        {busy === "upload" ? <p>Uploading…</p> : null}
      </div>

      <form className="report-loader__panel" onSubmit={onGenerate}>
        <h2>Generate check report</h2>
        <p>
          Runs analysis through the native binding (same engine as the CLI).
          This is not the same as reloading a saved report.
        </p>
        <label>
          Project directory (optional)
          <input
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder={"(defaults to server process.cwd())"}
            autoComplete="off"
          />
        </label>
        <label>
          CSS patterns
          <textarea
            value={patterns}
            onChange={(event) => setPatterns(event.target.value)}
            rows={3}
            required
          />
        </label>
        <button type="submit" disabled={busy !== null}>
          {busy === "generate" ? "Analyzing…" : "Run check"}
        </button>
      </form>

      <div className="report-loader__panel report-loader__recent">
        <h2>Project saved reports</h2>
        <p>
          From CLI <code>--save</code> under{" "}
          <code>.css-doctor/reports/*-latest.json</code>. Load only — does not
          re-analyze.
        </p>
        {discoverNote ? (
          <p className="report-loader__muted">{discoverNote}</p>
        ) : null}
        {discovered.length === 0 ? (
          <p className="report-loader__muted">
            No saved reports found for this project cwd.
          </p>
        ) : (
          <ul>
            {discovered.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setPath(entry.path);
                    void (async () => {
                      setBusy("load");
                      const result = await Lib.apis.loadReportFile({
                        path: entry.path,
                      });
                      setBusy(null);
                      if (!result.ok) {
                        onError(result.message, result.code);
                        return;
                      }
                      onLoaded(result.report, result.source);
                      setRecent(loadRecentReports());
                    })();
                  }}
                >
                  <strong>
                    {entry.command ?? "report"}
                    {entry.kind === "latest" ? " (latest)" : ""}
                  </strong>
                  <span>
                    {settings.showFullPaths
                      ? entry.path
                      : entry.path.split(/[/\\]/).slice(-1)[0]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {settings.recentHistoryEnabled ? (
        <div className="report-loader__panel report-loader__recent">
          <div className="report-loader__recent-head">
            <h2>Recent reports</h2>
            {recentVisible.length > 0 ? (
              <button
                type="button"
                onClick={() => setRecent(clearRecentReports())}
              >
                Clear all
              </button>
            ) : null}
          </div>
          <p>Metadata only — report contents are never stored in history.</p>
          {recentVisible.length === 0 ? (
            <p className="report-loader__muted">No recent reports yet.</p>
          ) : (
            <ul>
              {recentVisible.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void onOpenRecent(entry)}
                  >
                    <strong>{entry.label}</strong>
                    <span>
                      {entry.command}
                      {settings.showFullPaths && entry.path
                        ? ` · ${entry.path}`
                        : ""}
                    </span>
                    <small>{new Date(entry.openedAt).toLocaleString()}</small>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${entry.label} from recent`}
                    onClick={() => setRecent(removeRecentReport(entry.id))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <style>{`
        .report-loader {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        }
        .report-loader__panel {
          display: grid;
          gap: 0.75rem;
          align-content: start;
          background: var(--cssd-bg-elevated);
          border: 1px solid var(--cssd-border);
          border-radius: var(--cssd-radius);
          padding: 1rem;
        }
        .report-loader__panel h2 {
          margin: 0;
          font-size: 0.95rem;
        }
        .report-loader__panel p {
          margin: 0;
          color: var(--cssd-text-muted);
          font-size: 0.85rem;
        }
        .report-loader__panel label {
          display: grid;
          gap: 0.35rem;
          font-size: 0.8rem;
          color: var(--cssd-text-faint);
        }
        .report-loader__panel input,
        .report-loader__panel textarea {
          width: 100%;
          border: 1px solid var(--cssd-border-strong);
          border-radius: 8px;
          background: color-mix(in srgb, var(--cssd-bg) 80%, black);
          color: var(--cssd-text);
          padding: 0.55rem 0.65rem;
          font: inherit;
        }
        .report-loader__panel button {
          justify-self: start;
          border: 1px solid var(--cssd-accent);
          background: var(--cssd-accent-soft);
          color: var(--cssd-accent);
          border-radius: 8px;
          padding: 0.5rem 0.85rem;
          font: inherit;
          cursor: pointer;
        }
        .report-loader__panel button:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .report-loader__recent-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
        }
        .report-loader__recent-head button {
          border-color: var(--cssd-border-strong);
          background: transparent;
          color: var(--cssd-text-muted);
        }
        .report-loader__recent ul {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.5rem;
        }
        .report-loader__recent li {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 0.5rem;
          align-items: stretch;
        }
        .report-loader__recent li > button:first-child {
          display: grid;
          gap: 0.15rem;
          text-align: left;
          width: 100%;
        }
        .report-loader__recent li span,
        .report-loader__recent li small {
          color: var(--cssd-text-faint);
          font-size: 0.75rem;
          font-weight: 400;
        }
        .report-loader__muted {
          color: var(--cssd-text-faint);
        }
      `}</style>
    </div>
  );
}
