type ErrorStateProps = {
  title?: string;
  message: string;
};

export function ErrorState({
  title = "Something went wrong",
  message,
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      <style>{`
        .error-state {
          border: 1px solid color-mix(in srgb, var(--cssd-danger) 45%, var(--cssd-border));
          border-radius: var(--cssd-radius);
          background: color-mix(in srgb, var(--cssd-danger) 10%, var(--cssd-bg-elevated));
          padding: 1.25rem 1.5rem;
        }
        .error-state h2 {
          margin: 0 0 0.35rem;
          color: var(--cssd-danger);
          font-size: 1rem;
        }
        .error-state p {
          margin: 0;
          color: var(--cssd-text-muted);
        }
      `}</style>
    </div>
  );
}
