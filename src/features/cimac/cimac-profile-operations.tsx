"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { CustomerDirectoryProfile } from "@/features/customers/customer-directory-model";
import type { UnitRow } from "@/types/database";
import type { UnitPosition } from "@/features/units/operational-position";
import {
  createCimacCustomerIdentity,
  updateCimacAssetCondition,
  updateCimacCustomerProfile,
} from "./cimac-profile-actions";
import type { CimacViewLocale } from "./cimac-view-parts";
import styles from "./cimac-workspace.module.css";

// The two operation forms are fetched only when opened, not on every detail visit.
const CustomerWorkbenchForm = dynamic(() =>
  import("@/features/customers/customer-workbench-form").then((m) => m.CustomerWorkbenchForm),
);
const UnitConditionEditor = dynamic(() =>
  import("@/features/units/unit-condition-editor").then((m) => m.UnitConditionEditor),
);

export function CimacCustomerCreateOperation({
  locale,
  canCreateContract = false,
}: {
  locale: CimacViewLocale;
  canCreateContract?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const zh = locale === "zh";
  return (
    <>
      <button type="button" className={styles.button} onClick={() => setCreating(true)}>
        {zh ? "新建客户" : "Nouveau client"}
      </button>
      {creating ? (
        <CustomerWorkbenchForm
          profile={null}
          locale={locale}
          saveAction={createCimacCustomerIdentity}
          scopeNote={
            canCreateContract
              ? zh
                ? "这里只建立共享客户身份，不自动认定为建材城承租人，也不创建合同、应收或收款。保存后将继续办理合同；合同保存后才建立与园区资产的业务关系。已有档案请直接在合同中选择，不按同名自动合并。"
                : "Seule l’identité client partagée est créée, sans bail, créance, paiement ni qualité de locataire CIMAC. Après l’enregistrement, poursuivez le contrat : le lien avec un actif du parc n’existe qu’après sauvegarde du contrat. Sélectionnez un dossier existant dans le contrat ; aucun rapprochement par nom n’est automatique."
              : zh
                ? "这里只建立共享客户身份，不创建合同、应收或收款，也不自动认定为建材城承租人。当前账号没有建约权限；保存后可在合同目录核对新客户资料，请交由租售账号或管理员继续办理，合同保存后才建立园区业务关系。已有档案不按同名自动合并。"
                : "Seule l’identité client partagée est créée, sans contrat, créance, paiement ni qualité de locataire CIMAC. Ce compte ne peut pas créer de bail. Après sauvegarde, vérifiez la fiche dans le répertoire des contrats et confiez la suite à un commercial ou administrateur. Le lien au parc n’existe qu’après enregistrement du contrat ; aucun rapprochement par nom n’est automatique."
          }
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            const params = new URLSearchParams({ customer: id });
            router.push(`${locale === "fr" ? "/fr" : ""}/cimac/contracts?${params}`);
          }}
        />
      ) : null}
    </>
  );
}

export function CimacCustomerProfileOperation({
  profile,
  locale,
}: {
  profile: CustomerDirectoryProfile;
  locale: CimacViewLocale;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const zh = locale === "zh";
  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          setSaved(false);
          setEditing(true);
        }}
      >
        {zh ? "编辑客户资料" : "Modifier la fiche client"}
      </button>
      {saved && (
        <span role="status" className={styles.small}>
          {zh ? "资料已保存" : "Fiche enregistrée"}
        </span>
      )}
      {editing && (
        <CustomerWorkbenchForm
          key={`${profile.id}:${profile.updated_at}`}
          profile={profile}
          locale={locale}
          scopeNote={
            zh
              ? "姓名、联系方式、证件和备注属于共享客户身份。保存会同步更新该客户在其他项目中的资料，但不会改变任何合同、收款、黑名单或项目关系。"
              : "Nom, coordonnées, pièce et notes font partie de l’identité partagée. La modification s’applique aux autres projets de ce client, sans changer contrats, paiements, liste noire ou relations."
          }
          saveAction={(input) => updateCimacCustomerProfile(profile.id, profile.updated_at, input)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

export function CimacAssetConditionOperation({
  unit,
  position,
  buildingName,
  locale,
}: {
  unit: UnitRow;
  position?: UnitPosition;
  buildingName: string;
  locale: CimacViewLocale;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const zh = locale === "zh";
  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          setSaved(false);
          setEditing(true);
        }}
      >
        {zh ? "维护运行条件" : "Gérer l’état opérationnel"}
      </button>
      {saved && (
        <span role="status" className={styles.small}>
          {zh ? "运行条件已保存" : "État enregistré"}
        </span>
      )}
      {editing && (
        <UnitConditionEditor
          unit={unit}
          position={position}
          buildingName={buildingName}
          locale={locale}
          canEdit
          saveAction={updateCimacAssetCondition}
          onClose={() => setEditing(false)}
          onStatusChanged={() => {
            setEditing(false);
            setSaved(true);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
