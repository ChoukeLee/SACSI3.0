export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2 pt-0.5">{action}</div>}
    </div>
  )
}
