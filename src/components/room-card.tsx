import Link from "next/link";
import { cn } from "@/lib/utils";
import { roomStatusStyles, type RoomVisualStatus } from "@/lib/status-styles";

type RoomCardVariant = "matrix" | "detail";

interface RoomCardProps {
  variant: RoomCardVariant;
  roomNo: string;
  status: RoomVisualStatus;
  statusLabel: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function RoomCard({ variant, roomNo, status, statusLabel, href, onClick, className, children }: RoomCardProps) {
  const styles = roomStatusStyles[status];

  const base = cn(
    "group relative flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all duration-150",
    "hover:-translate-y-0.5 hover:shadow-lifted active:scale-[0.98]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo",
    styles.card,
    variant === "matrix" && "min-h-[92px] justify-between p-3",
    variant === "detail" && "min-h-[120px] p-4",
    className,
  );

  const inner = (
    <>
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className={cn("rounded-full px-2.5 py-1 font-mono text-xs font-bold shadow-sm", styles.badge)}>
          {roomNo}
        </span>
        <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/25", styles.dot)} />
      </div>

      <div className={cn("relative z-10", variant === "detail" && "mt-2 flex flex-col gap-1")}>
        <p className="text-xs font-bold text-current">{statusLabel}</p>
        {children}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={base} title={`${roomNo} - ${statusLabel}`}>
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={base}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {inner}
    </div>
  );
}

export { type RoomVisualStatus };
