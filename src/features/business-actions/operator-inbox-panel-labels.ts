export type OperatorLocale = "zh" | "fr";
export function operatorMethodLabel(method: string, locale: OperatorLocale) {
  const labels: Record<string, [string, string]> = {
    cash: ["现金", "Espèces"],
    check: ["支票", "Chèque"],
    bank_transfer: ["银行转账", "Virement bancaire"],
    offset: ["抵扣/转款", "Compensation / transfert"],
    other: ["其他", "Autre"],
  };
  return labels[method]?.[locale === "zh" ? 0 : 1] ?? method;
}
/** Never reinterpret a server business message as proof of success or rejection. */
export function operatorSourceMessage(message: string, locale: OperatorLocale) {
  return locale === "zh" ? message : `Message du serveur (texte source conservé) : ${message}`;
}
export function operatorConfirmationFeedbackFr(code: unknown) {
  const labels: Record<string, string> = {
    confirmationExpired:
      "La confirmation a expiré. Revenez à la conversation d’origine pour vérifier à nouveau les informations, en conservant l’identifiant.",
    confirmationSnapshotChanged:
      "Les données du séjour ont changé. Aucun nouvel enregistrement n’a été effectué par cette tentative ; revérifiez les montants dans la conversation d’origine, sans recréer un paiement.",
    missing_or_invalid_session:
      "La session a expiré. Reconnectez-vous puis revenez à cette confirmation, sans créer un paiement.",
    confirmationNotFound:
      "Cette confirmation est inaccessible au compte actuel. Connectez-vous avec le compte SACSI qui l’a créée.",
    confirmationForbidden: "Ce compte n’est pas autorisé à confirmer cet encaissement.",
    confirmationSuperseded:
      "Cette confirmation a été remplacée. L’ancien document ne peut plus être exécuté ; ouvrez la nouvelle confirmation.",
    confirmationRequestConflict:
      "L’identifiant entre en conflit avec une opération existante. Conservez-le et demandez une vérification, sans changer d’identifiant.",
    confirmationAlreadyExecuted:
      "Cette opération a déjà été exécutée. Conservez son identifiant et vérifiez le paiement d’origine, sans le recréer.",
  };
  return typeof code === "string" && labels[code]
    ? labels[code]
    : "Le résultat ne peut pas être confirmé. Conservez ce document et son identifiant ; ne créez pas de nouveau paiement. Si une nouvelle tentative est proposée, elle réutilise la même confirmation.";
}
