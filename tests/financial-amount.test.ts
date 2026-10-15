import { expect, it } from "vitest";
import { historicalXofAmount, formatXofExact } from "@/lib/financial-amount";
it("preserves historical two-decimal XOF and decimal rounding instead of silently rounding whole francs", () => {
  expect(historicalXofAmount(2, 90.7)).toBe(181.4);
  expect(historicalXofAmount(1.005, 1)).toBe(1.01);
  expect(historicalXofAmount(1.004, 1)).toBe(1);
  expect(historicalXofAmount("1e-3", "100.5")).toBe(0.1);
  expect(historicalXofAmount(100, 0)).toBeNull();
  expect(historicalXofAmount(100, NaN)).toBeNull();
  expect(historicalXofAmount(1e30, 1)).toBeNull();
});
it("formats exact amounts with locale and currency, not ambiguous ten-thousands or invented zeros", () => {
  expect(formatXofExact(181.4)).toBe("181.4 XOF");
  expect(formatXofExact(181.4, "fr")).toBe("181,4 XOF");
  expect(formatXofExact(undefined)).toBe("—");
});
