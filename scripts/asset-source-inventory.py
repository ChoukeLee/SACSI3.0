"""Read-only XLSX source inventory and identity reconciliation. Standard library only.

Source workbooks and the supplied system snapshot are never changed. All business
values are written only to --output-dir; do not commit generated inventories.
This is a source candidate inventory, not an occupancy or accounting import.
"""
import argparse
import collections
import hashlib
import json
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def read_xlsx(path):
    result = {"path": str(path.resolve()), "filename": path.name,
              "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "sheets": []}
    with zipfile.ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS):
                strings.append("".join(t.text or "" for t in si.iter("{" + NS["m"] + "}t")))
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = {e.attrib["Id"]: e.attrib["Target"] for e in
                ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        for item in workbook.find("m:sheets", NS):
            target = rels[item.attrib[RID]]
            target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            tree = ET.fromstring(archive.read(target))
            sheet = {"name": item.attrib["name"], "state": item.attrib.get("state", "visible"),
                     "rows": [], "merges": [e.attrib["ref"] for e in tree.findall("m:mergeCells/m:mergeCell", NS)]}
            for row in tree.findall("m:sheetData/m:row", NS):
                cells = []
                for cell in row.findall("m:c", NS):
                    raw = cell.find("m:v", NS)
                    value = raw.text if raw is not None else None
                    kind = cell.attrib.get("t")
                    if kind == "s" and value is not None:
                        value = strings[int(value)]
                    elif kind == "inlineStr":
                        value = "".join(t.text or "" for t in cell.findall("m:is//m:t", NS))
                    elif value is not None and kind not in ("e", "str"):
                        try:
                            value = float(value)
                            value = int(value) if value.is_integer() else value
                        except ValueError:
                            pass
                    formula = cell.find("m:f", NS)
                    if value is not None or formula is not None:
                        out = {"cell": cell.attrib["r"], "value": value}
                        if formula is not None:
                            out["formula"] = formula.text
                            out["formulaAttributes"] = formula.attrib
                        if kind == "e":
                            out["error"] = True
                        cells.append(out)
                if cells:
                    sheet["rows"].append({"row": int(row.attrib["r"]), "cells": cells})
            result["sheets"].append(sheet)
    return result


def text(value):
    return "" if value is None else str(value).strip()


def stable_id(value):
    return "SRC-" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def col(cell):
    return re.match(r"[A-Z]+", cell).group()


def range_bounds(value):
    a, _, b = value.partition(":")
    b = b or a
    x, y = re.fullmatch(r"([A-Z]+)(\d+)", a).groups()
    xx, yy = re.fullmatch(r"([A-Z]+)(\d+)", b).groups()
    return x, int(y), xx, int(yy)


def correction_cells(address):
    """Expand a bounded correction range, never a whole row or column."""
    if not isinstance(address, str) or not re.fullmatch(r"[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?", address):
        raise ValueError("invalid_correction_range")
    left, top, right, bottom = range_bounds(address)
    def index(label):
        value = 0
        for character in label:
            value = value * 26 + ord(character) - 64
        return value
    def label(value):
        result = ""
        while value:
            value, remainder = divmod(value - 1, 26)
            result = chr(65 + remainder) + result
        return result
    first, last = index(left), index(right)
    if first > last or top > bottom or last > 16384 or bottom > 1048576 or (last-first+1)*(bottom-top+1) > 10000:
        raise ValueError("invalid_correction_range")
    return [[label(column) + str(row) for column in range(first, last+1)] for row in range(top, bottom+1)]


def load_source_corrections(path, books):
    """Validate an evidence overlay. No source cell or workbook is mutated."""
    if path is None:
        return []
    document = json.loads(path.read_text(encoding="utf-8"))
    corrections = document.get("corrections") if isinstance(document, dict) else document
    if not isinstance(corrections, list) or any(not isinstance(item, dict) for item in corrections):
        raise ValueError("Corrections must be a JSON array or an object with corrections[]")
    by_hash = {book["sha256"]: book for book in books}
    result = []
    for position, item in enumerate(corrections):
        record = {**item, "applied": False, "cellChanges": []}
        record.setdefault("correctionId", "correction-" + str(position + 1))
        digest = text(item.get("fileHash")).lower()
        address = item.get("cell") or item.get("range")
        record["fileHash"] = digest
        try:
            if not re.fullmatch(r"[0-9a-f]{64}", digest) or digest not in by_hash:
                raise ValueError("source_hash_not_found")
            book = by_hash[digest]
            sheet = next((s for s in book["sheets"] if s["name"] == item.get("sheet")), None)
            if sheet is None:
                raise ValueError("source_sheet_not_found")
            grid = correction_cells(address)
            values = {c["cell"]: c["value"] for row in sheet["rows"] for c in row["cells"]}
            if "originalValue" not in item or "normalizedValue" not in item:
                raise ValueError("original_and_normalized_values_required")
            original, normalized = item["originalValue"], item["normalizedValue"]
            if isinstance(original, list):
                if (not isinstance(normalized, list) or len(original) != len(grid) or len(normalized) != len(grid)
                    or any(not isinstance(row, list) or len(row) != len(grid[0]) for row in original + normalized)):
                    raise ValueError("correction_matrix_shape_mismatch")
                changes = [{"cell":cell,"originalValue":original[y][x],"normalizedValue":normalized[y][x]}
                    for y,row in enumerate(grid) for x,cell in enumerate(row)]
            elif len(grid) == 1 and len(grid[0]) == 1:
                changes = [{"cell":grid[0][0],"originalValue":original,"normalizedValue":normalized}]
            elif address in sheet["merges"]:
                # A merged range owns one value; do not broadcast it to members.
                changes = [{"cell":grid[0][0],"originalValue":original,"normalizedValue":normalized}]
            else:
                raise ValueError("range_requires_matrix_or_exact_merged_anchor")
            if any(type(values.get(change["cell"])) is not type(change["originalValue"])
                   or values.get(change["cell"]) != change["originalValue"] for change in changes):
                raise ValueError("source_original_value_mismatch")
            record["sourceRef"] = {"fileHash":digest,"filename":book["filename"],"sheet":sheet["name"],"range":address}
            record["cellChanges"] = changes
            if item.get("status") != "confirmed":
                record["validationStatus"] = "pending_confirmation"
            elif not item.get("evidence"):
                record["validationStatus"] = "confirmation_evidence_required"
            else:
                record["validationStatus"] = "exact_source_original_match"
                record["applied"] = True
        except ValueError as error:
            record["validationStatus"] = str(error)
        result.append(record)
    owners = collections.defaultdict(list)
    for record in result:
        if record["applied"]:
            for change in record["cellChanges"]:
                owners[(record["fileHash"], record["sheet"], change["cell"])].append((record,change["normalizedValue"]))
    for matches in owners.values():
        if len({json.dumps(value, ensure_ascii=False, sort_keys=True) for _,value in matches}) > 1:
            for record,_ in matches:
                record["applied"] = False
                record["validationStatus"] = "conflicting_normalized_values"
    return result


def attach_source_corrections(assets, groups, corrections):
    """Expose overlays separately, including shared merged-cell scope."""
    by_id = {asset["candidateId"]:asset for asset in assets}
    for record in corrections:
        if not record["applied"]:
            continue
        for change in record["cellChanges"]:
            affected = set()
            for asset in assets:
                if any(row["source"]["fileHash"] == record["fileHash"] and row["source"]["sheet"] == record["sheet"]
                       and any(cell["cell"] == change["cell"] for cell in row["cells"]) for row in asset["rawRows"]):
                    affected.add(asset["candidateId"])
            for group in groups:
                if any(ref["fileHash"] == record["fileHash"] and ref["sheet"] == record["sheet"]
                       and any(change["cell"] in row for row in correction_cells(ref["range"])) for ref in group["sourceRefs"]):
                    group.setdefault("normalizedCorrections", []).append(record)
                    affected.update(group["memberCandidateIds"])
            for candidate_id in affected:
                overlay = {"correctionId":record["correctionId"],"sourceRef":record["sourceRef"], **change,
                    "status":record["status"],"evidence":record["evidence"],"reason":record.get("reason"),
                    "confirmedAt":record.get("confirmedAt"),"scope":record.get("scope"),
                    "applicationScope":"source_cell_or_shared_group_only_not_individual_financial_allocation"}
                by_id[candidate_id].setdefault("normalizedCorrections", []).append(overlay)


class Inventory:
    def __init__(self, sources):
        self.sources = sources
        self.assets = {}
        self.groups = []
        self.issues = []
        self.row_assets = collections.defaultdict(list)
        self.ignored = []

    def ref(self, book, sheet, start, end=None):
        rows = [r for r in sheet["rows"] if start <= r["row"] <= (end or start)]
        last = max((col(c["cell"]) for r in rows for c in r["cells"]), default="A")
        return {"fileHash": book["sha256"], "filename": book["filename"],
                "sheet": sheet["name"], "range": f"A{start}:{last}{end or start}"}

    def add(self, book, sheet, row, scope, locator, label, kind="apartment", building=None,
            owner=None, tenant=None, party=None, area=None, flags=(), source_kind="source_record",
            end=None, role_note=None):
        key = scope + "|" + locator
        ref = self.ref(book, sheet, row["row"], end)
        asset = self.assets.setdefault(key, {"candidateId": stable_id(key), "scope": scope,
            "sourceLocator": locator, "label": label, "kind": kind, "projectCode": "SACSI",
            "buildingCode": building, "unitNo": locator if building else None,
            "sourceRefs": [], "roles": [], "areaClaims": [], "rawRows": [],
            "reviewFlags": [], "groupIds": [], "match": {"status": "not_compared"}})
        if ref not in asset["sourceRefs"]:
            asset["sourceRefs"].append(ref)
            asset["rawRows"].append({"source": ref, "recordKind": source_kind,
                "cells": [c for r in sheet["rows"] if row["row"] <= r["row"] <= (end or row["row"]) for c in r["cells"]]})
        for role, value in (("owner", owner), ("tenant", tenant), ("unspecified_party", party)):
            if text(value):
                claim = {"role": role, "nameRaw": text(value), "source": ref,
                         "status": "source_claim_not_live_identity", "note": role_note}
                if claim not in asset["roles"]:
                    asset["roles"].append(claim)
        if area is not None:
            claim = {"raw": area, "source": ref}
            if isinstance(area, (int, float)):
                claim["areaSqm"] = area
            elif re.fullmatch(r"\d+(?:\.\d+)?\s*(?:㎡|M²|²)", text(area), re.I):
                claim["areaSqm"] = float(re.match(r"\d+(?:\.\d+)?", text(area)).group())
            asset["areaClaims"].append(claim)
        for flag in flags:
            if flag not in asset["reviewFlags"]:
                asset["reviewFlags"].append(flag)
        self.row_assets[(book["sha256"], sheet["name"], row["row"])].append(asset["candidateId"])
        return asset

    def issue(self, category, detail, refs=(), ids=(), priority="review"):
        self.issues.append({"issueId": stable_id(category + detail), "category": category,
            "priority": priority, "detail": detail, "sourceRefs": list(refs), "candidateIds": list(ids)})

    def group(self, kind, detail, members, refs, shared=None):
        members = sorted(set(members))
        item = {"groupId": stable_id(kind + detail + str(refs)), "kind": kind,
                "detail": detail, "memberCandidateIds": members, "sourceRefs": refs,
                "sharedCells": shared or [], "allocationAllowed": False}
        self.groups.append(item)
        for asset in self.assets.values():
            if asset["candidateId"] in members:
                asset["groupIds"].append(item["groupId"])
        return item

    def add_target_finance_findings(self, snapshot, target):
        buildings = {b["id"]: b for b in snapshot["buildings"]}
        units = {u["id"]: u for u in snapshot["units"]}
        targets = []
        for building, number in (("SACSI5", "1101"), ("SACSI5", "6F前楼"), ("SACSI11", "1205")):
            found = [u for u in units.values() if buildings[u["building_id"]]["code"] == building and u["unit_no"] == number]
            if len(found) != 1: continue
            unit = found[0]
            contracts = [c for c in snapshot.get("lease_contracts", []) if c["unit_id"] == unit["id"] and c["status"] != "terminated"]
            contract_ids = {c["id"] for c in contracts}
            payments = [p for p in target.get("payments", []) if p.get("unit_id") == unit["id"] and p.get("source_id") in contract_ids]
            receivables = [r for r in target.get("receivables", []) if r.get("unit_id") == unit["id"] and r.get("source_id") in contract_ids]
            # Facts are retained separately by currency and source_type. These
            # totals describe recorded rows; no unverified negative is retyped.
            buckets = collections.defaultdict(lambda: {"count": 0, "amount": 0})
            for p in payments:
                bucket = buckets[(p.get("currency"), p.get("source_type"))]
                bucket["count"] += 1
                bucket["amount"] += p["amount"]
            targets.append({"buildingCode": building, "unitNo": number, "unitId": unit["id"],
                "contracts": contracts, "paymentFacts": payments, "receivables": receivables,
                "recordedPaymentTotalsByCurrencyAndSourceType": [{"currency": k[0], "sourceType": k[1], **v} for k,v in buckets.items()],
                "scopeNote": "只含精确资产当前非terminated合同所关联付款；日租及其他客户历史不混入，不替代独立现金分类核验"})
        return {"snapshotAt": target.get("snapshot_at"), "targets": targets}

    def business_issues(self, standard, cutoff, target_review=None, corrections=()):
        def ref(book, sheet, cell_range):
            return {"fileHash": book["sha256"], "filename": book["filename"], "sheet": sheet, "range": cell_range}
        result = []
        def add(code, title, finding, action, refs, priority="review", ids=()):
            result.append({"issueId": code, "title": title, "detail": finding, "suggestedAction": action,
                "priority": priority, "sourceRefs": refs, "candidateIds": list(ids), "businessWritesAuthorized": False})
        targets = {(t["buildingCode"],t["unitNo"]): t for t in (target_review or {}).get("targets", [])}
        def live_summary(building, unit):
            target = targets.get((building, unit))
            if not target: return "未提供该资产的目标财务快照，实时付款状态待核。"
            contracts = []
            for c in target["contracts"]:
                currency = c.get("rent_currency") or "币种待核"
                rent = c.get("monthly_rent_amount") if c.get("monthly_rent_amount") is not None else c.get("monthly_rent_xof")
                deposit = c.get("deposit_amount_xof")
                deposit_text = "押金原币事实需另核，XOF槽值不能证明免押" if currency != "XOF" and deposit == 0 else ("押金未记录" if deposit is None else f"押金{deposit} XOF")
                months = c.get("deposit_months")
                months_text = "未记录" if months is None else str(months)
                contracts.append(f"月租{rent} {currency}，{deposit_text}、押月数{months_text}，已缴至{c.get('paid_through_date') or '未记录'}")
            labels = {"lease_rent":"租金", "lease_deposit":"押金"}
            payments = [f"{p.get('payment_date')} {labels.get(p.get('source_type'),p.get('source_type'))}{p.get('amount')} {p.get('currency')}" for p in target["paymentFacts"]]
            return "当前目标快照：" + "；".join(contracts) + "。同合同关联付款：" + ("；".join(payments) or "无关联记录，不能据此断言未付款") + "。"
        add("formula-4-e76", "4#代租汇总存在循环公式", "E76=SUM(E72:E76)引用自身，缓存85不能证明公式正确。", "核实应求和范围后在单独授权下修复；本次保留原文件。", [ref(standard,"4#公寓代租","E76")], "high")
        add("share-4", "4#服务费分配口径待确认", "已租汇总E3=967.2万、F3=50%、G3仍为967.2万；若服务费也按50%分，应为483.6万。", "确认服务费归属与分成规则，不能先改为数学推算数。", [ref(standard,"已租汇总","E3:G3")])
        add("share-11", "11#分配金额与两种常见规则都不一致", "C7年租22368万、D7物业1296万、E7服务570万、F7占比60%、G7为14752.8万；三项全乘60%为14540.4万，服务费全归属为14768.4万。", "逐项确认物业与服务费是否分成，再核对分配金额。", [ref(standard,"已租汇总","C7:G7")])
        front_correction = next((change for record in corrections if record["applied"]
            and record["fileHash"] == standard["sha256"] and record["sheet"] == "5#公寓"
            for change in record["cellChanges"] if change["cell"] == "C28"
            and re.search(r"美元|USD", text(change["normalizedValue"]), re.I)), None)
        if front_correction:
            add("front-floor-native-currency", "美元币种已确认，源表折算待核",
                "C28原￥符号为手误，按用户确认的规范值“" + text(front_correction["normalizedValue"]).replace("\n", " / ") +
                "”纠正解释；D28的183万折算值仍待核，不据此推算历史汇率。" + live_summary("SACSI5","6F前楼"),
                "后续按USD原币保留租金与付款事实；另核183万的折算依据，不新增或修改历史收款。原始Excel和rawRows保留原文，更正及证据单独保存。",
                [ref(standard,"5#公寓","C28:D30")], "review")
        else:
            add("front-floor-native-currency", "5#六楼原币与源表符号冲突", "5#C28写3200￥、D28组租183万。" + live_summary("SACSI5","6F前楼"), "以合同及美元原币付款保留事实，源表符号及组租金额标待核，不做历史汇率反推或重复入账。", [ref(standard,"5#公寓","C28:D30")], "high")
        add("lease-5-1101-rent", "5#1101源租金与当前合同不同", "源表D53月租140万。" + live_summary("SACSI5","1101"), "核对合同与源表更新时间；保留现有合同及实际付款，不按源标准自动覆盖。", [ref(standard,"5#公寓","A53:D53")], "high")
        add("lease-11-1205-payment", "11#1205源表新增押金与当前账务待核", "源表E80记9月30日押一租三340万、G80另记10月3日押金85万，源表覆盖截止写2027-01-03。" + live_summary("SACSI11","1205"), "查10月3日原始凭证及关联归属，同时核对覆盖截止日；不依据历史交接说法改系统，也不据缺失关联断言未付款。", [ref(cutoff,"11#公寓","A80:G80")], "high")
        add("dates-4-agency", "4#代租明细存在倒序日期及年份冲突", "J8写2025.11.01-2025.04.30；J95写2029.11.01-2026.12.31；F11付款日期2025.04.29与4#公寓E4对应2026.04.29不一致。", "以凭证核对具体年份，源文保留，不能批量自动修年。", [ref(cutoff,"4#代租明细","J8"),ref(cutoff,"4#代租明细","J95"),ref(cutoff,"4#代租明细","F11"),ref(cutoff,"4#公寓","E4")], "high")
        add("warehouse-old-27-rent", "老仓库27号费用与月租不同", "费用25万+税2.5万=27.5万，月租却列30万，年度360万。", "确认是否有调价或额外费用；不自动改为27.5万。", [ref(standard,"老仓库","A29:G29"),ref(cutoff,"老仓库等","A30:K30")])
        add("warehouse-new-6-rent", "新仓库6号费用与总计不同", "费用36万+税4万=40万，总计却列35万、年度420万；付款备注398万并带具体起租范围。", "核实优惠及期间折算依据，保留35万源值与398万付款文字，不把费用相加当实收。", [ref(standard,"新仓库","A7:G7"),ref(cutoff,"新仓库","H7")])
        add("warehouse-old-48-partitions", "老仓库48号需要正式分区编码", "同号有600㎡自用、75㎡及100㎡三条不同范围，已分别保留候选分区；当前代码以面积作临时定位。", "确认现场分区与是否包含关系，分配稳定子资产编号；不要按48号覆盖三条。", [ref(standard,"老仓库","A50:G52"),ref(cutoff,"老仓库等","A52:H54")])
        add("warehouse-tenancy-history", "同编号的历史租户不能形成重复资产", "老仓26、33、52及新仓13号的前后租户行已合并到同一候选资产，保留各条历史及退款原文。", "核对每段起止及交付事实；新增租户关系，不复制资产或自动覆盖当前房态。", [ref(cutoff,"老仓库等","A28:I29"),ref(cutoff,"老仓库等","A36:K37"),ref(cutoff,"老仓库等","A58:H60"),ref(cutoff,"新仓库","A14:J15")])
        add("group-rent-no-duplication", "整组租金和合并值禁止逐房重复计价", "7#1101—1206共享1560万；5#601—603共享租金；老仓34/35共享120万/月和1440万/年。部分姓名与付款也跨房合并。", "先确认组租覆盖，再给组合同；没有依据时不分配到每间或每号。", [ref(standard,"7#公寓","E62:E73"),ref(standard,"5#公寓","C28:D30"),ref(standard,"老仓库","F36:G37")], "high")
        add("ownership-agency-independent", "已售与代租属于独立关系", "4#同一房号出现买方/房东和租客付款、业主结算；已售仍可能持续代租。", "保留业主、租客和结算关系分别管理，不把出售自动改为空置或删掉租客。", [ref(standard,"4#公寓代租","A40:G46"),ref(cutoff,"4#公寓","A13:L23")])
        add("payment-through-vs-contract-end", "缴费覆盖期不能替代合同到期日", "4#104旧租期至2026-10-31，后记缴至2027-04-30；404代租旧租期至2026-10-31，后记缴至2026-12-31。", "续付款覆盖与正式续约分别核对；不能把旧租期当作停止收款或已完成续约。", [ref(cutoff,"4#公寓","C3:H4"),ref(cutoff,"4#公寓","C14:I15")])
        add("source-duplicates", "文件副本及重复汇总只读取一次", "4个文件为2组相同SHA256；已租汇总和汇总是重复汇总视图。", "按唯一哈希和明细范围统计，保留副本来源但不相加。", [], "info")
        add("special-asset-scope", "特殊场地、楼层和宿舍组需要确认资产范围", "特殊资产缺少与系统的精确身份映射；5#前三间房与前楼office、6#整层office、3#A座层级、孵化园多间组租和宿舍房号均有范围差异。", "按园区逐组确认边界、编号、管理方式及与现有系统单元的1对多关系；候选条数不等于确认实物数。", [], "review")
        add("warehouse-currency-review", "仓库试点租金币种暂不写入", "仓库月租列未逐项明示币种；组租、汽泡哥30000元年度/列位置、27号及新6优惠另待核。预备导入仅资产目录，monthlyRentNative和rentCurrency均留空。", "明确租金标准的币种、期间及组租规则后再补充财务档案，不以资产目录导入生成收款、应收或入住。", [], "review")
        return result

    def standards(self, book):
        for sh in book["sheets"]:
            name = sh["name"]
            rows = sh["rows"]
            for row in rows:
                n = row["row"]
                v = {col(c["cell"]): c["value"] for c in row["cells"]}
                raw = text(v.get("A"))
                if name in ("汇总", "已租汇总"):
                    continue
                if name == "3#公寓" and 2 <= n <= 64:
                    if n >= 17:
                        number = re.search(r"\d{3,4}", raw)
                        if number:
                            self.add(book, sh, row, "apartment-3-B", "B" + number.group(),
                                "3#公寓B座" + number.group(), building="SACSI3", party=v.get("B"))
                    elif n in (3, 4):
                        self.add(book, sh, row, "apartment-3-A", "first-floor-part-" + str(n - 2),
                            "3#公寓A座一层分区" + str(n - 2), kind="storefront", party=v.get("B"),
                            flags=("unconfirmed_storefront_alias",))
                    else:
                        self.add(book, sh, row, "apartment-3-A", "source-row-" + str(n),
                            "3#公寓A座/层级待核：" + raw, kind="floor_or_level", party=v.get("B"),
                            flags=("floor_to_rooms_unresolved", "duplicate_floor_label" if n in (7, 8) else "scope_requires_review"))
                elif name in ("4#公寓代租", "5#公寓", "6#公寓", "7#公寓", "11#公寓"):
                    number = {"4#公寓代租": 4, "5#公寓": 5, "6#公寓": 6, "7#公寓": 7, "11#公寓": 11}[name]
                    if name == "6#公寓": raw = text(v.get("B"))
                    hit = re.match(r"^(\d{3,4})(?:\D|$)", raw)
                    max_row = {4: 74, 5: 98, 6: 31, 7: 73, 11: 73}[number]
                    if n < (3 if number == 6 else 2) or n > max_row: continue
                    if hit:
                        locator = hit.group(1)
                        flags = []
                        if "\n" in raw and len(re.findall(r"\d{3,4}", raw)) > 1:
                            flags.append("ambiguous_multi_unit_label")
                        owner = v.get("B") if number == 4 else None
                        tenant = v.get("C") if number == 4 else None
                        party = v.get("C") if number in (5, 6) else v.get("B") if number in (7, 11) else None
                        self.add(book, sh, row, f"apartment-{number}", locator,
                            f"{number}#公寓{locator}", building="SACSI" + str(number),
                            owner=owner, tenant=tenant, party=party,
                            area=v.get("B") if number == 5 else None, flags=flags,
                            source_kind="asset_rent_standard", role_note="未标明角色的姓名不自动当作租客或房东")
                    elif raw and raw not in ("户型", "6号公寓", "房号"):
                        kind = "warehouse" if "仓库" in raw else "storefront" if "门面" in raw else "office_or_level"
                        self.add(book, sh, row, f"apartment-{number}-special", raw,
                            f"{number}#公寓{raw}", kind=kind, building="SACSI" + str(number),
                            party=v.get("B") if number == 4 else v.get("C"), flags=("special_kind_or_locator_review",))
                elif name in ("老仓库", "新仓库") and n >= 2 and raw:
                    if not re.fullmatch(r"\d+(?:\.\d+)?", raw): continue
                    scope = "old-warehouse" if name == "老仓库" else "new-warehouse"
                    locator = raw
                    flags = []
                    if scope == "old-warehouse" and raw == "48":
                        locator += "|partition-" + text(v.get("C")) + "sqm"
                        flags = ["same_number_distinct_partition", "partition_identifier_provisional"]
                    self.add(book, sh, row, scope, locator, name + raw + ("（" + text(v.get("C")) + "㎡分区）" if flags else ""),
                        kind="warehouse", tenant=v.get("B"), area=v.get("C"), flags=flags,
                        source_kind="warehouse_rent_standard")
                elif name == "老公司出租" and n in (2, 3):
                    self.add(book, sh, row, "old-company", "dormitory" if n == 2 else "office", raw,
                        kind="dormitory" if n == 2 else "office", tenant=v.get("B"), flags=("site_locator_unconfirmed",))
                elif name == "孵化园" and re.fullmatch(r"[AB]\d{2}", raw):
                    self.add(book, sh, row, "incubator", raw, "孵化园" + raw, kind="warehouse",
                        tenant=v.get("B"), source_kind="incubator_rent_standard")
            if name in ("汇总", "已租汇总"):
                self.ignored.append({"fileHash": book["sha256"], "sheet": name,
                    "reason": "aggregate_view_not_additional_assets; summary-only labels retained as claims"})
            self.merge_groups(book, sh)
        # Keep uniquely named sites which occur only in the summary, without
        # treating the duplicated summary or aggregate building rows as assets.
        sh = next(s for s in book["sheets"] if s["name"] == "已租汇总")
        for row in sh["rows"]:
            n = row["row"]
            if n == 13:
                self.add(book, sh, row, "incubator", "dormitory-summary-unresolved", "孵化园宿舍（汇总范围待核）",
                    kind="dormitory_group", flags=("summary_only", "dormitory_group_overlap_unresolved"), source_kind="summary_claim")

    def cutoffs(self, book):
        for sh in book["sheets"]:
            name = sh["name"]
            rows = sh["rows"]
            anchors = []
            for index, row in enumerate(rows):
                n = row["row"]
                v = {col(c["cell"]): c["value"] for c in row["cells"]}
                raw = text(v.get("A"))
                if n <= (2 if name == "孵化园" else 1) or not raw: continue
                if name in ("3#公寓", "4#公寓", "7#公寓", "11#公寓", "4#代租明细"):
                    number = {"3#公寓": 3, "4#公寓": 4, "7#公寓": 7, "11#公寓": 11, "4#代租明细": 4}[name]
                    hit = re.search(r"\d{3,4}", raw)
                    if hit:
                        locator = ("B" if number == 3 else "") + hit.group()
                        scope = f"apartment-{number}" + ("-B" if number == 3 else "")
                        anchors.append((row, scope, locator, f"{number}#公寓" + ("B座" if number == 3 else "") + hit.group(), "apartment", "SACSI" + str(number), v))
                    elif number in (3, 4) and ("门面" in raw or "仓库" in raw):
                        anchors.append((row, f"apartment-{number}-special", raw, f"{number}#公寓" + raw,
                            "warehouse" if "仓库" in raw else "storefront", "SACSI" + str(number), v))
                elif name in ("老仓库等", "新仓库"):
                    if re.fullmatch(r"\d+(?:\.\d+)?", raw):
                        scope = "old-warehouse" if name == "老仓库等" else "new-warehouse"
                        locator = raw
                        if scope == "old-warehouse" and raw == "48":
                            locator += "|partition-" + text(v.get("C")) + "sqm"
                        anchors.append((row, scope, locator, ("老仓库" if scope == "old-warehouse" else "新仓库") + raw,
                            "warehouse", None, v))
                    elif name == "老仓库等":
                        locators = {64: ("industrial-sites", "alloukoi-factory-2", "ALLOUKOI 2#厂房"),
                            66: ("industrial-sites", "alloukoi-factory-3", "ALLOUKOI 3#厂房"),
                            69: ("industrial-sites", "ousen-factory", "欧森工厂"),
                            72: ("industrial-sites", "factory-4067sqm", "4067㎡厂房"),
                            75: ("industrial-sites", "agame-shop", "阿佳美店"),
                            77: ("industrial-sites", "guoji-site", "国基租赁场地"),
                            83: ("industrial-sites", "site-1400sqm", "1400㎡共同经营场地"),
                            91: ("industrial-sites", "dingsheng-factory", "鼎盛食品厂"),
                            94: ("old-company", "dormitory", "老公司宿舍"),
                            97: ("old-company", "office", "老公司办公室")}
                        if n in locators:
                            scope, locator, label = locators[n]
                            anchors.append((row, scope, locator, label, "industrial_site" if scope == "industrial-sites" else locator, None, v))
                elif name == "VALLON" and n in (2, 23, 48, 67, 68):
                    locator = {2: "hotel", 23: "supermarket", 48: "barbecue", 67: "fresh-store-history-unresolved", 68: "fresh-store-history-unresolved"}[n]
                    anchors.append((row, "vallon", locator, "VALLON " + ("火锅店/三得利生鲜（历史关系待核）" if n in (67, 68) else raw), "commercial_site", None, v))
                elif name == "孵化园":
                    if re.fullmatch(r"[AB]\d{2}", raw):
                        anchors.append((row, "incubator", raw, "孵化园" + raw, "warehouse", None, v))
                    elif "宿舍" in raw:
                        anchors.append((row, "incubator-dormitory", "308" if "308" in raw else "source-group-row-" + str(n),
                            "孵化园" + raw + "（源表行" + str(n) + "）", "dormitory_group", None, v))
            for i, item in enumerate(anchors):
                row, scope, locator, label, kind, building, v = item
                next_row = anchors[i + 1][0]["row"] if i + 1 < len(anchors) else max(r["row"] for r in rows) + 1
                end = next_row - 1
                # Do not attach footer totals to the last asset.
                if name == "孵化园": end = min(end, 63)
                if name == "7#公寓": end = min(end, 53)
                flags = []
                owner = tenant = party = None
                if name == "4#代租明细": owner, tenant = v.get("B"), v.get("C")
                elif name == "4#公寓":
                    sale_row = isinstance(v.get("G"), (int, float)) and v.get("L") is not None
                    owner, tenant = (v.get("B"), None) if sale_row else (None, v.get("B"))
                elif name == "7#公寓":
                    sale_row = isinstance(v.get("E"), (int, float)) and v.get("K") is not None
                    owner, tenant = (v.get("C"), None) if sale_row else (None, v.get("C"))
                elif name == "11#公寓": party = v.get("C")
                else: tenant = v.get("B")
                if "48|partition" in locator: flags.extend(("same_number_distinct_partition", "partition_identifier_provisional"))
                if scope == "vallon" and locator == "fresh-store-history-unresolved": flags.append("possible_historical_tenant_change_requires_identity_review")
                if scope == "incubator-dormitory": flags.extend(("dormitory_room_numbers_missing_or_scope_unconfirmed", "no_invented_individual_room_ids"))
                if kind != "apartment": flags.append("special_site_identity_requires_review")
                asset = self.add(book, sh, row, scope, locator, label, kind, building,
                    owner=owner, tenant=tenant, party=party, area=v.get("C") if name in ("老仓库等", "新仓库", "孵化园") else v.get("B") if name in ("7#公寓", "11#公寓") else None,
                    flags=flags, source_kind="owner_settlement" if name == "4#代租明细" else "mixed_business_history", end=end)
                # Continuation rows are connected to the same asset, without
                # creating another asset for payments or an owner/buyer record.
                for r in range(row["row"] + 1, end + 1):
                    self.row_assets[(book["sha256"], name, r)].append(asset["candidateId"])
            self.merge_groups(book, sh)

    def merge_groups(self, book, sh):
        cells = {c["cell"]: c for r in sh["rows"] for c in r["cells"]}
        for merge in sh["merges"]:
            x, y, xx, yy = range_bounds(merge)
            anchor = x + str(y)
            if y == yy or anchor not in cells: continue
            members = [a for n in range(y, yy + 1) for a in self.row_assets.get((book["sha256"], sh["name"], n), [])]
            if not members: continue
            self.group("merged_source_cells", f"{sh['name']}!{merge}: 合并值只属于该范围，禁止逐资产重复计价或自动分摊", members,
                [{"fileHash": book["sha256"], "filename": book["filename"], "sheet": sh["name"], "range": merge}], [cells[anchor]])

    def add_summary_claims(self, book):
        sh = next(s for s in book["sheets"] if s["name"] == "已租汇总")
        mapping = {14:("industrial-sites","alloukoi-factory-2"),15:("industrial-sites","alloukoi-factory-3"),
            16:("industrial-sites","ousen-factory"),17:("industrial-sites","factory-4067sqm"),18:("industrial-sites","guoji-site"),
            19:("industrial-sites","agame-shop"),20:("industrial-sites","site-1400sqm"),21:("industrial-sites","dingsheng-factory"),
            22:("vallon","supermarket"),23:("vallon","fresh-store-history-unresolved"),24:("vallon","hotel"),25:("vallon","barbecue")}
        for row in sh["rows"]:
            if row["row"] in mapping:
                scope, locator = mapping[row["row"]]
                asset = self.assets.get(scope + "|" + locator)
                if asset:
                    self.add(book, sh, row, scope, locator, asset["label"], asset["kind"],
                        flags=("summary_amount_is_forecast_or_share_not_cash",), source_kind="summary_claim_existing_asset")

    def reconcile(self, snapshot):
        projects = {p["id"]: p for p in snapshot["projects"]}
        buildings = {b["id"]: b for b in snapshot["buildings"]}
        customers = {c["id"]: c["name"] for c in snapshot.get("customers", [])}
        index = collections.defaultdict(list)
        for unit in snapshot["units"]:
            b = buildings[unit["building_id"]]
            index[(projects[b["project_id"]]["code"], b["code"], unit["unit_no"], unit["kind"])].append(unit)
        matched = set()
        suggested = set()
        for asset in self.assets.values():
            key = ("SACSI", asset["buildingCode"], asset["unitNo"], asset["kind"])
            hits = index.get(key, []) if asset["buildingCode"] else []
            if len(hits) == 1 and asset["kind"] == "apartment" and "ambiguous_multi_unit_label" not in asset["reviewFlags"]:
                unit = hits[0]
                matched.add(unit["id"])
                asset["match"] = {"status": "exact_project_building_unit_kind", "systemUnitId": unit["id"],
                    "basis": "SACSI项目 + 楼栋code + 精确unit_no + apartment kind"}
                asset["system"] = {k: unit.get(k) for k in ("id", "code", "kind", "asset_subtype", "unit_no", "status", "area_sqm", "floor_label", "updated_at")}
                asset["system"]["leaseContracts"] = [{k: c.get(k) for k in ("id", "status", "start_date", "expected_end_date", "paid_through_date", "rent_currency", "monthly_rent_amount", "monthly_rent_xof", "customer_id")} | {"customerName": customers.get(c.get("customer_id"))} for c in snapshot.get("lease_contracts", []) if c["unit_id"] == unit["id"]]
                asset["system"]["saleContracts"] = [{k:c.get(k) for k in ("id", "status", "customer_id")} | {"customerName":customers.get(c.get("customer_id"))} for c in snapshot.get("sale_contracts", []) if c["unit_id"] == unit["id"]]
                areas = {c["areaSqm"] for c in asset["areaClaims"] if "areaSqm" in c}
                if len(areas) > 1:
                    asset["reviewFlags"].append("source_area_conflict")
                if unit.get("area_sqm") is not None and areas and any(abs(a - float(unit["area_sqm"])) > .05 for a in areas):
                    asset["reviewFlags"].append("source_system_area_difference")
            else:
                candidates = []
                if asset["buildingCode"]:
                    for (p, b, number, kind), found in index.items():
                        if p == "SACSI" and b == asset["buildingCode"] and number == asset["unitNo"]:
                            candidates.extend(found)
                asset["match"] = {"status": "identity_review" if candidates else "source_only_unmapped",
                    "systemUnitId": None, "possibleSystemUnitIds": [u["id"] for u in candidates],
                    "basis": "精确房号但类别或源标识待核" if candidates else "快照内未建立精确身份匹配；不代表资产不存在"}
                suggested.update(u["id"] for u in candidates)
        system_only = []
        for unit in snapshot["units"]:
            if unit["id"] in matched: continue
            b = buildings[unit["building_id"]]
            p = projects[b["project_id"]]
            item = {k: unit.get(k) for k in ("id", "code", "unit_no", "kind", "asset_subtype", "status", "area_sqm", "floor_label")}
            item.update({"projectCode": p["code"], "buildingCode": b["code"], "buildingName": b["display_name"],
                "matchStatus": "possible_source_match_requires_review" if unit["id"] in suggested else "system_only_no_exact_source_candidate",
                "scopeNote": "不同项目，不能按同门牌或仓库名称跨项目匹配" if p["code"] != "SACSI" else "未建立源表精确匹配，不证明源文件漏管或资产应删除"})
            system_only.append(item)
        return system_only


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--target-finance", type=Path)
    parser.add_argument("--corrections", type=Path, help="Evidence-backed source overlays; never modifies original XLSX cells")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(args.source_dir.glob("*.xlsx"), key=lambda p: ("(1)" in p.name, p.name))
    books, hashes, manifest = [], {}, []
    for path in files:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest.append({"path": str(path.resolve()), "filename": path.name, "sha256": digest,
            "sizeBytes": path.stat().st_size, "duplicateOf": hashes.get(digest)})
        if digest not in hashes:
            hashes[digest] = path.name
            books.append(read_xlsx(path))
    standards = next(b for b in books if any(s["name"] == "已租汇总" for s in b["sheets"]))
    cutoffs = next(b for b in books if any(s["name"] == "4#代租明细" for s in b["sheets"]))
    inv = Inventory(books)
    inv.standards(standards)
    inv.cutoffs(cutoffs)
    inv.add_summary_claims(standards)
    corrections = load_source_corrections(args.corrections, books)
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    system_only = inv.reconcile(snapshot)
    assets = list(inv.assets.values())
    attach_source_corrections(assets, inv.groups, corrections)
    # Flag historical role claims without mistaking separate roles for duplicate assets.
    for asset in assets:
        asset["sourceOwners"] = sorted({r["nameRaw"] for r in asset["roles"] if r["role"] == "owner"})
        asset["sourceTenants"] = sorted({r["nameRaw"] for r in asset["roles"] if r["role"] == "tenant"})
        asset["sourcePartiesUnspecified"] = sorted({r["nameRaw"] for r in asset["roles"] if r["role"] == "unspecified_party"})
        tenants = sorted({r["nameRaw"] for r in asset["roles"] if r["role"] == "tenant"})
        if len(tenants) > 1:
            asset["reviewFlags"].append("multiple_source_tenant_names_keep_history_not_current_occupancy")
        if len({r["nameRaw"] for r in asset["roles"] if r["role"] == "owner"}) > 1:
            asset["reviewFlags"].append("multiple_source_owner_claims_require_identity_review")
        for flag in asset["reviewFlags"]:
            inv.issue(flag, asset["label"] + "：" + flag, asset["sourceRefs"], [asset["candidateId"]])
    inv.issue("duplicate_source_files", "4个文件仅2个唯一SHA256，(1)副本不重复计算资产或金额")
    inv.issue("repeated_summary", "已租汇总与汇总为重复汇总视图，不增加资产；只保留唯一汇总范围和可追溯分配说明")
    inv.issue("source_status_boundary", "源表租用、已售、腾出、押金和收款文字仅作来源声明，不代替实时房态或独立付款凭证")
    inv.issue("old_warehouse_48", "老仓库48号600/75/100㎡三个不同源分区分别保留；分区代码待现场确认，不覆盖同号")
    inv.issue("incubator_group_scope", "孵化园A02注明3间但没有明确对应A03/A04/A05；宿舍数量不是房号，保留组范围而不创造单间")
    inv.issue("source_financial_conflicts", "5#六楼USD/CNY符号、11#1205押租、仓库优惠/费用差异均不得据源表自动改账")
    result = {"schemaVersion": 1, "mode": "read_only_source_inventory", "snapshotAt": snapshot.get("snapshot_at"),
        "sourceDirectory": str(args.source_dir.resolve()), "sourceManifest": manifest, "sourceCorrections": corrections,
        "rules": ["候选资产数量不是已确认实物资产总数", "source_only不等于资产不存在", "相同门牌必须结合项目、楼栋、类别", "源表金额不是已核实实收，不直接入账", "不同币种不直接合并", "业主、租客、历史交易和当前房态独立", "合并单元格值只记一份，不按成员重复计价或猜测分摊"],
        "summary": {"sourceFileCount": len(files), "uniqueSourceCount": len(books), "sourceCandidateCount": len(assets),
            "byScope": dict(collections.Counter(a["scope"] for a in assets)),
            "byMatchStatus": dict(collections.Counter(a["match"]["status"] for a in assets)),
            "systemUnitCount": len(snapshot["units"]), "systemOnlyOrUnresolvedCount": len(system_only),
            "systemOnlyByProject": dict(collections.Counter(x["projectCode"] for x in system_only)),
            "systemUnitsByProject": dict(collections.Counter(next(p["code"] for p in snapshot["projects"] if p["id"] == next(b["project_id"] for b in snapshot["buildings"] if b["id"] == u["building_id"])) for u in snapshot["units"])),
            "groupCount": len(inv.groups), "issueCount": len(inv.issues)},
        "assets": assets, "groups": inv.groups, "issues": inv.issues,
        "systemOnlyUnits": system_only, "excludedAggregateViews": inv.ignored}
    if args.target_finance:
        result["targetFinanceReview"] = inv.add_target_finance_findings(snapshot, json.loads(args.target_finance.read_text(encoding="utf-8")))
    result["businessIssues"] = inv.business_issues(standards, cutoffs, result.get("targetFinanceReview"), corrections)
    for correction in corrections:
        if not correction["applied"]:
            result["businessIssues"].append({"issueId":correction["correctionId"],"title":"来源更正尚未应用",
                "detail":correction["validationStatus"],"suggestedAction":"核对源文件哈希、单元格原文、确认状态与证据；不得直接覆盖源表。",
                "priority":"review","sourceRefs":[correction["sourceRef"]] if correction.get("sourceRef") else [],
                "candidateIds":[],"businessWritesAuthorized":False})
    fingerprint = hashlib.sha256("\n".join(sorted(hashes)).encode("ascii")).hexdigest()
    project_id = next(p["id"] for p in snapshot["projects"] if p["code"] == "SACSI")
    pilot, review = [], []
    for asset in assets:
        if asset["scope"] not in ("old-warehouse", "new-warehouse"): continue
        old = asset["scope"] == "old-warehouse"
        group = "old_warehouse" if old else "new_warehouse"
        number = asset["sourceLocator"].split("|")[0]
        partition = asset["sourceLocator"].partition("|partition-")[2]
        source_key = group + ":" + number + (":partition_" + partition if partition else "")
        code = ("SACSI-OLD-WH-" if old else "SACSI-NEW-WH-") + number.replace(".", "-") + ("-P" + partition.replace("sqm", "") if partition else "")
        name = ("老仓库" if old else "新仓库") + number + "号" + ("—" + partition.replace("sqm", "㎡") + "分区" if partition else "")
        refs = ["sha256:" + r["fileHash"] + "|file:" + r["filename"] + "|sheet:" + r["sheet"] + "|range:" + r["range"] for r in asset["sourceRefs"]]
        # Currency is not explicitly stated by the warehouse rent column.
        # Import a catalog only; preserve unconfirmed rent standards for review.
        pilot.append({"sourceKey": source_key, "code": code, "name": name, "group": group,
            "sourceRefs": refs, "unitId": None, "monthlyRentNative": None, "rentCurrency": None})
        standard = next((r for r in asset["rawRows"] if r["recordKind"] == "warehouse_rent_standard"), None)
        monthly = next((c for c in standard["cells"] if col(c["cell"]) == "F"), None) if standard else None
        shared_rent = [g for g in inv.groups if asset["candidateId"] in g["memberCandidateIds"] and len(g["memberCandidateIds"]) > 1 and any(col(c["cell"]) == "F" for c in g["sharedCells"])]
        review.append({"sourceKey": source_key, "candidateId": asset["candidateId"], "name": name,
            "approvalStatus": "candidate_pending_review", "monthlyRentRaw": monthly,
            "rentUnitContext": "原表月租与年度万单位上下文；币种未在仓库租金列明示，导入值留空",
            "groupRentShared": bool(shared_rent), "sharedRentGroups": [g["groupId"] for g in shared_rent],
            "reviewFlags": asset["reviewFlags"], "sourceRefs": asset["sourceRefs"]})
    pilot_payload = {"projectId": project_id, "sourceFingerprint": fingerprint, "assets": pilot}
    (args.output_dir / "warehouse-pilot-import.json").write_text(json.dumps(pilot_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "warehouse-pilot-review.json").write_text(json.dumps({"mode":"prepared_only_not_executed", "rentPolicy":"源租金标准、币种与组租待核，不导入为确认金额", "assets":review}, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "all-assets-reconciliation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "source-workbooks-extract.json").write_text(json.dumps(books, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
