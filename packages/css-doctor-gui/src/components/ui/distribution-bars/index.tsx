import type { GuiCountBucket } from "@shared/report-model";

type DistributionBarsProps = {
  title: string;
  items: GuiCountBucket[];
  emptyLabel?: string;
};

export function DistributionBars({
  title,
  items,
  emptyLabel = "No distribution data",
}: DistributionBarsProps) {
  const max = items.reduce((highest, item) => Math.max(highest, item.count), 0);

  return (
    <section className="distribution-bars">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="distribution-bars__empty">{emptyLabel}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <div className="distribution-bars__meta">
                <span>{item.key}</span>
                <strong>{item.count}</strong>
              </div>
              <div className="distribution-bars__track">
                <div
                  className="distribution-bars__fill"
                  style={{
                    width: max > 0 ? `${(item.count / max) * 100}%` : "0%",
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <style>{`
        .distribution-bars h3 {
          margin: 0 0 0.75rem;
          font-size: 0.9rem;
        }
        .distribution-bars ul {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.55rem;
        }
        .distribution-bars__meta {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          font-size: 0.85rem;
          margin-bottom: 0.2rem;
        }
        .distribution-bars__track {
          height: 0.45rem;
          border-radius: 999px;
          background: color-mix(in srgb, var(--cssd-border) 80%, transparent);
          overflow: hidden;
        }
        .distribution-bars__fill {
          height: 100%;
          background: var(--cssd-accent);
          border-radius: inherit;
        }
        .distribution-bars__empty {
          margin: 0;
          color: var(--cssd-text-muted);
          font-size: 0.85rem;
        }
      `}</style>
    </section>
  );
}
