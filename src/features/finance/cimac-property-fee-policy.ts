/** User-confirmed shop reference, not an invoice generator or live payment status. */
export const CIMAC_SHOP_PROPERTY_FEE_POLICY = Object.freeze({
  startsOn: "2027-04-01",
  monthlyRateXofPerSqm: 900,
  confirmedAsOf: "2026-10-19",
  collectionAtConfirmation: "not_collected",
} as const);

export function cimacShopPropertyFeeNotice(locale: "zh" | "fr"): string {
  const policy = CIMAC_SHOP_PROPERTY_FEE_POLICY;
  return locale === "zh"
    ? `商铺收费参考：${policy.startsOn}起，${policy.monthlyRateXofPerSqm} XOF／平方米／月，月费按确认计费面积×单价计算。${policy.confirmedAsOf}用户确认当时均未收取（非实时收款状态）。仅限商铺，不套用于仓库或公寓；不据此生成应收、欠款或收款，也不代替每笔明确账期。后续以正式业务记录为准。`
    : `Référence pour les boutiques : à partir du ${policy.startsOn}, ${policy.monthlyRateXofPerSqm} XOF/m²/mois, selon la surface facturable confirmée × le tarif. Au ${policy.confirmedAsOf}, l’utilisateur confirme qu’aucune de ces charges n’avait été encaissée (pas un état de paiement en temps réel). Boutiques uniquement, sans application aux entrepôts ou appartements ; cette référence ne crée ni créance, dette ou paiement, ni période de service pour chaque écriture. Les enregistrements officiels ultérieurs font foi.`;
}
