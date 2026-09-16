# 隔离本地 Supabase 验证

本环境仅服务阶段 2 技术验收，不是员工使用入口，也不代表真实员工试用通过。

## 隔离约定

- 工作目录：`work/supabase-local`（已被 Git 忽略）。项目 ID：`sacsi-isolated-test`。
- 固定 CLI `2.117.0`，PostgreSQL 17；不执行 link、远程 push/pull，不复制根目录 `.env.local` 或 `supabase/.temp`。
- 初始为空库；禁止直接复制整个迁移目录。历史迁移含真实楼栋、合同初始化及修账，需先分离结构和合成测试数据。
- 关闭 Studio、Edge Runtime 和 Analytics，禁用 seed；Auth 回调预留 `http://127.0.0.1:3100`。
- Docker 网络 `sacsi-isolated-loopback` 设置 `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`。
- Windows Docker Desktop 还需在界面设置 Port binding behavior 为 **Localhost only**，并 Apply & Restart。本机实测仅设置桥接网络或写入设置文件不足以证明 Windows 端口隔离生效。
- 用户已在界面完成设置；该选项影响 Docker 容器的端口发布范围。最初设置备份在 `work/local-setup/docker-settings-before-loopback.json`；该备份仅限本机，不提交。

## 启停与验证（PowerShell）

确保 Docker Desktop 已启动、Engine 就绪；旧终端需要临时更新 PATH：

```powershell
$env:Path = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:Path
npx --yes supabase@2.117.0 start --workdir work/supabase-local --network-id sacsi-isolated-loopback
node scripts/check-local-supabase.mjs
```

CLI 启动/状态输出包含本地密钥，不要截图转发或提交。检查脚本仅在内存中读取密钥，不读取应用环境配置，固定验证回环地址及项目 ID，拒绝云端关联。它创建随机合成账号，验证密码登录、服务端 token 校验及无效 token 拒绝，最后注销并删除该账号。它不验证业务 RLS，也不代替页面验收。

如果出现非回环监听，脚本会在创建账号前失败；立即停止环境，不导入数据。

```powershell
npx --yes supabase@2.117.0 stop --workdir work/supabase-local
```

默认 stop 保留测试数据卷；不要使用删除卷参数。不要以根目录默认 `npm run dev` 作为本地业务验收，它仍可能读取生产 `.env.local`。业务测试启动器完成前，不启动与本测试库关联的应用。

## 日租收款后端测试库（已验证）

```powershell
node scripts/setup-local-payment-schema.mjs
node scripts/setup-local-payment-schema.mjs --apply
node scripts/check-local-payment-flow.mjs
```

- 第一个命令只核对 17 个源文件的 LF 归一化哈希及片段边界，不执行 SQL。
- `--apply` 只接受固定本地容器及项目、回环端口和未关联云端的目录。首次安装拒绝已有业务表或 Auth 用户的数据库；整批 DDL 在一个事务中提交，失败则回滚。
- 这不是完整 SACSI schema：保留真实基础表约束、日租相关身份字段、角色/RLS、收款/确认/重做函数及审计触发器。跳过真实账号修改、经办人历史回填、楼栋合同种子、历史修账、系统设置数据、长租/出售及 AI 全量功能。不能据此验收未安装的业务路径。
- 从 `restore_missing_foundations` 仅截取表结构；从 `promote_ying_to_admin` 仅保留当前角色函数；从 AI foundations 保留身份字段/触发器与付款方式结构，排除历史回填和长租函数。原始片段内容不改写，源文件变化即要求复核。
- 只安装动作目录常量，不安装真实业务数据。原始重复迁移版本不改名，不写 Supabase 线上迁移历史；本地私有标记记录组装内容哈希。
- 已安装相同清单时不重复执行；只支持已审核的前一版清单升级更新时间函数，其他哈希不一致均拒绝。该标记不是检测手工 SQL 漂移的工具。
- 流程测试使用本地 Auth 的随机账号和真实 JWT，通过 PostgREST 调用，不伪造 `auth.uid()`。管理员密钥仅用于本地合成账号生命周期，不用于被测业务操作。数据准备/清理使用固定本地容器的 SQL，并只清理本次随机 UUID，绝不 truncate 共用表。

### 2026-09-16 后端验收结果

