import { readFileSync } from "node:fs";
import { installPaymentDatabase, type PaymentTestDatabase } from "./operator-payment-database";
export async function installCollectionDatabase(db: PaymentTestDatabase) {
  await installPaymentDatabase(db);
  const baseline=JSON.parse(readFileSync("supabase/baselines/20260916.application-schema.json","utf8"));
  for(const name of ["contract_status","payment_status"]) {
    const e=baseline.enums.find((e:{name:string})=>e.name===name);
    await db.exec(`create type public.${name} as enum (${e.labels.map((s:string)=>`'${s}'`).join(',')})`);
  }
  for(const name of ["lease_contracts","sale_contracts","sale_payment_schedule","property_fee_rules"]) {
    const t=baseline.tables.find((t:{name:string})=>t.name===name);
    await db.exec(`create table public.${name} (${t.columns.map((c:{name:string;type:string;default:string|null;notNull:boolean})=>`"${c.name}" ${c.type}${c.default?` default ${c.default}`:''}${c.notNull?' not null':''}`).join(',')});`);
  }
  await db.exec(`alter table public.payments add payment_method text;
    alter table public.receivables add title text default 'Synthetic due', add management_status text default 'normal';
    create function public.can_access_unit(uuid) returns boolean language sql stable as $$ select current_setting('test.deny_unit',true) is distinct from 'yes'; $$;`);
  await db.exec(readFileSync("supabase/migrations/20260922171433_operator_batch_collections.sql","utf8"));
}
