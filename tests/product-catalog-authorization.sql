-- Run after schema-authorization.sql; its synthetic tenants and profiles apply.
insert into public.salon_products(id,tenant_id,name_json,description_json,image_alt_json,category,price,currency,is_published) values
('81000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"fr":"Produit public","en":"Public product","es":"Producto público"}','{"fr":"","en":"","es":""}','{"fr":"","en":"","es":""}','hair',2500,'USD',true),
('81000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','{"fr":"Produit privé","en":"Private product","es":"Producto privado"}','{"fr":"","en":"","es":""}','{"fr":"","en":"","es":""}','hair',3000,'USD',false),
('81000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','{"fr":"Autre salon","en":"Other salon","es":"Otro salón"}','{"fr":"","en":"","es":""}','{"fr":"","en":"","es":""}','other',500,'USD',true)
on conflict (id) do nothing;

set role anon;
select public.test_assert((select count(*) from public.salon_products)=1,'anonymous sees only published products of published salons');
select public.test_assert((select name_json->>'en' from public.salon_products limit 1)='Public product','public product translations are readable');
select public.test_assert(not has_table_privilege('anon','public.salon_products','select'),'anonymous product access is column-scoped');
select public.test_denied('select updated_at from public.salon_products');
select public.test_denied('insert into public.salon_products(tenant_id,name_json,category,price,currency) values(''10000000-0000-0000-0000-000000000001'',''{"fr":"Bad","en":"Bad","es":"Bad"}'',''hair'',1,''USD'')');
reset role;

set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select public.test_assert((select count(*) from public.salon_products where tenant_id='10000000-0000-0000-0000-000000000001')=2,'owner reads own draft and published products');
select public.test_assert((select count(*) from public.salon_products where tenant_id='10000000-0000-0000-0000-000000000002')=0,'owner cannot read unpublished foreign salon products');
select public.test_denied('update public.salon_products set tenant_id=''10000000-0000-0000-0000-000000000002'' where id=''81000000-0000-0000-0000-000000000002''');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_assert((select count(*) from public.salon_products)=1,'staff cannot read owner drafts');
select public.test_denied('insert into public.salon_products(tenant_id,name_json,description_json,image_alt_json,category,price,currency) values(''10000000-0000-0000-0000-000000000001'',''{"fr":"Staff","en":"Staff","es":"Staff"}'',''{"fr":"","en":"","es":""}'',''{"fr":"","en":"","es":""}'',''hair'',1,''USD'')');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select public.test_assert((select count(*) from public.salon_products where tenant_id='10000000-0000-0000-0000-000000000002')=1,'other owner reads own product even before salon publication');
select public.test_assert((select count(*) from public.salon_products where tenant_id='10000000-0000-0000-0000-000000000001' and is_published=false)=0,'other owner cannot read foreign draft');
reset role;
reset request.jwt.claim.sub;

select public.test_assert((select count(*) from information_schema.columns where table_schema='public' and table_name='salon_products' and column_name in ('stock_count','quantity_on_hand','inventory_notes'))=0,'catalog has no private inventory columns');
