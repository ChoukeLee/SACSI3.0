"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  Columns3,
  DoorOpen,
  Info,
  ListChecks,
  Plus,
  Copy,
  Printer,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { qualifiedUnitNo } from "@/lib/unit-building-label";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { CalendarWindowData } from "./calendar-window-model";
import { parseCalendarWindow } from "./calendar-window-model";
import { addDays } from "./booking-presentation";
import {
  buildDailyTasks,
  dailyWorkbenchCounts,
  findDailyRooms,
  type DailyTaskFilter,
} from "./daily-workbench-model";
import {
  dailyDateLabel,
  dailyBookingIdentityLabel,
  dailyReadinessLabel,
  dailyStatusLabel,
} from "./daily-workbench-labels";
import { useDailyWorkbenchData } from "./use-daily-workbench-data";
import { DailyWorkbenchInspector } from "./daily-workbench-inspector";
import { DailyWorkbenchActions } from "./daily-workbench-actions";
import { DailyWorkbenchTimeline } from "./daily-workbench-timeline";
import { dailyWorkbenchShareText } from "./daily-workbench-share";
import styles from "./daily-workbench.module.css";

type WorkView = "today" | "availability" | "timeline" | "history";
type Selection = { unitId: string; bookingId: string | null } | null;
type ActionTarget = {
  unit: UnitRow | null;
  booking: DailyBookingRow | null;
  date: string;
  checkOut?: string;
};

