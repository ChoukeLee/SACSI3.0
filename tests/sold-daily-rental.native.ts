import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: Awaited<ReturnType<Awaited<ReturnType<typeof createNativePaymentPostgres>>["connect"]>>;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45000);
afterAll(async () => { await cluster?.close(); });

async function seed(enabled = true) {
  await db.query("reset role");
  const actor = randomUUID(), project = randomUUID(), building = randomUUID(), unit = randomUUID(), agent = randomUUID(), sale = randomUUID();
  await db.query(`insert into auth.users(id,email) values('${actor}','sold-daily@test.invalid');
    insert into public.user_profiles(id,role,display_name) values('${actor}','admin','Synthetic');
    insert into public.projects(id,code,display_name,allows_daily_rental,allows_sale) values('${project}','${project}','Test',true,true);
    insert into public.buildings(id,project_id,code,display_name) values('${building}','${project}','${building}','Test');
    insert into public.units(id,building_id,code,unit_no,floor_label,status) values('${unit}','${building}','${unit}','T901','9F','sold');
    insert into public.unit_business_flags(unit_id,business_type,is_enabled,default_price_xof) values('${unit}','daily_rental',${enabled},40000);
    insert into public.customers(id,name) values('${agent}','颖');
    insert into public.sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status)
    values('${sale}','${unit}','${agent}','${sale}',current_date,100000000,'lump_sum','active');`);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub: actor, role: "authenticated"})]);
  await db.query("set role authenticated");
  return { actor, unit, agent, sale };
}
async function create(f: Awaited<ReturnType<typeof seed>>) {
  const result = await db.query("select public.daily_create_booking_rpc($1,$2,current_date,current_date+2,'fixed',40000,null,null,$3,'{}') result", [f.unit, f.agent, randomUUID()]);
  return result.rows[0].result.booking.id as string;
}
it("creates, checks in, checks out and cleans while preserving sold ownership and sale history", async () => {
  const f = await seed();
  const before = (await db.query("select to_jsonb(s) data from public.sale_contracts s where id=$1", [f.sale])).rows[0].data;
  const booking = await create(f);
  await db.query("reset role");
  await db.query("update daily_bookings set status='confirmed' where id=$1", [booking]);
  await db.query("set role authenticated");
  await db.query("select public.daily_check_in_booking_rpc($1,0,null,'{}')", [booking]);
  expect((await db.query("select status from units where id=$1", [f.unit])).rows[0].status).toBe("sold");
  await db.query("select public.daily_check_out_booking_rpc($1,current_date+2,80000,0,null,'cleaning_pending','{}')", [booking]);
  expect((await db.query("select status from units where id=$1", [f.unit])).rows[0].status).toBe("sold");
  const task = (await db.query("select id from cleaning_tasks where daily_booking_id=$1 and not is_completed", [booking])).rows[0].id;
  await db.query("select public.daily_complete_cleaning_rpc($1,'{}')", [task]);
  expect((await db.query("select status from units where id=$1", [f.unit])).rows[0].status).toBe("sold");
  expect((await db.query("select to_jsonb(s) data from public.sale_contracts s where id=$1", [f.sale])).rows[0].data).toEqual(before);
});
it("rejects disabled daily capability, overlapping bookings and unfinished cleaning", async () => {
  await expect(create(await seed(false))).rejects.toThrow();
  const f = await seed();
  const booking = await create(f);
  await expect(create(f)).rejects.toThrow("doubleBooked");
  await db.query("reset role");
  await db.query("update daily_bookings set status='confirmed' where id=$1", [booking]);
  await db.query("insert into cleaning_tasks(unit_id,is_completed) values($1,false)", [f.unit]);
  await db.query("set role authenticated");
  await expect(db.query("select public.daily_check_in_booking_rpc($1,0,null,'{}')", [booking])).rejects.toThrow("cleaningPending");
});
