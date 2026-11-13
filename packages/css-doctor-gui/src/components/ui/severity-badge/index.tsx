import type { GuiSeverity } from "@shared/report-model";

type SeverityBadgeProps = {
  severity: GuiSeverity;
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <span className="severity-badge" data-severity={severity}>
      {severity}
      <style>{`
        .severity-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 0.1rem 0.5rem;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          border: 1px solid var(--cssd-border-strong);
          color: var(--cssd-text-muted);
        }
        .severity-badge[data-severity="error"] {
          color: #f2a4a4;
          border-color: color-mix(in srgb, #f2a4a4 45%, transparent);
          background: color-mix(in srgb, #f2a4a4 12%, transparent);
        }
        .severity-badge[data-severity="warning"] {
          color: #e6c07b;
          border-color: color-mix(in srgb, #e6c07b 45%, transparent);
          background: color-mix(in srgb, #e6c07b 12%, transparent);
        }
        .severity-badge[data-severity="info"] {
          color: #8fbfef;
          border-color: color-mix(in srgb, #8fbfef 45%, transparent);
          background: color-mix(in srgb, #8fbfef 12%, transparent);
        }
      `}</style>
    </span>
  );
}
