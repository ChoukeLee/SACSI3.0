export type Sacsi7Payment = {
  date: string;
  amount: number;
  currency?: "XOF" | "CNY";
  kind: "rent" | "deposit" | "sale";
  paidThrough?: string;
  note: string;
};

export type Sacsi7Lease = {
  unitNo: string;
  customer: string;
  monthlyRentXof: number;
  depositXof: number;
  startDate: string;
  expectedEndDate: string;
  payments: Sacsi7Payment[];
  masterUnits?: string[];
};

export type Sacsi7Sale = {
  unitNo: string;
  customer: string;
  totalAmountXof: number;
  signedDate?: string;
  planNote?: string;
  payments: Sacsi7Payment[];
};

export type Sacsi7OverdueRent = {
  unitNo: string;
  dueDate: string;
  amountXof: number;
  paidThrough: string;
};

const wan = (value: number) => Math.round(value * 10000);
const sale = (date: string, amountWan: number, note: string): Sacsi7Payment => ({ date, amount: wan(amountWan), kind: "sale", note });
const rent = (date: string, amountWan: number, paidThrough: string | undefined, note: string): Sacsi7Payment => ({ date, amount: wan(amountWan), kind: "rent", paidThrough, note });
const deposit = (date: string, amountWan: number, note: string): Sacsi7Payment => ({ date, amount: wan(amountWan), kind: "deposit", note });
const cny = (date: string, amount: number, kind: "rent" | "deposit" | "sale", note: string): Sacsi7Payment => ({ date, amount, currency: "CNY", kind, note });

export const SACSI7_SOURCE = "7号公寓.xlsx Sheet1 A1:J100";
export const SACSI7_AS_OF = "2026-07-22";
export const SACSI7_STOREFRONT_RENT_XOF = wan(120);

export const sacsi7OwnerOccupiedUnits = [
  { unitNo: "703", occupant: "李军" },
  { unitNo: "704", occupant: "李振咏" },
] as const;

