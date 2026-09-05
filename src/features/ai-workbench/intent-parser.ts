import type { WorkbenchDomain, WorkbenchIntent, WorkbenchQueryKind } from "./types";

const BUILDING_PATTERN = /(?:SACSI\s*)?(\d{1,2})\s*(?:#|号楼|栋|n[°o]\s*)/i;
const EXPLICIT_UNIT_PATTERN = /(?:房号|房间|房源|公寓|商铺|单元|chambre|appartement|boutique|local|unité|unite)\s*[：:]?\s*(?:n[°o]\s*)?([A-Za-z0-9-]{2,12})/i;

function normalizeBuildingCode(value: string | undefined): string | null {
  if (!value) return null;
  return `SACSI${Number(value)}`;
}

function detectDomain(query: string): WorkbenchDomain {
  if (/日租|短租|房态|入住|离店|保洁|journalier|journalière|nuit\b|nuits\b|ménage|nettoyage|arriv|départ\b/i.test(query)) return "daily";
  if (/长租|租赁|月租|bail\b|baux\b|longue durée|loyer\b|loyers\b/i.test(query)) return "lease";
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

function detectKind(query: string, unitNo: string | null): WorkbenchQueryKind {
  if (/房态|占用|在住|入住|离店|退房|保洁|可安排入住|空房|journalier|ménage|nettoyage|occup|disponib|aujourd'hui/i.test(query)) return "daily_status";
  if (/逾期|retard\b|retards\b|échu|echu|impayé|impayes/i.test(query)) return "receivable_overdue";
  if (/(?:\d{1,2}\s*天内|近期|即将).*(?:应缴|到期)|(?:应缴|到期).*(?:\d{1,2}\s*天内|近期|即将)/.test(query)) return "receivable_due_soon";
  if (/(?:\d{1,2}\s*(?:jours?|j\b).{0,16}(?:échéance|echeance|payer|paiement|d[ûu]))|(?:échéances?|echeances?).{0,16}(?:\d{1,2}\s*(?:jours?|j\b))/.test(query)) return "receivable_due_soon";
  if (/未收|欠款|欠费|应收余额|reste d[ûu]|impay|dette/i.test(query)) return "receivable_outstanding";
  if (unitNo && /合同|房间|房源|公寓|商铺|信息|情况|档案|客户|租客|业主|收款|contrat|paiement|paiements|client|locataire|infos?|situation/i.test(query)) return "unit_snapshot";
  if (unitNo) return "unit_snapshot";
  return "unsupported";
}

export function parseWorkbenchIntent(query: string, asOfDate: string): WorkbenchIntent {
  const normalized = query.trim().replaceAll("＃", "#");
  const domain = detectDomain(normalized);
  const { buildingCode, unitNo } = detectWorkbenchLocation(normalized);
  const kind = detectKind(normalized, unitNo);
  const daysMatch = normalized.match(/(\d{1,2})\s*(?:天内|jours?|j\b)/i);
  const days = Math.min(90, Math.max(1, Number(daysMatch?.[1] ?? 15)));

  return {
    kind,
    domain: kind === "daily_status" ? "daily" : domain,
    buildingCode,
    unitNo,
    customerName: null,
    days,
    asOfDate,
    confidence: kind === "unsupported" ? 0.2 : unitNo || kind === "daily_status" ? 0.94 : 0.88,
    source: "rules",
  };
}
