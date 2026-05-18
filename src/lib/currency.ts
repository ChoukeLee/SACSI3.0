import type { CurrencyCode } from "@/types/domain";

export function convertToXof(amount: number, currency: CurrencyCode, rate: number): number {
  if (currency === "XOF") return amount;
  return Math.round(amount * rate);
}

export function convertFromXof(amountXof: number, currency: CurrencyCode, rate: number): number {
  if (currency === "XOF" || rate === 0) return amountXof;
  return Math.round(amountXof / rate);
}
