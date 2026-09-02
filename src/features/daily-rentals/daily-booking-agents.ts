export const DAILY_BOOKING_AGENT_NAMES = [
  "Chouke",
  "Niamke",
  "Esai",
  "黄姐",
  "颖",
  "镇淮",
  "悦凯",
  "孙敏",
  "李军",
] as const;

const DAILY_BOOKING_AGENT_NAME_SET = new Set<string>(DAILY_BOOKING_AGENT_NAMES);

export function isDailyBookingAgentName(name: string | null | undefined) {
  return Boolean(name && DAILY_BOOKING_AGENT_NAME_SET.has(name.trim()));
}

export function dailyBookingAgentSortValue(name: string) {
  const index = DAILY_BOOKING_AGENT_NAMES.indexOf(name as (typeof DAILY_BOOKING_AGENT_NAMES)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
