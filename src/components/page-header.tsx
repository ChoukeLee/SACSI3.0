export function PageHeader({
  title, description, action,
}: {
  title: string; description?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight text-brand-ink-800">{title}</h1>
        {description && <p className="mt-1 text-sm text-brand-ink-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
