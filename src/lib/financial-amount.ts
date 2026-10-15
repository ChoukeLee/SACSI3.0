/** Match PostgreSQL round(amount * historical_rate, 2), without binary floating rounding. */
function decimal(value: number | string): { coefficient: bigint; scale: number } | null {
  const source = String(value).trim();
  if (!Number.isFinite(Number(source))) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(source);
  if (!match) return null;
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  if (Math.abs(scale) > 30 || source.length > 80) return null;
  return { coefficient: BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`), scale };
}
export function historicalXofAmount(amount: number | string, rate: number | string): number | null {
  const original = decimal(amount),
    historical = decimal(rate);
  if (
    !original ||
    !historical ||
    original.coefficient <= BigInt(0) ||
    historical.coefficient <= BigInt(0)
  )
    return null;
  const product = original.coefficient * historical.coefficient;
  const scale = original.scale + historical.scale - 2;
  const divisor = scale > 0 ? BigInt(10) ** BigInt(scale) : BigInt(1);
  const numerator = scale < 0 ? product * BigInt(10) ** BigInt(-scale) : product;
  const cents = (numerator + divisor / BigInt(2)) / divisor;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents) / 100;
}

/** Exact display for operating tables; unknown/invalid data is never shown as zero. */
export function formatXofExact(
  value: number | string | null | undefined,
  locale: "zh" | "fr" = "zh",
) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))
    return "—";
  return `${new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", { maximumFractionDigits: 2 }).format(Number(value))} XOF`;
}
