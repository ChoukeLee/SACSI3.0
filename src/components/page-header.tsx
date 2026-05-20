export function PageHeader({
  title, description, action,
}: {
  title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-brand-ink-900">{title}</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-brand-ink-400">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
