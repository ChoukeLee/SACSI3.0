import styles from "./cimac-customer-workbench.module.css";

/** Confirmed policy reference only: never an invoice generator or a contract override. */
export function CimacBillingRuleReference({ locale }: { locale: "zh" | "fr" }) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const confirmed = [
    [
      text("商铺物业费", "Charges des boutiques"),
      text(
        "900 XOF / ㎡ / 月，按合同计费面积。",
        "900 XOF / m² / mois, selon la surface contractuelle.",
      ),
    ],
    [
      text("公寓物业费", "Charges des appartements"),
      text(
        "一室 30,000 · 两室 40,000 · 三室 50,000 XOF / 月。",
        "1 chambre : 30 000 · 2 chambres : 40 000 · 3 chambres : 50 000 XOF / mois.",
      ),
    ],
    [
      text("仓库物业费", "Charges des entrepôts"),
      text(
        "450 XOF / ㎡ / 月，按合同计费面积。",
        "450 XOF / m² / mois, selon la surface contractuelle.",
      ),
    ],
    [
      text("年度收取", "Cycle annuel"),
      text(
        "首年度 2027.04.01—2028.03.31；以后每年4月1日至次年3月31日。月标准仅用于计价。",
        "Premier exercice : 01/04/2027–31/03/2028, puis du 1er avril au 31 mars. Le tarif mensuel sert au calcul.",
      ),
    ],
    [
      text("年中入驻", "Entrée en cours d’exercice"),
      text(
        "首期截至所处收费年度的结束日（3月31日）；不足整月按天折算，具体细则待核。",
        "Première période jusqu’au 31 mars de l’exercice ; prorata journalier pour les mois incomplets, modalités à vérifier.",
      ),
    ],
    [
      text("租金优惠", "Franchise de loyer"),
      text(
        "讨论中的商铺免租优惠截至2028.03.31，不自动顺延，也不等于物业费减免。具体合同单独核实。",
        "La franchise des boutiques discutée se termine le 31/03/2028, sans prolongation automatique ni exonération implicite des charges. Vérifier chaque contrat.",
      ),
    ],
  ];
  const pending = [
    [
      text("物业费起算日", "Début des charges"),
      text(
        "待确认，不默认使用交付日或租金起算日。",
        "À vérifier, sans reprendre par défaut la remise des clés ou le début du loyer.",
      ),
    ],
    [
      text("按天折算细则", "Modalités du prorata"),
      text(
        "分母、首尾日计入及金额舍入待确认。",
        "Dénominateur, inclusion des dates et arrondi à confirmer.",
      ),
    ],
    [
      text("缴费期限", "Échéance"),
      text(
        "到期日和宽限期待确认；缺少依据不自动判逾期。",
        "Échéance et délai de grâce à confirmer ; pas de retard déduit sans base fiable.",
      ),
    ],
    [
      text("水电单价", "Tarifs des fluides"),
      text(
        "可先保存逐户水电读数和用量；单价未确认不生成应收。",
        "Relevés et consommations individuels enregistrables ; aucune créance sans tarif confirmé.",
      ),
    ],
    [
      text("管理费", "Frais de gestion"),
      text(
        "挂靠经营的税务相关服务；标准、周期及服务范围待确认，与物业费分开。",
        "Services fiscaux liés au rattachement de l’activité ; tarif, cycle et périmètre à confirmer, distincts des charges.",
      ),
    ],
    [
      text("特殊减免", "Exonérations particulières"),
      text(
        "按具体合同、证据及条件核实，不自动认定条件已满足。",
        "Vérifier le contrat, les justificatifs et les conditions, sans présumer qu’elles sont remplies.",
      ),
    ],
  ];
  return (
    <div className={styles.tabPanel}>
      {[
        {
          title: text("已确认的收费约定", "Références tarifaires confirmées"),
          rows: confirmed,
          pending: false,
        },
        {
          title: text("待确认的业务规则", "Règles restant à vérifier"),
          rows: pending,
          pending: true,
        },
      ].map((section) => (
        <section key={section.title} className={styles.panel}>
          <div className={styles.sectionHead}>
            <h2>{section.title}</h2>
            <span className={`${styles.status} ${section.pending ? styles.pending : styles.good}`}>
              {section.pending
                ? text("不自动出账", "Aucune facturation automatique")
                : text("参考约定", "Référence")}
            </span>
          </div>
          <dl className={styles.rules}>
            {section.rows.map(([label, value]) => (
              <div key={label} className={styles.rule}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className={styles.note}>
        {text(
          "统一标准不是实际应收或已收事实。合同未核实、历史服务期间不明的记录继续待核，不改写原合同及历史账务。",
          "Une référence tarifaire n’est ni une créance ni un encaissement. Contrats non vérifiés et périodes historiques inconnues restent à vérifier, sans réécriture des contrats ou comptes existants.",
        )}
      </p>
    </div>
  );
}
