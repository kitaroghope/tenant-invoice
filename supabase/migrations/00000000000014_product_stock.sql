-- Optional per-product stock tracking. stock_quantity is nullable: null means "not tracked"
-- (services, or any product the business doesn't want inventory control on) and is left alone
-- by the invoice triggers below. A non-null value is decremented when an invoice line
-- referencing the product is issued, and the business explicitly asked for this to be allowed
-- to go negative rather than blocking or clamping an oversold item.
alter table public.products
  add column stock_quantity numeric(18, 3);

revoke update on public.products from authenticated;
grant update (
  name, description, sku, unit, default_tax_rate_basis_points, stock_quantity,
  deleted_at, deleted_by, deletion_reason
) on public.products to authenticated;

-- Invoice lines may optionally point at a catalog product. This is a convenience link for
-- prefill and stock accounting only — description/quantity/unit_price on the line remain the
-- financial record, so deleting or repricing a product later never rewrites an issued invoice.
alter table public.invoice_line_items
  add column product_id uuid references public.products(id);

revoke update on public.invoice_line_items from authenticated;
grant update (description, quantity, unit_price_minor_units, position, product_id) on public.invoice_line_items to authenticated;

-- A line's product must belong to the same business as the line itself; without this check a
-- client could reference another tenant's product row (readable columns only, but still a
-- cross-tenant reference we don't want in the data).
create or replace function private.validate_line_item_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_id is not null and not exists (
    select 1 from public.products p where p.id = new.product_id and p.business_id = new.business_id
  ) then
    raise exception 'Product does not belong to this business';
  end if;
  return new;
end;
$$;

create trigger invoice_line_items_validate_product
  before insert or update of product_id on public.invoice_line_items
  for each row execute function private.validate_line_item_product();

-- Applies (or reverses, with p_sign = -1) the stock impact of every line on an invoice that
-- references a stock-tracked product. Negative stock_quantity is allowed on purpose.
create or replace function private.apply_invoice_stock_delta(p_invoice_id uuid, p_sign integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products p
  set stock_quantity = p.stock_quantity - (p_sign * li.quantity)
  from public.invoice_line_items li
  where li.invoice_id = p_invoice_id
    and li.product_id = p.id
    and p.stock_quantity is not null;
end;
$$;

revoke all on function private.apply_invoice_stock_delta(uuid, integer) from public;

-- Re-declare issue_invoice to also debit stock for lines with a tracked product, once, at the
-- moment the invoice is finalized (not while it's still an editable draft).
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

  perform private.apply_invoice_stock_delta(p_invoice_id, 1);

  perform private.record_audit_event(
    target.business_id, 'business_member', 'invoice.issued', 'invoice', p_invoice_id,
    jsonb_build_object('invoice_number', allocated)
  );
end;
$$;

revoke all on function public.issue_invoice(uuid, uuid) from public, anon;
grant execute on function public.issue_invoice(uuid, uuid) to authenticated;

-- Re-declare void_invoice to credit the stock back — a voided invoice never happened, and
-- stock reserved for it should return to the pool.
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

  perform private.apply_invoice_stock_delta(p_invoice_id, -1);

  perform private.record_audit_event(
    target.business_id, 'business_member', 'invoice.voided', 'invoice', p_invoice_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

revoke all on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;
