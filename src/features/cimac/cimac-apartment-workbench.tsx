"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpDown, ArrowUpRight, LoaderCircle } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { constructionLabel } from "@/features/units/unit-workbench-model";
import { conditionLabel } from "@/features/units/operational-position";
import { initializeCimacApartments } from "./cimac-apartment-actions";
import { CimacApartmentReservationForm } from "./cimac-apartment-reservation-form";
import {
  cimacApartmentEastSuffixes,
  cimacApartmentFees,
  cimacApartmentFloors,
  cimacApartmentCurrentReferenceTerms,
  cimacApartmentWestSuffixes,
  type CimacApartmentData,
  type CimacApartmentFloor,
  type CimacApartmentQuery,
  type CimacApartmentRoom,
} from "./cimac-apartment-model";
import styles from "./cimac-apartment-workbench.module.css";

interface Props {
  data: CimacApartmentData;
  locale: Locale;
  initialQuery: CimacApartmentQuery;
  canInitialize: boolean;
}

const westRows: Readonly<Record<number, number>> = {
  0: 2,
  1: 4,
  2: 6,
  3: 8,
  6: 11,
  7: 14,
  8: 16,
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function restorePendingRequest(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    return value && uuidPattern.test(value) ? value : null;
  } catch {
    return null;
  }
}

function storePendingRequest(key: string, requestId: string | null) {
  try {
    if (requestId) sessionStorage.setItem(key, requestId);
    else sessionStorage.removeItem(key);
  } catch {
    // The in-memory ID remains available when browser storage is disabled.
  }
}

function roomType(room: CimacApartmentRoom, locale: Locale) {
  return locale === "zh"
    ? room.bedrooms === 1
      ? "一室一厅"
      : "两室"
    : room.bedrooms === 1
      ? "1 chambre + séjour"
      : "2 chambres";
}

function roomFacing(room: CimacApartmentRoom, locale: Locale) {
  return locale === "zh"
    ? room.facing === "east"
      ? "东侧"
      : "西侧"
    : room.facing === "east"
      ? "Est"
      : "Ouest";
}

function isDeliverable(room: CimacApartmentRoom) {
  return (
    room.registered &&
    room.constructionStatus === "operational" &&
    room.operationalCondition === "normal"
  );
}

function deliveryLabel(room: CimacApartmentRoom, locale: Locale) {
  const zh = locale === "zh";
  if (!room.registered) return zh ? "资料待补充" : "À compléter";
  if (room.operationalCondition === "locked") return zh ? "暂停交付" : "Livraison suspendue";
  if (room.operationalCondition === "maintenance") return zh ? "维护中" : "En maintenance";
  if (isDeliverable(room)) return zh ? "可交付" : "Livrable";
  if (!room.constructionStatus || ["operational", "unverified"].includes(room.constructionStatus))
    return zh ? "资料待补充" : "À compléter";
  return constructionLabel(room.constructionStatus, locale);
}

function reservationLabel(
  room: CimacApartmentRoom,
  schemaAvailable: boolean | undefined,
  locale: Locale,
) {
  const zh = locale === "zh";
  if (!room.registered || schemaAvailable !== true) return zh ? "资料待补充" : "À compléter";
  return room.reservation?.status === "reserved"
    ? zh
      ? "已预订"
      : "Réservé"
    : zh
      ? "暂无预订"
      : "Non réservé";
}

function businessRelationLabel(room: CimacApartmentRoom, locale: Locale) {
  const zh = locale === "zh";
  if (!room.registered) return zh ? "资料待补充" : "À compléter";
  if (room.occupancyState === "occupied")
    return zh ? "存在占用业务" : "Activité d’occupation existante";
  if (room.occupancyState === "unoccupied")
    return zh ? "已核实无占用业务" : "Absence confirmée d’activité d’occupation";
  return zh ? "资料待补充" : "À compléter";
}

