import packageJson from "../../../package.json";

type DashboardHeaderProps = {
  reportLabel: string;
  busy: boolean;
  onRefresh: () => void;
  onToggleTheme: () => void;
  theme: "light" | "dark";
};

export function DashboardHeader({
  reportLabel,
  busy,
  onRefresh,
  onToggleTheme,
  theme,
}: DashboardHeaderProps) {
  return (
    <header className="dashboard__header">
      <div className="dashboard__brand">
        <div className="dashboard__brand-copy">
          <div className="dashboard__brand-title">
            <strong>CSS Doctor</strong>
            <span className="dashboard__version">v{packageJson.version}</span>
          </div>
          <small>CSS Selector Explorer</small>
        </div>
      </div>
      <div className="dashboard__actions">
        <span className="dashboard__live" title={reportLabel}>
          <span className="dashboard__live-dot" aria-hidden="true" />
          Live Analysis
        </span>
        <div className="dashboard__action-group">
          <button
            type="button"
            className="dashboard__btn dashboard__btn--primary"
            onClick={onRefresh}
            disabled={busy}
            title="Re-fetch the current session report (does not re-analyze CSS)"
          >
            <RefreshIcon />
            <span>{busy ? "Refreshing…" : "Refresh Report"}</span>
          </button>
          <button
            type="button"
            className="dashboard__btn dashboard__btn--icon"
            onClick={onToggleTheme}
            title={
              theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            aria-label={
              theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>
    </header>
  );
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
    >
      <path
        d="M13.2 8A5.2 5.2 0 1 1 11.4 3.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M11 2.5v2.8h2.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
    >
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 2.2v1.2M8 12.6v1.2M2.2 8h1.2M12.6 8h1.2M3.9 3.9l.85.85M11.25 11.25l.85.85M12.1 3.9l-.85.85M4.75 11.25l-.85.85"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
    >
      <path
        d="M12.6 9.4A5 5 0 0 1 6.6 3.4 5.2 5.2 0 1 0 12.6 9.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
