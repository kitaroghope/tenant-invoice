create extension if not exists pgcrypto;
create schema if not exists private;

create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text not null,
  minor_unit smallint not null check (minor_unit between 0 and 6),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  code text not null check (code ~ '^[a-z][a-z0-9_.-]*$'),
  name text not null check (length(trim(name)) > 0),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

create unique index roles_system_code_uidx on public.roles(code)
  where business_id is null and deleted_at is null;

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.-]*$'),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id),
  permission_id uuid not null references public.permissions(id),
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index role_permissions_permission_id_idx on public.role_permissions(permission_id);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) > 0),
  trading_name text,
  default_currency_code text not null references public.currencies(code),
  locale text not null default 'en',
  timezone text not null default 'UTC',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

alter table public.roles add constraint roles_business_id_fkey
  foreign key (business_id) references public.businesses(id);

create unique index roles_business_code_uidx on public.roles(business_id, code)
  where business_id is not null and deleted_at is null;

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references auth.users(id),
  role_id uuid not null references public.roles(id),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

create unique index business_memberships_active_user_uidx
  on public.business_memberships(business_id, user_id) where deleted_at is null;
create index business_memberships_user_id_idx on public.business_memberships(user_id);
create index business_memberships_role_id_idx on public.business_memberships(role_id);

create table public.business_currencies (
  business_id uuid not null references public.businesses(id),
  currency_code text not null references public.currencies(code),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  primary key (business_id, currency_code)
);

create unique index business_currencies_one_default_uidx
  on public.business_currencies(business_id) where is_default and deleted_at is null;

insert into public.currencies (code, name, symbol, minor_unit) values
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'Pound Sterling', '£', 2),
  ('KES', 'Kenyan Shilling', 'KSh', 2),
  ('KWD', 'Kuwaiti Dinar', 'KD', 3),
  ('TZS', 'Tanzanian Shilling', 'TSh', 2),
  ('UGX', 'Ugandan Shilling', 'USh', 0),
  ('USD', 'US Dollar', '$', 2);

insert into public.roles (code, name, description, is_system) values
  ('owner', 'Owner', 'Full business ownership and billing control', true),
  ('administrator', 'Administrator', 'Business and member administration', true),
  ('accountant', 'Accountant', 'Financial document and reporting access', true),
  ('staff', 'Staff', 'Day-to-day customer and document access', true),
  ('viewer', 'Viewer', 'Read-only business access', true);

insert into public.permissions (code, name) values
  ('business.manage', 'Manage business'),
  ('members.manage', 'Manage members'),
  ('customers.read', 'Read customers'),
  ('customers.write', 'Manage customers'),
  ('invoices.read', 'Read invoices'),
  ('invoices.create', 'Create invoices'),
  ('invoices.update', 'Update draft invoices'),
  ('invoices.void', 'Void invoices'),
  ('payments.record', 'Record payments'),
  ('payments.reverse', 'Reverse payments'),
  ('receipts.create', 'Create receipts'),
  ('reports.read', 'Read reports'),
  ('branding.manage', 'Manage branding'),
  ('billing.manage', 'Manage billing'),
  ('audit.read', 'Read audit history');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p where r.code = 'owner';

create or replace function private.user_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.business_id
  from public.business_memberships membership
  join public.businesses business on business.id = membership.business_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and membership.deleted_at is null
    and business.deleted_at is null
$$;

revoke all on function private.user_business_ids() from public;
grant usage on schema private to authenticated;
grant execute on function private.user_business_ids() to authenticated;

create or replace function private.has_business_permission(p_business_id uuid, p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_memberships membership
    join public.roles role on role.id = membership.role_id
    join public.role_permissions assignment on assignment.role_id = role.id
    join public.permissions permission on permission.id = assignment.permission_id
    join public.businesses business on business.id = membership.business_id
    where membership.user_id = (select auth.uid())
      and membership.business_id = p_business_id
      and membership.status = 'active'
      and membership.deleted_at is null
      and role.deleted_at is null
      and business.deleted_at is null
      and permission.code = p_permission_code
  )
$$;

revoke all on function private.has_business_permission(uuid, text) from public;
grant execute on function private.has_business_permission(uuid, text) to authenticated;

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

  return new_business_id;
end
$$;

revoke all on function public.create_business(text, text, text, text, text) from public, anon;
grant execute on function public.create_business(text, text, text, text, text) to authenticated;

alter table public.currencies enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;
alter table public.business_currencies enable row level security;

revoke all on table public.currencies, public.roles, public.permissions,
  public.role_permissions, public.businesses, public.business_memberships,
  public.business_currencies from anon, authenticated;
grant select on public.currencies, public.roles, public.permissions,
  public.role_permissions, public.businesses, public.business_memberships,
  public.business_currencies to authenticated;
grant update on public.businesses to authenticated;

create policy currencies_read on public.currencies for select to authenticated using (is_active);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy system_or_business_roles_read on public.roles for select to authenticated
  using (business_id is null or business_id in (select private.user_business_ids()));
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (role_id in (select id from public.roles));
create policy businesses_read on public.businesses for select to authenticated
  using (id in (select private.user_business_ids()));
create policy businesses_update on public.businesses for update to authenticated
  using ((select private.has_business_permission(id, 'business.manage')))
  with check ((select private.has_business_permission(id, 'business.manage')));
create policy memberships_read on public.business_memberships for select to authenticated
  using (business_id in (select private.user_business_ids()));
create policy business_currencies_read on public.business_currencies for select to authenticated
  using (business_id in (select private.user_business_ids()));
