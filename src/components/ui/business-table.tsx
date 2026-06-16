"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Align = "left" | "center" | "right";

const alignClass: Record<Align, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export const DEFAULT_BUSINESS_TABLE_PAGE_SIZE = 20;

export function BusinessTable({
  children,
  minWidth,
  className,
}: {
  children: ReactNode;
  minWidth?: string;
  className?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table
          className={cn("w-full table-fixed text-left text-[13px]", minWidth, className)}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

export function BusinessThead({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return (
    <thead
      className={cn(
        "border-b bg-muted/70 text-xs font-semibold text-muted-foreground",
        sticky && "sticky top-0 z-10",
      )}
    >
      {children}
    </thead>
  );
}

export function BusinessTh({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <th className={cn("h-11 whitespace-nowrap px-4 py-3 align-middle", alignClass[align], className)}>
      {children}
    </th>
  );
}

export function BusinessTbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border/60">{children}</tbody>;
}

export function BusinessTd({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <td className={cn("h-12 whitespace-nowrap px-4 py-3 align-middle", alignClass[align], className)}>
      {children}
    </td>
  );
}

export function BusinessRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <tr className={cn("transition-colors hover:bg-accent/45", className)}>{children}</tr>;
}

export function MoneyCell({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "income" | "expense" | "debt" | "muted";
  className?: string;
}) {
  return (
    <BusinessTd
      align="right"
      className={cn(
        "tabular-nums font-semibold",
        tone === "income" && "text-emerald-600",
        tone === "expense" && "text-rose-600",
        tone === "debt" && "text-accentBlue-700",
        tone === "muted" && "text-muted-foreground",
        className,
      )}
    >
      {children}
    </BusinessTd>
  );
}

export const businessEmptyCell = "px-4 py-12 text-center text-muted-foreground/70";
