-- Transactional per-business, per-document-type numbering. INSERT ... ON CONFLICT DO UPDATE
-- takes a row lock atomically, so concurrent issuance requests from different devices cannot
-- allocate the same number.
create table public.business_document_counters (
  business_id uuid not null references public.businesses(id),
  document_type text not null check (document_type in ('invoice', 'receipt')),
  next_number bigint not null default 1,
  primary key (business_id, document_type)
);

alter table public.business_document_counters enable row level security;
alter table public.business_document_counters force row level security;
revoke all on public.business_document_counters from anon, authenticated;
-- No policies: this table is never read or written directly by clients, only through
-- private.allocate_document_number() below.

create or replace function private.allocate_document_number(p_business_id uuid, p_document_type text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocated bigint;
begin
  insert into public.business_document_counters (business_id, document_type, next_number)
  values (p_business_id, p_document_type, 2)
  on conflict (business_id, document_type)
    do update set next_number = public.business_document_counters.next_number + 1
  returning next_number - 1 into allocated;

  return allocated;
end;
$$;

revoke all on function private.allocate_document_number(uuid, text) from public;

-- Invoices. customer_id is optional (see plan §8): every invoice carries its own embedded
-- bill-to snapshot regardless of whether it is linked to a saved customer.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  customer_id uuid references public.customers(id),
  customer_display_name text not null check (length(trim(customer_display_name)) > 0),
  customer_email text,
  customer_phone text,
  customer_address_line1 text,
  customer_address_line2 text,
  customer_city text,
  customer_region text,
  customer_postal_code text,
  customer_country_code text,
  customer_tax_id text,
  currency_code text not null references public.currencies(code),
  currency_exponent smallint not null check (currency_exponent between 0 and 6),
  status text not null default 'draft' check (status in ('draft', 'issued', 'sent', 'partially_paid', 'paid', 'void')),
  invoice_number bigint,
  issued_at timestamptz,
  due_at timestamptz,
  tax_basis_points integer not null default 0 check (tax_basis_points >= 0),
  subtotal_minor_units bigint not null default 0,
  tax_minor_units bigint not null default 0,
  total_minor_units bigint not null default 0,
  notes text,
  issuance_idempotency_key uuid,
  void_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

create unique index invoices_business_number_uidx
  on public.invoices(business_id, invoice_number) where invoice_number is not null;
create index invoices_business_id_idx on public.invoices(business_id) where deleted_at is null;
create index invoices_business_status_idx on public.invoices(business_id, status) where deleted_at is null;
create index invoices_customer_id_idx on public.invoices(customer_id) where deleted_at is null;

alter table public.invoices enable row level security;
alter table public.invoices force row level security;

revoke all on public.invoices from anon, authenticated;
grant select, update on public.invoices to authenticated;

-- Column-restricted insert: subtotal/tax/total, invoice_number, status, issued_at,
-- issuance_idempotency_key and void_reason must never be settable by the client, even at
-- creation — the with_check clause below stops status/invoice_number specifically, but the
-- totals otherwise have no enforcement until the first line-item recompute fires.
grant insert (
  business_id, customer_id, customer_display_name, customer_email, customer_phone,
  customer_address_line1, customer_address_line2, customer_city, customer_region,
  customer_postal_code, customer_country_code, customer_tax_id,
  currency_code, currency_exponent, tax_basis_points, due_at, notes, created_by
) on public.invoices to authenticated;

create policy invoices_read on public.invoices for select to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.read'))
  );

create policy invoices_insert on public.invoices for insert to authenticated
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.create'))
    and created_by = (select auth.uid())
    and status = 'draft'
    and invoice_number is null
  );

-- Direct REST updates are only ever legal while the row is still a draft; issuing and
-- voiding go through the RPCs below instead, which is also where invoice_number,
-- status, issued_at and the computed totals are written.
create policy invoices_update on public.invoices for update to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.update'))
    and status = 'draft'
  )
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.update'))
    and status = 'draft'
  );

revoke update on public.invoices from authenticated;
grant update (
  customer_id, customer_display_name, customer_email, customer_phone,
  customer_address_line1, customer_address_line2, customer_city, customer_region,
  customer_postal_code, customer_country_code, customer_tax_id,
  currency_code, currency_exponent, tax_basis_points, due_at, notes,
  deleted_at, deleted_by, deletion_reason
) on public.invoices to authenticated;

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function private.set_updated_at();

