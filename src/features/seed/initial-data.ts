import type { Building, ModuleCard, Unit } from "@/types/domain";

export const activeBuilding: Building = {
  id: "sasci11",
  code: "SASCI11",
  displayName: "11#公寓",
  active: true,
  floorsAboveGround: 12,
  elevatorCount: 0
};

export const dailyRentalUnitNumbers = [
  "503",
  "505",
  "901",
  "902",
  "903",
  "905",
  "906",
  "1001",
  "1002",
  "1003",
  "1005",
  "1006",
  "1101",
  "1102",
  "1103",
  "1105",
  "1106",
  "1201",
  "1202",
  "1205",
  "1206"
];

export const sampleUnits: Unit[] = [
  {
    id: "sasci11-503",
    buildingCode: "SASCI11",
    unitNo: "503",
    floorLabel: "5F",
    kind: "apartment",
    status: "available",
    layout: "公寓",
    furnishing: "full",
    supports: ["daily_rental", "long_lease", "sale"],
    defaultDailyPriceXof: 40000
  },
  {
    id: "sasci11-901",
    buildingCode: "SASCI11",
    unitNo: "901",
    floorLabel: "9F",
    kind: "apartment",
    status: "reserved",
    layout: "公寓",
    furnishing: "full",
    supports: ["daily_rental", "long_lease", "sale"],
    defaultDailyPriceXof: 40000
  },
  {
    id: "sasci11-1105",
    buildingCode: "SASCI11",
    unitNo: "1105",
    floorLabel: "11F",
    kind: "apartment",
    status: "cleaning_pending",
    layout: "公寓",
    furnishing: "full",
    supports: ["daily_rental", "long_lease", "sale"],
    defaultDailyPriceXof: 40000
  },
  {
    id: "sasci11-206",
    buildingCode: "SASCI11",
    unitNo: "206",
    floorLabel: "2F",
    kind: "apartment",
    status: "leased",
    layout: "公寓",
    furnishing: "basic",
    supports: ["long_lease", "sale"]
  },
  {
    id: "sasci11-g-01",
    buildingCode: "SASCI11",
    unitNo: "G-01",
    floorLabel: "G",
    kind: "parking",
    status: "available",
    supports: ["sale"]
  }
];

export const moduleCards: ModuleCard[] = [
  {
    title: "11#房源总览",
    description: "主楼、车库、业务属性和房态管理",
    href: "/units",
    metric: "72户 + 车库",
    accent: "orange"
  },
  {
    title: "日租业务",
    description: "21间固定日租房、预订、入住、退房、保洁",
    href: "/daily-rentals",
    metric: "40,000 XOF/晚",
    accent: "green"
  },
  {
    title: "长租业务",
    description: "合同、应收、押金、退租结算",
    href: "/leases",
    metric: "按户型定价",
    accent: "ink"
  },
  {
    title: "出售业务",
    description: "出售合同、分期收款、过户跟进",
    href: "/sales",
    metric: "房源 + 车位",
    accent: "orange"
  }
];
