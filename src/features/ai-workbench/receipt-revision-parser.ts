export type ReceiptRevisionPatch = Partial<{
  buildingCode: string;
  roomNo: string;
  amountXof: number;
  receiptDate: string;
  paidThroughDate: string | null;
  payerName: string | null;
  notes: string | null;
  paymentMethod: "cash" | "check" | "bank_transfer" | "offset" | "other";
  businessHint: "rent" | "property_fee";
}>;

const DATE = "(20\\d{2}-\\d{2}-\\d{2})";
const AMOUNT = "([\\d][\\d.,\\s]*)";

function scaledAmount(raw: string, unit = "") {
  const numeric = Number(raw.replace(/[,.\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const multiplier = /万|w/i.test(unit) ? 10_000 : /千|k/i.test(unit) ? 1_000 : 1;
  return numeric * multiplier;
}

function cleanCapturedText(value: string) {
  return value.trim().replace(/[。；;,，]+$/, "").slice(0, 1000);
}

export function parseReceiptRevisionInstruction(instruction: string): ReceiptRevisionPatch {
  const text = instruction.normalize("NFKC").trim();
  if (text.length < 2 || text.length > 500) throw new Error("修改说明应为 2 到 500 个字符。");
  const patch: ReceiptRevisionPatch = {};

  const building = text.match(/(?:楼栋|楼|building|immeuble)\s*(?:改成|改为|改到|为|:|：|au|à)?\s*(?:SACSI\s*)?(\d{1,2})/i);
  if (building) patch.buildingCode = `SACSI${Number(building[1])}`;

  const room = text.match(/(?:房号|房间|房|logement|chambre)\s*(?:改成|改为|改到|为|:|：|au|à)?\s*([A-Z0-9-]{1,20})/i);
  if (room) patch.roomNo = room[1].toUpperCase();

  const correctedNegatedAmount = text.match(new RegExp(`(?:金额|款项|总额)\\s*不是\\s*${AMOUNT}\\s*(?:万|千|w|k|xof|西法)?\\s*[,，;；]?\\s*(?:而?是|应为|应该是|实际是)\\s*${AMOUNT}\\s*(万|千|w|k|xof|西法)?`, "i"));
  const correctedAmount = correctedNegatedAmount ? [correctedNegatedAmount[0], correctedNegatedAmount[2], correctedNegatedAmount[3]] : null;
  const labelledAmount = correctedAmount ?? text.match(new RegExp(`(?:金额|款项|总额|montant)\\s*(?:改成|改为|调整为|应该是|应为|实际是|实际为|正确为|为|:|：|à)?\\s*${AMOUNT}\\s*(万|千|w|k|xof|西法)?`, "i"));
  const currencyAmount = labelledAmount ?? text.match(new RegExp(`${AMOUNT}\\s*(万|千|w|k|xof|西法)(?:\\b|元)?`, "i"));
  if (currencyAmount) {
    const amount = scaledAmount(currencyAmount[1], currencyAmount[2]);
    if (amount) patch.amountXof = amount;
  }

  const paidThrough = text.match(new RegExp(`(?:已缴至|缴至|付至|pay[ée]? jusqu(?:'|’)?au)\\s*(?:改成|改为|为|:|：|au|à)?\\s*${DATE}`, "i"));
  if (paidThrough) patch.paidThroughDate = paidThrough[1];
  if (/(?:取消|清空|去掉|supprime(?:r)?|efface(?:r)?).{0,8}(?:已缴至|缴至|付至|pay[ée]? jusqu)/i.test(text)) patch.paidThroughDate = null;

  const paymentDate = text.match(new RegExp(`(?:付款日期|收款日期|日期|date)\\s*(?:改成|改为|为|:|：|au|à)?\\s*${DATE}`, "i"));
  if (paymentDate) patch.receiptDate = paymentDate[1];

  const businessText = text
    .replace(/(?:付款人|支付人|payeur)\s*(?:改成|改为|为|:|：)?\s*([^,，;；。]{1,80})/gi, "")
    .replace(/(?:备注|note)\s*(?:改成|改为|为|:|：)?\s*([^;；。]{1,200})/gi, "");
  if (/(?:物业费|物管费|charges?)/i.test(businessText)) patch.businessHint = "property_fee";
  else if (/(?:租金|loyer)/i.test(businessText)) patch.businessHint = "rent";

  if (/(?:银行转账|转账|virement)/i.test(text)) patch.paymentMethod = "bank_transfer";
  else if (/(?:现金|esp[eè]ces?)/i.test(text)) patch.paymentMethod = "cash";
  else if (/(?:支票|ch[eè]que)/i.test(text)) patch.paymentMethod = "check";
  else if (/(?:抵扣|compensation)/i.test(text)) patch.paymentMethod = "offset";

  const payer = text.match(/(?:付款人|支付人|payeur)\s*(?:改成|改为|为|:|：)?\s*([^,，;；。]{1,80})/i);
  if (payer) patch.payerName = cleanCapturedText(payer[1]);

  const notes = text.match(/(?:备注|note)\s*(?:改成|改为|为|:|：)?\s*([^;；。]{1,200})/i);
  if (notes) patch.notes = cleanCapturedText(notes[1]);
  if (/(?:清空|删除|去掉|supprime(?:r)?|efface(?:r)?).{0,8}(?:备注|note)/i.test(text)) patch.notes = null;

  if (Object.keys(patch).length === 0) {
    throw new Error("暂时无法确定要修改的字段。请明确说明房号、金额、日期、付款方式、付款人、备注或租金/物业费。");
  }
  return patch;
}
