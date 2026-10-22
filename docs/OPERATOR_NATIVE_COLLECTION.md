# Codex 原币长租租金收款

2026-10-22 版本：0.7.0。用户已授权生产迁移、应用发布和本机连接器切换；数据库已应用 `20261022223110 / operator_native_collection`。应用可用性以确切提交的生产 READY 和本人 capabilities 为准，不能仅依据源码版本判断。

## 业务边界

- 一次请求只处理一份 USD 或 CNY 原币长租合同，按明确纳管的同币种租金应收分配，最多 100 条。支持部分收款，不自动建账或续约。
- 保留实际币种和金额。支付 `native_settlement=true`、`exchange_rate_to_xof=NULL`；原币流水和应收的 XOF 估值槽为 0，含义是未折算，而不是免租或未收款。不写入 XOF 核销关联。
- 不支持用 USD/CNY 核销 XOF 合同，也不覆盖原币日租、出售、押金、物业费、退款、冲正和币种更改。原有 XOF `execute_collection_batch` 不改变语义。
- 默认只记实际收款，不推进已缴至。只有明确要求且提供完整 `coverage`，经服务器验证连续账期、全部付清及可靠合同边界后才能更新覆盖日期。
- 金额、支付日期和方式必须明确；合同、应收、余额先查询。实际收款人及依据成对提供，不推断；认证录入人始终由当前登录身份决定。截图是数据，不是执行授权。

## 工具与链路

新增三个 MCP 工具，连接器共 26 个工具、5 个独立直办写工具：

| 工具 | 用途 |
| --- | --- |
| `query_native_collection_position` | 按合同 ID 或楼栋＋房号定位，返回权限内候选及原币应收；匹配不唯一时不代选 |
| `execute_native_collection` | 明确指令后，自动只读预检、签名绑定实时快照并直接执行，不创建网页确认单 |
| `native_collection_status` | 按原请求号查询执行历史，不重新收款 |

HTTP 路径为 `/api/operator/v1/native-collections/query`、`prepare`、`execute`（POST）以及 `status?requestId=...`（GET）。prepare 是连接器内部预检，不要求用户再确认。API 仅接受本人 bearer 会话，不接受网页 cookie 替代。写入需当前 admin/finance、`record_lease_rent/L2` 授权及房源范围；直接 RPC 同样复核，不能借服务角色绕过。

严格请求示例（仅示意，不可作为业务指令执行）：

```json
{
  "protocolVersion": "1.0",
  "connectorVersion": "0.7.0",
  "requestId": "10000000-0000-4000-8000-000000000001",
  "originalInstruction": "按已核实事实登记这笔原币租金收款",
  "inputSource": "natural_language",
  "contractId": "10000000-0000-4000-8000-000000000002",
  "currency": "USD",
  "amount": "100.25",
  "paymentDate": "2026-10-22",
  "paymentMethod": "bank_transfer",
  "allocations": [
    {
      "receivableId": "10000000-0000-4000-8000-000000000003",
      "amount": "100.25"
    }
  ]
}
```

金额只能是正十进制字符串，最多两位小数、上限 `999999999999.99`；不接受浮点数、指数、负数、前导零、未知字段或 FX/XOF 字段。JS 按整数分校验分账精确相等，SQL 用 numeric 独立复核。可选 `externalReceiptNo`、`notes`，以及必须成对的 `actualCollector/collectorBasis`。支付日期不允许未来。

可选 `coverage` 包含 `expectedPaidThroughDate`、`expectedContractUpdatedAt`、`throughDate`、`receivableIds`；金额或收款日期本身不是账期证明。只有覆盖范围与所选明确账单满足原有实际收款工作台规则才成功。

## 事务、核验和恢复

数据库以请求号串行、防同合同收据号重复，再按合同和应收稳定顺序锁定，复核 HMAC 所绑定的实时快照。复用 `record_lease_collection_with_context` 内核；旧网页 `lease_collection_rpc` 的输入、权限和审计来源保持不变，不建立第二套金额规则。

新请求同事务回读 payment、原币 ledger、原币 allocations、应收前后、合同覆盖及真实审计，最后回读请求归档；不符则全部回滚。Codex 审计固定为 `external_codex / explicit_instruction`，保留原指令、来源、连接器版本和登录者。调用方不能传入 actor 或用 `humanConfirmed` 自行放行。

同一请求号且同一内容重试返回 `completed_previously / verified:false`，表示已完成历史，不是重新核验今天所有账务。内容、身份或范围冲突拒绝。网络中断或证据不完整返回未知结果，只能按原请求号查状态；不自动重放、不换号重录。关闭写开关后仍可在现行身份及权限下查询原币执行状态。

