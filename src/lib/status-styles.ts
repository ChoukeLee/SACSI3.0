import type { UnitStatus, ContractStatus } from "@/types/domain";

export type RoomVisualStatus =
  | "sold"
  | "leased"
  | "dailyOccupied"
  | "reserved"
  | "cleaningPending"
  | "maintenance"
  | "available";

export type StatusVisual = {
  card: string;
  badge: string;
  pill: string;
  dot: string;
  stripe: string;
  metric: string;
};

export const roomStatusStyles: Record<RoomVisualStatus, StatusVisual> = {
  sold: {
    card: "border-brand-warm-300 bg-brand-warm-100 text-brand-ink-900",
    badge: "bg-white text-brand-ink-900 ring-brand-warm-300",
    pill: "border-brand-warm-300 bg-brand-warm-100 text-brand-ink-800",
    dot: "bg-brand-neutral-500",
    stripe: "bg-brand-neutral-500",
    metric: "border-brand-warm-300 bg-white text-brand-ink-900",
  },
  leased: {
    card: "border-brand-purple-200 bg-brand-purple-50 text-brand-purple-900",
    badge: "bg-white text-brand-purple-900 ring-brand-purple-200",
    pill: "border-brand-purple-200 bg-brand-purple-50 text-brand-purple-800",
    dot: "bg-brand-purple-500",
    stripe: "bg-brand-purple-500",
    metric: "border-brand-purple-200 bg-brand-purple-50 text-brand-purple-900",
  },
  dailyOccupied: {
    card: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
    badge: "bg-white text-brand-indigo-900 ring-brand-indigo-200",
    pill: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-800",
    dot: "bg-brand-indigo-500",
    stripe: "bg-brand-indigo-500",
    metric: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
  },
  reserved: {
    card: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    badge: "bg-white text-brand-amber-900 ring-brand-amber-200",
    pill: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-800",
    dot: "bg-brand-amber-500",
    stripe: "bg-brand-amber-500",
    metric: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
  },
  cleaningPending: {
    card: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-900",
    badge: "bg-white text-brand-cyan-900 ring-brand-cyan-200",
    pill: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-800",
    dot: "bg-brand-cyan-500",
    stripe: "bg-brand-cyan-500",
    metric: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-900",
  },
  maintenance: {
    card: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
    badge: "bg-white text-brand-red-900 ring-brand-red-200",
    pill: "border-brand-red-200 bg-brand-red-50 text-brand-red-800",
    dot: "bg-brand-red-500",
    stripe: "bg-brand-red-500",
    metric: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
  },
  available: {
    card: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
    badge: "bg-white text-brand-green-900 ring-brand-green-200",
    pill: "border-brand-green-200 bg-brand-green-50 text-brand-green-800",
    dot: "bg-brand-green-500",
    stripe: "bg-brand-green-500",
    metric: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
  },
};

export const unitStatusToRoomVisual: Record<UnitStatus, RoomVisualStatus> = {
  sold: "sold",
  leased: "leased",
  daily_occupied: "dailyOccupied",
  reserved: "reserved",
  cleaning_pending: "cleaningPending",
  available: "available",
  maintenance: "maintenance",
  locked: "maintenance",
};

export const contractStatusStyles: Record<ContractStatus, { card: string; badge: string; dot: string }> = {
  active: {
    card: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
    badge: "bg-brand-green-50 text-brand-green-800 ring-brand-green-200",
    dot: "bg-brand-green-500",
  },
  draft: {
    card: "border-brand-warm-300 bg-white text-brand-ink-900",
    badge: "bg-brand-warm-100 text-brand-ink-700 ring-brand-warm-300",
    dot: "bg-brand-neutral-400",
  },
  terminated: {
    card: "border-brand-warm-300 bg-brand-warm-100 text-brand-ink-700",
    badge: "bg-brand-warm-100 text-brand-ink-700 ring-brand-warm-300",
    dot: "bg-brand-neutral-500",
  },
  expired: {
    card: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    badge: "bg-brand-amber-50 text-brand-amber-800 ring-brand-amber-200",
    dot: "bg-brand-amber-500",
  },
};

export const financeToneStyles = {
  neutral: "border-brand-warm-300 bg-white text-brand-ink-900",
  income: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
  warning: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
  danger: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
  accent: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
} as const;
