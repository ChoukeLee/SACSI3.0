import type { WorkbenchDomain, WorkbenchIntent, WorkbenchQueryKind } from "./types";

const BUILDING_PATTERN = /(?:SACSI\s*)?(\d{1,2})\s*(?:#|号楼|栋|n[°o]\s*)/i;
const EXPLICIT_UNIT_PATTERN = /(?:房号|房间|房源|公寓|商铺|单元|chambre|appartement|boutique|local|unité|unite)\s*[：:]?\s*(?:n[°o]\s*)?([A-Za-z0-9-]{2,12})/i;
const MOVEMENT_PATTERN = /(?:入住|到店|抵达|退房|离店|离开|arriv|départ|\bpart(?:ir|ent|ira|iront)?\b|check[\s-]?in|check[\s-]?out)/i;
const UPCOMING_WINDOW_PATTERN = /(?:\d{1,2}\s*天内|未来\s*(?:\d{1,2}|一|两)\s*(?:天|周|个月?)|接下来\s*(?:\d{1,2}|一|两)\s*(?:天|周|个月?)|下周|下个月|月底|近期|即将)/;
const UPCOMING_WINDOW_FR_PATTERN = /(?:\d{1,2}\s*(?:jours?|semaines?|mois)|(?:une?|deux)\s+(?:semaines?|mois)|semaine\s+prochaine|mois\s+prochain|fin\s+du\s+mois|bientôt)/i;

function normalizeQuery(query: string) {
  return query
    .trim()
    .replaceAll("＃", "#")
    .replace(/房太/g, "房态")
    .replace(/长祖/g, "长租")
    .replace(/月祖/g, "月租");
}

function clampDays(value: number) {
  return Math.min(90, Math.max(1, Math.trunc(value)));
}

function daysUntilMonthEnd(asOfDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfDate);
  if (!match) return 15;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const current = Date.UTC(year, month - 1, day);
  const monthEnd = Date.UTC(year, month, 0);
  return clampDays((monthEnd - current) / 86_400_000);
}

function detectWindowDays(query: string, asOfDate: string) {
  const dayMatch = query.match(/(\d{1,2})\s*(?:天(?:内)?|jours?|j\b)/i);
  if (dayMatch) return clampDays(Number(dayMatch[1]));
  const weekMatch = query.match(/(\d{1,2})\s*(?:周|星期|semaines?)/i);
  if (weekMatch) return clampDays(Number(weekMatch[1]) * 7);
  if (/(?:两周|deux\s+semaines?)/i.test(query)) return 14;
  if (/(?:一周|下周|une?\s+semaine|semaine\s+prochaine)/i.test(query)) return 7;
  const monthMatch = query.match(/(\d{1,2})\s*(?:个月|mois)/i);
  if (monthMatch) return clampDays(Number(monthMatch[1]) * 30);
  if (/(?:一个月|下个月|une?\s+mois|mois\s+prochain)/i.test(query)) return 30;
  if (/(?:月底|fin\s+du\s+mois)/i.test(query)) return daysUntilMonthEnd(asOfDate);
  return 15;
}

function normalizeBuildingCode(value: string | undefined): string | null {
  if (!value) return null;
  return `SACSI${Number(value)}`;
}

function detectDomain(query: string): WorkbenchDomain {
  if (/日租|短租|房态|房间状态|入住|离店|离开|保洁|能住|空的|journalier|journalière|nuit\b|nuits\b|ménage|nettoyage|arriv|départ\b|\bpart(?:ir|ent|ira|iront)?\b|chambres?\s+libres?|room\s+status/i.test(query)) return "daily";
  if (/长租|租赁|租约|月租|bail\b|baux\b|longue durée|loyer\b|loyers\b/i.test(query)) return "lease";
  if (/出售|售房|销售|购房|过户|vente\b|ventes\b|achat\b|acheter/i.test(query)) return "sale";
  return "all";
}