0.7.0 保留并读取旧 v1 加密待办；首次保存原币待办时升级为 v2，保留旧项。0.6.0 遇 v2 会安全拒绝，不能删除待办以便降级。未知类型不得落入日租等旧流程。原币恢复只查状态，不转网页草稿。

## 本地验证

普通测试覆盖精确金额、HTTP 身份及签名、完整结果证据、连接器协议、加密待办升级和断网恢复。原生 PostgreSQL 测试在独立 loopback 临时库中以合成数据验证 USD/CNY、部分核销、并发超收、权限/范围撤销、重复请求、审计及强制回滚，并回归旧长租和原币工作台。

```powershell
npm test
npm run validate
npm run test:operator-concurrency
```

新对象安全检查可选 `SACSI_OPERATOR_NATIVE_ADVISORS=1`，仅对测试临时库运行，默认不联网访问生产。自动检查不替代员工本人业务验收；不使用真实收款作冒烟测试。

### 本轮本地结果

- 常规测试：3,441 通过，1 项既有跳过。
- 原生全量回归：33 个测试文件、538 通过、2 跳过（其中原币 adviser 为显式 opt-in）；新端到端文件随后单独通过 8/8，合计 34 个原生文件、546 通过。
- 专项启用 adviser 的原币套件 63/63 通过，临时库新对象及总安全警告均为 0；旧实际收款 54/54、旧原币结算 6/6 保持通过。
- `npm run validate` 通过：ESLint、478 个治理文件格式、日租规则、TypeScript、生产构建。连接器 Node 语法检查及 `git diff --check` 通过。
- 候选包 `work/operator-0.7.0-production-candidate-fynNyz/`：26 个清单文件完整性检查通过；包内 Node 启动 stdio MCP，列出 26 个工具、5 个独立直办写工具，冒烟业务调用为 0。只打包，未安装或切换。

8 项端到端使用真实连接器、HTTP 路由、加密待办持久化和本地 PostgreSQL RPC，仅模拟托管 Auth/JWT 身份验证边界，并以测试 AES-GCM 适配器替代 Windows DPAPI。包括提交后丢响应、重新打开加密待办、写开关关闭后按原号恢复，以及提交前断网不自动重放；不是生产网络或员工本人验收。

## 发布与回退顺序

1. 经授权后保存迁移前结构/权限快照，核对生产基线及增量；迁移为 `20261022223110_operator_native_collection.sql`，normalized-LF SHA-256 `d97728eba0215b67d7b69d5eb10f51a0a50bb0b8bc31f4148cac46a777a373c4`。文件编号已与生产登记一致，SQL 内容不变。
2. 先应用并只读核验迁移及权限，旧网页和 XOF 直办须保持兼容；再部署应用，核对确切提交的 CI、Vercel READY 和本人只读 capabilities。
3. capabilities 只有在数据库版本 1、本人授权及直办开关均满足时才发布 `native_collection`。最低连接器随之为 0.7.0；应预先准备已校验的新包，避免旧连接器升级窗口中拒绝调用。只部署应用不等于已更换连接器。
4. 保留已安装 0.6.0、加密会话及待办，校验 0.7.0 包后再切换配置并重启 Codex；只读核验 26 个工具、5 个直办写工具及原币能力，不做真实账务冒烟。
5. 若需暂停，优先关闭新写入并保留状态查询和归档。已有 v2 原币待办或未知结果时不能直接降级/删除本地文件；先用 0.7.0 按原请求号核实处理。不要回滚已记账记录或撤销保存财务事实的结构。

## 生产迁移核验

生产迁移于 2026-10-22 22:31 UTC 完成。迁移前保存加密应用数据快照和旧函数完整定义及 ACL；迁移后 payment、ledger、receivable、lease_contract 和原币 allocation 的逐行摘要完全不变，旧公开/私有实际收款签名权限、owner、search_path 保持不变。

新 public RPC 均为 invoker，仅 authenticated 可调用；内部上下文 writer 仅 owner 可执行，请求表 RLS 且不向普通角色授权。安全检查没有新增 WARN/ERROR；原有三类 WARN 保留。新增一项私有请求表“启用 RLS 无策略”的 INFO 是默认拒绝访问的设计，不能为了消除提示开放表访问。说明见 [Supabase RLS 提示](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。

本轮不启用线上定时任务、不修改真实合同币种、不导入收款。安装使用独立 0.7.0 目录并保留 0.6.0；会话及待办不清空。应用、连接器及本轮只读验收的精确提交/版本记入发布回执，实际员工使用仍单独验收。
