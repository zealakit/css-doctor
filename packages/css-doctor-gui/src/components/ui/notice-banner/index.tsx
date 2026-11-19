type NoticeBannerProps = {
  message: string;
  onDismiss?: () => void;
};

export function NoticeBanner({ message, onDismiss }: NoticeBannerProps) {
  return (
    <div className="notice-banner" role="status" aria-live="polite">
      <p>{message}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss notice">
          Dismiss
        </button>
      ) : null}
      <style>{`
        .notice-banner {
          display: flex;
          gap: 1rem;
          justify-content: space-between;
          align-items: start;
          border: 1px solid color-mix(in srgb, var(--cssd-warning) 45%, var(--cssd-border));
          background: color-mix(in srgb, var(--cssd-warning) 12%, var(--cssd-bg-elevated));
          border-radius: var(--cssd-radius);
          padding: 0.75rem 1rem;
        }
        .notice-banner p {
          margin: 0;
          color: var(--cssd-text);
          font-size: 0.9rem;
        }
        .notice-banner button {
          border: 1px solid var(--cssd-border-strong);
          background: transparent;
          color: var(--cssd-text-muted);
          border-radius: 8px;
          padding: 0.3rem 0.55rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
