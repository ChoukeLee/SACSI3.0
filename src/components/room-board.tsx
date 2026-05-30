import { cn } from "@/lib/utils"

interface Props {
  children: React.ReactNode
  className?: string
  header?: React.ReactNode
}

export function RoomBoard({ children, className, header }: Props) {
  return (
    <section className={cn(
      "overflow-hidden rounded-[14px] border border-[rgba(23,50,77,0.08)] bg-white shadow-[0_10px_30px_rgba(25,58,92,0.06)]",
      className,
    )}>
      {header && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(23,50,77,0.06)] px-5 pt-[18px] pb-[14px]">
          {header}
        </div>
      )}
      <div className="px-5 pb-5 pt-5">
        {children}
      </div>
    </section>
  )
}
