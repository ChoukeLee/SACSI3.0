import type { Locale } from "@/lib/i18n";
import type { UnitStatus } from "@/types/domain";

export const COPY = {
  zh: {
    noRooms: "暂无日租房源",
    timeline: "预订时间轴",
    subtitle: "默认显示今天附近日期；点击空白格新建预订，点击色条查看订单。",
    allRooms: "全部房间",
    day: "天",
    week: "周",
    month: "月",
    today: "今天",
    occupied: "入住",
    maintenance: "维修",
    available: "可预订",
    reserved: "预订",
    cleaning: "待保洁",
    openEnded: "未定离店",
    room: "房间",
    floor: "楼",
    unitCount: "间",
    apartment: "公寓",
    emptyFilter: "当前筛选下没有房间",
  },
  fr: {
    noRooms: "Aucune chambre journaliere",
    timeline: "Planning des reservations",
    subtitle: "Affiche les dates autour d'aujourd'hui. Cliquez une case vide pour creer.",
    allRooms: "Toutes",
    day: "Jour",
    week: "Semaine",
    month: "Mois",
    today: "Aujourd'hui",
    occupied: "Occupe",
    maintenance: "Maintenance",
    available: "Dispo",
    reserved: "Reserve",
    cleaning: "Menage",
    openEnded: "Ouvert",
    room: "Ch.",
    floor: "Etage",
    unitCount: "unités",
    apartment: "Appartement",
    emptyFilter: "Aucune chambre dans ce filtre",
  },
} as const;

export const UNIT_STATUS_LABELS: Record<Locale, Record<UnitStatus, string>> = {
  zh: {
    available: "可预订",
    reserved: "已预订",
    daily_occupied: "日租中",
    cleaning_pending: "待保洁",
    leased: "长租中",
    sold: "已售",
    maintenance: "维修",
    locked: "锁定",
  },
  fr: {
    available: "Disponible",
    reserved: "Reserve",
    daily_occupied: "Occupe",
    cleaning_pending: "Menage",
    leased: "Bail long",
    sold: "Vendu",
    maintenance: "Maintenance",
    locked: "Bloque",
  },
};

export const BOOKING_STATUS_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    pending_review: "待审核",
    confirmed: "已确认",
    checked_in: "已入住",
    checked_out: "已退房",
    cancelled: "已取消",
  },
  fr: {
    pending_review: "A valider",
    confirmed: "Confirme",
    checked_in: "Arrive",
    checked_out: "Parti",
    cancelled: "Annule",
  },
};

export type CalendarCopy = typeof COPY.zh;
