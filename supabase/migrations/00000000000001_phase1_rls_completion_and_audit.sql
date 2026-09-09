-- Force RLS everywhere (defense in depth, even for table owners)
alter table public.currencies force row level security;
alter table public.roles force row level security;
alter table public.permissions force row level security;
alter table public.role_permissions force row level security;
alter table public.businesses force row level security;
alter table public.business_memberships force row level security;
alter table public.business_currencies force row level security;

-- Restrict businesses.update to the columns tenants should actually edit directly.
-- id/created_by/deleted_at/deleted_by must never be reachable via a plain REST update.
revoke update on public.businesses from authenticated;
grant update (legal_name, trading_name, default_currency_code, locale, timezone) on public.businesses to authenticated;

-- Append-only audit log
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  actor_id uuid references auth.users(id),
  actor_scope text not null default 'business_member' check (actor_scope in ('business_member', 'platform_admin', 'system')),
  event_code text not null check (event_code ~ '^[a-z][a-z0-9_.]*$'),
  resource_type text not null,
  resource_id uuid,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_business_id_idx on public.audit_events(business_id, created_at desc);
create index audit_events_resource_idx on public.audit_events(resource_type, resource_id);

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;

create policy audit_events_read on public.audit_events for select to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'audit.read'))
  );

-- No insert/update/delete grants to anon/authenticated: audit rows are only ever
-- written by trusted SECURITY DEFINER functions via private.record_audit_event,
-- and nothing may update or delete them afterward.
create or replace function private.record_audit_event(
  p_business_id uuid,
  p_actor_scope text,
  p_event_code text,
  p_resource_type text,
  p_resource_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events
    (business_id, actor_id, actor_scope, event_code, resource_type, resource_id, metadata)
  values
    (p_business_id, auth.uid(), p_actor_scope, p_event_code, p_resource_type, p_resource_id, p_metadata);
end;
$$;

revoke all on function private.record_audit_event(uuid, text, text, text, uuid, jsonb) from public;

-- Wire the one event that already exists: business creation.
create or replace function public.create_business(
  p_legal_name text,
  p_trading_name text,
  p_default_currency_code text,
  p_locale text,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_business_id uuid;
  owner_role_id uuid;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if length(trim(p_legal_name)) = 0 then raise exception 'Legal name is required'; end if;

  select id into strict owner_role_id from public.roles
    where code = 'owner' and business_id is null and deleted_at is null;

  insert into public.businesses
    (legal_name, trading_name, default_currency_code, locale, timezone, created_by)
  values
    (trim(p_legal_name), nullif(trim(p_trading_name), ''), upper(p_default_currency_code), p_locale, p_timezone, caller_id)
  returning id into new_business_id;

  insert into public.business_memberships (business_id, user_id, role_id)
    values (new_business_id, caller_id, owner_role_id);
  insert into public.business_currencies (business_id, currency_code, is_default)
    values (new_business_id, upper(p_default_currency_code), true);

  perform private.record_audit_event(
    new_business_id,
    'business_member',
    'business.created',
    'business',
    new_business_id,
    jsonb_build_object('legal_name', trim(p_legal_name), 'default_currency_code', upper(p_default_currency_code))
  );

  return new_business_id;
end
$$;

revoke all on function public.create_business(text, text, text, text, text) from public, anon;
grant execute on function public.create_business(text, text, text, text, text) to authenticated;
