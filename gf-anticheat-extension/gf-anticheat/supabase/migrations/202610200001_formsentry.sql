-- FormSentry: four core entities. Apply with Supabase CLI or the SQL editor.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 120),
  email text not null,
  created_at timestamptz not null default now()
);
create function public.formsentry_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.teachers(id, full_name, email) values(new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''),120), coalesce(new.email,''))
  on conflict(id) do update set email = excluded.email;
  return new;
end $$;
create trigger formsentry_auth_profile after insert or update of email on auth.users for each row execute function public.formsentry_profile();
insert into public.teachers(id, full_name, email) select id, left(coalesce(raw_user_meta_data->>'full_name',''),120), coalesce(email,'') from auth.users on conflict do nothing;

create function public.formsentry_valid_rules(r jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if not (r ?& array['departures','fullscreen','clipboard','domains','mode']) then return false; end if;
  if jsonb_typeof(r) <> 'object' or (r - array['departures','fullscreen','clipboard','domains','mode']) <> '{}'::jsonb then return false; end if;
  if jsonb_typeof(r->'departures') <> 'boolean' or jsonb_typeof(r->'fullscreen') <> 'boolean' or jsonb_typeof(r->'clipboard') <> 'boolean'
    or coalesce(r->>'mode','') not in ('RECORD','WARN') or jsonb_typeof(r->'domains') <> 'array' then return false; end if;
  if jsonb_array_length(r->'domains') > 50 then return false; end if;
  for d in select jsonb_array_elements_text(r->'domains') loop
    if length(d)>253 or d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.teachers(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  form_url text not null check (form_url ~ '^https://docs\.google\.com/forms/d/(e/)?[A-Za-z0-9_-]+/viewform$'),
  status text not null default 'draft' check(status in ('draft','active','inactive')),
  rules jsonb not null default '{"departures":true,"fullscreen":false,"clipboard":true,"domains":[],"mode":"RECORD"}'::jsonb check(public.formsentry_valid_rules(rules)),
  join_code text not null unique default encode(extensions.gen_random_bytes(24),'hex'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(teacher_id,form_url)
);
create index exams_teacher_status_idx on public.exams(teacher_id,status);
create function public.formsentry_exam_updated() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger formsentry_exam_timestamp before update on public.exams for each row execute function public.formsentry_exam_updated();

create table public.student_sessions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete restrict,
  student_name text not null check(length(trim(student_name)) between 2 and 120),
  student_email text not null check(length(student_email)<=254 and student_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  student_reference text check(length(student_reference)<=120),
  token_hash text not null unique check(length(token_hash)=64),
  consent_at timestamptz not null default now(), consent_version text not null default '2026-10-20',
  rules_snapshot jsonb not null check(public.formsentry_valid_rules(rules_snapshot)),
  started_at timestamptz not null default now(), ended_at timestamptz,
  status text not null default 'active' check(status in ('active','submitted','completed','interrupted','technical_issue','submission_unverified','teacher_ended')),
  submission_status text not null default 'not_detected' check(submission_status in ('not_detected','detected','verified','unverified')),
  last_activity_at timestamptz not null default now(), last_sync_at timestamptz not null default now(),
  ingress_window timestamptz not null default now(), ingress_count integer not null default 0,
  check(ended_at is null or ended_at>=started_at)
);
create index sessions_exam_started_idx on public.student_sessions(exam_id,started_at desc);
create index sessions_exam_status_idx on public.student_sessions(exam_id,status);
create table public.monitoring_events (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.student_sessions(id) on delete cascade,
  client_event_id text not null check(length(client_event_id) between 1 and 160),
  event_type text not null check(event_type in ('EXAM_STARTED','EXAM_ENDED','TAB_SWITCH','FOCUS_LOST','FULLSCREEN_EXIT','FULLSCREEN_ENTER','COPY_ATTEMPT','CUT_ATTEMPT','PASTE_ATTEMPT','DOMAIN_VISIT','NETWORK_DISCONNECTED','NETWORK_RECONNECTED','EXAM_RECONNECTED','SESSION_INTERRUPTED','MONITOR_ERROR','SUBMISSION_DETECTED')),
  category text not null check(category in ('ACTIVITY','REVIEW','TECHNICAL')),
  occurred_at timestamptz not null, received_at timestamptz not null default now(), duration_ms bigint check(duration_ms between 0 and 604800000),
  description text not null check(length(description)<=500), metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=6000),
  unique(session_id,client_event_id)
);
create index events_session_time_idx on public.monitoring_events(session_id,occurred_at);
create index events_session_category_idx on public.monitoring_events(session_id,category);

alter table public.teachers enable row level security;
alter table public.exams enable row level security;
alter table public.student_sessions enable row level security;
alter table public.monitoring_events enable row level security;
revoke all on public.teachers, public.exams, public.student_sessions, public.monitoring_events from anon, authenticated;
grant select on public.teachers to authenticated;
grant update(full_name) on public.teachers to authenticated;
grant select, insert, delete on public.exams to authenticated;
grant update(title,form_url,status,rules) on public.exams to authenticated;
grant select(id,exam_id,student_name,student_email,student_reference,consent_at,consent_version,rules_snapshot,started_at,ended_at,status,submission_status,last_activity_at,last_sync_at) on public.student_sessions to authenticated;
grant select on public.monitoring_events to authenticated;
grant all on public.teachers, public.exams, public.student_sessions, public.monitoring_events to service_role;
create policy teachers_own_select on public.teachers for select to authenticated using(id=(select auth.uid()));
create policy teachers_own_update on public.teachers for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy exams_own_select on public.exams for select to authenticated using(teacher_id=(select auth.uid()));
create policy exams_own_insert on public.exams for insert to authenticated with check(teacher_id=(select auth.uid()));
create policy exams_own_update on public.exams for update to authenticated using(teacher_id=(select auth.uid())) with check(teacher_id=(select auth.uid()));
create policy exams_own_delete on public.exams for delete to authenticated using(teacher_id=(select auth.uid()));
create policy sessions_teacher_select on public.student_sessions for select to authenticated using(exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=(select auth.uid())));
create policy events_teacher_select on public.monitoring_events for select to authenticated using(exists(select 1 from public.student_sessions s join public.exams e on e.id=s.exam_id where s.id=session_id and e.teacher_id=(select auth.uid())));

