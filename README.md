# SACIS 3.0 科建地产房屋管理系统

首期聚焦 `SASCI11 / 11#公寓`，但代码和数据库按多楼栋架构设计，后续可扩展到 3#/4#/5#/6#/7#。

## 技术框架

- Frontend: Next.js App Router + TypeScript + Tailwind CSS
- Backend/DB: Supabase PostgreSQL
- Hosting: Vercel + Supabase
- PWA、权限、深色模式后续按模块接入；中法双语骨架已建立

## 本地启动

```bash
npm install
npm run dev
```

复制 `.env.example` 为 `.env.local` 后填入 Supabase 项目配置。

## 目录说明

- `src/app`: 页面路由
- `src/components`: 通用 UI 和应用壳
- `src/features`: 各业务模块骨架
- `src/lib`: Supabase、工具函数、配置
- `src/lib/i18n.ts`: 中文/法语界面文案字典和语言路由工具
- `src/types`: 业务类型定义
- `supabase/migrations`: 数据库迁移与 11#初始化数据
- `docs/claude_code_module_prompts.md`: 后续交给 Claude Code 的模块提示词

## 首期范围

1. 11#房源档案和房态中心
2. 客户档案
3. 日租业务
4. 长租业务
5. 出售业务
6. 财务流水
7. 报表与提醒基础框架

## 双语路由

- 中文默认路径：`/`, `/units`, `/daily-rentals`
- 法语路径：`/fr`, `/fr/units`, `/fr/daily-rentals`
- 后续新增页面时，需要同步补充 `src/lib/i18n.ts` 内的 `zh` 和 `fr` 文案。
