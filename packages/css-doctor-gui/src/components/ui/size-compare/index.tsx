type SizeCompareProps = {
  beforeLabel: string;
  afterLabel: string;
  beforeBytes: number;
  afterBytes: number;
  formatBytes: (bytes: number) => string;
  note?: string;
};

export function SizeCompare({
  beforeLabel,
  afterLabel,
  beforeBytes,
  afterBytes,
  formatBytes,
  note,
}: SizeCompareProps) {
  const max = Math.max(beforeBytes, afterBytes, 1);

  return (
    <section className="size-compare">
      <div className="size-compare__row">
        <span>{beforeLabel}</span>
        <strong>{formatBytes(beforeBytes)}</strong>
      </div>
      <div className="size-compare__track">
        <div
          className="size-compare__fill size-compare__fill--before"
          style={{ width: `${(beforeBytes / max) * 100}%` }}
        />
      </div>
      <div className="size-compare__row">
        <span>{afterLabel}</span>
        <strong>{formatBytes(afterBytes)}</strong>
      </div>
      <div className="size-compare__track">
        <div
          className="size-compare__fill size-compare__fill--after"
          style={{ width: `${(afterBytes / max) * 100}%` }}
        />
      </div>
      {note ? <p className="size-compare__note">{note}</p> : null}
      <style>{`
        .size-compare {
          display: grid;
          gap: 0.45rem;
        }
        .size-compare__row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          font-size: 0.9rem;
        }
        .size-compare__track {
          height: 0.7rem;
          border-radius: 999px;
          background: color-mix(in srgb, var(--cssd-border) 80%, transparent);
          overflow: hidden;
        }
        .size-compare__fill {
          height: 100%;
          border-radius: inherit;
        }
        .size-compare__fill--before {
          background: color-mix(in srgb, var(--cssd-text-muted) 70%, transparent);
        }
        .size-compare__fill--after {
          background: var(--cssd-accent);
        }
        .size-compare__note {
          margin: 0.35rem 0 0;
          color: var(--cssd-text-faint);
          font-size: 0.8rem;
        }
      `}</style>
    </section>
  );
}
