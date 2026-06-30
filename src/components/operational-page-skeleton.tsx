import { cn } from "@/lib/utils";

type SkeletonKind = "table" | "records" | "dashboard";

interface OperationalPageSkeletonProps {
  kind?: SkeletonKind;
  rows?: number;
  className?: string;
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

export function OperationalPageSkeleton({ kind = "records", rows = 8, className }: OperationalPageSkeletonProps) {
  const isDashboard = kind === "dashboard";
  const isTable = kind === "table";

  return (
    <div className={cn("space-y-5", className)} aria-hidden="true">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {Array.from({ length: isDashboard ? 4 : 5 }).map((_, index) => (
          <div key={index} className="rounded-xl border bg-card p-4 shadow-sm">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-3 h-6 w-24" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonBlock className="h-9 w-32" />
          <SkeletonBlock className="h-9 w-28" />
          <SkeletonBlock className="h-9 w-28" />
          <SkeletonBlock className="h-9 w-40 lg:ml-auto" />
        </div>
      </div>

      {isDashboard ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonBlock className="h-64 rounded-xl" />
          <SkeletonBlock className="h-64 rounded-xl" />
          <SkeletonBlock className="h-80 rounded-xl lg:col-span-2" />
        </div>
      ) : isTable ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <SkeletonBlock className="h-11 rounded-none" />
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="grid grid-cols-6 gap-4 border-t px-4 py-3">
              <SkeletonBlock className="h-5" />
              <SkeletonBlock className="h-5" />
              <SkeletonBlock className="h-5" />
              <SkeletonBlock className="h-5" />
              <SkeletonBlock className="h-5" />
              <SkeletonBlock className="h-5" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <SkeletonBlock className="h-5 w-32" />
                <SkeletonBlock className="h-6 w-12 rounded-full" />
              </div>
              <SkeletonBlock className="mt-4 h-4 w-24" />
              <SkeletonBlock className="mt-3 h-4 w-36" />
              <div className="mt-5 flex gap-2">
                <SkeletonBlock className="h-8 w-16" />
                <SkeletonBlock className="h-8 w-16" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
