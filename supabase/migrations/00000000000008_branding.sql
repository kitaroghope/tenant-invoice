-- Business profile and branding fields (plan §7). Kept on businesses directly rather than
-- a separate table since it's a strict one-to-one, and reuses the existing column-grant
-- restriction pattern already established for the table.
alter table public.businesses
  add column address_line1 text,
  add column address_line2 text,
  add column city text,
  add column region text,
  add column postal_code text,
  add column country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column tax_id text,
  add column invoice_prefix text check (invoice_prefix is null or length(invoice_prefix) <= 12),
  add column receipt_prefix text check (receipt_prefix is null or length(receipt_prefix) <= 12),
  add column payment_instructions text,
  add column accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  add column logo_asset_path text;

revoke update on public.businesses from authenticated;
grant update (
  legal_name, trading_name, default_currency_code, locale, timezone,
  address_line1, address_line2, city, region, postal_code, country_code, tax_id,
  invoice_prefix, receipt_prefix, payment_instructions, accent_color, logo_asset_path
) on public.businesses to authenticated;

-- Logos and other approved business assets. Tenant-scoped by business_id in the object
-- path (business-assets/{business_id}/logos/{asset_id}.ext); policies check both active
-- membership AND that the path segment matches, so a client can't point at another
-- business's folder even if they guess a UUID.
insert into storage.buckets (id, name, public)
values ('business-assets', 'business-assets', true)
on conflict (id) do nothing;

create policy business_assets_read on storage.objects for select to authenticated
  using (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_business_ids())
  );

create policy business_assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_business_ids())
    and (select private.has_business_permission((storage.foldername(name))[1]::uuid, 'branding.manage'))
  );

create policy business_assets_update on storage.objects for update to authenticated
  using (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_business_ids())
    and (select private.has_business_permission((storage.foldername(name))[1]::uuid, 'branding.manage'))
  )
  with check (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_business_ids())
    and (select private.has_business_permission((storage.foldername(name))[1]::uuid, 'branding.manage'))
  );

create policy business_assets_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1]::uuid in (select private.user_business_ids())
    and (select private.has_business_permission((storage.foldername(name))[1]::uuid, 'branding.manage'))
  );
