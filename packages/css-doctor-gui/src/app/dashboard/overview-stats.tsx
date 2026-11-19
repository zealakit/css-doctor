import type { ReactNode } from "react";

import type { SelectorExplorerOverview } from "@shared/selector-explorer";

type OverviewStatsProps = {
  overview: SelectorExplorerOverview;
};

export function OverviewStats({ overview }: OverviewStatsProps) {
  const usageReady = overview.available && overview.usageAvailable;

  return (
    <section className="dashboard__stats" aria-label="Selector overview">
      <Stat
        label="Selectors"
        value={overview.totalSelectors}
        available={overview.available}
        tone="purple"
        icon={<LayersIcon />}
      />
      <Stat
        label="Definitions"
        value={overview.totalDefinitions}
        available={overview.available && overview.totalDefinitions !== null}
        tone="blue"
        icon={<FileIcon />}
      />
      <Stat
        label="Confirmed Usages"
        value={overview.confirmedUsages}
        available={usageReady}
        tone="teal"
        icon={<PulseIcon />}
      />
      <Stat
        label="Usage Files"
        value={overview.distinctUsageFiles}
        available={usageReady && overview.distinctUsageFiles !== null}
        tone="blue"
        icon={<FileIcon />}
      />
      <Stat
        label="Unused"
        value={overview.unusedSelectors}
        available={usageReady}
        tone="orange"
        icon={<AlertIcon />}
      />
      <Stat
        label="Partial / Unknown"
        value={overview.partialOrUnresolved}
        available={usageReady}
        tone="orange"
        icon={<PartialIcon />}
      />
      {overview.note ? (
        <p className="dashboard__note dashboard__stats-note">{overview.note}</p>
      ) : null}
      {overview.completeness === "legacy-class-only" ||
      overview.completeness === "symbols-only" ? (
        <p className="dashboard__note dashboard__stats-note dashboard__legacy-banner">
          Limited selector coverage — this report is not a complete Core
          selector analysis.
        </p>
      ) : null}
    </section>
  );
}

function Stat(props: {
  label: string;
  value: number | null;
  available: boolean;
  tone: "purple" | "teal" | "orange" | "blue";
  icon: ReactNode;
}) {
  const unavailable = !props.available || props.value === null;
  return (
    <div className={`dashboard__stat dashboard__stat--${props.tone}`}>
      <div className="dashboard__stat-top">
        <span className="dashboard__stat-label">{props.label}</span>
        <span className="dashboard__stat-icon" aria-hidden="true">
          {props.icon}
        </span>
      </div>
      <span
        className={
          unavailable
            ? "dashboard__stat-value is-unavailable"
            : "dashboard__stat-value"
        }
      >
        {unavailable ? "—" : formatCount(props.value ?? 0)}
      </span>
    </div>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function LayersIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 5.2 8 2.5l5.5 2.7L8 7.9 2.5 5.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 8.2 8 10.9l5.5-2.7M2.5 10.8 8 13.5l5.5-2.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1.5 8h3l1.4-3.2L8.8 12l1.6-4H14.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 2.8 13.4 13H2.6L8 2.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.4v2.8M8 11.2h.01"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.2 2.5h5.1L12 5.2v8.3H4.2V2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 2.5V5.3H12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PartialIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 4.8v3.2l2 1.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
