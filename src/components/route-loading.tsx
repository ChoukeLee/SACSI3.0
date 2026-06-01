type RouteLoadingVariant = "dashboard" | "timeline" | "table";

function StatSkeleton({ tone = "muted" }: { tone?: "muted" | "blue" | "green" | "amber" }) {
  const tones = {
    muted: "bg-muted/45",
    blue: "bg-accentBlue-50",
    green: "bg-accentGreen-50",
    amber: "bg-accentAmber-50",
  };

  return (
    <div className={`rounded-2xl border border-border/60 ${tones[tone]} p-4 shadow-sm`}>
      <div className="mb-4 h-3 w-20 animate-pulse rounded-full bg-muted/60" />
      <div className="h-7 w-24 animate-pulse rounded-lg bg-muted/70" />
    </div>
  );
}

function RoomGridSkeleton() {
  return (
    <div className="rounded-[18px] border border-border/60 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary/70" />
          <div className="h-4 w-24 animate-pulse rounded-full bg-muted/70" />
        </div>
        <div className="hidden gap-2 sm:flex">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-5 w-16 animate-pulse rounded-full bg-muted/50" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, floorIndex) => (
          <div key={floorIndex}>
            <div className="mb-2 h-3 w-10 animate-pulse rounded-full bg-muted/60" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, cardIndex) => (
                <div key={cardIndex} className="h-[112px] animate-pulse rounded-xl bg-muted/40" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="overflow-hidden rounded-[22px] border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 p-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded-lg bg-muted/70" />
          <div className="mt-2 h-3 w-56 animate-pulse rounded-full bg-muted/50" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-10 w-24 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[170px_repeat(7,minmax(92px,1fr))]">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={`head-${index}`} className="h-14 border-b border-r border-border/50 bg-muted/30" />
        ))}
        {Array.from({ length: 56 }).map((_, index) => (
          <div key={`cell-${index}`} className="h-14 border-b border-r border-border/40 bg-card">
            {index % 13 === 0 && <div className="m-2 h-9 animate-pulse rounded-full bg-accentBlue-100" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="grid grid-cols-6 border-b border-border/60 bg-muted/35 px-4 py-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-3 w-16 animate-pulse rounded-full bg-muted/70" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-6 border-b border-border/40 px-4 py-4 last:border-b-0">
          {Array.from({ length: 6 }).map((_, colIndex) => (
            <div key={colIndex} className="h-4 w-20 animate-pulse rounded-full bg-muted/50" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function RouteLoading({ variant = "dashboard" }: { variant?: RouteLoadingVariant }) {
  return (
    <section className="animate-fade-in space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="h-3 w-20 animate-pulse rounded-full bg-muted/60" />
          <div className="mt-3 h-8 w-40 animate-pulse rounded-lg bg-muted/70" />
        </div>
        <div className="hidden h-9 w-28 animate-pulse rounded-full bg-muted/50 sm:block" />
      </div>

      {variant === "timeline" ? (
        <TimelineSkeleton />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatSkeleton tone="blue" />
            <StatSkeleton tone="green" />
            <StatSkeleton tone="amber" />
            <StatSkeleton />
          </div>
          {variant === "table" ? <TableSkeleton /> : <RoomGridSkeleton />}
        </>
      )}
    </section>
  );
}
