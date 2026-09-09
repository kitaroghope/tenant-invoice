-- Branding fields (logo, colors, template, address, prefixes) live on the same businesses
-- row as core identity, so someone with only branding.manage (not the broader
-- business.manage) should still be able to save them. Column-level grants already keep
-- non-branding-only roles from touching anything else meaningful.
drop policy businesses_update on public.businesses;

create policy businesses_update on public.businesses for update to authenticated
  using (
    (select private.has_business_permission(id, 'business.manage'))
    or (select private.has_business_permission(id, 'branding.manage'))
  )
  with check (
    (select private.has_business_permission(id, 'business.manage'))
    or (select private.has_business_permission(id, 'branding.manage'))
  );
