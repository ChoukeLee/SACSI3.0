import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { UnitStatus } from "@/types/domain";

const unitStatusVariant: Record<UnitStatus, BadgeProps["variant"]> = {
  available: "success",
  daily_occupied: "accent",
  reserved: "warning",
  cleaning_pending: "info",
  leased: "purple",
  sold: "neutral",
  maintenance: "danger",
  locked: "outline",
};

const shortLabel: Record<UnitStatus, string> = {
  available: "空闲",
  daily_occupied: "日租中",
  reserved: "已预订",
  cleaning_pending: "待保洁",
  leased: "长租中",
  sold: "已售",
  maintenance: "维修",
  locked: "锁定",
};

export function StatusBadge({ status, label }: { status: UnitStatus; label?: string }) {
  return (
    <Badge variant={unitStatusVariant[status]} role="status" aria-label={label ?? shortLabel[status]}>
      {label ?? shortLabel[status]}
    </Badge>
  );
}

export { unitStatusVariant, shortLabel };
