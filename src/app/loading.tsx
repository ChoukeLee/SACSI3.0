/**
 * Root loading skeleton — shown instantly on client-side navigation
 * while the target page's server component resolves.
 * Language-neutral: serves both /zh and /fr routes.
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand-indigo/30 border-t-brand-indigo" />
    </div>
  );
}
