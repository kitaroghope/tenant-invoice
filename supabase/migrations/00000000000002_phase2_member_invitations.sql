-- Invitation metadata on business_memberships
alter table public.business_memberships
  add column invited_by uuid references auth.users(id),
  add column invited_at timestamptz,
  add column invitation_token_hash text,
  add column invitation_expires_at timestamptz;

create unique index business_memberships_token_hash_uidx
  on public.business_memberships(invitation_token_hash)
  where invitation_token_hash is not null;

-- Create a pending invitation. Caller must already have members.manage on the business.
-- p_user_id is resolved beforehand (Edge Function side) to a real auth.users id, whether
-- that account already existed or was just created for this invite.
create or replace function public.create_invitation(
  p_business_id uuid,
  p_user_id uuid,
  p_role_id uuid
)
returns table (membership_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_membership_id uuid;
  raw_token text;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not (select private.has_business_permission(p_business_id, 'members.manage')) then
    raise exception 'You do not have permission to invite members to this business';
  end if;
  if not exists (
    select 1 from public.roles
    where id = p_role_id and deleted_at is null
      and (business_id is null or business_id = p_business_id)
  ) then
    raise exception 'Invalid role for this business';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  begin
    insert into public.business_memberships
      (business_id, user_id, role_id, status, invited_by, invited_at, invitation_token_hash, invitation_expires_at)
    values
      (p_business_id, p_user_id, p_role_id, 'invited', caller_id, now(),
       encode(extensions.digest(raw_token, 'sha256'), 'hex'), now() + interval '7 days')
    returning id into new_membership_id;
  exception
    when unique_violation then
      raise exception 'This person already has an active or pending membership in this business';
  end;

  perform private.record_audit_event(
    p_business_id, 'business_member', 'member.invited', 'business_membership', new_membership_id,
    jsonb_build_object('role_id', p_role_id)
  );

  return query select new_membership_id, raw_token;
end;
$$;

revoke all on function public.create_invitation(uuid, uuid, uuid) from public, anon;
grant execute on function public.create_invitation(uuid, uuid, uuid) to authenticated;

-- Accept a pending invitation. Caller must be signed in as the invited account.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  found_membership record;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  select id, business_id, user_id into found_membership
  from public.business_memberships
  where invitation_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and status = 'invited'
    and deleted_at is null
    and invitation_expires_at > now();

  if found_membership is null then
    raise exception 'This invitation is no longer valid';
  end if;

  if found_membership.user_id <> caller_id then
    raise exception 'This invitation was sent to a different account. Sign in as the invited email and try again.';
  end if;

  update public.business_memberships
  set status = 'active', invitation_token_hash = null, invitation_expires_at = null, updated_at = now()
  where id = found_membership.id;

  perform private.record_audit_event(
    found_membership.business_id, 'business_member', 'member.invitation_accepted',
    'business_membership', found_membership.id, '{}'::jsonb
  );

  return found_membership.business_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- Revoke a pending invitation.
create or replace function public.revoke_invitation(p_membership_id uuid)
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
  from public.business_memberships
  where id = p_membership_id and deleted_at is null;

  if target is null then raise exception 'Invitation not found'; end if;
  if target.status <> 'invited' then raise exception 'Only a pending invitation can be revoked'; end if;
  if not (select private.has_business_permission(target.business_id, 'members.manage')) then
    raise exception 'You do not have permission to manage members for this business';
  end if;

  update public.business_memberships
  set deleted_at = now(), deleted_by = caller_id, deletion_reason = 'invitation_revoked',
      invitation_token_hash = null, invitation_expires_at = null, updated_at = now()
  where id = p_membership_id;

  perform private.record_audit_event(
    target.business_id, 'business_member', 'member.invitation_revoked',
    'business_membership', p_membership_id, '{}'::jsonb
  );
end;
$$;

revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- Resend: issue a fresh token and expiry for a still-pending invitation.
create or replace function public.resend_invitation(p_membership_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target record;
  raw_token text;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  select id, business_id, status into target
  from public.business_memberships
  where id = p_membership_id and deleted_at is null;

  if target is null then raise exception 'Invitation not found'; end if;
  if target.status <> 'invited' then raise exception 'Only a pending invitation can be resent'; end if;
  if not (select private.has_business_permission(target.business_id, 'members.manage')) then
    raise exception 'You do not have permission to manage members for this business';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  update public.business_memberships
  set invitation_token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex'),
      invitation_expires_at = now() + interval '7 days',
      updated_at = now()
  where id = p_membership_id;

  perform private.record_audit_event(
    target.business_id, 'business_member', 'member.invitation_resent',
    'business_membership', p_membership_id, '{}'::jsonb
  );

  return raw_token;
end;
$$;

revoke all on function public.resend_invitation(uuid) from public, anon;
grant execute on function public.resend_invitation(uuid) to authenticated;
