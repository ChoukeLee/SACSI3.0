export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
