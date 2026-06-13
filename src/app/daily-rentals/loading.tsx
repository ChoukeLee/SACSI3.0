export default function Loading() {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="h-4 w-24 animate-pulse rounded-full bg-muted/70" />
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl bg-muted/45" />
        ))}
      </div>
      <div className="mt-5 h-12 animate-pulse rounded-xl bg-muted/35" />
    </section>
  );
}
