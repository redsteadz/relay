begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
-- The three-argument overload checks schema + table; two text arguments mean table + description.
select has_table('public','smart_automation_settings','Smart automation settings exist');
select has_table('public','smart_google_services','Google service settings exist');
select has_table('public','smart_automation_rules','Smart automation rules exist');
select has_table('public','smart_action_effects','Smart action effect identities exist');
select has_table('public','smart_action_outbox','Smart action outbox exists');
select has_table('public','smart_google_oauth_sessions','Google OAuth sessions exist');
select ok(not has_table_privilege('authenticated','public.smart_google_oauth_sessions','select'),'OAuth sessions are backend-only');
select ok(not has_table_privilege('authenticated','public.smart_action_outbox','update'),'Clients cannot claim execution work');
select ok(not has_function_privilege('authenticated','public.propose_smart_action_v1(uuid,uuid,uuid,text,jsonb,integer)','execute'),'Clients cannot propose privileged effects');
select ok(not has_function_privilege('authenticated','public.check_smart_dispatch_v1(uuid,uuid)','execute'),'Clients cannot claim dispatch authorization');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('93000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smart-one@example.test','',now(),now(),now()),
('93000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smart-two@example.test','',now(),now(),now());
insert into public.smart_automation_settings(user_id,paused) values('93000000-0000-4000-8000-000000000001',true),('93000000-0000-4000-8000-000000000002',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.smart_automation_settings),1::bigint,'Tenant one sees only its settings');
select is((select paused from public.smart_automation_settings),true,'Settings do not leak tenant two state');
select throws_ok($$update public.smart_automation_settings set paused=false$$,'42501','permission denied for table smart_automation_settings','Settings writes require the authenticated API boundary');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.smart_automation_settings),1::bigint,'Tenant two sees only its settings');
select is((select paused from public.smart_automation_settings),false,'Tenant two owns a separate pause control');
reset role;
select * from finish();
rollback;