export const sacsi7Leases: Sacsi7Lease[] = [
  { unitNo: "202", customer: "刘才生", monthlyRentXof: wan(140), depositXof: wan(280), startDate: "2026-07-01", expectedEndDate: "2026-12-31", payments: [] },
  { unitNo: "206", customer: "ABDOUL", monthlyRentXof: wan(115), depositXof: wan(230), startDate: "2026-01-23", expectedEndDate: "2026-12-31", payments: [
    deposit("2026-02-23", 230, "押金2个月，天逻转交"), rent("2026-02-23", 230, "2026-03-22", "租金2个月"),
    rent("2026-04-13", 115, "2026-04-22", "支票付天逻"), rent("2026-05-07", 115, "2026-05-22", "支票付天逻"),
    rent("2026-06-10", 115, "2026-06-22", "支票付天逻"), rent("2026-07-13", 115, "2026-07-22", "支票付天逻"),
  ] },
  { unitNo: "306", customer: "李文硕", monthlyRentXof: wan(115), depositXof: wan(230), startDate: "2026-04-17", expectedEndDate: "2026-12-31", payments: [
    deposit("2026-04-09", 230, "押金2个月"), rent("2026-04-09", 345, "2026-07-16", "租金3个月"),
  ] },
  { unitNo: "503", customer: "AIE", monthlyRentXof: wan(95), depositXof: wan(190), startDate: "2025-11-01", expectedEndDate: "2026-12-31", payments: [
    rent("2025-10-17", 95, "2025-11-30", "预付租金"), deposit("2025-10-27", 190, "押金2个月"),
    rent("2025-10-27", 95, "2025-12-31", "组合款中仅计明确租金，中介费未导入"),
    rent("2026-02-09", 95, "2026-01-31", "存高总账号"), rent("2026-03-18", 95, "2026-02-28", "存高总账号"),
    rent("2026-04-14", 90, "2026-03-31", "本次先付90万"), rent("2026-05-19", 5, "2026-03-31", "补付3月欠款5万"),
    rent("2026-05-19", 95, "2026-04-30", "付4月租金"),
  ] },
  { unitNo: "706", customer: "享通世贸", monthlyRentXof: 0, depositXof: 0, startDate: "2026-03-25", expectedEndDate: "2026-09-24", payments: [
    cny("2026-03-26", 15000, "rent", "人民币租金6个月，2500元/月"), cny("2026-04-27", 17000, "deposit", "人民币押金，微信付高峰"),
  ] },
  { unitNo: "801", customer: "余辉", monthlyRentXof: wan(140), depositXof: wan(280), startDate: "2025-10-10", expectedEndDate: "2026-10-09", payments: [
    rent("2025-10-03", 870, "2026-04-09", "与901合付1740万，按两套各半分配；押金280万为已报"),
    rent("2026-05-04", 840, "2026-10-09", "续付6个月"),
  ] },
  { unitNo: "805", customer: "LOKATOR", monthlyRentXof: wan(125), depositXof: wan(300), startDate: "2025-05-16", expectedEndDate: "2026-12-31", payments: [
    deposit("2025-05-07", 300, "押金已报300万"), rent("2025-05-07", 375, "2025-08-15", "按125万/月计3个月；中介部分未导入"),
    rent("2025-09-26", 375, "2025-11-15", "支票付3个月"), rent("2026-01-23", 375, "2026-02-15", "支票付3个月"),
    rent("2026-05-21", 375, "2026-05-15", "付3个月"), rent("2026-07-01", 375, "2026-08-15", "付3个月"),
  ] },
  { unitNo: "902", customer: "BOMBA", monthlyRentXof: wan(150), depositXof: wan(300), startDate: "2025-08-07", expectedEndDate: "2026-12-31", payments: [
    deposit("2025-08-01", 300, "押金2个月已报"), rent("2025-08-01", 450, "2025-11-06", "租金3个月；中介费未导入"),
    rent("2025-12-03", 450, "2026-02-06", "续付3个月"), rent("2026-04-07", 450, "2026-05-07", "续付3个月"),
    rent("2026-07-03", 450, "2026-08-07", "续付3个月"),
  ] },
  { unitNo: "906", customer: "刘海鹏王艺", monthlyRentXof: wan(125), depositXof: wan(250), startDate: "2025-11-01", expectedEndDate: "2026-12-31", payments: [
    deposit("2026-02-23", 250, "押金2个月，天逻转交"), rent("2026-02-23", 500, "2026-02-28", "租金4个月"),
    rent("2026-03-28", 250, "2026-04-30", "付天逻2个月"),
  ] },
  { unitNo: "1001", customer: "山东威海", monthlyRentXof: wan(150), depositXof: 0, startDate: "2026-03-30", expectedEndDate: "2026-09-19", payments: [] },
  { unitNo: "1003", customer: "范坤", monthlyRentXof: wan(115), depositXof: wan(230), startDate: "2026-04-05", expectedEndDate: "2026-10-04", payments: [
    deposit("2026-04-01", 230, "押金2个月"), rent("2026-04-01", 690, "2026-10-04", "租金6个月"),
  ] },
  { unitNo: "1101", customer: "7号楼办公室租户（资料待补）", monthlyRentXof: wan(1560), depositXof: wan(3120), startDate: "2025-09-01", expectedEndDate: "2026-12-31", masterUnits: [
    "1101", "1102", "1103", "1104", "1105", "1106", "1201", "1202", "1203", "1204", "1205", "1206",
  ], payments: [
    deposit("2025-09-11", 3120, "办公室整租押金2个月"), rent("2025-09-11", 4680, "2025-11-30", "办公室整租租金3个月"),
    rent("2026-02-07", 1560, "2025-12-31", "补付2025年12月办公室租金"), rent("2026-06-29", 4680, "2026-03-31", "付2026年第一季度办公室租金"),
  ] },
];

