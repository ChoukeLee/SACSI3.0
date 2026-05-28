import { cn } from "@/lib/utils";

interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "default" | "dense";
}

export function DataTable({ size = "default", className, children, ...props }: DataTableProps) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-brand-warm-200 bg-white shadow-card",
        className,
      )}
      {...props}
    >
      <table className={cn("w-full text-left", size === "dense" ? "text-xs" : "text-[13px]")}>
        {children}
      </table>
    </div>
  );
}

export function DataTableHead({ className, children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-brand-warm-200 bg-brand-warm-50 text-xs font-semibold uppercase tracking-[0.04em] text-brand-ink-500",
        className,
      )}
      {...props}
    >
      {children}
    </thead>
  );
}

export function DataTableRow({ className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-brand-warm-100 transition-colors hover:bg-brand-warm-50",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function DataTableHeaderCell({ className, children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("px-4 py-2.5 text-left", className)} {...props}>
      {children}
    </th>
  );
}

export function DataTableCell({ className, children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-2.5", className)} {...props}>
      {children}
    </td>
  );
}
