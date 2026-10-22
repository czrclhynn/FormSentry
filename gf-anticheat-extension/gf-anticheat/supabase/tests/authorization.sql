-- Run in the Supabase SQL editor AFTER the migration. All fixtures roll back.
-- This is an executable database authorization test, not a claim it has run.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
('a0000000-0000-4000-8000-000000000001','formsentry-test-a@example.invalid','{"full_name":"Test Teacher A"}'),
('b0000000-0000-4000-8000-000000000002','formsentry-test-b@example.invalid','{"full_name":"Test Teacher B"}');
insert into public.exams(id,teacher_id,title,form_url,status) values
('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','RLS test A','https://docs.google.com/forms/d/e/rls-a/viewform','active'),
('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','RLS test B','https://docs.google.com/forms/d/e/rls-b/viewform','active');
insert into public.student_sessions(id,exam_id,student_name,student_email,token_hash,rules_snapshot) select
'b2000000-0000-4000-8000-000000000002',id,'Test Student','student@example.invalid',repeat('b',64),rules from public.exams where id='b1000000-0000-4000-8000-000000000002';
insert into public.monitoring_events(session_id,client_event_id,event_type,category,occurred_at,description)
values('b2000000-0000-4000-8000-000000000002','scope:1','EXAM_STARTED','ACTIVITY',now(),'Scope test');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.exams where id in ('a1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002'))<>1 then raise exception 'RLS failed: cross-teacher exam visibility'; end if;
  if exists(select id from public.student_sessions where id='b2000000-0000-4000-8000-000000000002') then raise exception 'RLS failed: student session exposed'; end if;
  if exists(select id from public.monitoring_events where session_id='b2000000-0000-4000-8000-000000000002') then raise exception 'RLS failed: student events exposed'; end if;
  begin
    perform public.formsentry_teacher_end('b2000000-0000-4000-8000-000000000002');
    raise exception 'RLS failed: another teacher ended session';
  exception when raise_exception then if sqlerrm<>'Session unavailable or already ended' then raise; end if; end;
  begin
    insert into public.exams(teacher_id,title,form_url) values('b0000000-0000-4000-8000-000000000002','Spoofed','https://docs.google.com/forms/d/e/spoof/viewform');
    raise exception 'RLS failed: spoofed teacher accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform token_hash from public.student_sessions;
    raise exception 'Privilege failed: session token hashes exposed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.formsentry_ingest('b2000000-0000-4000-8000-000000000002',repeat('b',64),'[]',null,null);
    raise exception 'Privilege failed: student RPC callable by teacher';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  if (select count(id) from public.student_sessions where id='b2000000-0000-4000-8000-000000000002')<>1 then raise exception 'Owner cannot read session'; end if;
  if (select count(*) from public.monitoring_events where session_id='b2000000-0000-4000-8000-000000000002')<>1 then raise exception 'Owner cannot read events'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform id from public.exams; raise exception 'Privilege failed: anonymous exam listing'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Transactional ingestion and immutable replay checks under trusted server role.
set local role service_role;
do $$ declare stamp text=now()::text; payload jsonb; first_result jsonb; attempt jsonb; invitation text; begin
  select join_code into invitation from public.exams where id='b1000000-0000-4000-8000-000000000002';
  attempt=public.formsentry_start(invitation,repeat('d',64),'Retry Student','retry@example.invalid');
  if attempt<>public.formsentry_start(invitation,repeat('d',64),'Retry Student','retry@example.invalid') then raise exception 'Start retry created a different attempt'; end if;
  payload=jsonb_build_array(jsonb_build_object('id','test:1','type','EXAM_STARTED','category','ACTIVITY','timestamp',stamp,'durationMs',null,'description','Test start','metadata','{}'::jsonb));
  first_result=public.formsentry_ingest('b2000000-0000-4000-8000-000000000002',repeat('b',64),payload,null,null);
  perform public.formsentry_ingest('b2000000-0000-4000-8000-000000000002',repeat('b',64),payload,null,null);
  if (select count(*) from public.monitoring_events where session_id='b2000000-0000-4000-8000-000000000002' and client_event_id='test:1')<>1 then raise exception 'Idempotency failed'; end if;
  begin
    perform public.formsentry_ingest('b2000000-0000-4000-8000-000000000002',repeat('c',64),payload,null,null);
    raise exception 'Wrong session token accepted';
  exception when raise_exception then if sqlerrm<>'Invalid session credential' then raise; end if; end;
  begin
    perform public.formsentry_ingest('b2000000-0000-4000-8000-000000000002',repeat('b',64),jsonb_set(payload,'{0,description}','"Modified history"'),null,null);
    raise exception 'Historical mutation accepted';
  exception when raise_exception then if sqlerrm<>'Historical event is immutable' then raise; end if; end;
end $$;
reset role;
rollback;
select 'FormSentry authorization, token scope and idempotency checks passed; fixtures rolled back.' as result;
