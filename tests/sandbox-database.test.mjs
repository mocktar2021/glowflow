import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {promisify} from 'node:util';
import test from 'node:test';
import { verifySandboxAuthorization } from './rls-authorization.mjs';

// Explicit opt-in: run against a fresh, disposable localhost database only.
const connection=process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const psql=process.env.PSQL_BIN || 'psql';
const root=new URL('../',import.meta.url);
const execAsync=promisify(execFile);
function safeDatabaseError(error) {
 let diagnostic=String(error.stderr || 'Local PostgreSQL command failed.');
 for(const value of [connection, connection && new URL(connection).password, connection && decodeURIComponent(new URL(connection).password)]) {
  if(value) diagnostic=diagnostic.replaceAll(value,'[redacted]');
 }
 return new Error(diagnostic.slice(0,2000));
}
async function run(...args) { try { return await execAsync(...args); } catch(error) { throw safeDatabaseError(error); } }
function sql(query){try{return execFileSync(psql,['-X','-w','-v','ON_ERROR_STOP=1','-At','-c',query,connection],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch(error){throw safeDatabaseError(error);}}
const tenant='10000000-0000-0000-0000-000000000001';
const staff='20000000-0000-0000-0000-000000000001';
const service='30000000-0000-0000-0000-000000000001';
const stamp="(current_date+10+time '10:00') at time zone 'UTC'";
function reserve(key,time=stamp,name='Test Client',who=staff){return `select row_to_json(r) from public.reserve_stripe_sandbox_booking('fixture','${service}','${who}',${time},'${name}',null,'test@example.com','fr','${key}') r`;}
function event(r,id,type='checkout.session.completed',extra={}){const v={account:r.stripe_account_id,session:'cs_test_fixture'+r.id.replaceAll('-',''),pi:'pi_fixture'+r.id.replaceAll('-',''),amount:r.amount,currency:r.currency,live:'false',...extra};return `select row_to_json(r) from public.process_stripe_sandbox_event('${id}','${v.account}','${r.id}','${v.session}','${v.pi}','${type}',${v.amount},'${v.currency}','${r.tenant_id}','${r.appointment_id}','${r.client_id}',${v.live}) r`;}

test('sandbox database transactions and RLS',{skip:!connection},async()=>{
 const url=new URL(connection);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'local database required');
 assert.ok(['postgres:','postgresql:'].includes(url.protocol) && !url.search && !url.hash,'plain PostgreSQL URL required');
 assert.match(url.pathname,/^\/glowflow_sandbox_test[0-9_]*$/,'dedicated disposable database required');
 assert.equal(sql("select count(*) from pg_tables where schemaname='public'"),'0','database must be empty');
 sql(readFileSync(new URL('tests/sandbox-database-fixture.sql',root),'utf8'));
 sql(readFileSync(new URL('supabase/migrations/20260906225417_add_stripe_sandbox_connections.sql',root),'utf8'));
 const original=readFileSync(new URL('supabase/migrations/20260905234045_add_public_availability_booking.sql',root),'utf8');
 sql(original.slice(original.indexOf('create or replace function private.public_resource_available'),original.indexOf('create or replace function public.get_public_booking_slots')));
 const migration=readdirSync(new URL('supabase/migrations/',root)).find(f=>f.endsWith('_add_stripe_sandbox_reservations.sql'));assert.ok(migration);
 sql(readFileSync(new URL('supabase/migrations/'+migration,root),'utf8'));
 sql(`insert into public.stripe_sandbox_connections(tenant_id,stripe_account_id) values('${tenant}','acct_fixture')`);
 const key='40000000-0000-0000-0000-000000000001';
 // Reproduce the deployed failure before applying the forward migration.
 sql(`update public.salon_public_profiles set is_published=false where tenant_id='${tenant}'`);
 assert.throws(()=>sql('set role service_role;'+reserve(key)),/sandbox_payments_unavailable/);
 sql(readFileSync(new URL('supabase/migrations/20260913161823_allow_unpublished_sandbox_reservations.sql',root),'utf8'));
 const r=JSON.parse(sql('set role service_role;'+reserve(key)) .split('\n').at(-1));
 assert.equal(sql(`select is_published from public.salon_public_profiles where tenant_id='${tenant}'`),'f');
 assert.equal(JSON.parse(sql(reserve(key))).id,r.id);
 assert.notEqual(r.appointment_id,r.id); assert.notEqual(r.client_id,r.id);
 assert.equal(sql('select count(*) from public.appointments'),'0');
 assert.equal(r.amount,1200);assert.equal(r.status,'reserved');
 assert.ok(Date.parse(r.expires_at)-Date.parse(r.created_at)===35*60000);
 assert.throws(()=>sql(reserve(key,stamp,'Changed Client')),/sandbox_request_mismatch/);
 assert.throws(()=>sql(reserve('40000000-0000-0000-0000-000000000002')),/exclusion constraint/);
 assert.throws(()=>sql(reserve('40000000-0000-0000-0000-000000000003',"(current_date+10+time '07:00') at time zone 'UTC'")),/sandbox_time_unavailable/);
 // Adjacent after sanitation buffer is valid; same chair with another staff is not.
 const adjacent=JSON.parse(sql(reserve('40000000-0000-0000-0000-000000000004',"(current_date+10+time '10:40') at time zone 'UTC'")));
 assert.throws(()=>sql(reserve('40000000-0000-0000-0000-000000000005',stamp,'Test Client','20000000-0000-0000-0000-000000000002')),/exclusion constraint/);
 assert.throws(()=>sql('set role anon;'+reserve(key)),/permission denied/);
 assert.throws(()=>sql('set role authenticated;'+reserve(key)),/permission denied/);
 assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${staff}';select count(*) from public.stripe_sandbox_reservations`).split('\n').at(-1),'2');
 for(const uid of ['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000099'])assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${uid}';select count(*) from public.stripe_sandbox_reservations`).split('\n').at(-1),'0');
 assert.throws(()=>sql('set role authenticated;select * from public.stripe_sandbox_events'),/permission denied/);
 assert.throws(()=>sql(event(r,'evt_wrong',undefined,{amount:1})),/sandbox_event_mismatch/);
 assert.throws(()=>sql(event(r,'evt_live',undefined,{live:'true'})),/sandbox_event_mismatch/);
 assert.throws(()=>sql(event(r,'evt_account',undefined,{account:'acct_wrong'})),/sandbox_event_mismatch/);
 assert.equal(JSON.parse(sql(event(r,'evt_paid'))).status,'paid');
 assert.equal(JSON.parse(sql(event(r,'evt_paid'))).status,'paid');
 assert.equal(sql("select count(*) from public.stripe_sandbox_events where event_id='evt_paid'"),'1');
 assert.equal(JSON.parse(sql(event(r,'evt_old','checkout.session.expired'))).status,'paid');
 const duplicates=await Promise.all([1,2].map(()=>run(psql,['-X','-w','-v','ON_ERROR_STOP=1','-At','-d',connection,'-c',event(r,'evt_parallel')])));
 assert.equal(duplicates.length,2);
 assert.equal(sql("select count(*) from public.stripe_sandbox_events where event_id='evt_parallel'"),'1');
 const attached=JSON.parse(sql(`select row_to_json(x) from public.attach_stripe_sandbox_checkout('${r.id}','cs_test_fixture${r.id.replaceAll('-','')}','https://checkout.stripe.com/c/pay/fixture') x`));
 assert.equal(attached.status,'paid');
 assert.throws(()=>sql(`select public.attach_stripe_sandbox_checkout('${r.id}','cs_test_other','https://checkout.stripe.com/c/pay/other')`),/sandbox_session_mismatch/);
 sql(`update public.stripe_sandbox_reservations set expires_at=now()-interval '1 minute' where id='${adjacent.id}'`);
 assert.equal(JSON.parse(sql(event(adjacent,'evt_late'))).status,'reconciliation_required');
 // Parallel connections contend for one resource: exactly one transaction succeeds.
 const concurrent=await Promise.allSettled([6,7].map(i=>run(psql,['-X','-w','-v','ON_ERROR_STOP=1','-At','-d',connection,'-c',reserve(`40000000-0000-0000-0000-00000000000${i}`,"(current_date+11+time '10:00') at time zone 'UTC'")])));
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(concurrent.filter(x=>x.status==='rejected').length,1);
 const late=JSON.parse(sql(reserve('40000000-0000-0000-0000-000000000008',"(current_date+12+time '10:00') at time zone 'UTC'")));
 sql(`insert into public.appointments(tenant_id,staff_id,station_name,start_time,buffer_end_time,status) values('${tenant}','${staff}','chair','${late.start_time}','${late.buffer_end_time}','confirmed')`);
 assert.equal(JSON.parse(sql(event(late,'evt_capacity'))).status,'reconciliation_required');
 verifySandboxAuthorization(sql,r);
});
