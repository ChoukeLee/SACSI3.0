import type { Locale } from "@/lib/i18n";
import type { UnitRow } from "@/types/database";

type CardStatus = "sold" | "leased" | "dailyOccupied" | "reserved" | "cleaningPending" | "maintenance" | "ownerOccupied" | "available";

function firstMatch(notes: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const value = notes.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

export function referencedLeaseContractNo(notes: string | null | undefined): string | null {
  return String(notes ?? "").match(/主合同\s*([A-Z0-9-]+)/i)?.[1] ?? null;
}

export function unitCardPartyFromNotes(unit: Pick<UnitRow, "notes">, status: CardStatus): string | null {
  const notes = String(unit.notes ?? "");
  if (!notes) return null;

  if (status === "leased") {
    return firstMatch(notes, [
      /当前租赁状态[:：]\s*([^；;\n]+?)长租/,
      /当前按\s*([^；;\n]+?)长租标记/,
      /当前租户[:：]\s*([^；;\n]+)/,
      /承租人(?:为|[:：])\s*([^；;，,、\n]+)/,
      /租户(?:为|[:：])\s*([^；;，,、\n]+)/,
    ]);
  }

  if (status === "sold") {
    return firstMatch(notes, [
      /买方(?:为|[:：])?\s*([^；;，,、\n]+)/,
      /当前整层已售\s*([^；;。.\n]+)/,
    ]);
  }

  if (status === "ownerOccupied") {
    return firstMatch(notes, [
      /入住人[:：]\s*([^；;，,、\n]+)/,
      /使用人[:：]\s*([^；;，,、\n]+)/,
    ]);
  }

  return null;
}

export function unresolvedUnitCardParty(status: CardStatus, locale: Locale): string {
  if (locale === "fr") {
    if (status === "sold") return "Acheteur à confirmer";
    if (status === "leased") return "Locataire à confirmer";
    if (status === "dailyOccupied") return "Client à confirmer";
    return "À confirmer";
  }
  if (status === "sold") return "买方待确认";
  if (status === "leased") return "租户待确认";
  if (status === "dailyOccupied") return "住客待确认";
  return "待确认";
}