-- Line items belong to a draft. They are subordinate editing state, not their own financial
-- record, so unlike customers/products they are genuinely deletable rather than soft-deleted
-- — the invoice itself is the unit that gets soft-deleted or voided.
create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  business_id uuid not null references public.businesses(id),
  position integer not null default 0,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(18, 3) not null check (quantity > 0),
  unit_price_minor_units bigint not null check (unit_price_minor_units >= 0),
  line_total_minor_units bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoice_line_items_invoice_id_idx on public.invoice_line_items(invoice_id);

alter table public.invoice_line_items enable row level security;
alter table public.invoice_line_items force row level security;

revoke all on public.invoice_line_items from anon, authenticated;
grant select, insert, update, delete on public.invoice_line_items to authenticated;

create policy invoice_line_items_read on public.invoice_line_items for select to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.read'))
  );

create policy invoice_line_items_insert on public.invoice_line_items for insert to authenticated
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.update'))
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.business_id = invoice_line_items.business_id and i.status = 'draft'
    )
  );

create policy invoice_line_items_update on public.invoice_line_items for update to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.update'))
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft')
  )
  with check (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.update'))
  );

create policy invoice_line_items_delete on public.invoice_line_items for delete to authenticated
  using (
    business_id in (select private.user_business_ids())
    and (select private.has_business_permission(business_id, 'invoices.update'))
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft')
  );

revoke update on public.invoice_line_items from authenticated;
grant update (description, quantity, unit_price_minor_units, position) on public.invoice_line_items to authenticated;

create trigger invoice_line_items_set_updated_at
  before update on public.invoice_line_items
  for each row execute function private.set_updated_at();

-- Line totals and invoice totals are always server-computed, never trusted from the client.
create or replace function private.set_line_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.line_total_minor_units = round(new.unit_price_minor_units * new.quantity);
  return new;
end;
$$;

create trigger invoice_line_items_set_line_total
  before insert or update of quantity, unit_price_minor_units on public.invoice_line_items
  for each row execute function private.set_line_total();

create or replace function private.recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  computed_subtotal bigint;
  basis_points integer;
  computed_tax bigint;
begin
  select coalesce(sum(line_total_minor_units), 0) into computed_subtotal
  from public.invoice_line_items where invoice_id = p_invoice_id;

  select tax_basis_points into basis_points from public.invoices where id = p_invoice_id;
  computed_tax := (computed_subtotal * basis_points + 5000) / 10000;

  update public.invoices
  set subtotal_minor_units = computed_subtotal,
      tax_minor_units = computed_tax,
      total_minor_units = computed_subtotal + computed_tax
  where id = p_invoice_id;
end;
$$;

revoke all on function private.recompute_invoice_totals(uuid) from public;

create or replace function private.invoice_line_items_recompute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return null;
end;
$$;

create trigger invoice_line_items_recompute_totals
  after insert or update or delete on public.invoice_line_items
  for each row execute function private.invoice_line_items_recompute();

-- Changing the tax rate on a draft must also re-run the computation. Scoped to the
-- tax_basis_points column specifically so recompute_invoice_totals's own UPDATE (which never
-- touches that column) cannot re-trigger this and recurse.
create or replace function private.invoice_tax_rate_recompute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_invoice_totals(new.id);
  return null;
end;
$$;

create trigger invoices_recompute_on_tax_change
  after update of tax_basis_points on public.invoices
  for each row execute function private.invoice_tax_rate_recompute();

-- Issue a draft: allocates the next number for this business/document type and locks the
-- invoice row first so two concurrent issue attempts on the SAME invoice cannot race. Callers
-- must pass a client-generated idempotency key; a retry with the same key on an
-- already-issued invoice is a no-op rather than an error or a second number.
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
      return; -- already issued by this exact request; nothing to do
    end if;
    raise exception 'This invoice has already been issued';
  end if;

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

-- Void an issued invoice. The number is never reused (plan §9) — voiding only flips status.
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target record;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  select id, business_id, status into target
  from public.invoices
  where id = p_invoice_id and deleted_at is null
  for update;

  if target is null then raise exception 'Invoice not found'; end if;
  if target.status = 'draft' or target.status = 'void' then
    raise exception 'Only an issued invoice can be voided';
  end if;
  if not (select private.has_business_permission(target.business_id, 'invoices.void')) then
    raise exception 'You do not have permission to void invoices for this business';
  end if;

  update public.invoices
  set status = 'void', void_reason = p_reason, updated_at = now()
  where id = p_invoice_id;

  perform private.record_audit_event(
    target.business_id, 'business_member', 'invoice.voided', 'invoice', p_invoice_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

revoke all on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;
