export function PageHeader({
  title, description, action,
}: {
  title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 rounded-3xl border border-white/70 bg-white/65 px-5 py-5 shadow-[0_18px_44px_-38px_rgba(15,23,42,0.45)] backdrop-blur sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-6 text-slate-500">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