-- Only the server function may call student RPCs. Tokens are hashed before storage.
create function public.formsentry_start(p_join_code text,p_token_hash text,p_name text,p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare exam public.exams; sess public.student_sessions;
begin
  select * into exam from public.exams where join_code=p_join_code for update;
  if not found or exam.status<>'active' then raise exception 'Examination is unavailable'; end if;
  select * into sess from public.student_sessions where token_hash=p_token_hash;
  if found then
    if sess.exam_id<>exam.id or sess.student_name<>p_name or sess.student_email<>lower(p_email) then raise exception 'Attempt identity mismatch'; end if;
    return jsonb_build_object('id',sess.id,'status',sess.status,'started_at',sess.started_at,'rules',sess.rules_snapshot);
  end if;
  if (select count(*) from public.student_sessions where exam_id=exam.id and started_at>now()-interval '15 minutes')>=500 then raise exception 'Too many starts; contact the teacher'; end if;
  insert into public.student_sessions(exam_id,student_name,student_email,token_hash,rules_snapshot) values(exam.id,p_name,lower(p_email),p_token_hash,exam.rules) returning * into sess;
  return jsonb_build_object('id',sess.id,'status',sess.status,'started_at',sess.started_at,'rules',sess.rules_snapshot);
end $$;

create function public.formsentry_ingest(p_session uuid,p_token_hash text,p_events jsonb,p_final text default null,p_submission text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sess public.student_sessions; item jsonb; old public.monitoring_events; accepted text[]='{}'; event_time timestamptz;
begin
  select * into sess from public.student_sessions where id=p_session and token_hash=p_token_hash for update;
  if not found then raise exception 'Invalid session credential'; end if;
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>50 then raise exception 'Invalid batch'; end if;
  if sess.status in ('teacher_ended','completed','interrupted','submission_unverified','technical_issue') then
    select coalesce(array_agg(e.client_event_id),'{}') into accepted from public.monitoring_events e where e.session_id=sess.id and e.client_event_id in (select value->>'id' from jsonb_array_elements(p_events));
    return jsonb_build_object('status',sess.status,'accepted',accepted,'terminal',true);
  end if;
  if sess.started_at<now()-interval '7 days' then raise exception 'Session credential expired'; end if;
  if sess.ingress_window<now()-interval '1 minute' then sess.ingress_window=now(); sess.ingress_count=0; end if;
  if sess.ingress_count>=120 then raise exception 'Rate limit exceeded'; end if;
  for item in select * from jsonb_array_elements(p_events) loop
    event_time=(item->>'timestamp')::timestamptz;
    if event_time<sess.started_at-interval '5 minutes' or event_time>now()+interval '5 minutes' then raise exception 'Invalid event timestamp'; end if;
    select * into old from public.monitoring_events where session_id=sess.id and client_event_id=item->>'id';
    if found then
      if old.event_type<>item->>'type' or old.category<>item->>'category' or old.occurred_at<>event_time or old.description<>item->>'description' or old.metadata<>item->'metadata' or old.duration_ms is distinct from (item->>'durationMs')::bigint then raise exception 'Historical event is immutable'; end if;
    else
      insert into public.monitoring_events(session_id,client_event_id,event_type,category,occurred_at,duration_ms,description,metadata)
      values(sess.id,item->>'id',item->>'type',item->>'category',event_time,(item->>'durationMs')::bigint,item->>'description',item->'metadata');
    end if;
    accepted=array_append(accepted,item->>'id');
  end loop;
  if p_final is not null and p_final not in ('completed','interrupted','technical_issue','submission_unverified') then raise exception 'Invalid final state'; end if;
  if p_submission is not null and p_submission not in ('detected','unverified') then raise exception 'Students cannot verify submission'; end if;
  update public.student_sessions set last_sync_at=now(),last_activity_at=greatest(last_activity_at,coalesce(event_time,last_activity_at)),
    ingress_window=sess.ingress_window,ingress_count=sess.ingress_count+1,
    status=coalesce(p_final,status), ended_at=case when p_final is not null then now() else ended_at end,
    submission_status=coalesce(p_submission,submission_status) where id=sess.id;
  return jsonb_build_object('accepted',accepted,'status',coalesce(p_final,sess.status),'terminal',p_final is not null);
end $$;

create function public.formsentry_teacher_end(p_session uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.student_sessions s set status='teacher_ended',ended_at=now() where s.id=p_session and s.status in ('active','technical_issue','submitted')
    and exists(select 1 from public.exams e where e.id=s.exam_id and e.teacher_id=(select auth.uid()));
  if not found then raise exception 'Session unavailable or already ended'; end if;
end $$;
revoke all on function public.formsentry_profile(), public.formsentry_exam_updated(), public.formsentry_start(text,text,text,text), public.formsentry_ingest(uuid,text,jsonb,text,text), public.formsentry_teacher_end(uuid) from public,anon,authenticated;
grant execute on function public.formsentry_start(text,text,text,text), public.formsentry_ingest(uuid,text,jsonb,text,text) to service_role;
grant execute on function public.formsentry_teacher_end(uuid) to authenticated;
commit;
