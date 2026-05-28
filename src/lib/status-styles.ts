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
    card: "border-[#505080]/25 bg-[#505080] text-white",
    badge: "bg-white text-[#303052] ring-white/60",
    pill: "border-[#505080]/20 bg-[#505080]/10 text-[#505080]",
    dot: "bg-[#505080]",
    stripe: "bg-[#505080]",
    metric: "border-[#505080]/20 bg-[#505080]/10 text-[#303052]",
  },
  leased: {
    card: "border-[#7050A0]/20 bg-[#7050A0] text-white",
    badge: "bg-white text-[#51347A] ring-white/60",
    pill: "border-[#7050A0]/20 bg-[#7050A0]/10 text-[#5C4388]",
    dot: "bg-[#7050A0]",
    stripe: "bg-[#7050A0]",
    metric: "border-[#7050A0]/20 bg-[#7050A0]/10 text-[#4F3A78]",
  },
  dailyOccupied: {
    card: "border-[#5090C0]/20 bg-[#5090C0] text-white",
    badge: "bg-white text-[#2C628B] ring-white/60",
    pill: "border-[#5090C0]/20 bg-[#5090C0]/10 text-[#376F99]",
    dot: "bg-[#5090C0]",
    stripe: "bg-[#5090C0]",
    metric: "border-[#5090C0]/20 bg-[#5090C0]/10 text-[#2E628B]",
  },
  reserved: {
    card: "border-[#A0C0E0]/30 bg-[#A0C0E0] text-[#1F4564]",
    badge: "bg-white text-[#315E83] ring-white/70",
    pill: "border-[#A0C0E0]/30 bg-[#A0C0E0]/25 text-[#315E83]",
    dot: "bg-[#A0C0E0]",
    stripe: "bg-[#A0C0E0]",
    metric: "border-[#A0C0E0]/30 bg-[#A0C0E0]/25 text-[#315E83]",
  },
  cleaningPending: {
    card: "border-[#5AB5B8]/25 bg-[#5AB5B8] text-white",
    badge: "bg-white text-[#32757A] ring-white/60",
    pill: "border-[#5AB5B8]/25 bg-[#5AB5B8]/10 text-[#32757A]",
    dot: "bg-[#5AB5B8]",
    stripe: "bg-[#5AB5B8]",
    metric: "border-[#5AB5B8]/25 bg-[#5AB5B8]/10 text-[#32757A]",
  },
  maintenance: {
    card: "border-[#F0A080]/35 bg-[#F0A080] text-[#673522]",
    badge: "bg-white text-[#8A4A32] ring-white/70",
    pill: "border-[#F0A080]/35 bg-[#F0A080]/20 text-[#8A4A32]",
    dot: "bg-[#F0A080]",
    stripe: "bg-[#F0A080]",
    metric: "border-[#F0A080]/35 bg-[#F0A080]/20 text-[#8A4A32]",
  },
  available: {
    card: "border-[#F0E0D0]/70 bg-[#F0E0D0] text-[#4F4238]",
    badge: "bg-white text-[#5D4B3F] ring-white/80",
    pill: "border-[#F0E0D0] bg-[#F0E0D0]/55 text-[#5D4B3F]",
    dot: "bg-[#F0E0D0]",
    stripe: "bg-[#F0E0D0]",
    metric: "border-[#F0E0D0] bg-[#F0E0D0]/55 text-[#5D4B3F]",
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

export const receivableStatusStyles: Record<string, string> = {
  pending:   "bg-brand-warm-100 text-brand-ink-700",
  partial:   "bg-brand-amber-100 text-brand-amber-700",
  paid:      "bg-brand-green-100 text-brand-green-700",
  overdue:   "bg-brand-red-100 text-brand-red-700",
  cancelled: "bg-brand-warm-100 text-brand-ink-500 line-through",
};

export const receivableRowBg: Record<string, string> = {
  pending:   "",
  partial:   "bg-brand-amber-50/30",
  paid:      "",
  overdue:   "bg-brand-red-50/30",
  cancelled: "opacity-60",
};

export const contractStatusVariant: Record<string, "secondary" | "success" | "destructive" | "warning"> = {
  draft: "secondary",
  active: "success",
  terminated: "destructive",
  expired: "warning",
};
