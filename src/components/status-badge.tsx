import { Badge } from "@/components/ui/badge"
import type { UnitStatus } from "@/types/domain"

const variantMap: Record<UnitStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  available: "success",
  reserved: "warning",
  daily_occupied: "default",
  cleaning_pending: "outline",
  leased: "secondary",
  sold: "secondary",
  maintenance: "destructive",
  locked: "outline",
}

const labels: Record<UnitStatus, string> = {
  available: "空闲", daily_occupied: "日租中", reserved: "已预订", cleaning_pending: "待保洁",
  leased: "长租中", sold: "已售", maintenance: "维修", locked: "锁定",
}

export function StatusBadge({ status, label }: { status: UnitStatus; label?: string }) {
  return <Badge variant={variantMap[status]}>{label ?? labels[status]}</Badge>
}
export { variantMap as unitStatusVariant, labels as shortLabel }