function money(value: number, locale: Locale) {
  return locale === "zh"
    ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / 10000)}万 XOF`
    : `${new Intl.NumberFormat("fr-FR").format(value)} XOF`;
}

function RoomButton({
  room,
  selected,
  locale,
  onSelect,
  reservationSchemaAvailable,
  mobile = false,
}: {
  room: CimacApartmentRoom;
  selected: boolean;
  locale: Locale;
  onSelect: (room: CimacApartmentRoom) => void;
  reservationSchemaAvailable?: boolean;
  mobile?: boolean;
}) {
  const type = locale === "zh" ? (room.bedrooms === 1 ? "一室" : "两室") : `${room.bedrooms} ch.`;
  const zh = locale === "zh";
  const reservation =
    room.registered &&
    reservationSchemaAvailable === true &&
    room.reservation?.status === "reserved"
      ? room.reservation
      : null;
  const delivery = deliveryLabel(room, locale);
  const booking = reservationLabel(room, reservationSchemaAvailable, locale);
  const stay = zh ? "资料待补充" : "À compléter";
  return (
    <button
      type="button"
      className={`${styles.room} ${room.bedrooms === 2 ? styles.twoBedrooms : ""} ${mobile ? styles.mobileRoom : ""} ${reservation ? styles.reservedRoom : ""}`}
      data-room={room.unitNo}
      aria-pressed={selected}
      aria-label={`${room.unitNo} · ${roomType(room, locale)} · ${roomFacing(room, locale)} · ${zh ? "交付" : "Livraison"}：${delivery} · ${zh ? "预订" : "Réservation"}：${booking}${reservation ? ` · ${reservation.reserverName}` : ""} · ${zh ? "实际入住" : "Séjour réel"}：${stay}`}
      onClick={() => onSelect(room)}
    >
      <span className={styles.roomIdentity}>
        <strong>{room.unitNo}</strong>
        <span className={styles.roomCaption}>{type}</span>
      </span>
      {reservation ? (
        <span className={styles.roomName} title={reservation.reserverName}>
          {reservation.reserverName}
        </span>
      ) : null}
      <span className={styles.roomStates}>
        {[
          [zh ? "交付" : "Livr.", delivery, isDeliverable(room) ? styles.deliveryReady : ""],
          [zh ? "预订" : "Réserv.", booking, reservation ? styles.bookingKnown : ""],
          [zh ? "入住" : "Séjour", stay, ""],
        ].map(([label, value, tone]) => (
          <span className={styles.roomState} key={label}>
            <span>{label}</span>
            <span className={tone} title={value}>
              {value}
            </span>
          </span>
        ))}
      </span>
    </button>
  );
}

function Core({ locale, mobile = false }: { locale: Locale; mobile?: boolean }) {
  return (
    <div className={`${styles.core} ${mobile ? styles.mobileCore : ""}`}>
      <div className={styles.coreIcons} aria-hidden="true">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3 21h6v-6h6V9h6V3" />
        </svg>
        <ArrowUpDown size={17} />
      </div>
      <span>{locale === "zh" ? "楼梯 · 电梯" : "Escaliers · ascenseurs"}</span>
    </div>
  );
}

/** Query navigation resets selection; a refresh of the same query keeps pending request identity. */
export function CimacApartmentWorkbench(props: Props) {
  return (
    <ApartmentWorkbench
      key={`${props.initialQuery.floor}:${props.initialQuery.suffix}:${props.initialQuery.tab}`}
      {...props}
    />
  );
}

function ApartmentWorkbench({ data, locale, initialQuery, canInitialize }: Props) {
  const zh = locale === "zh";
  const router = useRouter();
  const base = `${zh ? "" : "/fr"}/cimac`;
  const [selection, setSelection] = useState({
    floor: initialQuery.floor,
    suffix: initialQuery.suffix,
  });
  const [tab, setTab] = useState(initialQuery.tab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const requestId = useRef<string | null>(null);
  const requestStorageKey = `cimac-apartment-initialize:${data.projectId}:${data.buildingId}`;
  const guard = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const floorRooms = data.rooms.filter((room) => room.floor === selection.floor);
  const selected =
    floorRooms.find((room) => room.suffix === selection.suffix) ?? floorRooms[0] ?? data.rooms[0];
  const roomsBySuffix = new Map(floorRooms.map((room) => [room.suffix, room]));
  const oneBedroomCount = data.rooms.filter((room) => room.bedrooms === 1).length;
  const twoBedroomCount = data.rooms.filter((room) => room.bedrooms === 2).length;
  const deliverableCount = data.rooms.filter(isDeliverable).length;
  const reservationKnownCount =
    data.reservationSchemaAvailable === true
      ? data.rooms.filter((room) => room.registered).length
      : 0;
  const reservationCount = data.rooms.filter(
    (room) =>
      room.registered &&
      data.reservationSchemaAvailable === true &&
      room.reservation?.status === "reserved",
  ).length;
  const floorReservationCount = floorRooms.filter(
    (room) =>
      room.registered &&
      data.reservationSchemaAvailable === true &&
      room.reservation?.status === "reserved",
  ).length;
  const floorTwoBedroomCount = floorRooms.filter((room) => room.bedrooms === 2).length;
  const canCreateCatalogue = canInitialize && data.schemaAvailable && data.registeredCount === 0;
  const fees = selected ? cimacApartmentFees(selected) : null;
  const oneBedroom = data.rooms.find((room) => room.bedrooms === 1);
  const twoBedroom = data.rooms.find((room) => room.bedrooms === 2);
  const selectedReservation =
    selected?.registered &&
    data.reservationSchemaAvailable === true &&
    selected.reservation?.status === "reserved"
      ? selected.reservation
      : null;

  async function initialize() {
    if (!canCreateCatalogue || guard.current || saved) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      requestId.current ??= restorePendingRequest(requestStorageKey) ?? crypto.randomUUID();
      storePendingRequest(requestStorageKey, requestId.current);
      const result = await initializeCimacApartments(requestId.current);
      if (!active.current) return;
      if (
        result.success &&
        result.requestId === requestId.current &&
        result.roomCount === 64 &&
        typeof result.idempotent === "boolean"
      ) {
        storePendingRequest(requestStorageKey, null);
        setSaved(true);
        router.refresh();
      } else {
        setError(
          !result.success && zh
            ? result.error
            : zh
              ? "尚未核实台账建立结果，请按原请求重试。"
              : "Résultat non vérifié. Réessayez avec la même demande.",
        );
      }
    } catch {
      if (active.current)
        setError(
          zh
            ? "结果尚未确认，请按原请求重试，不要重复新建台账。"
            : "Résultat non confirmé. Réessayez avec la même demande, sans recréer le répertoire.",
        );
    } finally {
      guard.current = false;
      if (active.current) setBusy(false);
    }
  }

  const chooseRoom = (room: CimacApartmentRoom) =>
    setSelection({ floor: room.floor, suffix: room.suffix });
  const renderRoom = (suffix: number, mobile = false) => {
    const room = roomsBySuffix.get(suffix);
    return room ? (
      <RoomButton
        key={room.unitNo}
        room={room}
        selected={room.unitNo === selected?.unitNo}
        locale={locale}
        reservationSchemaAvailable={data.reservationSchemaAvailable}
        onSelect={chooseRoom}
        mobile={mobile}
      />
    ) : null;
  };

  function moveDetailTab(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab =
      event.key === "Home"
        ? "room"
        : event.key === "End"
          ? "fees"
          : tab === "room"
            ? "fees"
            : "room";
    setTab(nextTab);
    event.currentTarget.querySelector<HTMLButtonElement>(`#apartment-tab-${nextTab}`)?.focus();
  }

  return (
    <div className={styles.workbench}>
      <header className={styles.heading}>
        <div>
          <p className={styles.overline}>APARTMENTS / BUILDING 17</p>
          <h1>{zh ? "17栋 · 公寓住宿" : "Bâtiment 17 · Appartements"}</h1>
          <p className={styles.subtitle}>
            {zh
              ? "按楼层看房间，实际住户与合同、收费分别核对。"
              : "Chambres par étage ; résidents, contrats et encaissements sont vérifiés séparément."}
          </p>
        </div>
      </header>

      <section className={styles.stats} aria-label={zh ? "已确认房间清单" : "Inventaire confirmé"}>
        <div className={styles.stat}>
          <span className={styles.label}>{zh ? "房间总数" : "Total des logements"}</span>
          <strong className={styles.statNumber}>
            {data.rooms.length}
            <small>{zh ? "套" : "logements"}</small>
          </strong>
          <span className={styles.statNote}>
            {zh ? "2—5层 · 每层16套" : "Étages 2–5 · 16 par étage"}
          </span>
          <span className={styles.statNote}>
            {zh
              ? `${oneBedroomCount}套一室一厅 / ${twoBedroomCount}套两室`
              : `${oneBedroomCount} × 1 ch. / ${twoBedroomCount} × 2 ch.`}
          </span>
        </div>
        <div className={styles.stat} data-testid="apartment-delivery-summary">
          <span className={styles.label}>{zh ? "交付条件" : "Conditions de livraison"}</span>
          <strong className={styles.statNumber}>
            {deliverableCount}
            <small>{zh ? "套可交付" : "livrables"}</small>
          </strong>
          <span className={styles.statNote}>
            {deliverableCount === data.rooms.length
              ? zh
                ? "建设及运行条件已满足"
                : "Conditions du bâti et d’exploitation réunies"
              : zh
                ? `${data.rooms.length - deliverableCount}套待处理或补充资料`
                : `${data.rooms.length - deliverableCount} à traiter ou compléter`}
          </span>
        </div>
        <div className={styles.stat} data-testid="apartment-reservation-summary">
          <span className={styles.label}>{zh ? "预订情况" : "Réservations"}</span>
          {reservationKnownCount > 0 ? (
            <>
              <strong className={styles.statNumber}>
                {reservationCount}
                <small>{zh ? "套已预订" : "réservés"}</small>
              </strong>
              <span className={styles.statNote}>
                {zh
                  ? `${reservationKnownCount - reservationCount}套暂无预订`
                  : `${reservationKnownCount - reservationCount} non réservés`}
              </span>
              {reservationKnownCount < data.rooms.length ? (
                <span className={styles.statNote}>
                  {zh
                    ? `${data.rooms.length - reservationKnownCount}套预订资料待补充`
                    : `${data.rooms.length - reservationKnownCount} réservations à compléter`}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <strong className={styles.summaryValue}>{zh ? "待补充" : "À compléter"}</strong>
              <span className={styles.statNote}>
                {zh ? "预订资料尚未完整读取" : "Données de réservation incomplètes"}
              </span>
            </>
          )}
        </div>
        <div className={styles.stat} data-testid="apartment-stay-summary">
          <span className={styles.label}>{zh ? "实际入住" : "Séjours réels"}</span>
          <strong className={styles.statNumber}>
            {data.rooms.length}
            <small>{zh ? "套资料待补充" : "à compléter"}</small>
          </strong>
          <span className={styles.statNote}>
            {zh ? "实际住户与入住日期" : "Résidents réels et dates d’entrée"}
          </span>
        </div>
      </section>

      <div className={styles.registration}>
        <div>
          <span className={styles.registrationLabel}>
            {data.schemaAvailable
              ? zh
                ? `资产建档 ${data.registeredCount} / ${data.rooms.length}`
                : `Fiches d’actifs ${data.registeredCount} / ${data.rooms.length}`
              : zh
                ? "公寓台账待部署"
                : "Répertoire à déployer"}
          </span>
          <p className={styles.small}>
            {!data.schemaAvailable
              ? zh
                ? "请先完成公寓数据库迁移；当前清单不代表已建立资产。"
                : "Migration requise. La liste confirmée ne signifie pas que les fiches d’actifs sont créées."
              : data.registeredCount === 0
                ? zh
                  ? "房号、户型及收费已确认，资产记录尚未建立。"
                  : "Numéros, types et tarifs confirmés ; fiches d’actifs non créées."
                : zh
                  ? "交付条件、预订和实际入住分别记录。"
                  : "Livraison, réservation et séjour réel sont suivis séparément."}
          </p>
        </div>
        {canCreateCatalogue ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || saved}
            onClick={() => void initialize()}
          >
            {busy ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" /> : null}
            {saved
              ? zh
                ? "台账已建立"
                : "Répertoire créé"
              : busy
                ? zh
                  ? "正在核验并建立…"
                  : "Vérification et création…"
                : zh
                  ? "建立64套房间台账"
                  : "Créer les 64 fiches"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {requestId.current && !saved ? (
        <p className={styles.small}>
          {zh ? "请求编号：" : "Identifiant de demande : "}
          <code>{requestId.current}</code>
        </p>
      ) : null}
      {saved ? (
        <p role="status" className={styles.success}>
          {zh
            ? "已核验建立64套资产台账，未生成合同、应收或收款。"
            : "64 fiches vérifiées et créées, sans contrat, créance ni encaissement."}
        </p>
      ) : null}

      <div className={styles.workspace}>
        <section
          className={styles.planPanel}
          aria-label={zh ? "楼层房间分布" : "Répartition par étage"}
        >
          <div className={styles.panelHeader}>
            <h2>{zh ? "楼层分布" : "Répartition des appartements"}</h2>
            <div
              className={styles.floorControl}
              role="group"
              aria-label={zh ? "切换楼层" : "Choisir un étage"}
            >
              {cimacApartmentFloors.map((floor: CimacApartmentFloor) => (
                <button
                  key={floor}
                  type="button"
                  aria-pressed={selection.floor === floor}
                  onClick={() => setSelection((previous) => ({ ...previous, floor }))}
                >
                  {zh ? `${floor}层` : `Étage ${floor}`}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.floorMeta}>
            <span>
              {zh
                ? `${selection.floor}层 · ${floorRooms.length}套 · ${floorRooms.length - floorTwoBedroomCount}套一室 / ${floorTwoBedroomCount}套两室`
                : `Étage ${selection.floor} · ${floorRooms.length} logements · ${floorRooms.length - floorTwoBedroomCount} × 1 ch. / ${floorTwoBedroomCount} × 2 ch.`}
            </span>
            {data.reservationSchemaAvailable ? (
              <span className={styles.reservationSummary}>
                {zh
                  ? `本层预订 ${floorReservationCount} 套`
                  : `${floorReservationCount} réservés à cet étage`}
              </span>
            ) : null}
            <div className={styles.legend} aria-label={zh ? "户型图例" : "Légende des types"}>
              <span>
                <b />
                {zh ? "一室" : "1 ch."}
              </span>
              <span className={styles.twoLegend}>
                <b />
                {zh ? "两室" : "2 ch."}
              </span>
            </div>
          </div>
          <div className={styles.plan}>
            <div className={styles.desktopPlan} data-testid="apartment-desktop-plan">
              <div className={styles.sideCaption}>
                <strong>{zh ? "东侧" : "Est"}</strong>
                <span>
                  {zh ? "1701所在商铺排的上方" : "Au-dessus de la rangée du commerce 1701"}
                </span>
              </div>
              <div className={styles.roomRow}>
                {cimacApartmentEastSuffixes.map((suffix) => renderRoom(suffix))}
              </div>
              <div className={styles.corridor}>{zh ? "公共走廊" : "Couloir commun"}</div>
              <div className={styles.roomRow}>
                {cimacApartmentWestSuffixes.slice(0, 4).map((suffix) => renderRoom(suffix))}
                <Core locale={locale} />
                {cimacApartmentWestSuffixes.slice(4).map((suffix) => renderRoom(suffix))}
              </div>
              <div className={styles.sideCaption}>
                <strong>{zh ? "西侧" : "Ouest"}</strong>
                <span>{zh ? "尾号02所在排" : "Rangée des numéros finissant par 02"}</span>
              </div>
            </div>
            <div
              className={styles.mobilePlan}
              data-testid="apartment-mobile-plan"
              aria-label={zh ? "西侧在左、东侧在右的房间分布" : "Ouest à gauche, est à droite"}
            >
              <div className={styles.mobileSide}>{zh ? "西侧" : "Ouest"}</div>
              <div />
              <div className={styles.mobileSide}>{zh ? "东侧" : "Est"}</div>
              <div className={styles.mobileCorridor}>{zh ? "公共走廊" : "Couloir"}</div>
              {cimacApartmentEastSuffixes.map((suffix, index) => (
                <div key={`east-${suffix}`} style={{ gridRow: index + 2, gridColumn: 3 }}>
                  {renderRoom(suffix, true)}
                </div>
              ))}
              {Object.entries(westRows).map(([index, suffix]) => (
                <div key={`west-${suffix}`} style={{ gridRow: Number(index) + 2, gridColumn: 1 }}>
                  {renderRoom(suffix, true)}
                </div>
              ))}
              <Core locale={locale} mobile />
            </div>
            {floorRooms.length === 0 ? (
              <p>
                {zh
                  ? "当前楼层没有可读取的房间清单。"
                  : "Aucun appartement lisible pour cet étage."}
              </p>
            ) : null}
            <div className={styles.planFoot}>
              <span>
                {zh ? "点击房间查看资料与收费" : "Sélectionnez un logement pour ses détails"}
              </span>
              <span>{zh ? "位置示意 · 非面积比例" : "Schéma de position, non à l’échelle"}</span>
            </div>
          </div>
        </section>

        {selected && fees ? (
          <aside
            className={styles.detail}
            aria-label={zh ? "选中房间详情" : "Détails du logement sélectionné"}
          >
            <div className={styles.detailHeading}>
              <div>
                <p className={styles.label}>
                  {zh
                    ? `17栋 · ${selected.floor}层 · ${roomFacing(selected, locale)}`
                    : `Bâtiment 17 · Étage ${selected.floor} · ${roomFacing(selected, locale)}`}
                </p>
                <h2 className={styles.detailRoom} data-testid="apartment-selected-number">
                  {selected.unitNo}
                </h2>
                <p className={styles.detailType}>{roomType(selected, locale)}</p>
                {selectedReservation ? (
                  <p className={styles.reservationName} title={selectedReservation.reserverName}>
                    {zh ? "预订人：" : "Réservataire : "}
                    {selectedReservation.reserverName}
                  </p>
                ) : null}
              </div>
            </div>
            <dl className={styles.detailStates} aria-label={zh ? "房间状态" : "États du logement"}>
              <div>
                <dt>{zh ? "交付条件" : "Conditions de livraison"}</dt>
                <dd className={isDeliverable(selected) ? styles.deliveryReady : ""}>
                  {deliveryLabel(selected, locale)}
                </dd>
              </div>
              <div>
                <dt>{zh ? "预订情况" : "Réservation"}</dt>
                <dd className={selectedReservation ? styles.bookingKnown : ""}>
                  {reservationLabel(selected, data.reservationSchemaAvailable, locale)}
                </dd>
              </div>
              <div>
                <dt>{zh ? "实际入住" : "Séjour réel"}</dt>
                <dd>{zh ? "资料待补充" : "À compléter"}</dd>
              </div>
            </dl>
            <div
              className={styles.detailTabs}
              role="tablist"
              aria-label={zh ? "房间详情分区" : "Sections du logement"}
              onKeyDown={moveDetailTab}
            >
              <button
                id="apartment-tab-room"
                type="button"
                role="tab"
                tabIndex={tab === "room" ? 0 : -1}
                aria-selected={tab === "room"}
                aria-controls="apartment-room-info"
                onClick={() => setTab("room")}
              >
                {zh ? "房间资料" : "Fiche du logement"}
              </button>
              <button
                id="apartment-tab-fees"
                type="button"
                role="tab"
                tabIndex={tab === "fees" ? 0 : -1}
                aria-selected={tab === "fees"}
                aria-controls="apartment-room-fees"
                onClick={() => setTab("fees")}
              >
                {zh ? "收费标准" : "Tarifs de référence"}
              </button>
            </div>
            <div className={styles.detailBody}>
              <div
                id="apartment-room-info"
                role="tabpanel"
                aria-labelledby="apartment-tab-room"
                hidden={tab !== "room"}
              >
                <dl className={styles.facts}>
                  {selectedReservation ? (
                    <>
                      <div className={styles.fact}>
                        <dt>{zh ? "预订人" : "Réservataire"}</dt>
                        <dd>{selectedReservation.reserverName}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>{zh ? "预留付款" : "Paiement de la réservation"}</dt>
                        <dd>{zh ? "未付款" : "Non payé"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>{zh ? "预计入住日期" : "Arrivée prévue"}</dt>
                        <dd>{zh ? "待定" : "À préciser"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>{zh ? "租期" : "Durée"}</dt>
                        <dd>{zh ? "待定" : "À préciser"}</dd>
                      </div>
                    </>
                  ) : null}
                  <div className={styles.fact}>
                    <dt>{zh ? "关联业务" : "Activités liées"}</dt>
                    <dd>{businessRelationLabel(selected, locale)}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>{zh ? "实际住户" : "Résident réel"}</dt>
                    <dd>{zh ? "待补充" : "À compléter"}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>{zh ? "关联商户" : "Commerçant associé"}</dt>
                    <dd>{zh ? "待补充" : "À compléter"}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>{zh ? "入住日期" : "Date d’entrée"}</dt>
                    <dd>{zh ? "待补充" : "À compléter"}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>{zh ? "租金起算日" : "Début du loyer"}</dt>
                    <dd>{zh ? "待核实" : "À vérifier"}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>{zh ? "面积" : "Surface"}</dt>
                    <dd>
                      {selected.areaSqm === null
                        ? zh
                          ? "待核实"
                          : "À vérifier"
                        : `${new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR").format(selected.areaSqm)} m²`}
                    </dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>{zh ? "建设条件" : "État du bâti"}</dt>
                    <dd>{constructionLabel(selected.constructionStatus ?? undefined, locale)}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>{zh ? "运行条件" : "État opérationnel"}</dt>
                    <dd>{conditionLabel(selected.operationalCondition ?? undefined, locale)}</dd>
                  </div>
                </dl>
              </div>
              <div
                id="apartment-room-fees"
                role="tabpanel"
                aria-labelledby="apartment-tab-fees"
                hidden={tab !== "fees"}
              >
                <dl className={styles.facts}>
                  {[
                    [zh ? "月租" : "Loyer mensuel", selected.monthlyRentXof],
                    [
                      zh
                        ? `押金 · ${selected.depositMonths}个月`
                        : `Dépôt · ${selected.depositMonths} mois`,
                      fees.depositXof,
                    ],
                    [
                      zh
                        ? `预付租金 · ${selected.rentPrepayMonths}个月`
                        : `Loyer prépayé · ${selected.rentPrepayMonths} mois`,
                      fees.prepaidRentXof,
                    ],
                    [zh ? "物业费 · 每月" : "Charges · mois", selected.monthlyPropertyFeeXof],
                    [zh ? "物业费 · 一年" : "Charges · année", fees.annualPropertyFeeXof],
                  ].map(([label, amount]) => (
                    <div className={styles.fact} key={String(label)}>
                      <dt>{label}</dt>
                      <dd>{money(Number(amount), locale)}</dd>
                    </div>
                  ))}
                </dl>
                <div className={styles.ruleTotal}>
                  <p className={styles.label}>
                    {zh ? "标准首期测算" : "Estimation du premier versement"}
                  </p>
                  <strong data-testid="apartment-initial-total">
                    {money(fees.standardInitialTotalXof, locale)}
                  </strong>
                  <small>
                    {zh
                      ? `${selected.depositMonths}个月押金 + ${selected.rentPrepayMonths}个月租金 + 完整1年物业费`
                      : `Dépôt ${selected.depositMonths} mois + loyer ${selected.rentPrepayMonths} mois + charges d’une année entière`}
                  </small>
                </div>
              </div>
            </div>
            <p className={styles.detailFoot}>
              {tab === "room"
                ? zh
                  ? "交付条件、预订与实际入住分别记录。"
                  : "Livraison, réservation et séjour réel sont suivis séparément."
                : zh
                  ? "收费测算，不代表应收或已收款。"
                  : "Estimation uniquement, ni créance ni encaissement."}
            </p>
            {canInitialize &&
            data.reservationSchemaAvailable &&
            selected.registered &&
            selected.unitUpdatedAt ? (
              <CimacApartmentReservationForm
                key={`${selected.unitId}:${selected.reservation?.id ?? "none"}:${selected.reservation?.updatedAt ?? ""}`}
                room={selected}
                projectId={data.projectId}
                buildingId={data.buildingId}
                locale={locale}
              />
            ) : null}
            {canInitialize && selected.registered && data.reservationSchemaAvailable === false ? (
              <p className={styles.detailFoot}>
                {zh ? "房间预留功能待部署。" : "Gestion des réservations à déployer."}
              </p>
            ) : null}
            {selected.registered && selected.unitId ? (
              <Link
                className={styles.assetLink}
                href={`${base}/assets/${selected.unitId}?${new URLSearchParams({ returnTo: `${base}/apartments?floor=${selected.floor}&room=${selected.unitNo}&tab=${tab}` })}`}
                prefetch={false}
              >
                {zh ? "查看资产与关联业务" : "Actif et activités liées"}
                <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            ) : null}
          </aside>
        ) : null}
      </div>

      <section
        className={styles.rulesPanel}
        aria-label={zh ? "公寓统一收费规则" : "Tarifs des appartements"}
      >
        <div className={styles.rulesHeading}>
          <h2>{zh ? "收费规则" : "Règles tarifaires"}</h2>
          <span className={styles.label}>
            {zh
              ? "原币 XOF · 押二付三 · 物业年缴"
              : `XOF · dépôt ${cimacApartmentCurrentReferenceTerms.depositMonths} mois · loyer ${cimacApartmentCurrentReferenceTerms.rentPrepayMonths} mois · charges annuelles`}
          </span>
        </div>
        <div
          className={styles.rulesTableWrap}
          role="region"
          aria-label={zh ? "收费标准对照" : "Comparaison des tarifs"}
          tabIndex={0}
        >
          <table className={styles.rulesTable}>
            <thead>
              <tr>
                <th scope="col">{zh ? "户型" : "Type"}</th>
                <th scope="col">{zh ? "月租" : "Loyer / mois"}</th>
                <th scope="col" className={styles.optionalColumn}>
                  {zh
                    ? `押金 / ${cimacApartmentCurrentReferenceTerms.depositMonths}个月`
                    : `Dépôt / ${cimacApartmentCurrentReferenceTerms.depositMonths} mois`}
                </th>
                <th scope="col" className={styles.optionalColumn}>
                  {zh
                    ? `预付 / ${cimacApartmentCurrentReferenceTerms.rentPrepayMonths}个月`
                    : `Prépayé / ${cimacApartmentCurrentReferenceTerms.rentPrepayMonths} mois`}
                </th>
                <th scope="col">{zh ? "物业 / 年" : "Charges / an"}</th>
                <th scope="col">{zh ? "标准首期" : "Premier versement estimé"}</th>
              </tr>
            </thead>
            <tbody>
              {[oneBedroom, twoBedroom]
                .filter((room): room is CimacApartmentRoom => Boolean(room))
                .map((room) => {
                  const standard = cimacApartmentFees(room);
                  return (
                    <tr key={room.bedrooms}>
                      <th scope="row">{roomType(room, locale)}</th>
                      <td>{money(room.monthlyRentXof, locale)}</td>
                      <td className={styles.optionalColumn}>
                        {money(standard.depositXof, locale)}
                      </td>
                      <td className={styles.optionalColumn}>
                        {money(standard.prepaidRentXof, locale)}
                      </td>
                      <td>{money(standard.annualPropertyFeeXof, locale)}</td>
                      <td>{money(standard.standardInitialTotalXof, locale)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <details className={styles.ruleNotes}>
          <summary>{zh ? "查看待核收费口径" : "Points tarifaires à confirmer"}</summary>
          <dl>
            <dt>{zh ? "物业年度起止" : "Année des charges"}</dt>
            <dd>
              {zh
                ? "待确认，不套用商铺年度。"
                : "À confirmer, sans appliquer l’année des commerces."}
            </dd>
            <dt>{zh ? "首年不足一年" : "Première année incomplète"}</dt>
            <dd>{zh ? "折算方式待确认。" : "Prorata à confirmer."}</dd>
            <dt>{zh ? "实际账务" : "Comptabilité réelle"}</dt>
            <dd>
              {zh
                ? "根据合同、真实账期及收款另行登记。"
                : "À enregistrer séparément d’après le contrat, la période et le paiement réels."}
            </dd>
          </dl>
        </details>
      </section>
      <p className={styles.footer}>
        {zh
          ? "本页收费为已确认参考标准；实际入住、合同、应收与收款独立保存。"
          : "Tarifs de référence confirmés ; résidents, contrats, créances et encaissements sont conservés séparément."}
      </p>
      <p className={styles.srOnly} aria-live="polite">
        {selected
          ? `${selected.unitNo} · ${roomType(selected, locale)} · ${roomFacing(selected, locale)}`
          : ""}
      </p>
    </div>
  );
}
