-- Platform administration (plan §17): a small, deliberately minimal cross-tenant surface
-- for the platform's own operators — business search, suspend/reinstate, subscription
-- override, and an abuse-report queue. Every capability is a SECURITY DEFINER RPC that
-- re-checks private.is_platform_admin() on every call, the same pattern already used for
-- has_business_permission() throughout the app — this achieves the same "server re-checks
-- the caller's privilege on every call, never trusts the client" property the plan asks
-- for from an Edge Function, without introducing a second code path for what is otherwise
-- a normal authenticated RPC call. inviteUserByEmail was the one thing earlier that
-- genuinely needed the GoTrue admin API and therefore an Edge Function; these don't.

-- Not exposed through the Data API at all: no select policy, RLS forced, all privileges
-- revoked from anon/authenticated. Granting/revoking admin status is a manual SQL action
-- by the project owner — there is deliberately no in-app UI for it.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  revoked_at timestamptz
);

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
revoke all on public.platform_admins from anon, authenticated;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid() and revoked_at is null
  )
$$;

revoke all on function private.is_platform_admin() from public;
grant execute on function private.is_platform_admin() to authenticated;

-- Distinct from the tenant's own soft-delete/archive fields — this is a platform-level
-- lock, not something a business owner can set or clear themselves.
alter table public.businesses
  add column platform_suspended_at timestamptz,
  add column platform_suspended_reason text;

-- A suspended business is treated the same as an expired subscription: read-only, no
-- new transactions, but nothing is deleted and exports still work.
create or replace function private.business_is_active(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select status in ('trialing', 'active', 'past_due') and platform_suspended_at is null
     from public.business_subscriptions bs
     join public.businesses b on b.id = bs.business_id
     where bs.business_id = p_business_id),
    false
  )
$$;

revoke all on function private.business_is_active(uuid) from public;

create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  reporter_id uuid references auth.users(id),
  reporter_email text,
  note text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create index abuse_reports_business_id_idx on public.abuse_reports(business_id);
create index abuse_reports_status_idx on public.abuse_reports(status);

alter table public.abuse_reports enable row level security;
alter table public.abuse_reports force row level security;
-- No client-facing policies at all: filing goes through create_abuse_report (any signed-in
-- user), reading/resolving goes through the admin_* RPCs. Nobody reads this table directly.
revoke all on public.abuse_reports from anon, authenticated;

