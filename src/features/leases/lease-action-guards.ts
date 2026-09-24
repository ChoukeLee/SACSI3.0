import "server-only";
import { requireRole } from "@/lib/auth";
export async function guardLeaseWrite() {
  await requireRole("admin", "rental_sales");
}

export async function guardLeaseFinance() {
  await requireRole("admin", "finance");
}
