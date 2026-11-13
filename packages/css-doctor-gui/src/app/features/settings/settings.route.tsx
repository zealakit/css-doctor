import { useEffect, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { useSettings } from "@/hooks/use-settings";
import { Lib } from "@/lib";
import type { RuntimeInfo, HealthInfo } from "@/lib/apis";
import {
  clearRecentReports,
  loadRecentReports,
  type RecentReportEntry,
} from "@/lib/recent-reports";
import type { GuiThemePreference } from "@/lib/gui-settings";

export function SettingsRoute() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [recent, setRecent] = useState<RecentReportEntry[]>(() =>
    loadRecentReports(),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingStatus(true);
      try {
        const [runtimeInfo, healthInfo] = await Promise.all([
          Lib.apis.fetchRuntimeInfo(),
          Lib.apis.fetchHealth(),
        ]);
        if (cancelled) {
          return;
        }
        setRuntime(runtimeInfo);
        setHealth(healthInfo);
        setStatusError(null);
      } catch (error) {
        if (!cancelled) {
          setStatusError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="settings">
      <PageHeader
        title="Settings"
        description="Local viewer preferences. Stored in this browser only."
      />

      <div className="settings__grid">
        <article>
          <h2>Appearance</h2>
          <label>
            Theme
            <select
              value={settings.theme}
              onChange={(event) =>
                updateSettings({
                  theme: event.target.value as GuiThemePreference,
                })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="settings__check">
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(event) =>
                updateSettings({ reduceMotion: event.target.checked })
              }
            />
            Reduce motion
          </label>
          <label className="settings__check">
            <input
              type="checkbox"
              checked={settings.showFullPaths}
              onChange={(event) =>
                updateSettings({ showFullPaths: event.target.checked })
              }
            />
            Show full filesystem paths in the UI
          </label>
        </article>

        <article>
          <h2>Recent reports</h2>
          <label className="settings__check">
            <input
              type="checkbox"
              checked={settings.recentHistoryEnabled}
              onChange={(event) =>
                updateSettings({ recentHistoryEnabled: event.target.checked })
              }
            />
            Remember recently opened reports (metadata only)
          </label>
          <p className="settings__hint">
            History never stores report contents. Uploaded browser files without
            a server path cannot be reopened from history.
          </p>
          <p className="settings__hint">{recent.length} stored entries</p>
          <button type="button" onClick={() => setRecent(clearRecentReports())}>
            Clear recent history
          </button>
        </article>

        <article>
          <h2>Runtime status</h2>
          {loadingStatus ? <LoadingState label="Checking runtime…" /> : null}
          {statusError ? <ErrorState message={statusError} /> : null}
          {!loadingStatus && !statusError && runtime && health ? (
            <dl>
              <div>
                <dt>Phase</dt>
                <dd>{runtime.phase}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{runtime.runtime}</dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>
                  {health.service} · {health.version}
                </dd>
              </div>
              <div>
                <dt>Report loaded</dt>
                <dd>{runtime.hasReport ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>
                  {Object.entries(runtime.capabilities)
                    .filter(([, enabled]) => enabled)
                    .map(([key]) => key)
                    .join(", ") || "none"}
                </dd>
              </div>
              <div>
                <dt>Note</dt>
                <dd>{runtime.note}</dd>
              </div>
            </dl>
          ) : null}
          {!loadingStatus && !runtime && !statusError ? (
            <EmptyState
              title="Runtime unavailable"
              description="Could not read runtime status from the local server."
            />
          ) : null}
        </article>
      </div>

      <button type="button" className="settings__reset" onClick={resetSettings}>
        Reset preferences
      </button>

      <style>{`
        .settings {
          display: grid;
          gap: 1.25rem;
        }
        .settings__grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }
        .settings article {
          background: var(--cssd-bg-elevated);
          border: 1px solid var(--cssd-border);
          border-radius: var(--cssd-radius);
          padding: 1rem;
          display: grid;
          gap: 0.75rem;
          align-content: start;
        }
        .settings h2 {
          margin: 0;
          font-size: 0.95rem;
        }
        .settings label {
          display: grid;
          gap: 0.35rem;
          font-size: 0.85rem;
          color: var(--cssd-text-muted);
        }
        .settings__check {
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 0.55rem;
        }
        .settings select {
          border: 1px solid var(--cssd-border-strong);
          border-radius: 8px;
          background: color-mix(in srgb, var(--cssd-bg) 80%, black);
          color: var(--cssd-text);
          padding: 0.45rem 0.6rem;
        }
        .settings__hint {
          margin: 0;
          color: var(--cssd-text-faint);
          font-size: 0.8rem;
        }
        .settings dl {
          margin: 0;
          display: grid;
          gap: 0.55rem;
        }
        .settings dt {
          color: var(--cssd-text-faint);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .settings dd {
          margin: 0.15rem 0 0;
          word-break: break-word;
        }
        .settings button {
          justify-self: start;
          border: 1px solid var(--cssd-border-strong);
          background: transparent;
          color: var(--cssd-text-muted);
          border-radius: 8px;
          padding: 0.45rem 0.7rem;
          cursor: pointer;
          font: inherit;
        }
        .settings__reset {
          border-color: var(--cssd-danger);
          color: var(--cssd-danger);
        }
      `}</style>
    </section>
  );
}