export function detectWorkbenchLocation(query: string): { buildingCode: string | null; unitNo: string | null } {
  const buildingMatch = query.match(BUILDING_PATTERN);
  const buildingCode = normalizeBuildingCode(buildingMatch?.[1]);
  const explicitUnit = query.match(EXPLICIT_UNIT_PATTERN)?.[1] ?? null;
  if (explicitUnit) return { buildingCode, unitNo: explicitUnit.toUpperCase() };

  if (buildingMatch?.index != null) {
    const afterBuilding = query.slice(buildingMatch.index + buildingMatch[0].length);
    const adjacentUnit = afterBuilding.match(/^\s*(?:的|de\s*la\s*chambre|chambre\s*|n[°o]\s*)?\s*([A-Za-z0-9-]{3,12})/i)?.[1] ?? null;
    if (adjacentUnit && !/^\d{4}-\d{2}/.test(adjacentUnit)) {
      return { buildingCode, unitNo: adjacentUnit.toUpperCase() };
    }
  }

  return { buildingCode, unitNo: null };
}

function looksLikeMovementsList(query: string): boolean {
  if (/可安排入住|可住|空房|available|disponib/i.test(query)) return false;
  const listTerm = /(?:今天|今日|名单|哪些|谁|有几个|有多少|明细|安排|liste|quels|qui|prévu|aujourd'hui|today|du\s+jour)/i;
  return MOVEMENT_PATTERN.test(query) && listTerm.test(query);
}

function detectKind(query: string, unitNo: string | null, domain: WorkbenchDomain): WorkbenchQueryKind {
  if (looksLikeMovementsList(query) && MOVEMENT_PATTERN.test(query)) return "daily_movements";
  if (domain === "lease" && /到期|期满|快到期|将到期|expir/i.test(query) && !/应缴|要交|缴款|收款|未收|没交|未交|欠/i.test(query)) return "lease_expiring";
  if (/房态|房间状态|占用|在住|入住|离店|退房|保洁|可安排入住|能住|空房|空的|journalier|ménage|nettoyage|occup|disponib|chambres?\s+libres?|room\s+status|aujourd'hui/i.test(query)) return "daily_status";
  if (/逾期|retard\b|retards\b|échu|echu|impayé|impayes/i.test(query)) return "receivable_overdue";
  if ((UPCOMING_WINDOW_PATTERN.test(query) && /应缴|要交|到期/.test(query)) || (UPCOMING_WINDOW_FR_PATTERN.test(query) && /échéance|echeance|payer|paiement|d[ûu]/i.test(query))) return "receivable_due_soon";
  if (/(?:\d{1,2}\s*(?:jours?|j\b).{0,16}(?:échéance|echeance|payer|paiement|d[ûu]))|(?:échéances?|echeances?|payer|paiement|d[ûu]).{0,16}(?:\d{1,2}\s*(?:jours?|j\b))/i.test(query)) return "receivable_due_soon";
  if (/未收|没收|没交|未交|欠款|欠费|欠多少|还欠|还差.{0,8}(?:钱|款)|应收余额|reste (?:d[ûu]|à payer)|solde.{0,12}(?:d[ûu]|payer)|non\s+pay[ée]s?|impay|dette/i.test(query)) return "receivable_outstanding";
  if (unitNo && /合同|房间|房源|公寓|商铺|信息|情况|档案|客户|租客|业主|收款|contrat|paiement|paiements|client|locataire|infos?|situation/i.test(query)) return "unit_snapshot";
  if (unitNo) return "unit_snapshot";
  return "unsupported";
}

export function parseWorkbenchIntent(query: string, asOfDate: string): WorkbenchIntent {
  const normalized = normalizeQuery(query);
  const domain = detectDomain(normalized);
  const { buildingCode, unitNo } = detectWorkbenchLocation(normalized);
  const kind = detectKind(normalized, unitNo, domain);
  const days = detectWindowDays(normalized, asOfDate);

  return {
    kind,
    domain: kind === "daily_status" || kind === "daily_movements" ? "daily" : domain,
    buildingCode,
    unitNo,
    customerName: null,
    days,
    asOfDate,
    confidence: kind === "unsupported" ? 0.2 : unitNo || kind === "daily_status" ? 0.94 : 0.88,
    source: "rules",
  };
}
