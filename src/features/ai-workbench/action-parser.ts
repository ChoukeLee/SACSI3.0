import { detectWorkbenchLocation } from "./intent-parser";

export interface WorkbenchActionIntent {
  action: "complete_daily_cleaning";
  buildingCode: string;
  unitNo: string;
  confidence: number;
  source: "rules";
}

const CLEANING_ZH_PATTERN =
  /(?:保洁|清洁|打扫)(?:工作)?(?:已经|已)?(?:完成|做好|好了)|(?:已经|已)?(?:完成|做好)(?:了)?.{0,24}(?:保洁|清洁|打扫)/;

// French declarations that a cleaning was finished. Covers:
//  - "ménage / nettoyage … (est) terminé / fini / fait …"
//  - "… terminé / fini / fait … ménage / nettoyage"
//  - "la chambre … (est / a été) nettoyée / terminée / finie / faite …"
const CLEANING_FR_PATTERN =
  /(?:ménage|nettoyage).{0,32}(?:est\s+|a été\s+)?(?:terminé|termine|fait|faite|fini|finie|effectué|effectue|achevé)|(?:terminé|termine|fait|faite|fini|finie|effectué|effectue|achevé).{0,24}(?:ménage|nettoyage)|(?:chambre|appartement|boutique|local).{0,26}(?:est\s+|a été\s+)?(?:nettoyée?|terminée?|faite?|finie?|effectuée?)/i;

const QUESTION_PATTERN = /(?:查询|查看|看看|是否|有没有|完成了吗|完成没|好了没|吗[？?]?$|[?？]|est[- ]?ce que|est[- ]?il|a-t-)/i;

export function parseWorkbenchAction(query: string): WorkbenchActionIntent | null {
  const normalized = query.trim().replaceAll("＃", "#");
  if (QUESTION_PATTERN.test(normalized)) return null;
  if (!CLEANING_ZH_PATTERN.test(normalized) && !CLEANING_FR_PATTERN.test(normalized)) return null;
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
