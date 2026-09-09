-- invoice_line_items_recompute() and invoice_tax_rate_recompute() call
-- private.recompute_invoice_totals(), which has EXECUTE revoked from public. As plain
-- (non-definer) trigger functions they ran as the invoking `authenticated` role and had no
-- grant to call it, so every line-item insert/update/delete failed with
-- "permission denied for function recompute_invoice_totals". Making the trigger functions
-- SECURITY DEFINER runs them as their owner, matching the pattern already used by
-- create_business calling private.record_audit_event.
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
