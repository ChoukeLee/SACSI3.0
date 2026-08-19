"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, UserX, UserCheck, X, Eye, Phone, Home, CreditCard, BedDouble, Star } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn, compareUnitNo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterBar, MetricGrid, SegmentedControl, StatTile, controlClass } from "@/components/ui/operational";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import type { CustomerRow } from "@/types/database";
import { createCustomer, updateCustomer } from "./actions";

export interface CustomerBuildingSummary {
  id: string;
  code: string;
  label: string;
}

interface CustomerListProps {
  customers: CustomerRow[];
  customerSegments?: {
    leaseCustomerIds: string[];
    saleCustomerIds: string[];
    dailyCustomerIds: string[];
  };
  customerRooms?: Record<string, string[]>;
  customerBuildings?: Record<string, CustomerBuildingSummary[]>;
  buildingOptions?: CustomerBuildingSummary[];
  customerLastActivity?: Record<string, string>;
  locale: Locale;
  showHeader?: boolean;
  canEdit?: boolean;
}

type FormMode = { type: "add" } | { type: "edit"; customer: CustomerRow } | null;
type CustomerSegment = "all" | "lease" | "sale" | "daily" | "blacklisted";
type CustomerGroup = "lease" | "sale" | "daily" | "uncategorized" | "blacklisted";

