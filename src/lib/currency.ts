import type { CurrencyCode } from "@/types/domain";
import type { PaymentRow } from "@/types/database";
import { formatXof } from "@/lib/utils";
import { historicalXofAmount } from "@/lib/financial-amount";

export function convertToXof(amount: number, currency: CurrencyCode, rate: number): number {
  if (currency === "XOF") return amount;
  return Math.round(amount * rate);
}

export function convertFromXof(amountXof: number, currency: CurrencyCode, rate: number): number {
  if (currency === "XOF" || rate === 0) return amountXof;
  return Math.round(amountXof / rate);
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€" };

/**
 * 按原币格式化金额。
 * XOF/FCFA 展示完整 XOF；原币保留最多两位小数。
 */
export function formatMoney(
  amount: number,
  currency: string | null | undefined,
  locale: "zh" | "fr" = "zh",
): string {
  const code = String(currency ?? "XOF").toUpperCase();
  if (code === "XOF" || code === "FCFA") return formatXof(amount, locale);
  const n = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
    maximumFractionDigits: 2,
  }).format(Number(amount));
  const symbol = CURRENCY_SYMBOL[code];
  return symbol ? symbol + n : n + " " + code;
}

/**
 * 付款展示：primary = 原币金额；secondary = 折合 XOF（仅非 XOF 时有值）。
 * 供长租/出售/房源等收款明细统一使用。
 */
export function paymentDisplay(
  payment: Pick<PaymentRow, "amount" | "currency" | "exchange_rate_to_xof">,
  locale: "zh" | "fr" = "zh",
): { primary: string; secondary: string | null } {
  const code = String(payment.currency ?? "XOF").toUpperCase();
  const xof = historicalXofAmount(
    Math.abs(Number(payment.amount)),
    Number(payment.exchange_rate_to_xof),
  );
  if (code === "XOF" || code === "FCFA") {
    return { primary: formatXof(Number(payment.amount), locale), secondary: null };
  }
  return {
    primary: formatMoney(Number(payment.amount), code, locale),
    secondary:
      xof === null
        ? locale === "zh"
          ? "历史汇率未核验"
          : "Taux historique non vérifié"
        : formatXof(Number(payment.amount) < 0 ? -xof : xof, locale),
  };
}
