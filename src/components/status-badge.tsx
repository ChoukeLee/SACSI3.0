import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { UnitStatus } from "@/types/domain";

const variantMap: Record<UnitStatus, BadgeProps["variant"]> = {
  available: "success",
  reserved: "warning",
  daily_occupied: "accent",
  cleaning_pending: "info",
  leased: "neutral",
  sold: "neutral",
  maintenance: "danger",
  locked: "outline",
};

export function StatusBadge({ status, labels }: { status: UnitStatus; labels: Record<UnitStatus, string> }) {
  const label = labels[status];
  return (
    <Badge variant={variantMap[status]} role="status" aria-label={label}>
      {label}
    </Badge>
  );
}
