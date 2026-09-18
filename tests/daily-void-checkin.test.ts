import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
let db: PGlite;
const booking='33333333-3333-4333-8333-333333333333';
beforeAll(async()=>{
 db=await PGlite.create();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth;
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
 create function public.has_app_role(variadic roles text[]) returns boolean language sql as $$ select current_setting('test.role',true)=any(roles) $$;
 create type public.unit_status as enum('available','daily_occupied');
 create table public.units(id uuid primary key,status public.unit_status,updated_at timestamptz);
 create table public.daily_bookings(id uuid primary key,unit_id uuid,status text,actual_check_out date,prepaid_amount_xof numeric,notes text,updated_at timestamptz);
 create table public.payments(id uuid,source_type text,source_id uuid);
 create table public.receivables(source_type text,source_id uuid,paid_amount_xof numeric,status text,updated_at timestamptz);
 create table public.cleaning_tasks(daily_booking_id uuid);
 create table public.audit_logs(actor_id uuid,action text,entity_type text,entity_id uuid,before_data jsonb,after_data jsonb,metadata jsonb);
 create function public.daily_resolve_unit_status(uuid,uuid) returns public.unit_status language sql as $$ select 'available'::public.unit_status $$;
 create function public.daily_booking_operation_snapshot(uuid,uuid) returns jsonb language sql as $$ select to_jsonb(b) from public.daily_bookings b where id=$1 $$;
 grant usage on schema public,auth to authenticated;
 grant select,insert,update on all tables in schema public to authenticated;
 create function public.test_audit_failure() returns trigger language plpgsql as $$ begin if current_setting('test.fail',true)='yes' then raise exception 'auditFailed'; end if; return new; end $$;
 create trigger test_audit_failure before insert on public.audit_logs for each row execute function public.test_audit_failure();`);
 await db.exec(readFileSync('supabase/migrations/20260918084208_add_admin_duplicate_checkin_correction.sql','utf8'));
},30000);
beforeEach(async()=>{
 await db.exec(`reset role; set test.actor='11111111-1111-4111-8111-111111111111'; set test.role='admin'; set test.fail='no';
 truncate units,daily_bookings,payments,receivables,cleaning_tasks,audit_logs;
 insert into units values('${booking}','daily_occupied',now());
 insert into daily_bookings values('${booking}','${booking}','checked_in',null,0,'original',now());
 insert into receivables values('daily_booking','${booking}',0,'pending',now());`);
});
afterAll(async()=>{await db.close();});
async function run(reason='Duplicate entry confirmed by user'){
 await db.exec('set role authenticated');
 try{return await db.query('select public.daily_void_erroneous_checkin_rpc($1,$2)',[booking,reason]);}
 finally{await db.exec('reset role');}
}
it('cancels atomically, preserves history and is idempotent',async()=>{
 await run(); await run();
 expect((await db.query('select status,notes from daily_bookings')).rows[0]).toMatchObject({status:'cancelled',notes:expect.stringContaining('original')});
 expect((await db.query('select status from receivables')).rows[0]).toEqual({status:'cancelled'});
 expect((await db.query('select count(*)::int n from audit_logs')).rows[0]).toEqual({n:1});
 expect((await db.query('select count(*)::int n from cleaning_tasks')).rows[0]).toEqual({n:0});
});
it('rejects non-admin and missing identity',async()=>{
 await db.exec("set test.role='front_desk'"); await expect(run()).rejects.toThrow('dailyCancelPermissionDenied');
 await db.exec("set test.role='admin';set test.actor=''"); await expect(run()).rejects.toThrow('dailyCancelPermissionDenied');
});
it('rejects any payment history, even a zero-value row',async()=>{
 await db.exec(`insert into payments values(gen_random_uuid(),'daily_booking','${booking}')`);
 await expect(run()).rejects.toThrow('bookingHasPayments');
});
it('rejects paid totals and cleaning history',async()=>{
 await db.exec('update daily_bookings set prepaid_amount_xof=1'); await expect(run()).rejects.toThrow('bookingHasPayments');
 await db.exec(`update daily_bookings set prepaid_amount_xof=0;insert into cleaning_tasks values('${booking}')`);
 await expect(run()).rejects.toThrow('bookingHasCleaningHistory');
});
it('requires a reason and checked-in state',async()=>{
 await expect(run('')).rejects.toThrow('correctionReasonRequired');
 await db.exec("update daily_bookings set status='checked_out'"); await expect(run()).rejects.toThrow('bookingNotErroneousCheckin');
});
it('rolls back business changes when audit fails',async()=>{
 await db.exec("set test.fail='yes'"); await expect(run()).rejects.toThrow('auditFailed');
 expect((await db.query('select status from daily_bookings')).rows[0]).toEqual({status:'checked_in'});
 expect((await db.query('select status from receivables')).rows[0]).toEqual({status:'pending'});
});
it('never grants anonymous or service-role execution',async()=>{
 const rows=(await db.query(`select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where proname='daily_void_erroneous_checkin_rpc'`)).rows;
 expect(rows[0]).toEqual({prosecdef:false,anon:false,service:false});
});
