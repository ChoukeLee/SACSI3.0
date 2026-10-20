import type { CalendarWindowData } from "./calendar-window-model";

/** The workbench is not a currency converter or the authoritative cash report. */
export function dailyRecordedXofNet(payments: CalendarWindowData["payments"]): number | null {
  let net = 0;
  for (const payment of payments) {
    const amount = Number(payment.amount);
    if (
      payment.currency !== "XOF" ||
      Number(payment.exchange_rate_to_xof) !== 1 ||
      !Number.isSafeInteger(amount)
    )
      return null;
    net += amount;
    if (!Number.isSafeInteger(net)) return null;
  }
  return net;
}
