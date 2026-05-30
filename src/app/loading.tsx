/**
 * Root loading skeleton — mimics page layout to reduce perceived loading time.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6 animate-[fade-in_0.3s_ease-out]">
      {/* Page chrome skeleton */}
      <div className="flex flex-col gap-1">
        <div className="h-3 w-20 rounded bg-muted/60" />
        <div className="flex items-baseline gap-3 mt-1">
          <div className="h-6 w-40 rounded bg-muted/60" />
          <div className="h-4 w-16 rounded bg-muted/40" />
        </div>
      </div>

      {/* Stat blocks skeleton */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-card px-3.5 py-3">
            <div className="h-2.5 w-2.5 rounded-full bg-muted/60" />
            <div className="flex-1 space-y-1">
              <div className="h-5 w-24 rounded bg-muted/60" />
              <div className="h-3 w-16 rounded bg-muted/40" />
            </div>
          </div>
        ))}
      </div>

      {/* Room board skeleton */}
      <div className="rounded-[14px] border border-[rgba(23,50,77,0.06)] bg-white p-5 space-y-4">
        <div className="flex justify-between border-b border-[rgba(23,50,77,0.04)] pb-3">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-muted/60" />
            <div className="h-4 w-32 rounded bg-muted/60" />
          </div>
          <div className="flex gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-muted/40" />
                <div className="h-3 w-10 rounded bg-muted/40" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, fi) => (
            <div key={fi}>
              <div className="h-3 w-12 rounded bg-muted/50 mb-2" />
              <div className="grid grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, ci) => (
                  <div key={ci} className="h-[106px] rounded-[10px] bg-muted/30" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
