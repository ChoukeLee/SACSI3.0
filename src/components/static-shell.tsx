/**
 * Minimal static shell shown immediately while auth resolves.
 * No data fetching, no client hooks — pure HTML, instant render.
 */
export function StaticShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Minimal header placeholder matching AppShell structure */}
      <header className="sticky top-0 z-sticky flex h-12 shrink-0 items-center border-b border-border bg-card/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="flex w-full items-center gap-2 px-4">
          <div className="h-8 w-8 animate-pulse rounded-md bg-muted/50" />
          <div className="h-5 w-24 animate-pulse rounded-lg bg-muted/50" />
          <div className="ml-auto h-8 w-48 animate-pulse rounded-lg bg-muted/40" />
        </div>
      </header>
      <main className="min-h-screen bg-background p-4 sm:p-5 lg:p-6">
        {children}
      </main>
    </>
  );
}