export function CustomerList({ customers, customerSegments, customerRooms, customerBuildings, buildingOptions, customerLastActivity, locale, showHeader = true, canEdit = true }: CustomerListProps) {
  const [optimisticCustomers, setOptimisticCustomers] = useState<CustomerRow[]>(customers);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<CustomerSegment>("all");
  const [buildingFilter, setBuildingFilter] = useState("__all__");
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formGender, setFormGender] = useState("");
  const [formDocType, setFormDocType] = useState("");
  const [formDocNo, setFormDocNo] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    setOptimisticCustomers(customers);
  }, [customers]);

  const segmentSets = useMemo(() => {
    const lease = new Set(customerSegments?.leaseCustomerIds ?? []);
    const sale = new Set(customerSegments?.saleCustomerIds ?? []);
    const daily = new Set(customerSegments?.dailyCustomerIds ?? []);
    return { lease, sale, daily };
  }, [customerSegments]);

  const stats = useMemo(() => ({
    lease: optimisticCustomers.filter((c) => segmentSets.lease.has(c.id)).length,
    sale: optimisticCustomers.filter((c) => segmentSets.sale.has(c.id)).length,
    dailyOnly: optimisticCustomers.filter((c) => segmentSets.daily.has(c.id) && !segmentSets.lease.has(c.id) && !segmentSets.sale.has(c.id)).length,
    blacklisted: optimisticCustomers.filter((c) => c.is_blacklisted).length,
    all: optimisticCustomers.length,
  }), [optimisticCustomers, segmentSets]);

  const customerGroup = (c: CustomerRow): CustomerGroup => {
    if (c.is_blacklisted) return "blacklisted";
    if (segmentSets.lease.has(c.id)) return "lease";
    if (segmentSets.sale.has(c.id)) return "sale";
    if (segmentSets.daily.has(c.id)) return "daily";
    return "uncategorized";
  };

  const primaryRoom = (customerId: string) => {
    const rooms = [...((customerRooms ?? {})[customerId] ?? [])].sort(compareUnitNo);
    return rooms[0] ?? "";
  };

  const primaryBuilding = (customerId: string) => {
    const buildings = customerBuildings?.[customerId] ?? [];
    return buildings[0] ?? null;
  };

  // Group-first, then by room number, recent activity and name.
  const sorted = useMemo(() => {
    const activity = customerLastActivity ?? {};
    const groupRank: Record<CustomerGroup, number> = {
      lease: 0,
      sale: 1,
      daily: 2,
      uncategorized: 3,
      blacklisted: 4,
    };
    return [...optimisticCustomers].sort((a, b) => {
      const aBuilding = primaryBuilding(a.id)?.label ?? "";
      const bBuilding = primaryBuilding(b.id)?.label ?? "";
      if (aBuilding !== bBuilding) return aBuilding.localeCompare(bBuilding);
      const groupOrder = groupRank[customerGroup(a)] - groupRank[customerGroup(b)];
      if (groupOrder !== 0) return groupOrder;
      const aRoom = primaryRoom(a.id);
      const bRoom = primaryRoom(b.id);
      if (aRoom || bRoom) {
        const roomOrder = compareUnitNo(aRoom || null, bRoom || null);
        if (roomOrder !== 0) return roomOrder;
      }
      const aAct = activity[a.id] ?? "";
      const bAct = activity[b.id] ?? "";
      if (aAct !== bAct) return bAct.localeCompare(aAct);
      return a.name.localeCompare(b.name);
    });
  }, [optimisticCustomers, segmentSets, customerRooms, customerBuildings, customerLastActivity]);

  const filteredBase = useMemo(() => {
    const s = search.toLowerCase().trim();
    const rooms = customerRooms ?? {};
    return sorted.filter((c) => {
      const group = customerGroup(c);
      if (segment === "lease" && group !== "lease") return false;
      if (segment === "sale" && group !== "sale") return false;
      if (segment === "daily" && group !== "daily") return false;
      if (segment === "blacklisted" && group !== "blacklisted") return false;
      if (s) {
        const nameMatch = c.name.toLowerCase().includes(s);
        const phoneMatch = c.phone?.includes(s) ?? false;
        const documentMatch = c.encrypted_document_no?.toLowerCase().includes(s) ?? false;
        const roomMatch = (rooms[c.id] ?? []).some((r) => r.toLowerCase().includes(s));
        if (!nameMatch && !phoneMatch && !documentMatch && !roomMatch) return false;
      }
      return true;
    });
  }, [sorted, search, segment, segmentSets, customerRooms]);

  const filtered = useMemo(() => {
    if (buildingFilter === "__all__") return filteredBase;
    return filteredBase.filter((customer) =>
      (customerBuildings?.[customer.id] ?? []).some((building) => building.id === buildingFilter)
    );
  }, [filteredBase, customerBuildings, buildingFilter]);

  const selected = selectedId ? optimisticCustomers.find((c) => c.id === selectedId) : null;
  const selectedRooms = selected ? [...((customerRooms ?? {})[selected.id] ?? [])].sort(compareUnitNo) : [];
  const selectedBuildings = selected ? (customerBuildings?.[selected.id] ?? []) : [];

  const customerTypeLabel = (c: CustomerRow) => {
    if (c.is_blacklisted) return locale === "zh" ? "黑名单" : "Liste noire";
    const tags: string[] = [];
    if (segmentSets.lease.has(c.id)) tags.push(locale === "zh" ? "长租" : "Location");
    if (segmentSets.sale.has(c.id)) tags.push(locale === "zh" ? "购房" : "Achat");
    if (segmentSets.daily.has(c.id)) tags.push(locale === "zh" ? "日租" : "Jour");
    return tags.join(" · ") || (locale === "zh" ? "未分类" : "Non classé");
  };

  const customerTypeTone = (c: CustomerRow): "default" | "secondary" | "destructive" | "outline" => {
    if (c.is_blacklisted) return "destructive";
    if (segmentSets.lease.has(c.id) || segmentSets.sale.has(c.id)) return "default";
    if (segmentSets.daily.has(c.id)) return "secondary";
    return "outline";
  };

  const resetForm = () => {
    setFormName(""); setFormGender(""); setFormDocType(""); setFormDocNo(""); setFormPhone(""); setFormNotes(""); setFormError("");
  };

  const openAdd = () => { resetForm(); setFormMode({ type: "add" }); setSelectedId(null); };
  const openEdit = (customer: CustomerRow) => {
    setFormName(customer.name); setFormGender(customer.gender ?? ""); setFormDocType(customer.document_type ?? "");
    setFormDocNo(""); setFormPhone(customer.phone ?? ""); setFormNotes(customer.notes ?? ""); setFormError("");
    setFormMode({ type: "edit", customer });
  };

  const buildOptimisticCustomer = (id: string, base?: CustomerRow): CustomerRow => {
    const now = new Date().toISOString();
    return {
      id,
      name: formName.trim(),
      gender: formGender || null,
      document_type: formDocType || null,
      encrypted_document_no: formDocNo || base?.encrypted_document_no || null,
      phone: formPhone || null,
      notes: formNotes || null,
      is_blacklisted: base?.is_blacklisted ?? false,
      blacklist_reason: base?.blacklist_reason ?? null,
      blacklist_operator_id: base?.blacklist_operator_id ?? null,
      blacklist_date: base?.blacklist_date ?? null,
      blacklist_permanent: base?.blacklist_permanent ?? false,
      created_at: base?.created_at ?? now,
      updated_at: now,
    };
  };

  const handleSave = async () => {
    if (!formName.trim() || formName.trim().length < 2) {
      setFormError(locale === "zh" ? "请输入客户姓名（至少2个字符）" : "Le nom doit comporter au moins 2 caractères");
      return;
    }
    setSaving(true); setFormError("");
    const previousCustomers = optimisticCustomers;
    if (formMode?.type === "add") {
      const tempId = `optimistic-customer-${Date.now()}`;
      const optimistic = buildOptimisticCustomer(tempId);
      setOptimisticCustomers((prev) => [optimistic, ...prev]);
      setFormMode(null); resetForm();
      const result = await createCustomer({ name: formName.trim(), gender: formGender || null, document_type: formDocType || null, document_no_plain: formDocNo || undefined, phone: formPhone || null, notes: formNotes || null });
      if (result.success && result.data) {
        setOptimisticCustomers((prev) => prev.map((customer) => customer.id === tempId ? result.data! : customer));
      } else {
        setOptimisticCustomers(previousCustomers);
        setFormMode({ type: "add" });
        setFormError(result.error ?? (locale === "zh" ? "操作失败。" : "Échec de l'opération."));
      }
    } else if (formMode?.type === "edit") {
      const original = formMode.customer;
      const optimistic = buildOptimisticCustomer(original.id, original);
      setOptimisticCustomers((prev) => prev.map((customer) => customer.id === original.id ? optimistic : customer));
      setFormMode(null); resetForm();
      const result = await updateCustomer(formMode.customer.id, { name: formName.trim(), gender: formGender || null, document_type: formDocType || null, document_no_plain: formDocNo || undefined, phone: formPhone || null, notes: formNotes || null });
      if (result.success && result.data) {
        setOptimisticCustomers((prev) => prev.map((customer) => customer.id === original.id ? result.data! : customer));
      } else {
        setOptimisticCustomers(previousCustomers);
        setFormMode({ type: "edit", customer: original });
        setFormError(result.error ?? (locale === "zh" ? "操作失败。" : "Échec de l'opération."));
      }
    }
    setSaving(false);
  };

  const isFormOpen = formMode !== null;

  const inputClass = cn("w-full", controlClass);
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";

  const t = {
    leaseClients: locale === "zh" ? "长租客户" : "Locataires",
    saleClients: locale === "zh" ? "购房客户" : "Acheteurs",
    dailyOnly: locale === "zh" ? "日租住客" : "Journaliers",
    blacklisted: locale === "zh" ? "黑名单" : "Liste noire",
    total: locale === "zh" ? "客户总数" : "Total",
    allTab: locale === "zh" ? "全部" : "Tous",
    leaseTab: locale === "zh" ? "长租客户" : "Locataires",
    saleTab: locale === "zh" ? "购房客户" : "Acheteurs",
    dailyTab: locale === "zh" ? "日租客户" : "Journaliers",
    blacklistTab: locale === "zh" ? "黑名单" : "Liste noire",
    search: locale === "zh" ? "搜索姓名 / 电话 / 证件 / 房号..." : "Rechercher nom / tél / pièce / chambre...",
    add: locale === "zh" ? "新增客户" : "Nouveau client",
    edit: locale === "zh" ? "编辑" : "Modifier",
    save: locale === "zh" ? "保存" : "Enregistrer",
    cancel: locale === "zh" ? "取消" : "Annuler",
    profile: locale === "zh" ? "查看档案" : "Profil",
    name: locale === "zh" ? "姓名" : "Nom",
    gender: locale === "zh" ? "性别" : "Genre",
    docType: locale === "zh" ? "证件类型" : "Pièce",
    docNo: locale === "zh" ? "证件号码" : "N° pièce",
    phone: locale === "zh" ? "手机号码" : "Téléphone",
    notes: locale === "zh" ? "备注" : "Remarques",
    male: locale === "zh" ? "男" : "Homme",
    female: locale === "zh" ? "女" : "Femme",
    other: locale === "zh" ? "其他" : "Autre",
    idCard: locale === "zh" ? "身份证" : "Carte d’identité",
    passport: locale === "zh" ? "护照" : "Passeport",
    driversLicense: locale === "zh" ? "驾照" : "Permis",
    blacklistAdd: locale === "zh" ? "加入黑名单" : "Ajouter à la liste noire",
    blacklistRemove: locale === "zh" ? "解除黑名单" : "Retirer de la liste noire",
    blacklistReason: locale === "zh" ? "拉黑原因" : "Motif",
    blacklistPermanent: locale === "zh" ? "永久" : "Permanent",
    blacklistTemporary: locale === "zh" ? "临时" : "Temporaire",
    blacklistDate: locale === "zh" ? "日期" : "Date",
    blacklistReason2: locale === "zh" ? "原因" : "Raison",
    blacklistWarnTitle: locale === "zh" ? "该客户已被加入黑名单" : "Ce client est sur la liste noire",
    blacklistWarnMessage: locale === "zh" ? "黑名单客户无法创建新的业务单据" : "Clients bloqués pour nouvelles transactions",
    docEncrypted: locale === "zh" ? "证件号将加密存储" : "Stockage chiffré",
    docKeepBlank: locale === "zh" ? "留空则保持原证件号不变" : "Laisser vide pour ne pas modifier",
    filtered: (n: number, total: number) => locale === "zh" ? `${n} / ${total} 位客户` : `${n} / ${total} clients`,
    empty: locale === "zh" ? "暂无客户数据" : "Aucun client",
    leaseTag: locale === "zh" ? "长租" : "Location",
    saleTag: locale === "zh" ? "购房" : "Achat",
    dailyTag: locale === "zh" ? "日租" : "Jour",
    rooms: locale === "zh" ? "关联房源" : "Chambres",
    allBuildings: locale === "zh" ? "全部楼栋" : "Tous batiments",
    noBuilding: locale === "zh" ? "未关联楼栋" : "Sans batiment",
    stableFirst: locale === "zh" ? "稳定客户优先" : "Stables en premier",
  };

  const statBlocks = [
    { key: "lease", label: t.leaseClients, value: String(stats.lease), dot: "bg-[#5E9BC5]" },
    { key: "sale", label: t.saleClients, value: String(stats.sale), dot: "bg-[#B88A48]" },
    { key: "daily", label: t.dailyOnly, value: String(stats.dailyOnly), dot: "bg-sky-500" },
    { key: "blacklisted", label: t.blacklisted, value: String(stats.blacklisted), dot: stats.blacklisted > 0 ? "bg-accentRed-500" : "bg-muted-foreground/40" },
    { key: "total", label: t.total, value: String(stats.all), dot: "bg-accentAmber-500" },
  ];

  const groupDefinitions: { key: CustomerGroup; label: string; dot: string }[] = [
    { key: "lease", label: t.leaseClients, dot: "bg-[#5E9BC5]" },
    { key: "sale", label: t.saleClients, dot: "bg-[#B88A48]" },
    { key: "daily", label: t.dailyOnly, dot: "bg-sky-500" },
    { key: "uncategorized", label: locale === "zh" ? "未分类客户" : "Non classés", dot: "bg-muted-foreground/40" },
    { key: "blacklisted", label: t.blacklisted, dot: "bg-accentRed-500" },
  ];

  const buildingTabs = [
    { value: "__all__", label: t.allBuildings, count: filteredBase.length },
    ...(buildingOptions ?? []).map((building) => ({
      value: building.id,
      label: building.label,
      count: filteredBase.filter((customer) =>
        (customerBuildings?.[customer.id] ?? []).some((item) => item.id === building.id)
      ).length,
    })),
  ];

  const activeBuildingGroups = buildingFilter === "__all__"
    ? [
        ...(buildingOptions ?? []).map((building) => ({
          building,
          customers: filtered.filter((customer) =>
            (customerBuildings?.[customer.id] ?? []).some((item) => item.id === building.id)
          ),
        })),
        {
          building: null,
          customers: filtered.filter((customer) => (customerBuildings?.[customer.id] ?? []).length === 0),
        },
      ]
    : [
        {
          building: (buildingOptions ?? []).find((building) => building.id === buildingFilter) ?? null,
          customers: filtered.filter((customer) =>
            (customerBuildings?.[customer.id] ?? []).some((item) => item.id === buildingFilter)
          ),
        },
      ];

  const visibleBuildingGroups = activeBuildingGroups
    .map((buildingGroup) => ({
      ...buildingGroup,
      businessGroups: groupDefinitions
        .filter((group) => segment === "all" || group.key === segment)
        .map((group) => ({
          ...group,
          customers: buildingGroup.customers.filter((customer) => customerGroup(customer) === group.key),
        }))
        .filter((group) => group.customers.length > 0),
    }))
    .filter((buildingGroup) => buildingGroup.businessGroups.length > 0);

  const renderCustomerCard = (c: CustomerRow) => {
    const isSelected = selectedId === c.id;
    const hasLease = segmentSets.lease.has(c.id);
    const hasSale = segmentSets.sale.has(c.id);
    const hasDaily = segmentSets.daily.has(c.id);
    const isStable = hasLease || hasSale;
    const rooms = [...((customerRooms ?? {})[c.id] ?? [])].sort(compareUnitNo);
    const buildings = customerBuildings?.[c.id] ?? [];

    return (
      <button
        key={c.id}
        onClick={() => {
          setSelectedId(isSelected ? null : c.id);
          setFormMode(null);
        }}
        className={cn(
          "flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all hover:shadow-md",
          c.is_blacklisted && "border-l-[3px] border-l-red-400 bg-red-50/40",
          isSelected && "ring-2 ring-ring",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-sm font-medium">
              {isStable && <Star className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              {c.name}
            </p>
            {c.gender && (
              <span className="text-[11px] text-muted-foreground">
                {c.gender === "male" ? t.male : c.gender === "female" ? t.female : t.other}
              </span>
            )}
          </div>
          {c.is_blacklisted ? (
            <Badge variant="destructive" className="shrink-0 text-[10px]">{t.blacklisted}</Badge>
          ) : (
            <Badge variant={customerTypeTone(c)} className="shrink-0 text-[10px]">{customerTypeLabel(c)}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {c.phone ? (
            <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>
          ) : (
            <span>-</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {buildings.map((building) => (
            <span key={building.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground/70">
              {building.label}
            </span>
          ))}
          {hasLease && <span className="rounded bg-[#DDECF7] px-1.5 py-0.5 text-[10px] font-medium text-[#2E6F9A]"><Home className="mr-0.5 inline h-3 w-3" />{t.leaseTag}</span>}
          {hasSale && <span className="rounded bg-[#EFE1CA] px-1.5 py-0.5 text-[10px] font-medium text-[#7B5A2B]"><CreditCard className="mr-0.5 inline h-3 w-3" />{t.saleTag}</span>}
          {hasDaily && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"><BedDouble className="mr-0.5 inline h-3 w-3" />{t.dailyTag}</span>}
          {c.is_blacklisted && <AlertTriangle className="h-3 w-3 text-red-500" />}
        </div>
        {rooms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {rooms.slice(0, 3).map((r) => (
              <span key={r} className="rounded bg-muted px-1 py-0 text-[10px] text-muted-foreground font-mono">{r}</span>
            ))}
            {rooms.length > 3 && <span className="text-[10px] text-muted-foreground">+{rooms.length - 3}</span>}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page chrome ── */}
      {showHeader && (
      <PageHeader
        title={locale === "zh" ? "客户管理" : "Gestion des clients"}
        description={`${stats.all} ${locale === "zh" ? "位客户" : "clients"} · ${locale === "zh" ? "按业务类型、房号和最近活动排序" : "Tries par activite, chambre et recence"}`}
        action={canEdit ? <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4" />{t.add}</Button> : undefined}
      />
      )}

      <MetricGrid columns={5}>
        {statBlocks.map(b => (
          <StatTile key={b.key} label={b.label} value={b.value} tone={b.key === "blacklisted" ? "red" : b.key === "lease" ? "leased" : b.key === "sale" ? "sold" : b.key === "daily" ? "blue" : "neutral"} />
        ))}
      </MetricGrid>

      <FilterBar
        meta={
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            className="w-full sm:w-[300px]"
          />
        }
      >
          <SegmentedControl
            value={segment}
            onChange={setSegment}
            ariaLabel={locale === "zh" ? "客户类型" : "Segments clients"}
            items={[
              { value: "all", label: t.allTab, count: stats.all },
              { value: "lease", label: t.leaseTab, count: stats.lease },
              { value: "sale", label: t.saleTab, count: stats.sale },
              { value: "daily", label: t.dailyTab, count: stats.dailyOnly },
              { value: "blacklisted", label: t.blacklistTab, count: stats.blacklisted },
            ]}
          />
          {buildingTabs.length > 1 && (
            <SegmentedControl
              value={buildingFilter}
              onChange={setBuildingFilter}
              ariaLabel={locale === "zh" ? "楼栋分类" : "Batiment"}
              items={buildingTabs}
            />
          )}
          <span className="pl-1 text-xs text-muted-foreground">
            {t.filtered(filtered.length, customers.length)}
            <span className="ml-2 text-[10px] opacity-60">{t.stableFirst}</span>
          </span>
      </FilterBar>

      {/* ── Blacklist warning banner ── */}
      {selected?.is_blacklisted && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span className="font-semibold text-red-700">{t.blacklistWarnTitle}</span>
          <span className="text-red-600">— {t.blacklistWarnMessage}</span>
        </div>
      )}

      {/* ── Customer cards list ── */}
      {filtered.length === 0 ? (
        <EmptyState title={t.empty} action={canEdit ? <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4" />{t.add}</Button> : undefined} />
      ) : (
        <div className="space-y-5">
          {visibleBuildingGroups.map((buildingGroup) => (
            <section key={buildingGroup.building?.id ?? "__no_building__"} className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <Home className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{buildingGroup.building?.label ?? t.noBuilding}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                    {buildingGroup.customers.length}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {locale === "zh" ? "按业务类型、房号、最近业务排序" : "Tri par type, chambre, activite"}
                </span>
              </div>
              {buildingGroup.businessGroups.map((group) => (
                <div key={`${buildingGroup.building?.id ?? "__no_building__"}-${group.key}`} className="space-y-2">
                  <div className="flex items-center gap-2 border-b border-border/70 pb-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", group.dot)} />
                    <h3 className="text-sm font-medium">{group.label}</h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                      {group.customers.length}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {group.customers.map(renderCustomerCard)}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {/* ── Selected detail drawer ── */}
      {selected && !isFormOpen && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={() => setSelectedId(null)} />
          <div className="fixed inset-x-0 bottom-0 z-panel max-h-[88vh] overflow-y-auto overflow-x-hidden rounded-t-xl border bg-card p-4 shadow-panel sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-lg sm:rounded-none sm:border-l">
            <div className="mb-4 flex items-start justify-between gap-3 border-b pb-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">{locale === "zh" ? "客户详情" : "Détail client"}</p>
                <h3 className="truncate text-base font-semibold">{selected.name}</h3>
              </div>
              <button onClick={() => setSelectedId(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5 text-sm">
              <p className="font-medium">{selected.name}</p>
              {selected.phone && <p className="text-muted-foreground"><Phone className="mr-1 inline h-3.5 w-3.5" />{selected.phone}</p>}
              {selected.gender && <p className="text-muted-foreground">{t.gender}: {selected.gender === "male" ? t.male : selected.gender === "female" ? t.female : t.other}</p>}
              {selected.document_type && <p className="text-muted-foreground">{t.docType}: {selected.document_type === "id_card" ? t.idCard : selected.document_type === "passport" ? t.passport : selected.document_type === "drivers_license" ? t.driversLicense : selected.document_type}</p>}
              {selected.notes && <p className="text-xs text-muted-foreground">{selected.notes}</p>}
              {selectedRooms.length > 0 && (
                <p className="text-xs text-muted-foreground">{t.rooms}: {selectedRooms.join(", ")}</p>
              )}
              {selectedBuildings.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {locale === "zh" ? "所属楼栋" : "Batiment"}: {selectedBuildings.map((building) => building.label).join(", ")}
                </p>
              )}
              {selected.is_blacklisted && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-2.5 text-xs">
                  <p className="font-semibold text-red-700">{t.blacklisted}</p>
                  {selected.blacklist_reason && <p className="text-red-600">{t.blacklistReason2}: {selected.blacklist_reason}</p>}
                  {selected.blacklist_date && <p className="text-red-500">{t.blacklistDate}: {selected.blacklist_date} · {selected.blacklist_permanent ? t.blacklistPermanent : t.blacklistTemporary}</p>}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={routeFor(locale, `/customers/${selected.id}`)}><Eye className="h-3.5 w-3.5" />{t.profile}</Link>
              </Button>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(selected)}>{t.edit}</Button>}
            </div>
            </div>
          </div>
        </>
      )}

      {/* ── Add/Edit Form Panel ── */}
      {canEdit && isFormOpen && (
        <>
          <div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={() => setFormMode(null)} />
          <div className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-full overflow-y-auto overflow-x-hidden border-l border-border bg-card shadow-panel lg:max-w-[480px]">
            <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
              <h3 className="text-[15px] font-semibold">{formMode.type === "add" ? t.add : t.edit}</h3>
              <button onClick={() => setFormMode(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.name} *</label><input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className={inputClass} placeholder={t.name} /></div>
              <div><label className={labelClass}>{t.gender}</label>
                <select value={formGender} onChange={(e) => setFormGender(e.target.value)} className={inputClass}>
                  <option value="">-</option><option value="male">{t.male}</option><option value="female">{t.female}</option><option value="other">{t.other}</option>
                </select>
              </div>
              <div><label className={labelClass}>{t.docType}</label>
                <select value={formDocType} onChange={(e) => setFormDocType(e.target.value)} className={inputClass}>
                  <option value="">-</option><option value="id_card">{t.idCard}</option><option value="passport">{t.passport}</option><option value="drivers_license">{t.driversLicense}</option>
                </select>
              </div>
              <div><label className={labelClass}>{t.docNo}</label>
                <input type="text" value={formDocNo} onChange={(e) => setFormDocNo(e.target.value)} className={inputClass} placeholder={formMode.type === "edit" ? t.docKeepBlank : t.docNo} />
                <p className="mt-1 text-[11px] text-muted-foreground">{formMode.type === "edit" ? t.docKeepBlank : t.docEncrypted}</p>
              </div>
              <div><label className={labelClass}>{t.phone}</label><input type="text" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className={inputClass} placeholder={t.phone} /></div>
              <div><label className={labelClass}>{t.notes}</label><textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={3} className={cn(inputClass, "resize-none overflow-hidden")} placeholder={t.notes} /></div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving}>{saving ? "..." : t.save}</Button>
                <Button variant="ghost" onClick={() => setFormMode(null)}>{t.cancel}</Button>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