export function DailyWorkbench({
  initialWindow,
  buildings,
  locale,
  userRole,
}: {
  initialWindow: CalendarWindowData;
  buildings: { id: string; code: string; display_name: string }[];
  locale: Locale;
  userRole: string;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const prefix = locale === "fr" ? "/fr" : "";
  const [view, setView] = useState<WorkView>("today");
  const [buildingId, setBuildingId] = useState(initialWindow.buildingId);
  const [filter, setFilter] = useState<DailyTaskFilter>("priority");
  const [selection, setSelection] = useState<Selection>(null);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [notice, setNotice] = useState("");
  const [businessDay, setBusinessDay] = useState(initialWindow.today);
  const [from, setFrom] = useState(initialWindow.today);
  const [to, setTo] = useState(addDays(initialWindow.today, 3));
  const [searchRange, setSearchRange] = useState({
    from: initialWindow.today,
    to: addDays(initialWindow.today, 3),
  });
  const [queryError, setQueryError] = useState("");
  const [timelineFrom, setTimelineFrom] = useState(initialWindow.today);
  const [dayCount, setDayCount] = useState(7);
  const [historyRange, setHistoryRange] = useState({
    from: initialWindow.today.slice(0, 7) + "-01",
    to: addDays(initialWindow.today, 1),
  });
  const [historyFrom, setHistoryFrom] = useState(historyRange.from);
  const [historyTo, setHistoryTo] = useState(historyRange.to);
  const [historySearch, setHistorySearch] = useState("");
  const inspectorRef = useRef<HTMLDivElement>(null);
  const inspectorId = useId();
  const stageId = useId();
  const tabPrefix = useId();
  const range =
    view === "availability"
      ? searchRange
      : view === "timeline"
        ? { from: timelineFrom, to: addDays(timelineFrom, dayCount) }
        : view === "history"
          ? historyRange
          : {
              from: businessDay,
              to: addDays(
                businessDay,
                Math.max(
                  1,
                  Math.round(
                    (Date.parse(initialWindow.to) - Date.parse(initialWindow.from)) / 86400000,
                  ),
                ),
              ),
            };
  const query = { buildingId, ...range };
  const { data, pending, failed, refresh, asOf } = useDailyWorkbenchData(initialWindow, query);
  const today = data?.today ?? businessDay;
  useEffect(() => {
    if (!data || data.today === businessDay) return;
    const nextDay = data.today;
    setBusinessDay(nextDay);
    setAction(null);
    setSelection(null);
    if (from === businessDay && to === addDays(businessDay, 3)) {
      setFrom(nextDay);
      setTo(addDays(nextDay, 3));
    }
    setSearchRange((previous) =>
      previous.from === businessDay && previous.to === addDays(businessDay, 3)
        ? { from: nextDay, to: addDays(nextDay, 3) }
        : previous,
    );
    setTimelineFrom((previous) => (previous === businessDay ? nextDay : previous));
  }, [data, businessDay, from, to]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const sync = () => setDayCount(media.matches ? 3 : 7);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const tasks = useMemo(
    () => (data ? buildDailyTasks(data, today, filter) : []),
    [data, today, filter],
  );
  const counts = useMemo(() => (data ? dailyWorkbenchCounts(data, today) : null), [data, today]);
  const rooms = useMemo(
    () =>
      data && view === "availability"
        ? findDailyRooms(data, searchRange.from, searchRange.to, today)
        : [],
    [data, view, searchRange.from, searchRange.to, today],
  );
  const available = rooms.filter((room) => room.state !== "blocked");
  const firstTask = tasks[0];
  const effectiveSelection =
    selection ??
    (view === "today" && firstTask
      ? { unitId: firstTask.unit.id, bookingId: firstTask.booking?.id ?? null }
      : view === "availability" && available[0]
        ? { unitId: available[0].unit.id, bookingId: null }
        : null);
  const selectedUnit =
    data?.dailyUnits.find((unit) => unit.id === effectiveSelection?.unitId) ??
    data?.unitLookupUnits.find((unit) => unit.id === effectiveSelection?.unitId) ??
    null;
  const selectedBooking =
    data?.bookings.find(
      (booking) =>
        booking.id === effectiveSelection?.bookingId && booking.unit_id === selectedUnit?.id,
    ) ?? null;
  const selectedRoomResult = rooms.find((room) => room.unit.id === selectedUnit?.id);
  const revealInspector = () => {
    if (window.matchMedia("(max-width: 899px)").matches) {
      requestAnimationFrame(() =>
        inspectorRef.current?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        }),
      );
    }
  };
  const choose = (unitId: string, bookingId: string | null) => {
    setSelection({ unitId, bookingId });
    revealInspector();
  };
  const changeView = (next: WorkView) => {
    setView(next);
    setSelection(null);
    setAction(null);
    setQueryError("");
  };
  const building = buildings.find((b) => b.id === buildingId);
  const filterNames: [DailyTaskFilter, string][] = [
    ["priority", text("需处理", "À traiter")],
    ["arrivals", text("入住", "Arrivées")],
    ["inhouse", text("在住", "En séjour")],
    ["departures", text("退房", "Départs")],
    ["cleaning", text("保洁", "Ménage")],
    ["collection", text("收款", "Paiements")],
  ];
  const groupName = (kind: string) =>
    ({
      arrival: text("待入住", "Arrivées attendues"),
      inhouse: text("当前在住", "Séjours en cours"),
      departure: text("离店与交接", "Départs et remise"),
      cleaning: text("待保洁", "Ménage à faire"),
      collection: text("收款跟进 · 非已核应收", "Paiements à suivre · solde non vérifié"),
      review: text("需要核实", "À vérifier"),
    })[kind] ?? text("待处理", "À traiter");
  const groups = [...new Set(tasks.map((task) => task.kind))];
  const history =
    data?.bookings.filter((booking) => {
      const end = booking.actual_check_out ?? booking.check_out;
      const inRange = booking.check_in < historyRange.to && (!end || end >= historyRange.from);
      const room = data.unitLookupUnits.find((unit) => unit.id === booking.unit_id);
      const agent = data.customers?.find(
        (customer) => customer.id === (booking.booking_agent_id ?? booking.customer_id),
      );
      return (
        inRange &&
        `${room ? qualifiedUnitNo(room) : ""} ${dailyBookingIdentityLabel(booking, data, locale)} ${agent?.name ?? ""}`
          .toLocaleLowerCase()
          .includes(historySearch.trim().toLocaleLowerCase())
      );
    }) ?? [];
  const operate = () => {
    if (!data || !selectedUnit) return;
    setAction({
      unit: selectedUnit,
      booking: selectedBooking,
      date: view === "availability" ? searchRange.from : today,
      checkOut: view === "availability" ? searchRange.to : undefined,
    });
  };
  const submitRange = (event: React.FormEvent, mode: "availability" | "history") => {
    event.preventDefault();
    try {
      const parsed = parseCalendarWindow({
        buildingId,
        from: mode === "history" ? historyFrom : from,
        to: mode === "history" ? historyTo : to,
      });
      if (mode === "availability" && parsed.from < today) throw new Error("past");
      if (mode === "history") setHistoryRange({ from: parsed.from, to: parsed.to });
      else setSearchRange({ from: parsed.from, to: parsed.to });
      setQueryError("");
      setSelection(null);
    } catch {
      setQueryError(
        text(
          "请选择有效日期，结束日晚于开始日，最多查询 62 天；普通预订不能选择过去日期。",
          "Choisissez une période valide de 1 à 62 jours ; une réservation normale ne commence pas dans le passé.",
        ),
      );
    }
  };

  return (
    <div className={styles.workbench} data-daily-workbench>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DAILY OPERATIONS</p>
          <h1 className={styles.title}>{text("日租运营台", "Locations courtes")}</h1>
          <p className={styles.subtitle}>
            {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
              month: "long",
              day: "numeric",
              weekday: "long",
              timeZone: "Africa/Abidjan",
            }).format(new Date(today + "T00:00:00Z"))}{" "}
            · {text("先把今天安排好", "Organiser la journée")}
          </p>
        </div>
        <div className={styles.headerActions}>
          {view === "today" && (
            <>
              <button
                type="button"
                className={styles.button}
                disabled={!data}
                onClick={async () => {
                  if (!data) return;
                  try {
                    await navigator.clipboard.writeText(
                      dailyWorkbenchShareText(data, building?.display_name ?? "", locale),
                    );
                    setNotice(
                      text(
                        "房态摘要已复制，不含住客身份或收款信息。",
                        "Résumé copié, sans identité des voyageurs ni encaissements.",
                      ),
                    );
                  } catch {
                    setNotice(
                      text(
                        "复制失败，请检查浏览器剪贴板权限。",
                        "Copie impossible ; vérifier les droits du presse-papiers.",
                      ),
                    );
                  }
                }}
              >
                <Copy size={15} aria-hidden="true" />
                {text("复制房态", "Copier")}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!data}
                onClick={() => window.print()}
              >
                <Printer size={15} aria-hidden="true" />
                {text("打印", "Imprimer")}
              </button>
            </>
          )}
          {["admin", "rental_sales"].includes(userRole) && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => changeView("availability")}
            >
              <Plus size={16} aria-hidden="true" />
              {text("新建预订", "Nouvelle réservation")}
            </button>
          )}
        </div>
      </header>
      <div className={styles.viewbar}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label={text("日租工作视图", "Vues des locations courtes")}
        >
          {(
            [
              ["today", ListChecks, text("今日运营", "Aujourd'hui")],
              ["availability", Search, text("查空房", "Disponibilités")],
              ["timeline", Columns3, text("排房", "Planning")],
            ] as const
          ).map(([value, Icon, title]) => (
            <button
              type="button"
              key={value}
              role="tab"
              id={`${tabPrefix}-${value}`}
              aria-selected={view === value}
              aria-controls={stageId}
              className={cn(styles.tab, view === value && styles.activeTab)}
              onClick={() => changeView(value)}
            >
              <Icon size={16} aria-hidden="true" />
              {title}
            </button>
          ))}
        </div>
        <nav
          className={styles.archiveNav}
          aria-label={text("日租历史与分析", "Historique et analyse")}
        >
          <button
            type="button"
            aria-current={view === "history" ? "page" : undefined}
            onClick={() => changeView("history")}
          >
            {text("历史订单", "Historique")}
          </button>
          {["admin", "finance", "boss"].includes(userRole) && (
            <Link href={`${prefix}/daily-rentals/receipts`}>
              {text("收款分析 ↗", "Encaissements ↗")}
            </Link>
          )}
        </nav>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.buildingSelect}>
          <span>{text("楼栋", "Bâtiment")}</span>
          <select
            value={buildingId}
            onChange={(event) => {
              setBuildingId(event.target.value);
              setSelection(null);
              setAction(null);
            }}
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.freshness}>
          <span>
            {asOf
              ? `${text("更新于", "Actualisé à")} ${new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Abidjan" }).format(new Date(asOf))}`
              : text("页面读取快照", "Lecture à l'ouverture")}
          </span>
          <button
            type="button"
            className={styles.quietButton}
            onClick={() => {
              setAction(null);
              refresh();
            }}
            disabled={pending}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {text("刷新", "Actualiser")}
          </button>
        </div>
      </div>
      {view === "availability" && (
        <form className={styles.query} onSubmit={(event) => submitRange(event, "availability")}>
          <label className={styles.field}>
            {text("入住日期", "Date d'arrivée")}
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              required
            />
          </label>
          <label className={styles.field}>
            {text("离店日期", "Date de départ")}
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              required
            />
          </label>
          <button className={styles.primaryButton} type="submit">
            <Search size={15} aria-hidden="true" />
            {text("查询房间", "Rechercher")}
          </button>
        </form>
      )}
      {view === "history" && (
        <form className={styles.historyToolbar} onSubmit={(event) => submitRange(event, "history")}>
          <label className={styles.field}>
            {text("开始日期", "Début")}
            <input
              type="date"
              value={historyFrom}
              onChange={(event) => setHistoryFrom(event.target.value)}
              required
            />
          </label>
          <label className={styles.field}>
            {text("结束日期（不含）", "Fin (exclue)")}
            <input
              type="date"
              value={historyTo}
              onChange={(event) => setHistoryTo(event.target.value)}
              required
            />
          </label>
          <button type="submit" className={styles.button}>
            {text("查询记录", "Rechercher")}
          </button>
          {userRole === "admin" && (
            <button
              type="button"
              className={styles.button}
              disabled={!data}
              onClick={() => setAction({ unit: null, booking: null, date: today })}
            >
              {text("历史补录", "Rattrapage")}
            </button>
          )}
          <label className={styles.field}>
            {text("房号、住客或经办人", "Chambre, voyageur ou responsable")}
            <input
              type="search"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
          </label>
        </form>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {queryError && (
        <p className={styles.error} role="alert">
          {queryError}
        </p>
      )}
      {failed ? (
        <div className={styles.error} role="alert">
          {text(
            "读取失败，当前范围房态未知。未显示旧快照，请重试。",
            "Lecture impossible : disponibilité inconnue. Aucun ancien instantané affiché.",
          )}{" "}
          <button type="button" className={styles.button} onClick={refresh}>
            {text("重试", "Réessayer")}
          </button>
        </div>
      ) : !data ? (
        <div className={styles.empty} role="status">
          {text("正在读取实时房态与订单…", "Lecture de l'occupation et des séjours…")}
        </div>
      ) : (
        <section
          id={stageId}
          role={view === "history" ? "region" : "tabpanel"}
          aria-label={
            view === "history" ? text("历史住宿订单", "Historique des séjours") : undefined
          }
          aria-labelledby={view === "history" ? undefined : `${tabPrefix}-${view}`}
        >
          {view === "today" && counts && (
            <div
              className={styles.summary}
              aria-label={text("当前楼栋运营汇总", "Résumé opérationnel du bâtiment")}
            >
              {[
                [counts.arrivals, text("待入住 / 待核实", "Arrivées / à vérifier")],
                [counts.inhouse, text("当前在住", "En séjour")],
                [counts.departures, text("应退 / 待核实", "Départs / à vérifier")],
                [counts.cleaning, text("待保洁", "Ménage")],
              ].map(([value, label]) => (
                <div className={styles.stat} key={label}>
                  <strong className={styles.statValue}>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}
          {view === "availability" && (
            <p className={styles.resultSummary}>
              <strong>
                {dailyDateLabel(searchRange.from, locale)} —{" "}
                {dailyDateLabel(searchRange.to, locale)} ·{" "}
                {Math.round((Date.parse(searchRange.to) - Date.parse(searchRange.from)) / 86400000)}{" "}
                {text("晚", "nuits")}
              </strong>{" "}
              · {rooms.filter((room) => room.state === "ready").length}{" "}
              {text("间当前已就绪", "prêtes actuellement")}，
              {rooms.filter((room) => room.state === "conditional").length}{" "}
              {text("间待交接 / 复核", "à remettre / revérifier")}
            </p>
          )}
          <div className={styles.workspace}>
            {view === "today" && (
              <section className={styles.board} aria-label={text("今日运营任务", "Tâches du jour")}>
                <div className={styles.boardHeader}>
                  <div>
                    <h2>{text("今天需要处理", "À traiter aujourd'hui")}</h2>
                    <p className={styles.kicker}>
                      {text("按交房顺序安排，不让事情遗漏", "Organiser les remises sans oubli")}
                    </p>
                  </div>
                  <span className={styles.kicker}>{building?.display_name}</span>
                </div>
                <div className={styles.filters} aria-label={text("任务分类", "Types de tâches")}>
                  {filterNames.map(([value, title]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={filter === value}
                      className={cn(styles.filter, filter === value && styles.activeFilter)}
                      onClick={() => {
                        setFilter(value);
                        setSelection(null);
                      }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                {groups.map((kind) => (
                  <div key={kind}>
                    <div className={styles.groupTitle}>
                      <span>{groupName(kind)}</span>
                      <span>{tasks.filter((task) => task.kind === kind).length}</span>
                    </div>
                    {tasks
                      .filter((task) => task.kind === kind)
                      .map((task) => (
                        <button
                          type="button"
                          className={cn(
                            styles.task,
                            effectiveSelection?.unitId === task.unit.id &&
                              effectiveSelection.bookingId === (task.booking?.id ?? null) &&
                              styles.selectedTask,
                          )}
                          key={task.id}
                          onClick={() => choose(task.unit.id, task.booking?.id ?? null)}
                          aria-controls={inspectorId}
                          aria-pressed={
                            effectiveSelection?.unitId === task.unit.id &&
                            effectiveSelection.bookingId === (task.booking?.id ?? null)
                          }
                        >
                          <span className={styles.roomIcon}>
                            <DoorOpen size={18} aria-hidden="true" />
                          </span>
                          <span className={styles.taskBody}>
                            <span className={styles.taskTitle}>
                              {qualifiedUnitNo(task.unit)}
                              <small>
                                {task.booking
                                  ? dailyBookingIdentityLabel(task.booking, data, locale)
                                  : text("房间交接", "Remise de chambre")}
                              </small>
                            </span>
                            <span className={styles.taskMeta}>
                              {task.booking
                                ? `${dailyDateLabel(task.booking.check_in, locale)} — ${dailyDateLabel(task.booking.actual_check_out ?? task.booking.check_out, locale)}`
                                : text("未完成保洁任务", "Ménage non terminé")}
                              {task.customer
                                ? ` · ${text("经办", "Resp.")} ${task.customer.name}`
                                : ""}
                            </span>
                          </span>
                          <span className={styles.taskSide}>
                            <span
                              className={cn(
                                styles.tag,
                                task.kind === "cleaning" || task.kind === "review"
                                  ? styles.amberTag
                                  : task.kind === "inhouse"
                                    ? styles.greenTag
                                    : styles.blueTag,
                              )}
                            >
                              {task.booking
                                ? dailyStatusLabel(task.booking, today, locale)
                                : text("待保洁", "Ménage")}
                            </span>
                            <ChevronRight size={14} aria-hidden="true" />
                          </span>
                        </button>
                      ))}
                  </div>
                ))}
                {!tasks.length && (
                  <p className={styles.empty}>
                    {text("当前分类暂无待办。", "Aucune tâche dans cette catégorie.")}
                  </p>
                )}
                <p className={styles.inlineInfo}>
                  <Info size={14} aria-hidden="true" />
                  {text(
                    "同一间房可能同时待入住与待保洁；分类数量不能相加当作总房量。",
                    "Une chambre peut attendre arrivée et ménage ; ces nombres ne s'additionnent pas.",
                  )}
                </p>
              </section>
            )}
            {view === "availability" && (
              <section
                className={styles.board}
                aria-label={text("空房查询结果", "Résultats de disponibilité")}
              >
                <div className={styles.boardHeader}>
                  <h2>{text("可排期房间", "Chambres à planifier")}</h2>
                  <span className={styles.kicker}>{building?.display_name}</span>
                </div>
                {available.map((room) => (
                  <button
                    type="button"
                    className={cn(
                      styles.roomResult,
                      selectedUnit?.id === room.unit.id && styles.selectedTask,
                    )}
                    key={room.unit.id}
                    aria-pressed={selectedUnit?.id === room.unit.id}
                    onClick={() => choose(room.unit.id, null)}
                    aria-controls={inspectorId}
                  >
                    <span>
                      <span className={styles.resultLabel}>
                        {qualifiedUnitNo(room.unit)}
                        <small>{room.unit.layout ?? ""}</small>
                      </span>
                      <span className={styles.resultHint}>
                        {dailyReadinessLabel(room.reason, locale)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        styles.tag,
                        room.state === "ready" ? styles.greenTag : styles.amberTag,
                      )}
                    >
                      {room.state === "ready"
                        ? text("已就绪", "Prête")
                        : text("待交接 / 复核", "À revérifier")}
                    </span>
                  </button>
                ))}
                {!available.length && (
                  <p className={styles.empty}>
                    {text(
                      "此区间暂无可安排房间。",
                      "Aucune chambre disponible pour cette période.",
                    )}
                  </p>
                )}
                <details className={styles.searchReason}>
                  <summary>
                    {text("不可安排", "Indisponibles")} ·{" "}
                    {rooms.filter((room) => room.state === "blocked").length}
                  </summary>
                  {rooms
                    .filter((room) => room.state === "blocked")
                    .map((room) => (
                      <p key={room.unit.id}>
                        {qualifiedUnitNo(room.unit)} · {dailyReadinessLabel(room.reason, locale)}
                      </p>
                    ))}
                </details>
                <p className={styles.inlineInfo}>
                  <CalendarCheck size={14} aria-hidden="true" />
                  {text(
                    "入住日含、离店日不含；同日退住仍需退房与保洁检查。",
                    "Arrivée incluse, départ exclu ; une remise le même jour exige départ et ménage.",
                  )}
                </p>
              </section>
            )}
            {view === "timeline" && (
              <DailyWorkbenchTimeline
                data={data}
                from={timelineFrom}
                dayCount={dayCount}
                today={today}
                buildingLabel={building?.display_name ?? ""}
                locale={locale}
                selectedBookingId={selectedBooking?.id}
                inspectorId={inspectorId}
                onChoose={choose}
                onRangeChange={setTimelineFrom}
              />
            )}
            {view === "history" && (
              <section
                className={styles.board}
                aria-label={text("历史查询结果", "Résultats historiques")}
              >
                <div className={styles.boardHeader}>
                  <h2>{text("住宿记录", "Dossiers de séjour")}</h2>
                  <span className={styles.kicker}>
                    {history.length} {text("笔", "dossiers")}
                  </span>
                </div>
                <p className={styles.inlineInfo}>
                  {text(
                    "所选区间住宿记录，不含已取消订单；收款流水请进入收款分析。",
                    "Dossiers sur la période, hors annulations ; voir Encaissements pour les mouvements financiers.",
                  )}
                </p>
                {history.map((booking) => {
                  const unit = data.unitLookupUnits.find((row) => row.id === booking.unit_id);
                  return unit ? (
                    <button
                      type="button"
                      className={cn(
                        styles.task,
                        selectedBooking?.id === booking.id && styles.selectedTask,
                      )}
                      key={booking.id}
                      onClick={() => choose(unit.id, booking.id)}
                      aria-pressed={selectedBooking?.id === booking.id}
                      aria-controls={inspectorId}
                    >
                      <span className={styles.roomIcon}>
                        <CalendarDays size={18} />
                      </span>
                      <span className={styles.taskBody}>
                        <span className={styles.taskTitle}>
                          {qualifiedUnitNo(unit)}
                          <small>{dailyBookingIdentityLabel(booking, data, locale)}</small>
                        </span>
                        <span className={styles.taskMeta}>
                          {dailyDateLabel(booking.check_in, locale)} —{" "}
                          {dailyDateLabel(booking.actual_check_out ?? booking.check_out, locale)}
                        </span>
                      </span>
                      <span className={styles.tag}>{dailyStatusLabel(booking, today, locale)}</span>
                    </button>
                  ) : null;
                })}
                {!history.length && (
                  <p className={styles.empty}>
                    {text("所选条件没有住宿记录。", "Aucun dossier pour ces critères.")}
                  </p>
                )}
              </section>
            )}
            <div id={inspectorId} ref={inspectorRef}>
              <DailyWorkbenchInspector
                data={data}
                unit={selectedUnit}
                booking={selectedBooking}
                locale={locale}
                today={today}
                reason={view === "availability" ? selectedRoomResult?.reason : undefined}
                from={view === "availability" ? searchRange.from : today}
                to={view === "availability" ? searchRange.to : addDays(today, 1)}
                userRole={userRole}
                onOperate={operate}
              />
            </div>
          </div>
        </section>
      )}
      <footer className={styles.footer}>
        <span>
          {text(
            "仅统计当前账号可访问的当前楼栋；不把分类相加当作房间总数。",
            "Bâtiment actuel, selon vos droits ; les catégories ne constituent pas un total de chambres.",
          )}
        </span>
        <span>
          {today} · {text("阿比让时间", "Heure d'Abidjan")}
        </span>
      </footer>
      {action && data && (
        <DailyWorkbenchActions
          unit={action.unit}
          booking={action.booking}
          date={action.date}
          checkOut={action.checkOut}
          open
          onClose={() => setAction(null)}
          onChanged={() => {
            setAction(null);
            setSelection(null);
            refresh();
          }}
          locale={locale}
          userRole={userRole}
          buildingId={buildingId}
        />
      )}
    </div>
  );
}
