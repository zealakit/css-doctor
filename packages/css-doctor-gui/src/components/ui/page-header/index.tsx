type PageHeaderProps = {
  title: string;
  description?: string;
};

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      <style>{`
        .page-header {
          margin-bottom: 1.5rem;
        }
        .page-header h1 {
          margin: 0 0 0.35rem;
          font-size: 1.5rem;
          font-weight: 600;
          letter-spacing: -0.02em;
        }
        .page-header p {
          margin: 0;
          color: var(--cssd-text-muted);
          max-width: 52rem;
        }
      `}</style>
    </header>
  );
}
