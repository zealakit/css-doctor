import { useEffect } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";

import { NoticeBanner } from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import { useSettings } from "@/hooks/use-settings";
import { NAV_ITEMS, ROUTES } from "@/lib/constants";

export function ConsoleLayout() {
  const {
    state,
    source,
    notice,
    clearNotice,
    busy,
    refresh,
    reloadFromDisk,
    clearSession,
    reportRevision,
  } = useReport();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (reportRevision === 0 || !location.search) {
      return;
    }
    navigate({ pathname: location.pathname, search: "" }, { replace: true });
  }, [reportRevision, location.pathname, location.search, navigate]);

  const reportLabel =
    state.status === "ready"
      ? settings.showFullPaths
        ? (source?.path ?? source?.label ?? state.report.source.command)
        : (source?.label ?? state.report.source.command)
      : state.status === "empty"
        ? "No report"
        : state.status === "loading"
          ? "Loading…"
          : "Error";

  return (
    <div className="console-layout">
      <a className="console-layout__skip" href="#main-content">
        Skip to content
      </a>
      <aside className="console-layout__sidebar">
        <div className="console-layout__brand">
          <span className="console-layout__mark" aria-hidden="true">
            CD
          </span>
          <div>
            <strong>CSS Doctor</strong>
            <small>Report Viewer</small>
          </div>
        </div>
        <nav aria-label="Primary">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.path}
                  end={item.path === "/"}
                  className={({ isActive }) =>
                    isActive
                      ? "console-layout__link is-active"
                      : "console-layout__link"
                  }
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="console-layout__main">
        <header className="console-layout__topbar">
          <div className="console-layout__status">
            <span>Local analysis console</span>
            <span className="console-layout__report" title={source?.path}>
              {reportLabel}
            </span>
          </div>
          <div className="console-layout__actions">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void reloadFromDisk()}
              disabled={busy || source?.reloadable !== true}
              title="Reload JSON from disk (not re-analysis)"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => void clearSession()}
              disabled={busy || state.status === "empty"}
            >
              Clear
            </button>
            <NavLink to={ROUTES.SETTINGS} className="console-layout__settings">
              Settings
            </NavLink>
            <span className="console-layout__badge">Phase 7</span>
          </div>
        </header>
        <main
          id="main-content"
          className="console-layout__content"
          tabIndex={-1}
        >
          {notice && location.pathname !== ROUTES.OVERVIEW ? (
            <div className="console-layout__notice">
              <NoticeBanner message={notice} onDismiss={clearNotice} />
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
      <style>{`
        .console-layout {
          display: grid;
          grid-template-columns: var(--cssd-sidebar-width) minmax(0, 1fr);
          min-height: 100vh;
        }
        .console-layout__skip {
          position: absolute;
          left: -9999px;
          top: 0;
          background: var(--cssd-accent);
          color: #fff;
          padding: 0.5rem 0.75rem;
          z-index: 20;
        }
        .console-layout__skip:focus {
          left: 0.75rem;
          top: 0.75rem;
        }
        .console-layout__sidebar {
          border-right: 1px solid var(--cssd-border);
          background: color-mix(in srgb, var(--cssd-bg-elevated) 88%, black);
          padding: 1.25rem 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .console-layout__brand {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          padding: 0.35rem 0.55rem;
        }
        .console-layout__mark {
          width: 2rem;
          height: 2rem;
          border-radius: 8px;
          display: grid;
          place-items: center;
          background: var(--cssd-accent-soft);
          color: var(--cssd-accent);
          font-size: 0.75rem;
          font-weight: 700;
        }
        .console-layout__brand strong {
          display: block;
          font-size: 0.95rem;
        }
        .console-layout__brand small {
          color: var(--cssd-text-faint);
        }
        .console-layout__sidebar ul {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.25rem;
        }
        .console-layout__link {
          display: grid;
          gap: 0.1rem;
          padding: 0.65rem 0.7rem;
          border-radius: 8px;
          color: var(--cssd-text-muted);
        }
        .console-layout__link span {
          font-size: 0.92rem;
          font-weight: 500;
          color: var(--cssd-text);
        }
        .console-layout__link small {
          color: var(--cssd-text-faint);
          font-size: 0.75rem;
        }
        .console-layout__link:hover,
        .console-layout__link.is-active {
          background: var(--cssd-accent-soft);
        }
        .console-layout__link.is-active span {
          color: var(--cssd-accent);
        }
        .console-layout__main {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .console-layout__topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          padding: 0.9rem 1.5rem;
          border-bottom: 1px solid var(--cssd-border);
          color: var(--cssd-text-muted);
          font-size: 0.875rem;
          flex-wrap: wrap;
        }
        .console-layout__status {
          display: grid;
          gap: 0.15rem;
          min-width: 0;
        }
        .console-layout__report {
          color: var(--cssd-text);
          font-family: var(--cssd-font-mono);
          font-size: 0.8rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: min(48vw, 420px);
        }
        .console-layout__actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
          align-items: center;
        }
        .console-layout__actions button,
        .console-layout__settings {
          border: 1px solid var(--cssd-border-strong);
          background: transparent;
          color: var(--cssd-text-muted);
          border-radius: 8px;
          padding: 0.3rem 0.55rem;
          cursor: pointer;
          font: inherit;
        }
        .console-layout__actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .console-layout__badge {
          border: 1px solid var(--cssd-border-strong);
          border-radius: 999px;
          padding: 0.15rem 0.55rem;
          color: var(--cssd-text-faint);
          font-size: 0.75rem;
        }
        .console-layout__content {
          padding: 1.5rem;
          outline: none;
        }
        .console-layout__notice {
          margin-bottom: 1rem;
        }
        @media (max-width: 900px) {
          .console-layout {
            grid-template-columns: 1fr;
          }
          .console-layout__sidebar {
            border-right: 0;
            border-bottom: 1px solid var(--cssd-border);
          }
          .console-layout__sidebar nav ul {
            display: flex;
            gap: 0.35rem;
            overflow-x: auto;
          }
          .console-layout__link small {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
