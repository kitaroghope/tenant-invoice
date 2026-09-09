-- Plans and entitlements. Charging isn't wired to a payment provider yet, but the schema
-- and enforcement boundaries exist from the start per the plan — "Subscription charging
-- follows after the financial workflow is stable, but the schema and entitlement
-- boundaries are included from the start."
--
-- "Number of businesses" from the plan's entitlement list is deliberately omitted here:
-- a subscription belongs to a business, so a per-business cap on how many businesses that
-- business can have doesn't fit the model — that's an account-level concept, not scoped
-- to this table. The other entitlements below are all legitimately per-business.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  max_team_members integer,
  monthly_invoice_allowance integer,
  branding_enabled boolean not null default true,
  reports_enabled boolean not null default true,
  monthly_email_allowance integer,
  price_minor_units bigint not null default 0 check (price_minor_units >= 0),
  currency_code text references public.currencies(code),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.plans enable row level security;
alter table public.plans force row level security;
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;
create policy plans_read on public.plans for select to authenticated using (is_active);

insert into public.plans (code, name, max_team_members, monthly_invoice_allowance, branding_enabled, reports_enabled, monthly_email_allowance, price_minor_units)
values ('free', 'Free', 3, 20, true, true, 50, 0);

create table public.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) unique,
  plan_id uuid not null references public.plans(id),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_subscriptions_business_id_idx on public.business_subscriptions(business_id);

alter table public.business_subscriptions enable row level security;
alter table public.business_subscriptions force row level security;

-- Same precedent as payments/receipts: no billing.read permission was seeded, so any
-- active member can see their own business's subscription status; changing it is what's
-- permission-gated (via billing.manage, once a management RPC exists) or platform-admin-only.
revoke all on public.business_subscriptions from anon, authenticated;
grant select on public.business_subscriptions to authenticated;
create policy business_subscriptions_read on public.business_subscriptions for select to authenticated
  using (business_id in (select private.user_business_ids()));

create trigger business_subscriptions_set_updated_at
  before update on public.business_subscriptions
  for each row execute function private.set_updated_at();

-- Every business gets a subscription row the moment it's created — defaults to the free
-- plan, trialing status, so there's never a business without one to check against.
create or replace function private.provision_default_subscription(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  free_plan_id uuid;
begin
  select id into free_plan_id from public.plans where code = 'free';
  insert into public.business_subscriptions (business_id, plan_id, status, trial_ends_at)
  values (p_business_id, free_plan_id, 'trialing', now() + interval '30 days')
  on conflict (business_id) do nothing;
end;
$$;

revoke all on function private.provision_default_subscription(uuid) from public;

-- Backfill every existing business so nothing is left without a subscription row.
do $$
declare
  biz record;
begin
  for biz in select id from public.businesses loop
    perform private.provision_default_subscription(biz.id);
  end loop;
end $$;

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

  perform private.provision_default_subscription(new_business_id);

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

-- One place to answer "can this business transact right now", reused by any mutation
-- that should respect subscription state. past_due is a grace period, not a block.
create or replace function private.business_is_active(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select status in ('trialing', 'active', 'past_due') from public.business_subscriptions where business_id = p_business_id),
    false
  )
$$;

revoke all on function private.business_is_active(uuid) from public;

-- Enforces both the read-only-on-expiry rule and the monthly invoice allowance. Counts
-- invoices issued since the start of the current calendar month — simple and honest for a
-- free tier; a real billing-period boundary can replace this once a provider is wired up.
create or replace function private.check_can_issue_invoice(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan_allowance integer;
  issued_this_period integer;
begin
  if not private.business_is_active(p_business_id) then
    raise exception 'This business''s subscription is not active. Renew to issue new invoices.';
  end if;

  select p.monthly_invoice_allowance into plan_allowance
  from public.business_subscriptions bs
  join public.plans p on p.id = bs.plan_id
  where bs.business_id = p_business_id;

  if plan_allowance is not null then
    select count(*) into issued_this_period
    from public.invoices
    where business_id = p_business_id
      and issued_at >= date_trunc('month', now());

    if issued_this_period >= plan_allowance then
      raise exception 'This business has reached its plan''s monthly invoice allowance (%). Upgrade to issue more.', plan_allowance;
    end if;
  end if;
end;
$$;

revoke all on function private.check_can_issue_invoice(uuid) from public;

create or replace function public.issue_invoice(p_invoice_id uuid, p_idempotency_key uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target record;
  allocated bigint;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  select id, business_id, status, issuance_idempotency_key into target
  from public.invoices
  where id = p_invoice_id and deleted_at is null
  for update;

  if target is null then raise exception 'Invoice not found'; end if;

  if not (select private.has_business_permission(target.business_id, 'invoices.update')) then
    raise exception 'You do not have permission to issue invoices for this business';
  end if;

  if target.status <> 'draft' then
    if target.issuance_idempotency_key = p_idempotency_key then
      return;
    end if;
    raise exception 'This invoice has already been issued';
  end if;

  perform private.check_can_issue_invoice(target.business_id);

  allocated := private.allocate_document_number(target.business_id, 'invoice');

  update public.invoices
  set status = 'issued',
      invoice_number = allocated,
      issued_at = now(),
      issuance_idempotency_key = p_idempotency_key,
      updated_at = now()
  where id = p_invoice_id;

  perform private.record_audit_event(
    target.business_id, 'business_member', 'invoice.issued', 'invoice', p_invoice_id,
    jsonb_build_object('invoice_number', allocated)
  );
end;
$$;

revoke all on function public.issue_invoice(uuid, uuid) from public, anon;
grant execute on function public.issue_invoice(uuid, uuid) to authenticated;
