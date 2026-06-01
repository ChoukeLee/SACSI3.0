export function FinanceStripSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-4">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-muted/60 animate-pulse" />
          <div className="min-w-0 space-y-1.5">
            <div className="h-3 w-16 rounded bg-muted/50 animate-pulse" />
            <div className="h-5 w-28 rounded bg-muted/60 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatusOverviewSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="mr-2 h-3 w-16 rounded bg-muted/50 animate-pulse" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1">
          <div className="h-2 w-2 shrink-0 rounded-full bg-muted/50 animate-pulse" />
          <div className="h-3 w-6 rounded bg-muted/50 animate-pulse" />
          <div className="h-3 w-8 rounded bg-muted/40 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function RiskAlertsSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accentRed-100 bg-accentRed-50/60 px-4 py-2.5">
      <div className="h-4 w-4 shrink-0 rounded bg-muted/50 animate-pulse" />
      <div className="h-3 w-16 rounded bg-muted/50 animate-pulse" />
      <div className="h-3 w-20 rounded bg-muted/40 animate-pulse" />
      <div className="h-3 w-24 rounded bg-muted/40 animate-pulse" />
    </div>
  );
}

export function RoomBoardSkeleton() {
  return (
    <div className="rounded-[14px] border border-[rgba(23,50,77,0.06)] bg-white p-5">
      <div className="flex justify-between border-b border-[rgba(23,50,77,0.04)] pb-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-muted/50 animate-pulse" />
          <div className="h-4 w-28 rounded bg-muted/50 animate-pulse" />
          <div className="h-3 w-16 rounded bg-muted/40 animate-pulse" />
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-muted/30 animate-pulse" />
              <div className="h-3 w-8 rounded bg-muted/30 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
      {Array.from({ length: 2 }).map((_, fi) => (
        <div key={fi} className={fi > 0 ? "mt-[18px]" : ""}>
          <div className="mb-2 h-3 w-12 rounded bg-muted/50 animate-pulse" />
          <div className="grid grid-cols-6 gap-3.5">
            {Array.from({ length: 6 }).map((_, ci) => (
              <div key={ci} className="h-[106px] rounded-[10px] bg-muted/25 animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function QualityWidgetSkeleton() {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="h-4 w-32 rounded bg-muted/50 animate-pulse" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-muted/40 animate-pulse" />
          <div className="h-3 flex-1 rounded bg-muted/40 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
