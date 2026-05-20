# SACIS 3.0 — 生产验收清单

## 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 是 | Supabase 匿名公钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | 否 | Service role（仅服务端，勿加 NEXT_PUBLIC 前缀） |

## 数据库 Migration 执行顺序

1. `202605180001_initial_schema.sql` — 核心表
2. `202605180002_seed_sasci11.sql` — 种子数据
3. `202605180003_user_profiles.sql` — 用户档案
4. `202605180004_rls_policies.sql` — RLS 策略
5. `202605180005_open_daily_booking.sql` — 开放式日租
6. `202605190001_receivables.sql` — 统一应收
7. `202605190002_lease_settlements.sql` — 退租结算
8. `202605200001_audit_logs_enhance.sql` — 审计增强
9. `202605210001_business_targets.sql` — 经营目标
10. `202605210002_system_settings.sql` — 系统配置

## 种子账号

| 邮箱 | 角色 | 预期 |
|---|---|---|
| admin@sacis.com | admin | 全部权限 |
| boss@sacis.com | boss | 查看全部，不可写 |
| finance@sacis.com | finance | 财务/应收/收款操作 |
| front@sacis.com | front_desk | 前台日租操作 |

## RLS 检查

- `user_profiles`: authenticated 可读写自己的
- `buildings`: authenticated select, admin insert/update
- `audit_logs`: admin/boss 全部，finance 财务相关，front_desk 无
- `system_settings`: admin 可写，全部可读
- `business_targets`: admin/boss 可写，全部可读

## 发布后冒烟测试

### 核心页面
- [ ] `/` — 仪表盘加载，指标卡显示
- [ ] `/management` — 驾驶舱加载，KPI 卡片显示
- [ ] `/management/targets` — 目标 CRUD
- [ ] `/units` — 房源列表 + 详情面板
- [ ] `/units/[id]` — 房源 360 档案
- [ ] `/customers` — 客户列表 + 档案入口
- [ ] `/customers/[id]` — 客户 360 档案
- [ ] `/daily-rentals` — 日租日历
- [ ] `/daily-rentals/overview` — 日租占用总览
- [ ] `/leases` — 长租合同列表 + 详情
- [ ] `/sales` — 出售合同列表 + 详情
- [ ] `/finance` — 财务流水 + 应收
- [ ] `/reports` — 7 报表 Tab
- [ ] `/documents` — 单据中心
- [ ] `/todos` — 待办中心
- [ ] `/data-quality` — 数据质量检测
- [ ] `/front-desk` — 前台工作台
- [ ] `/data-exchange` — 导入导出
- [ ] `/bulk-actions` — 批量操作
- [ ] `/settings` — 设置中心
- [ ] `/settings/audit-logs` — 审计日志
- [ ] `/settings/security` — 安全中心

### 日租流程
- [ ] 新建 pending_review 预订 → 状态 correct
- [ ] 确认 → confirmed
- [ ] 办理入住 → checked_in, unit → daily_occupied
- [ ] 退房 → checked_out, unit → cleaning_pending
- [ ] /daily-rentals 与 /front-desk 房态一致

### 长租流程
- [ ] 新建 active 合同 → 生成应收
- [ ] 收款 → receivable paid_amount 更新
- [ ] 退租 → unit → available, future CRC cancelled

### 出售流程
- [ ] 新建合同 → schedule + receivable
- [ ] 收款 → receivable + schedule 同步
- [ ] 终止 → unit available, 未收 cancelled

### 财务口径一致性
- [ ] /reports 收入 = /finance receivable summary
- [ ] /management 应收 = 统一 receivables 汇总
- [ ] 客户 360 欠费 = receivables unpaid
- [ ] 房源 360 应收 = unit receivables

## 常见问题

| 问题 | 解决 |
|---|---|
| 登录后角色不对 | 检查 user_profiles.role |
| 日租房态不一致 | 检查 computeRoomStates 和 unit.status 同步 |
| 应收金额与报表不一致 | 确认 cancelled receivable 已排除 |
| 页面 500 | 检查 Supabase 表是否存在、RLS 是否允许 |
| 旧 service worker 缓存 | layout.tsx 已 unregister 所有 sw |

## 备份建议

- 每周手动导出 `/settings/security` 数据备份
- migration 前执行完整 pg_dump
- 关键操作写 audit_logs

## 部署

```bash
npm run build   # 构建
# 部署到 Vercel 或自托管
# 执行 supabase migration
```
