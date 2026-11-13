type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
};

export function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <article className="metric-card">
      <p className="metric-card__label">{label}</p>
      <p className="metric-card__value">{value}</p>
      {hint ? <p className="metric-card__hint">{hint}</p> : null}
      <style>{`
        .metric-card {
          background: var(--cssd-bg-elevated);
          border: 1px solid var(--cssd-border);
          border-radius: var(--cssd-radius);
          padding: 0.9rem 1rem;
          box-shadow: var(--cssd-shadow);
        }
        .metric-card__label {
          margin: 0;
          color: var(--cssd-text-faint);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .metric-card__value {
          margin: 0.35rem 0 0;
          font-size: 1.45rem;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .metric-card__hint {
          margin: 0.35rem 0 0;
          color: var(--cssd-text-muted);
          font-size: 0.8rem;
        }
      `}</style>
    </article>
  );
}