通过：真实角色解析；只读角色拒绝收款；未配置角色的账号受 RLS 限制；用户 metadata 伪造 admin 无效；自提权拒绝；匿名 RPC 拒绝；其他管理员不能读/执行本人的确认单；收款和证据一致；重复确认只入账一次；账务快照变化阻断旧单；重做保留历史；审计 actor 不接受伪造；boss 可读审计。

已复测两次。结束后 SQL 复查 Auth 用户、订单、付款及审计测试记录均为 0；保留 20 张公共结构表，全部启用 RLS。

安全扫描发现并修复历史 `update_receivables_updated_at` 的可变 search_path 告警；新增 `20260916170356_harden_receivable_timestamp_search_path.sql`，只修改该函数配置，尚未部署线上。修复后本地 security advisors 在 warn/error 级别无问题。新清单/库存检查与原付款/确认数据库回归共 61 项通过，类型检查和 diff 检查通过。本轮不声称全量应用构建或网页联调通过。

## 完整应用结构与网页联调（2026-09-16 已推进）

最新结果及命令见 [第二阶段技术验收](OPERATOR_STAGE2_ACCEPTANCE.md)。线上仅只读导出结构；本地已从 20 表日租子集升级到完整应用结构加待发布迁移，并验证独立连接器、真实网页确认和审计。

`node scripts/start-local-operator-web.mjs` 显式只绑定 127.0.0.1:3100，源文件按白名单复制到忽略目录，不复制任何 `.env`，且清除继承的生产/模型/Sentry 凭据。加 `--build` 可做同样隔离的生产构建。每次启动使用当时源码快照，源文件修改后需重新启动。

## 历史后续门槛与预检记录

### 迁移预检（2026-09-16）

运行 `node scripts/check-local-migrations.mjs`；需要机器可读清单时加 `--json`。该工具只读文件，不载入环境变量、不连接数据库、不执行 SQL。报告带每个文件的 SHA-256，供后续人工审核清单绑定内容；检测到重复版本或非法文件名返回非零退出码。

本轮扫描 77 个 SQL 文件，发现两组重复版本：

| 版本 | 文件后缀 |
| --- | --- |
| 202608010001 | `management_finance_snapshot_include_history`、`normalize_all_contract_numbers` |
| 202609010001 | `reconfigure_sacsi5_daily_rooms`、`rename_daily_booking_agent_ying` |

不直接重命名已用于线上迁移的文件，也不删除历史修账文件。后续隔离初始化应使用审核后的依赖清单，另行记录本地执行顺序与源文件哈希，不冒充线上迁移历史。

68 个文件包含需复核的写入/过程/业务命名等文本信号。**这不是 68 个缺陷，也不是 SQL 语义解析**：函数体中的合法写操作及注释也可能触发；无信号的文件仍需人工审核，报告永远不授予执行许可。

已审阅的基础路径：initial_schema → user_profiles → open_daily_booking → receivables → audit 增强。不能将这几个文件单独当作可交付业务库：早期 profiles 策略存在自引用，早期权限宽泛，必须结合后续 harden_authorization 及角色变更一起审核。`restore_missing_foundations` 同时含结构、系统默认配置和收据函数；`promote_ying_to_admin` 同时含实际账号更新和角色函数，不能按文件名简单全选或全跳过。

本轮新增库存检查测试 6 项通过，类型检查通过。业务 schema 尚未安装；页面及真实业务 RLS 验收仍未完成。

2026-09-16 用户完成界面设置后复核通过：7 个本地容器运行；API 54321、数据库 54322、测试邮件 54324 共 6 个 IPv4/IPv6 绑定均为 `127.0.0.1` / `::1`。Windows `Get-NetTCPConnection` 也确认这三个端口仅回环监听。真实 Auth 合成账号创建、密码登录、服务端令牌验证、无效令牌拒绝及注销删除已通过。没有安装业务 schema 或导入真实数据，不能据此宣布阶段 2 完成。

1. 日租收款结构清单及真实 Auth/RPC 测试已完成；继续补齐其他业务依赖，不将本子集当作完整 schema。
2. 扩展角色组合、撤权/令牌刷新和异常场景，验证完整业务权限边界。
3. 提供显式隔离的应用启动入口，完成确认页面及登录恢复联调。
4. 技术审核通过后，另行安排小颖与黄姐实际试用；不能自动预填通过。
