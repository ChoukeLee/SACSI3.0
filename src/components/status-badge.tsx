import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
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

export function StatusBadge({ status, locale = "zh" }: { status: UnitStatus; locale?: Locale }) {
  return (
    <Badge variant={variantMap[status]} role="status" aria-label={dictionaries[locale].statuses[status]}>
      {dictionaries[locale].statuses[status]}
    </Badge>
  );
}