export const sacsi7Sales: Sacsi7Sale[] = [
  { unitNo: "101", customer: "罗玉新", totalAmountXof: wan(16000), signedDate: "2025-01-04", payments: [sale("2025-01-04",10000,"首付款"),sale("2025-01-08",6000,"尾款")] },
  { unitNo: "201", customer: "Anzoumana", totalAmountXof: wan(50000), planNote: "与203、205共同以土地款结算；未拆分到单套", payments: [] },
  { unitNo: "203", customer: "Anzoumana", totalAmountXof: 0, planNote: "与201、205共同以土地款结算；金额待拆分", payments: [] },
  { unitNo: "205", customer: "Anzoumana", totalAmountXof: 0, planNote: "与201、203共同以土地款结算；金额待拆分", payments: [] },
  { unitNo: "301", customer: "张馨月", totalAmountXof: wan(17000), signedDate: "2024-05-07", payments: [sale("2024-05-07",1000,"定金"),sale("2024-07-04",6945,"房款"),sale("2024-08-23",2190,"房款"),sale("2024-08-23",1865,"房款"),sale("2024-09-28",2000,"支票房款"),sale("2024-12-02",2000,"支票房款"),sale("2025-12-16",1000,"车位款")] },
  { unitNo: "302", customer: "YAPOBI", totalAmountXof: wan(19500), signedDate: "2024-06-07", payments: [sale("2024-06-07",19500,"全款支票")] },
  { unitNo: "303", customer: "DIALLO", totalAmountXof: wan(10466.2), signedDate: "2025-11-17", payments: [sale("2025-11-17",966.2,"房款"),sale("2026-03-23",9500,"支票房款")] },
  { unitNo: "304", customer: "KONE", totalAmountXof: wan(11500), signedDate: "2025-12-09", planNote: "含车位，尚未结清", payments: [sale("2025-12-09",1000,"房款"),sale("2026-02-25",3000,"存SACSI账号"),sale("2026-04-29",6500,"支票房款"),sale("2026-07-03",100,"车位预付款")] },
  { unitNo: "401", customer: "卢国平", totalAmountXof: wan(16500), signedDate: "2024-06-10", payments: [sale("2024-06-10",3000,"支票房款"),sale("2024-06-30",12500,"支票房款"),sale("2025-01-31",1000,"车位款")] },
  { unitNo: "402", customer: "申瑞来", totalAmountXof: wan(16500), signedDate: "2024-05-07", payments: [sale("2024-05-07",1000,"定金"),sale("2024-09-26",5000,"支票房款"),sale("2024-10-30",5000,"房款"),sale("2025-01-06",4500,"房款"),sale("2025-01-31",1000,"车位款")] },
  { unitNo: "403", customer: "CAMARA", totalAmountXof: wan(11555.725), signedDate: "2025-04-08", planNote: "含车位1000万；3月存取冲回未计入收入", payments: [sale("2025-04-08",11555.725,"最终存入SACSI账号")] },
  { unitNo: "404", customer: "KARIDIOULA", totalAmountXof: wan(10150), signedDate: "2025-12-05", payments: [sale("2025-12-05",500,"支票房款"),sale("2026-01-06",9650,"欧元折算房款")] },
  { unitNo: "501", customer: "李广吴刚启", totalAmountXof: wan(16233), signedDate: "2023-06-19", payments: [sale("2023-06-19",5000,"房款"),sale("2024-04-05",5000,"房款"),sale("2024-12-12",4700,"房款"),sale("2025-08-23",533,"房款"),sale("2025-09-17",1000,"车位款")] },
  { unitNo: "502", customer: "黄樱", totalAmountXof: wan(16500), signedDate: "2024-05-07", payments: [sale("2024-05-07",1000,"定金"),sale("2025-02-03",5200,"支票房款"),sale("2025-03-01",10300,"文具分红抵房款")] },
  { unitNo: "503", customer: "KOROUMA", totalAmountXof: wan(10245), signedDate: "2026-02-05", planNote: "已售后由AIE代租", payments: [sale("2026-02-05",10245,"全款")] },
  { unitNo: "504", customer: "AMARA", totalAmountXof: wan(11400), signedDate: "2024-11-05", planNote: "含车位1000万", payments: [sale("2024-11-05",1500,"房款"),sale("2024-11-21",4500,"现金房款"),sale("2024-11-22",2900,"房款")] },
  { unitNo: "506", customer: "FLAN", totalAmountXof: wan(13200), signedDate: "2023-08-16", payments: [sale("2023-08-16",1000,"房款"),sale("2023-11-13",500,"房款"),sale("2024-01-08",900,"房款"),sale("2024-02-06",600,"房款"),sale("2024-04-26",970,"房款"),sale("2024-06-21",700,"房款"),sale("2024-06-27",1500,"房款"),sale("2024-07-04",1530,"房款"),sale("2024-08-27",1000,"房款"),sale("2025-09-24",370,"房款")] },
  { unitNo: "601", customer: "KAKORO", totalAmountXof: wan(19500), signedDate: "2024-12-18", payments: [sale("2024-12-18",3000,"首付款，不含注册金30万"),sale("2024-12-27",3000,"支票房款"),sale("2025-01-28",3300,"支票房款"),sale("2025-01-31",3200,"支票房款"),sale("2025-06-17",6000,"两张支票"),sale("2025-08-16",1000,"房款")] },
  { unitNo: "602", customer: "高峰", totalAmountXof: wan(14200), payments: [sale("2024-01-01",6000,"原表仅登记6000万，具体日期待补"),sale("2024-02-09",1000,"车位款"),sale("2025-01-08",7200,"房款")] },
  { unitNo: "603", customer: "AIQI艾旗", totalAmountXof: wan(10600), signedDate: "2023-04-14", payments: [sale("2023-04-14",3600,"房款"),sale("2024-10-30",3000,"房款"),sale("2025-01-25",4000,"房款")] },
  { unitNo: "604", customer: "Kodjo", totalAmountXof: wan(9600), signedDate: "2023-04-20", payments: [sale("2023-04-20",1000,"房款")] },
  { unitNo: "606", customer: "KIKISSAGBE", totalAmountXof: wan(17700), signedDate: "2025-07-17", planNote: "转5号楼1003；代收过户税800万未计入房款", payments: [sale("2025-07-17",500,"预付款"),sale("2025-07-28",400,"房款"),sale("2025-08-18",300,"房款"),sale("2025-08-30",13840,"支票房款"),sale("2025-09-23",400,"房款"),sale("2025-10-02",120,"房款"),sale("2026-04-25",1638.4,"房款"),sale("2026-06-10",501.3,"房款"),sale("2026-06-13",0.7,"尾款")] },
  { unitNo: "701", customer: "陈颖", totalAmountXof: 0, signedDate: "2026-02-18", planNote: "人民币总价217.4万元，含车位1个", payments: [cny("2026-02-18",100000,"sale","人民币定金"),cny("2026-02-24",2074040,"sale","人民币房款")] },
  { unitNo: "702", customer: "陈定元", totalAmountXof: 0, signedDate: "2026-02-18", planNote: "人民币总价217.4万元", payments: [cny("2026-02-18",100000,"sale","人民币定金"),cny("2026-03-02",2074040,"sale","人民币房款")] },
  { unitNo: "802", customer: "TOURE", totalAmountXof: wan(21500), signedDate: "2025-01-08", planNote: "房款20600万+车位900万", payments: [sale("2025-01-08",21500,"全款")] },
  { unitNo: "806", customer: "COULIBALY", totalAmountXof: wan(15700), signedDate: "2026-02-14", payments: [sale("2026-02-14",15700,"全款支票")] },
  { unitNo: "901", customer: "何康", totalAmountXof: wan(18000), signedDate: "2025-12-18", payments: [sale("2025-12-18",6300,"上午付款"),sale("2025-12-18",10000,"下午付款"),sale("2025-12-20",1168,"房款"),sale("2025-12-20",532,"由原租金转房款")] },
  { unitNo: "904", customer: "刘建", totalAmountXof: wan(10203), signedDate: "2024-12-24", payments: [sale("2024-12-24",873.3,"房款"),sale("2025-01-13",5240.2,"房款"),sale("2025-01-14",4089.5,"房款")] },
  { unitNo: "905", customer: "AMICHIA", totalAmountXof: wan(17000), signedDate: "2025-03-11", planNote: "房款16000万+车位1000万", payments: [sale("2025-03-11",3000,"房款"),sale("2025-03-15",1000,"支票房款")] },
  { unitNo: "1002", customer: "ILENIA", totalAmountXof: wan(19928), signedDate: "2024-10-17", planNote: "由906换至1002", payments: [sale("2024-10-17",1500,"房款"),sale("2024-11-07",2000,"现金500+支票1500"),sale("2024-12-12",1500,"支票房款"),sale("2025-01-28",2000,"含欧元15000"),sale("2025-03-04",1500,"现金1000+支票500"),sale("2025-03-20",2000,"现金1500+支票500"),sale("2025-07-17",1500,"现金房款"),sale("2025-09-10",1500,"现金房款"),sale("2025-11-26",1000,"房款"),sale("2026-02-09",1000,"房款"),sale("2026-03-12",1000,"现金房款"),sale("2026-06-17",1000,"现金房款")] },
  { unitNo: "1004", customer: "DIALLO", totalAmountXof: wan(11792.14), signedDate: "2025-09-18", planNote: "房款11000万+代付过户税792.14万", payments: [sale("2025-09-18",6097.5,"支票房款"),sale("2025-09-24",5652.4,"房款")] },
  { unitNo: "1005", customer: "王勇", totalAmountXof: wan(12600), signedDate: "2023-01-03", payments: [sale("2023-01-03",3600,"房款"),sale("2023-01-30",500,"房款"),sale("2023-02-28",500,"房款"),sale("2023-04-01",500,"房款"),sale("2023-05-02",500,"房款"),sale("2023-07-31",500,"房款"),sale("2023-09-01",500,"房款"),sale("2023-10-28",1000,"房款"),sale("2024-02-26",1000,"房款"),sale("2024-03-11",2000,"人民币折算房款"),sale("2024-03-23",1000,"房款")] },
  { unitNo: "1006", customer: "曾灿明", totalAmountXof: wan(13900), signedDate: "2024-06-10", planNote: "前手王青云历史款已退，不导入", payments: [sale("2024-06-10",9000,"支票房款"),sale("2024-07-08",4900,"支票房款")] },
];

