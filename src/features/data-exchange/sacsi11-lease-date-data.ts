export type Sacsi11LeaseDateRow = {
  unitNo: string;
  paidThroughDate: string;
  expectedEndConfirmed: boolean;
};

export const SACSI11_LEASE_DATE_SOURCE = "11号公寓.xlsx Sheet1 A1:L100";
export const SACSI11_LEASE_DATE_AS_OF = "2026-07-22";

// The workbook records rent coverage using wording such as “止7.31”. Except for
// 701 (explicitly paid for one year), those dates are payment coverage dates,
// not confirmed contract expiry dates.
export const sacsi11LeaseDates: Sacsi11LeaseDateRow[] = [
  { unitNo: "102", paidThroughDate: "2026-12-19", expectedEndConfirmed: false },
  { unitNo: "103", paidThroughDate: "2026-08-06", expectedEndConfirmed: false },
  { unitNo: "105", paidThroughDate: "2026-08-31", expectedEndConfirmed: false },
  { unitNo: "106", paidThroughDate: "2026-08-30", expectedEndConfirmed: false },
  { unitNo: "201", paidThroughDate: "2026-10-09", expectedEndConfirmed: false },
  { unitNo: "203", paidThroughDate: "2026-08-24", expectedEndConfirmed: false },
  { unitNo: "205", paidThroughDate: "2026-08-30", expectedEndConfirmed: false },
  { unitNo: "206", paidThroughDate: "2026-10-31", expectedEndConfirmed: false },
  { unitNo: "303", paidThroughDate: "2026-10-04", expectedEndConfirmed: false },
  { unitNo: "306", paidThroughDate: "2026-08-09", expectedEndConfirmed: false },
  { unitNo: "405", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "406", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "501", paidThroughDate: "2026-07-20", expectedEndConfirmed: false },
  { unitNo: "502", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "503", paidThroughDate: "2026-07-02", expectedEndConfirmed: false },
  { unitNo: "506", paidThroughDate: "2026-09-30", expectedEndConfirmed: false },
  { unitNo: "602", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "603", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "605", paidThroughDate: "2026-08-09", expectedEndConfirmed: false },
  { unitNo: "701", paidThroughDate: "2026-08-04", expectedEndConfirmed: true },
  { unitNo: "702", paidThroughDate: "2026-08-30", expectedEndConfirmed: false },
  { unitNo: "703", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "705", paidThroughDate: "2026-08-31", expectedEndConfirmed: false },
  { unitNo: "706", paidThroughDate: "2026-09-30", expectedEndConfirmed: false },
  { unitNo: "801", paidThroughDate: "2026-10-14", expectedEndConfirmed: false },
  { unitNo: "802", paidThroughDate: "2026-08-30", expectedEndConfirmed: false },
  { unitNo: "803", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "805", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
  { unitNo: "806", paidThroughDate: "2026-08-30", expectedEndConfirmed: false },
  { unitNo: "1203", paidThroughDate: "2026-09-30", expectedEndConfirmed: false },
  { unitNo: "1206", paidThroughDate: "2026-07-31", expectedEndConfirmed: false },
];

export const sacsi11OverdueRent = [
  { unitNo: "501", dueDate: "2026-07-21", amountXof: 750_000 },
  { unitNo: "503", dueDate: "2026-07-03", amountXof: 700_000 },
] as const;