-- Any signed-in user can flag a business — the reporter need not be a member of it.
create or replace function public.create_abuse_report(p_business_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_report_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'Business not found';
  end if;
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'A description of the issue is required';
  end if;

  insert into public.abuse_reports (business_id, reporter_id, reporter_email, note)
  values (
    p_business_id, caller_id,
    (select email from auth.users where id = caller_id),
    trim(p_note)
  )
  returning id into new_report_id;

  return new_report_id;
end;
$$;

revoke all on function public.create_abuse_report(uuid, text) from public, anon;
grant execute on function public.create_abuse_report(uuid, text) to authenticated;

create or replace function public.admin_list_businesses(p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (
  business_id uuid,
  legal_name text,
  trading_name text,
  owner_email text,
  created_at timestamptz,
  member_count bigint,
  subscription_status text,
  plan_code text,
  platform_suspended_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
  select
    b.id,
    b.legal_name,
    b.trading_name,
    owner_user.email::text,
    b.created_at,
    (select count(*) from public.business_memberships bm where bm.business_id = b.id and bm.deleted_at is null and bm.status = 'active'),
    bs.status,
    p.code,
    b.platform_suspended_at
  from public.businesses b
  left join public.business_subscriptions bs on bs.business_id = b.id
  left join public.plans p on p.id = bs.plan_id
  left join auth.users owner_user on owner_user.id = b.created_by
  where p_search is null or p_search = ''
    or b.legal_name ilike '%' || p_search || '%'
    or b.trading_name ilike '%' || p_search || '%'
    or owner_user.email ilike '%' || p_search || '%'
  order by b.created_at desc
  limit least(coalesce(p_limit, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_list_businesses(text, integer, integer) from public, anon;
grant execute on function public.admin_list_businesses(text, integer, integer) to authenticated;

create or replace function public.admin_suspend_business(p_business_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if not private.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'Business not found';
  end if;

  update public.businesses
  set platform_suspended_at = now(), platform_suspended_reason = p_reason
  where id = p_business_id;

  insert into public.audit_events (business_id, actor_id, actor_scope, event_code, resource_type, resource_id, metadata)
  values (p_business_id, caller_id, 'platform_admin', 'business.platform_suspended', 'business', p_business_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function public.admin_suspend_business(uuid, text) from public, anon;
grant execute on function public.admin_suspend_business(uuid, text) to authenticated;

create or replace function public.admin_reinstate_business(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if not private.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'Business not found';
  end if;

  update public.businesses
  set platform_suspended_at = null, platform_suspended_reason = null
  where id = p_business_id;

  insert into public.audit_events (business_id, actor_id, actor_scope, event_code, resource_type, resource_id, metadata)
  values (p_business_id, caller_id, 'platform_admin', 'business.platform_reinstated', 'business', p_business_id, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_reinstate_business(uuid) from public, anon;
grant execute on function public.admin_reinstate_business(uuid) to authenticated;

-- Support-case override: comps, corrections after a billing issue. Any field left null
-- keeps its current value.
create or replace function public.admin_override_subscription(
  p_business_id uuid,
  p_plan_code text default null,
  p_status text default null,
  p_current_period_end timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_plan_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if not exists (select 1 from public.business_subscriptions where business_id = p_business_id) then
    raise exception 'This business has no subscription row';
  end if;

  if p_plan_code is not null then
    select id into target_plan_id from public.plans where code = p_plan_code;
    if target_plan_id is null then raise exception 'Unknown plan code: %', p_plan_code; end if;
  end if;

  if p_status is not null and p_status not in ('trialing', 'active', 'past_due', 'cancelled', 'expired') then
    raise exception 'Unknown subscription status: %', p_status;
  end if;

  update public.business_subscriptions
  set plan_id = coalesce(target_plan_id, plan_id),
      status = coalesce(p_status, status),
      current_period_end = coalesce(p_current_period_end, current_period_end)
  where business_id = p_business_id;

  insert into public.audit_events (business_id, actor_id, actor_scope, event_code, resource_type, resource_id, metadata)
  values (
    p_business_id, caller_id, 'platform_admin', 'business.subscription_overridden', 'business_subscription', p_business_id,
    jsonb_build_object('plan_code', p_plan_code, 'status', p_status, 'current_period_end', p_current_period_end)
  );
end;
$$;

revoke all on function public.admin_override_subscription(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.admin_override_subscription(uuid, text, text, timestamptz) to authenticated;

create or replace function public.admin_list_abuse_reports(p_status text default 'open')
returns setof public.abuse_reports
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
  select * from public.abuse_reports
  where p_status is null or status = p_status
  order by created_at desc;
end;
$$;

revoke all on function public.admin_list_abuse_reports(text) from public, anon;
grant execute on function public.admin_list_abuse_reports(text) to authenticated;

create or replace function public.admin_resolve_abuse_report(p_report_id uuid, p_status text, p_resolution_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_business_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Status must be resolved or dismissed';
  end if;

  select business_id into target_business_id from public.abuse_reports where id = p_report_id;
  if target_business_id is null then raise exception 'Abuse report not found'; end if;

  update public.abuse_reports
  set status = p_status, resolved_by = caller_id, resolved_at = now(), resolution_note = p_resolution_note
  where id = p_report_id;

  insert into public.audit_events (business_id, actor_id, actor_scope, event_code, resource_type, resource_id, metadata)
  values (target_business_id, caller_id, 'platform_admin', 'abuse_report.resolved', 'abuse_report', p_report_id, jsonb_build_object('status', p_status));
end;
$$;

revoke all on function public.admin_resolve_abuse_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_abuse_report(uuid, text, text) to authenticated;

-- A platform admin also needs to see the businesses they act on, even though they aren't
-- a member of any of them — the ordinary membership-scoped read policy doesn't cover this.
create policy businesses_platform_admin_read on public.businesses for select to authenticated
  using (private.is_platform_admin());
