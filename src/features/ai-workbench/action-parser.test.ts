import { describe, expect, it } from "vitest";
import { parseWorkbenchAction } from "./action-parser";

describe("parseWorkbenchAction", () => {
  it.each([
    ["11#906保洁已完成", "SACSI11", "906"],
    ["完成11号楼1205的保洁", "SACSI11", "1205"],
    ["5栋805清洁好了", "SACSI5", "805"],
  ])("识别明确的完成保洁陈述：%s", (query, buildingCode, unitNo) => {
    expect(parseWorkbenchAction(query)).toMatchObject({
      action: "complete_daily_cleaning",
      buildingCode,
      unitNo,
      confidence: 0.98,
    });
  });

  it.each([
    ["ménage terminé au 11#906", "SACSI11", "906"],
    ["nettoyage fini 11#1205", "SACSI11", "1205"],
    ["la chambre 906 est nettoyée au 11#", "SACSI11", "906"],
    ["le ménage de la chambre 503 de la 5# est fait", "SACSI5", "503"],
  ])("reconnaît une déclaration de ménage terminé en français : %s", (query, buildingCode, unitNo) => {
    expect(parseWorkbenchAction(query)).toMatchObject({
      action: "complete_daily_cleaning",
      buildingCode,
      unitNo,
      confidence: 0.98,
    });
  });

  it.each([
    "查看11#906保洁是否完成",
    "11#906保洁完成了吗？",
    "完成906保洁",
    "今天有哪些房间待保洁",
    "est-ce que le ménage de 11#906 est terminé ?",
    "le ménage de la chambre 906 est-il terminé ?",
    "ménage à prévoir aujourd'hui",
  ])("不会把查询或缺少楼栋的输入识别为写操作：%s", (query) => {
    expect(parseWorkbenchAction(query)).toBeNull();
  });
});
