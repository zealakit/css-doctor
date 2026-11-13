type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-state__dot" aria-hidden="true" />
      <span>{label}</span>
      <style>{`
        .loading-state {
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
          color: var(--cssd-text-muted);
        }
        .loading-state__dot {
          width: 0.65rem;
          height: 0.65rem;
          border-radius: 999px;
          background: var(--cssd-accent);
          animation: cssd-pulse 1.1s ease-in-out infinite;
        }
        @keyframes cssd-pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
