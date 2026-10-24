import type { CimacAccountReceivable } from "./cimac-billing-types";

export function billingNumber(value: unknown, locale: "zh" | "fr"): string {
  if (typeof value !== "string" && typeof value !== "number") return "—";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  const raw = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return "—";
  const [integer, fraction] = raw.split(".");
  const digits = integer.replace(/\B(?=(\d{3})+(?!\d))/g, locale === "zh" ? "," : "\u202f");
  const decimals = fraction?.replace(/0+$/, "");
  return `${digits}${decimals ? `${locale === "zh" ? "." : ","}${decimals}` : ""}`;
}

/** Money inputs cross the boundary as decimal strings, never floating point sums. */
export function billingMinor(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function billingMinorString(value: bigint): string {
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  const fraction = String(absolute % BigInt(100))
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${sign}${absolute / BigInt(100)}${fraction ? `.${fraction}` : ""}`;
}

export function billingCategory(value: string, locale: "zh" | "fr"): string {
  const labels: Record<string, [string, string]> = {
    lease_rent: ["租金", "Loyer"],
    lease_deposit: ["押金", "Dépôt de garantie"],
    property_fee: ["物业费", "Charges immobilières"],
    water: ["水费", "Eau"],
    electricity: ["电费", "Électricité"],
    management_fee: ["管理费", "Frais de gestion"],
    sale_installment: ["出售分期款", "Échéance de vente"],
    sale_lump_sum: ["售房款", "Prix de vente"],
    other: ["其他费用", "Autres frais"],
  };
  return labels[value]?.[locale === "zh" ? 0 : 1] ?? value;
}

export function billingKind(value: string, locale: "zh" | "fr"): string {
  const labels: Record<string, [string, string]> = {
    storefront: ["商铺", "Boutiques"],
    apartment: ["公寓", "Appartements"],
    warehouse: ["仓库", "Entrepôts"],
    parking: ["停车位", "Stationnements"],
    office: ["办公室", "Bureaux"],
  };
  return labels[value]?.[locale === "zh" ? 0 : 1] ?? value;
}

export function receivableAmounts(row: CimacAccountReceivable) {
  return row.currency === "XOF"
    ? { amount: row.amount_xof, paid: row.paid_amount_xof }
    : { amount: row.amount_native, paid: row.paid_amount_native };
}

export function billingStatus(row: CimacAccountReceivable, today: string, locale: "zh" | "fr") {
  const zh = locale === "zh";
  if (row.reviewReason) return zh ? "金额待核" : "Montant à vérifier";
  if (row.management_status === "historical_pending")
    return zh ? "历史待核" : "Historique à vérifier";
  if (row.management_status === "excluded") return zh ? "已排除" : "Exclue";
  if (row.status === "cancelled") return zh ? "已取消" : "Annulée";
  if (row.status === "paid") return zh ? "已结清" : "Soldée";
  if (row.management_status !== "managed") return zh ? "管理归属待核" : "Gestion à vérifier";
  const remaining = billingMinor(row.outstanding);
  if (remaining === null) return zh ? "金额待核" : "Montant à vérifier";
  if (remaining === BigInt(0)) return zh ? "已结清" : "Soldée";
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.due_date ?? "") && row.due_date < today)
    return zh ? "按到期日已逾期" : "Échéance dépassée";
  if (row.status === "partial") return zh ? "部分核销" : "Partiellement imputée";
  return zh ? "未收" : "À recevoir";
}
