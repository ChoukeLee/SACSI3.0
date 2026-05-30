import type { UnitStatus, ContractStatus } from "@/types/domain";

/* ═══════════════════════════════════════════════════════════════════════════
   SACIS Room Status CSS Tokens — exact spec, do not alter values
   ═══════════════════════════════════════════════════════════════════════════ */

export const ROOM_COLORS = {
  deepBlue:  "#075A9A",
  skyBlue:   "#62B6F5",
  iceBlue:   "#EAF7FF",
  cream:     "#FFF6D8",
  mint:      "#D9F7F0",
  coral:     "#FFE2EA",
  lavender:  "#E8E2FF",
  textDark:  "#17324D",
  textSoft:  "#5D7186",
  textWhite: "#FFFFFF",
} as const;

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

/* ── Exact status → color mapping ── */
export const roomStatusStyles: Record<RoomVisualStatus, StatusVisual> = {
  sold: {
    card: "bg-[#075A9A] text-white",
    badge: "bg-white/90 text-[#17324D]",
    pill: "bg-[#075A9A]/10 text-[#075A9A] ring-[#075A9A]/20",
    dot: "bg-[#075A9A]",
    stripe: "bg-[#075A9A]",
    metric: "bg-[#075A9A]/10 text-[#075A9A]",
  },
  leased: {
    card: "bg-[#E8E2FF] text-[#17324D]",
    badge: "bg-white text-[#17324D]",
    pill: "bg-[#E8E2FF] text-[#17324D] ring-[#C8BEF0]/60",
    dot: "bg-[#A898E8]",
    stripe: "bg-[#A898E8]",
    metric: "bg-[#E8E2FF] text-[#17324D]",
  },
  dailyOccupied: {
    card: "bg-[#62B6F5] text-white",
    badge: "bg-white/90 text-[#17324D]",
    pill: "bg-[#62B6F5]/10 text-[#1A6090] ring-[#62B6F5]/20",
    dot: "bg-[#62B6F5]",
    stripe: "bg-[#62B6F5]",
    metric: "bg-[#62B6F5]/10 text-[#1A6090]",
  },
  reserved: {
    card: "bg-[#FFF6D8] text-[#17324D]",
    badge: "bg-white text-[#17324D]",
    pill: "bg-[#FFF6D8] text-[#17324D] ring-[#E8D5A0]/60",
    dot: "bg-[#E8C840]",
    stripe: "bg-[#E8C840]",
    metric: "bg-[#FFF6D8] text-[#17324D]",
  },
  available: {
    card: "bg-[#EAF7FF] text-[#17324D]",
    badge: "bg-white text-[#17324D]",
    pill: "bg-[#EAF7FF] text-[#17324D] ring-[#C0DDF0]/60",
    dot: "bg-[#A0D0E8]",
    stripe: "bg-[#A0D0E8]",
    metric: "bg-[#EAF7FF] text-[#17324D]",
  },
  cleaningPending: {
    card: "bg-[#D9F7F0] text-[#17324D]",
    badge: "bg-white text-[#17324D]",
    pill: "bg-[#D9F7F0] text-[#17324D] ring-[#A8E8DB]/60",
    dot: "bg-[#5CC4B8]",
    stripe: "bg-[#5CC4B8]",
    metric: "bg-[#D9F7F0] text-[#17324D]",
  },
  maintenance: {
    card: "bg-[#FFE2EA] text-[#17324D]",
    badge: "bg-white text-[#17324D]",
    pill: "bg-[#FFE2EA] text-[#17324D] ring-[#F5C0CC]/60",
    dot: "bg-[#F08090]",
    stripe: "bg-[#F08090]",
    metric: "bg-[#FFE2EA] text-[#17324D]",
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
    card: "border-emerald-200 bg-emerald-50 text-emerald-900",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  draft: {
    card: "border-border bg-card text-foreground",
    badge: "bg-muted text-foreground/70 ring-border",
    dot: "bg-muted-foreground",
  },
  terminated: {
    card: "border-border bg-muted text-foreground/70",
    badge: "bg-muted text-foreground/70 ring-border",
    dot: "bg-muted-foreground",
  },
  expired: {
    card: "border-amber-200 bg-amber-50 text-amber-900",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
};

export const financeToneStyles = {
  neutral: "border-border bg-card text-foreground",
  income: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
  accent: "border-blue-200 bg-blue-50 text-blue-900",
} as const;

export const receivableStatusStyles: Record<string, string> = {
  pending:   "bg-muted text-foreground/70",
  partial:   "bg-amber-100 text-amber-700",
  paid:      "bg-emerald-100 text-emerald-700",
  overdue:   "bg-red-100 text-red-700",
  cancelled: "bg-muted text-foreground/50 line-through",
};

export const receivableRowBg: Record<string, string> = {
  pending:   "",
  partial:   "bg-amber-50/30",
  paid:      "",
  overdue:   "bg-red-50/30",
  cancelled: "opacity-60",
};

export const contractStatusVariant: Record<string, "secondary" | "success" | "destructive" | "warning"> = {
  draft: "secondary",
  active: "success",
  terminated: "destructive",
  expired: "warning",
};
