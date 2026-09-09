import type { Locale } from "@/lib/i18n";
import type { WorkbenchIntent } from "./types";

export interface UnsupportedGuidance {
  title: string;
  answer: string;
  suggestions: string[];
}

function shortBuilding(code: string | null) {
  return code?.replace(/^SACSI/i, "") ?? null;
}

export function buildUnsupportedGuidance(intent: WorkbenchIntent, locale: Locale): UnsupportedGuidance {
  const building = shortBuilding(intent.buildingCode);
  if (locale === "fr") {
    if (intent.domain === "daily") {
      return {
        title: "Que souhaitez-vous vérifier ?",
        answer: building
          ? `J’ai identifié le bâtiment ${building}#. Souhaitez-vous voir son état journalier, les arrivées ou les départs ?`
          : "J’ai identifié la location journalière. Précisez si vous souhaitez l’état des chambres, les arrivées ou les départs, avec le bâtiment si nécessaire.",
        suggestions: building ? [`état journalier ${building}#`, `départs du jour ${building}#`] : ["état journalier aujourd'hui", "départs du jour 11#"],
      };
    }
    if (intent.domain === "lease") {
      return {
        title: "Précisez la consultation du bail",
        answer: building
          ? `J’ai identifié les baux du bâtiment ${building}#. Voulez-vous les retards, les sommes restant dues, les échéances proches ou une chambre précise ?`
          : "J’ai identifié les baux longue durée. Indiquez le bâtiment ou la chambre, puis précisez : retards, reste dû ou échéances proches.",
        suggestions: building ? [`retards bail ${building}#`, `contrat et paiements du ${building}#503`] : ["baux expirant sous 30 jours", "retards bail 11#"],
      };
    }
    if (intent.domain === "sale") {
      return {
        title: "Précisez la consultation de vente",
        answer: building
          ? `J’ai identifié les ventes du bâtiment ${building}#. Voulez-vous les échéances proches, les retards ou le dossier d’un local précis ?`
          : "J’ai identifié les ventes. Précisez le bâtiment ou le local et si vous cherchez les échéances, retards ou paiements.",
        suggestions: ["échéances vente sous 15 jours", building ? `paiements du local ${building}#503` : "paiements du local 11#503"],
      };
    }
    if (building) {
      return {
        title: "Quel secteur souhaitez-vous consulter ?",
        answer: `J’ai identifié le bâtiment ${building}#, mais pas encore le secteur. Indiquez location journalière, bail longue durée ou vente, puis ce que vous souhaitez vérifier.`,
        suggestions: [`état journalier ${building}#`, `retards bail ${building}#`],
      };
    }
    return {
      title: "Précisez votre demande",
      answer: "Je peux consulter les données réelles de location journalière, de bail et de vente. Indiquez le secteur, le bâtiment ou la chambre, puis ce que vous souhaitez vérifier.",
      suggestions: ["état journalier aujourd'hui", "retards bail 11#", "échéances vente sous 15 jours"],
    };
  }

  if (intent.domain === "daily") {
    return {
      title: "你想继续查看哪一项？",
      answer: building
        ? `我识别到你在问 ${building}# 日租。你想看今天房态、入住名单，还是退房名单？`
        : "我识别到你在问日租。请说明想看房态、入住名单还是退房名单，必要时再加楼栋。",
      suggestions: building ? [`${building}#今天日租房态`, `${building}#今天退房名单`] : ["今天日租房态", "11#今天退房名单"],
    };
  }
  if (intent.domain === "lease") {
    return {
      title: "请补充长租查询范围",
      answer: building
        ? `我识别到你在问 ${building}# 长租。你想查逾期、未收、近期到期，还是某个房间的合同和收款？`
        : "我识别到你在问长租。请补充楼栋或房号，并说明要查逾期、未收还是近期到期。",
      suggestions: building ? [`${building}#长租逾期明细`, `查看${building}#503的合同和收款`] : ["长租30天内缴租截至", "11#长租逾期明细"],
    };
  }
  if (intent.domain === "sale") {
    return {
      title: "请补充出售查询范围",
      answer: building
        ? `我识别到你在问 ${building}# 出售。你想查近期应缴、逾期，还是某个商铺的合同和收款？`
        : "我识别到你在问出售。请补充楼栋或商铺，并说明要查应缴、逾期还是收款。",
      suggestions: ["出售15天内应缴", building ? `查看${building}#503的合同和收款` : "查看11#503的合同和收款"],
    };
  }
  if (building) {
    return {
      title: "你想查看哪类业务？",
      answer: `我识别到楼栋 ${building}#，但还不知道你要查日租、长租还是出售。请再补充业务类型和要核对的事项。`,
      suggestions: [`${building}#今天日租房态`, `${building}#长租逾期明细`],
    };
  }
  return {
    title: "请再具体一点",
    answer: "我可以查询日租、长租和出售的系统实时记录。请告诉我业务类型、楼栋或房号，以及你想核对的事项。",
    suggestions: ["今天日租房态", "11#长租逾期明细", "出售15天内应缴"],
  };
}