export const sacsi7TerminatedLeaseUnits = ["606", "1102", "1103", "1104", "1105", "1106", "1201", "1202", "1203", "1204", "1205", "1206"];

// Only amounts that are already due and still unpaid as of SACSI7_AS_OF.
// 206 is paid through 2026-07-22, so its next rent is not overdue yet.
export const sacsi7OverdueRentReceivables: Sacsi7OverdueRent[] = [
  { unitNo: "306", dueDate: "2026-07-17", amountXof: wan(115), paidThrough: "2026-07-16" },
  { unitNo: "503", dueDate: "2026-05-01", amountXof: wan(95), paidThrough: "2026-04-30" },
  { unitNo: "503", dueDate: "2026-06-01", amountXof: wan(95), paidThrough: "2026-04-30" },
  { unitNo: "503", dueDate: "2026-07-01", amountXof: wan(95), paidThrough: "2026-04-30" },
  { unitNo: "906", dueDate: "2026-05-01", amountXof: wan(125), paidThrough: "2026-04-30" },
  { unitNo: "906", dueDate: "2026-06-01", amountXof: wan(125), paidThrough: "2026-04-30" },
  { unitNo: "906", dueDate: "2026-07-01", amountXof: wan(125), paidThrough: "2026-04-30" },
  { unitNo: "1101", dueDate: "2026-04-01", amountXof: wan(1560), paidThrough: "2026-03-31" },
  { unitNo: "1101", dueDate: "2026-05-01", amountXof: wan(1560), paidThrough: "2026-03-31" },
  { unitNo: "1101", dueDate: "2026-06-01", amountXof: wan(1560), paidThrough: "2026-03-31" },
  { unitNo: "1101", dueDate: "2026-07-01", amountXof: wan(1560), paidThrough: "2026-03-31" },
];

export const sacsi7ExcludedCategories = [
  "中介费及负数支出", "退款及前租户历史", "物业费", "水电及过户预付费", "注册费", "过户税代收代付", "无日期或无法唯一拆分的金额",
];
