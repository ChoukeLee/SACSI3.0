import { detectWorkbenchLocation } from "./intent-parser";

export interface WorkbenchActionIntent {
  action: "complete_daily_cleaning";
  buildingCode: string;
  unitNo: string;
  confidence: number;
  source: "rules";
}

const CLEANING_COMPLETED_PATTERN =
  /(?:保洁|清洁|打扫)(?:工作)?(?:已经|已)?(?:完成|做好|好了)|(?:已经|已)?(?:完成|做好)(?:了)?.{0,24}(?:保洁|清洁|打扫)/;
const QUESTION_PATTERN = /(?:查询|查看|看看|是否|有没有|完成了吗|完成没|好了没|吗[？?]?$)/;

export function parseWorkbenchAction(query: string): WorkbenchActionIntent | null {
  const normalized = query.trim().replaceAll("＃", "#");
  if (!CLEANING_COMPLETED_PATTERN.test(normalized) || QUESTION_PATTERN.test(normalized)) return null;
  const { buildingCode, unitNo } = detectWorkbenchLocation(normalized);
  if (!buildingCode || !unitNo) return null;
  return {
    action: "complete_daily_cleaning",
    buildingCode,
    unitNo,
    confidence: 0.98,
    source: "rules",
  };
}
