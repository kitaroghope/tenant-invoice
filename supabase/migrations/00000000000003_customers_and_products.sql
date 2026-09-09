-- Generic updated_at stamping. Direct REST updates (unlike the RPC-based writes elsewhere
-- in this schema) have no server-side code path to set updated_at themselves, so a trigger
-- keeps it accurate without depending on any specific extension being installed.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Customers: belong to exactly one business, soft-deletable, restorable.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  display_name text not null check (length(trim(display_name)) > 0),
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  tax_id text,
  preferred_currency_code text references public.currencies(code),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

create index customers_business_id_idx on public.customers(business_id) where deleted_at is null;

alter table public.customers enable row level security;
alter table public.customers force row level security;

revoke all on public.customers from anon, authenticated;
grant select, insert, update on public.customers to authenticated;

create policy customers_read on public.customers for select to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.read'))
  );

create policy customers_insert on public.customers for insert to authenticated
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
    and created_by = (select auth.uid())
  );

-- Column-restricted: id/business_id/created_by/created_at/deleted_* are never directly
-- reachable via REST update, matching the pattern already used for businesses.
create policy customers_update on public.customers for update to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
  )
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
  );

revoke update on public.customers from authenticated;
grant update (
  display_name, email, phone, address_line1, address_line2, city, region,
  postal_code, country_code, tax_id, preferred_currency_code, notes,
  deleted_at, deleted_by, deletion_reason
) on public.customers to authenticated;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

-- Products and services: reusable descriptions; prices live separately per currency.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  name text not null check (length(trim(name)) > 0),
  description text,
  sku text,
  unit text not null default 'unit',
  default_tax_rate_basis_points integer not null default 0 check (default_tax_rate_basis_points >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

create index products_business_id_idx on public.products(business_id) where deleted_at is null;

alter table public.products enable row level security;
alter table public.products force row level security;

revoke all on public.products from anon, authenticated;
grant select, insert, update on public.products to authenticated;

create policy products_read on public.products for select to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.read'))
  );

create policy products_insert on public.products for insert to authenticated
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
    and created_by = (select auth.uid())
  );

create policy products_update on public.products for update to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
  )
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
  );

revoke update on public.products from authenticated;
grant update (
  name, description, sku, unit, default_tax_rate_basis_points,
  deleted_at, deleted_by, deletion_reason
) on public.products to authenticated;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- Per-currency prices for a product. A product can be priced in several enabled currencies.
create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  product_id uuid not null references public.products(id),
  currency_code text not null references public.currencies(code),
  unit_price_minor_units bigint not null check (unit_price_minor_units >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id)
);

create unique index product_prices_product_currency_uidx
  on public.product_prices(product_id, currency_code) where deleted_at is null;
create index product_prices_business_id_idx on public.product_prices(business_id) where deleted_at is null;

alter table public.product_prices enable row level security;
alter table public.product_prices force row level security;

revoke all on public.product_prices from anon, authenticated;
grant select, insert, update on public.product_prices to authenticated;

create policy product_prices_read on public.product_prices for select to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.read'))
  );

create policy product_prices_insert on public.product_prices for insert to authenticated
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
    and exists (select 1 from public.products p where p.id = product_id and p.business_id = product_prices.business_id)
  );

create policy product_prices_update on public.product_prices for update to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
  )
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'customers.write'))
  );

revoke update on public.product_prices from authenticated;
grant update (unit_price_minor_units, deleted_at, deleted_by) on public.product_prices to authenticated;

create trigger product_prices_set_updated_at
  before update on public.product_prices
  for each row execute function private.set_updated_at();
