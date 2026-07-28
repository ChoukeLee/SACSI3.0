import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/Chouke/Desktop/SACSI3.0/outputs/handover_materials";
const workbook = Workbook.create();
const sheet = workbook.worksheets.add("交房物料清单");
sheet.showGridLines = false;

const items = [
  [1, "入户门钥匙", "Cle de la porte d'entree", 5, ""],
  [2, "卧室钥匙", "Cle de chambre", 6, ""],
  [3, "电梯卡", "Carte / badge d'ascenseur", 3, ""],
  [4, "好邻居钥匙；网络遥控器", "Cle Bon voisin ; telecommande reseau", 4, "3 + 1"],
];

function setValues(range, values) {
  sheet.getRange(range).values = values;
}

function border(range, preset = "all", color = "#B8B8B8", style = "thin") {
  sheet.getRange(range).format.borders = { preset, color, style };
}

function fill(range, color) {
  sheet.getRange(range).format.fill = color;
}

function font(range, opts) {
  sheet.getRange(range).format.font = opts;
}

function align(range, horizontal = "center", vertical = "center") {
  sheet.getRange(range).format.horizontalAlignment = horizontal;
  sheet.getRange(range).format.verticalAlignment = vertical;
}

sheet.getRange("A:A").format.columnWidth = 10;
sheet.getRange("B:B").format.columnWidth = 24;
sheet.getRange("C:C").format.columnWidth = 32;
sheet.getRange("D:D").format.columnWidth = 12;
sheet.getRange("E:E").format.columnWidth = 28;
sheet.getRange("A1:E1").format.rowHeight = 28;
sheet.getRange("A2:E4").format.rowHeight = 26;
sheet.getRange("A6:E6").format.rowHeight = 32;
sheet.getRange("A7:E11").format.rowHeight = 30;
sheet.getRange("A13:E16").format.rowHeight = 28;

sheet.getRange("A1:E1").merge();
setValues("A1", [["交房物料清单表 / Liste de reception des articles pour la remise des cles"]]);
font("A1", { bold: true, size: 16, color: "#111111" });
align("A1");

sheet.getRange("A2:B2").merge();
sheet.getRange("C2").merge();
sheet.getRange("D2").merge();
sheet.getRange("E2").merge();
sheet.getRange("A3:B4").merge();
sheet.getRange("C3:D4").merge();
sheet.getRange("E3:E4").merge();
setValues("A2:E4", [
  ["楼栋号 / Numero de batiment", "", "5#", "房号 / Logement", "1003"],
  ["业主姓名/租户姓名\nNom du proprietaire ou du locataire", "", "", "", "物料备注 / Note des articles\n入户门钥匙 / Cle de la porte d'entree\n室内门钥匙 / Cle interieure\n梯卡 / Carte ou badge d'ascenseur"],
  ["", "", "", "", ""],
]);
fill("A2:E4", "#F7F7F5");
font("A2:E4", { size: 10, color: "#222222" });
font("B2:D2", { bold: true, size: 13, color: "#111111" });
align("A2:E4");
sheet.getRange("A2:E4").format.wrapText = true;
border("A2:E4");

setValues("A6:E6", [["序号\nNo.", "名称", "Designation", "数量\nQuantite", "备注\nRemarques"]]);
fill("A6:E6", "#1F2937");
font("A6:E6", { bold: true, color: "#FFFFFF", size: 11 });
align("A6:E6");
sheet.getRange("A6:E6").format.wrapText = true;
border("A6:E11");

setValues("A7:E10", items);
font("A7:E10", { size: 11, color: "#111111" });
align("A7:A10");
align("D7:D10");
align("B7:C10", "left");
align("E7:E10", "left");
sheet.getRange("B7:E10").format.wrapText = true;

setValues("A11:E11", [["", "合计", "Total", null, ""]]);
sheet.getRange("D11").formulas = [["=SUM(D7:D10)"]];
font("A11:E11", { bold: true, size: 11, color: "#111111" });
fill("A11:E11", "#F3F4F6");
align("A11:E11");

sheet.getRange("A13:B13").merge();
sheet.getRange("C13:E13").merge();
sheet.getRange("A14:B14").merge();
sheet.getRange("C14:E14").merge();
sheet.getRange("A15:B15").merge();
sheet.getRange("C15:E15").merge();
sheet.getRange("A16:E16").merge();
sheet.getRange("A13").values = [["客户签字 / Signature du client"]];
sheet.getRange("C13").values = [["交付人签字 / Signature du remettant：李明杰"]];
sheet.getRange("A15").values = [["日期 / Date"]];
sheet.getRange("C15").values = [["2016-06-11"]];
sheet.getRange("A16").values = [["说明 / Note: 本表用于交房钥匙及物料交接确认。Ce formulaire confirme la remise des cles et des articles."]];
fill("A13:E16", "#FFFFFF");
font("A13:E16", { size: 11, color: "#111111" });
font("A13:C13", { bold: true, color: "#222222" });
font("A16:E16", { italic: true, size: 10, color: "#555555" });
align("A13:E16", "left");
sheet.getRange("A13:E16").format.wrapText = true;
border("A13:E16");

sheet.freezePanes.freezeRows(6);

const used = sheet.getRange("A1:E16");
used.format.borders = {
  insideHorizontal: { style: "thin", color: "#D0D0D0" },
  insideVertical: { style: "thin", color: "#D0D0D0" },
  top: { style: "medium", color: "#777777" },
  bottom: { style: "medium", color: "#777777" },
  left: { style: "medium", color: "#777777" },
  right: { style: "medium", color: "#777777" },
};

const inspect = await workbook.inspect({
  kind: "table",
  range: "交房物料清单!A1:E16",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const preview = await workbook.render({
  sheetName: "交房物料清单",
  range: "A1:E16",
  scale: 2,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "交房物料清单预览.png"), new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "交房物料清单_中法双语.xlsx"));
console.log(path.join(outputDir, "交房物料清单_中法双语.xlsx"));
