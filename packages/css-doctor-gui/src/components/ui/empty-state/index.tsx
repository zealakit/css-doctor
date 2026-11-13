type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <h2>{title}</h2>
      <p>{description}</p>
      <style>{`
        .empty-state {
          border: 1px dashed var(--cssd-border-strong);
          border-radius: var(--cssd-radius);
          background: var(--cssd-bg-elevated);
          padding: 1.5rem;
        }
        .empty-state h2 {
          margin: 0 0 0.4rem;
          font-size: 1rem;
        }
        .empty-state p {
          margin: 0;
          color: var(--cssd-text-muted);
        }
      `}</style>
    </div>
  );
}
