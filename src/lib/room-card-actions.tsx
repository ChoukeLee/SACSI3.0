"use client"

import {
  CalendarPlus, Home, BadgeDollarSign, LogIn, LogOut, DollarSign,
  FileText, Check, X, Wrench, MoreHorizontal, Eye, Info,
} from "lucide-react"
import type { RoomCardAction, RoomStatus } from "@/components/room-card"
import { routeFor } from "@/lib/i18n"
import type { Locale } from "@/lib/i18n"

export interface ActionContext {
  locale: Locale
  unitId?: string
  unitNo?: string
  // Route-based
  detailHref?: string
  dailyHref?: string
  leaseHref?: string
  saleHref?: string
  // Callback-based (take priority over href)
  onDetail?: () => void
  onNewDaily?: () => void
  onNewLease?: () => void
  onNewSale?: () => void
  onCheckIn?: () => void
  onCheckOut?: () => void
  onPayment?: () => void
  onCompleteCleaning?: () => void
  onCancel?: () => void
  onContract?: () => void
  onMaintenance?: () => void
}

function r(locale: Locale, path: string) { return routeFor(locale, path) }

export function getRoomCardActions(status: RoomStatus, ctx: ActionContext): RoomCardAction[] {
  const { locale, unitId } = ctx

  switch (status) {
    /* ══════ available ══════ */
    case "available":
      return [
        {
          key: "new-daily", label: locale === "zh" ? "新建日租" : "Jour",
          icon: CalendarPlus,
          onClick: ctx.onNewDaily,
          href: !ctx.onNewDaily ? r(locale, "/daily-rentals") : undefined,
        },
        {
          key: "new-lease", label: locale === "zh" ? "新增长租" : "Bail",
          icon: Home,
          onClick: ctx.onNewLease,
          href: !ctx.onNewLease ? r(locale, "/leases") : undefined,
        },
        {
          key: "new-sale", label: locale === "zh" ? "新增出售" : "Vente",
          icon: BadgeDollarSign,
          onClick: ctx.onNewSale,
          href: !ctx.onNewSale ? r(locale, "/sales") : undefined,
        },
      ]

    /* ══════ reserved / pending_review / confirmed ══════ */
    case "reserved":
      return [
        {
          key: "detail", label: locale === "zh" ? "详情" : "Détail",
          icon: Eye,
          onClick: ctx.onDetail,
          href: !ctx.onDetail && ctx.detailHref ? ctx.detailHref : !ctx.onDetail ? r(locale, `/units/${unitId ?? ""}`) : undefined,
        },
        {
          key: "check-in", label: locale === "zh" ? "入住" : "Arrivée",
          icon: LogIn,
          onClick: ctx.onCheckIn,
          href: !ctx.onCheckIn ? r(locale, "/daily-rentals") : undefined,
        },
        {
          key: "cancel", label: locale === "zh" ? "取消" : "Annuler",
          icon: X,
          onClick: ctx.onCancel,
          href: !ctx.onCancel ? r(locale, "/daily-rentals") : undefined,
        },
      ]

    /* ══════ daily_occupied / checked_in ══════ */
    case "daily_occupied":
    case "dailyOccupied":
      return [
        {
          key: "detail", label: locale === "zh" ? "详情" : "Détail",
          icon: Eye,
          onClick: ctx.onDetail,
          href: !ctx.onDetail && ctx.detailHref ? ctx.detailHref : !ctx.onDetail ? r(locale, `/units/${unitId ?? ""}`) : undefined,
        },
        {
          key: "payment", label: locale === "zh" ? "收款" : "Paiement",
          icon: DollarSign,
          onClick: ctx.onPayment,
          href: !ctx.onPayment ? r(locale, "/daily-rentals") : undefined,
        },
        {
          key: "check-out", label: locale === "zh" ? "退房" : "Départ",
          icon: LogOut,
          onClick: ctx.onCheckOut,
          href: !ctx.onCheckOut ? r(locale, "/daily-rentals") : undefined,
        },
      ]

    /* ══════ cleaning_pending ══════ */
    case "cleaning_pending":
    case "cleaningPending": {
      const actions: RoomCardAction[] = [
        {
          key: "complete-cleaning", label: locale === "zh" ? "完成保洁" : "Ménage fait",
          icon: Check,
          onClick: ctx.onCompleteCleaning,
        },
      ]
      if (!ctx.onCompleteCleaning) {
        actions.push({
          key: "detail", label: locale === "zh" ? "详情" : "Détail",
          icon: Info,
          onClick: ctx.onDetail,
          href: !ctx.onDetail && ctx.detailHref ? ctx.detailHref : r(locale, `/units/${unitId ?? ""}`),
        })
      }
      return actions
    }

    /* ══════ leased ══════ */
    case "leased":
      return [
        {
          key: "detail", label: locale === "zh" ? "详情" : "Détail",
          icon: Eye,
          onClick: ctx.onDetail,
          href: !ctx.onDetail && ctx.detailHref ? ctx.detailHref : !ctx.onDetail ? r(locale, `/units/${unitId ?? ""}`) : undefined,
        },
        {
          key: "payment", label: locale === "zh" ? "收款" : "Paiement",
          icon: DollarSign,
          onClick: ctx.onPayment,
          href: !ctx.onPayment ? r(locale, "/leases") : undefined,
        },
        {
          key: "contract", label: locale === "zh" ? "合同" : "Contrat",
          icon: FileText,
          onClick: ctx.onContract,
          href: !ctx.onContract ? r(locale, "/leases") : undefined,
        },
      ]

    /* ══════ sold ══════ */
    case "sold":
      return [
        {
          key: "detail", label: locale === "zh" ? "详情" : "Détail",
          icon: Eye,
          onClick: ctx.onDetail,
          href: !ctx.onDetail && ctx.detailHref ? ctx.detailHref : !ctx.onDetail ? r(locale, `/units/${unitId ?? ""}`) : undefined,
        },
        {
          key: "payment", label: locale === "zh" ? "回款" : "Paiement",
          icon: DollarSign,
          onClick: ctx.onPayment,
          href: !ctx.onPayment ? r(locale, "/sales") : undefined,
        },
        {
          key: "contract", label: locale === "zh" ? "合同" : "Contrat",
          icon: FileText,
          onClick: ctx.onContract,
          href: !ctx.onContract ? r(locale, "/sales") : undefined,
        },
      ]

    /* ══════ maintenance / locked ══════ */
    case "maintenance":
      return [
        {
          key: "detail", label: locale === "zh" ? "详情" : "Détail",
          icon: Eye,
          onClick: ctx.onDetail,
          href: !ctx.onDetail && ctx.detailHref ? ctx.detailHref : !ctx.onDetail ? r(locale, `/units/${unitId ?? ""}`) : undefined,
        },
        {
          key: "unlock", label: locale === "zh" ? "解除" : "Débloquer",
          icon: Wrench,
          onClick: ctx.onMaintenance,
          disabled: !ctx.onMaintenance,
        },
        {
          key: "more", label: locale === "zh" ? "更多" : "Plus",
          icon: MoreHorizontal,
          onClick: ctx.onDetail,
          href: !ctx.onDetail && ctx.detailHref ? ctx.detailHref : r(locale, `/units/${unitId ?? ""}`),
        },
      ]

    default:
      return []
  }
}
