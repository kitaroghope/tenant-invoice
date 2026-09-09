import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AssignableRole,
  InviteMemberCommand,
  MembershipGateway,
  MemberRow,
} from '../../application/ports/MembershipGateway'

interface MembershipRow {
  id: string
  role_id: string
  status: 'invited' | 'active' | 'suspended'
  invited_at: string | null
  created_at: string
  roles: { name: string } | null
}

export class SupabaseMembershipGateway implements MembershipGateway {
  public constructor(private readonly client: SupabaseClient) {}

  public async listAssignableRoles(): Promise<readonly AssignableRole[]> {
    const { data, error } = await this.client
      .from('roles')
      .select('id, code, name')
      .is('business_id', null)
      .is('deleted_at', null)
      .neq('code', 'owner')
      .order('name')
    if (error) throw error
    return data as AssignableRole[]
  }

  public async listMembers(businessId: string): Promise<readonly MemberRow[]> {
    const { data, error } = await this.client
      .from('business_memberships')
      .select('id, role_id, status, invited_at, created_at, roles(name)')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as unknown as MembershipRow[]).map((row) => ({
      membershipId: row.id,
      roleId: row.role_id,
      roleName: row.roles?.name ?? 'Member',
      status: row.status,
      invitedAt: row.invited_at,
      createdAt: row.created_at,
    }))
  }

  public async invite(command: InviteMemberCommand): Promise<void> {
    const { data, error } = await this.client.functions.invoke('invite-member', {
      body: {
        businessId: command.businessId,
        email: command.email,
        roleId: command.roleId,
      },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
  }

  public async revoke(membershipId: string): Promise<void> {
    const { error } = await this.client.rpc('revoke_invitation', { p_membership_id: membershipId })
    if (error) throw error
  }

  public async resend(membershipId: string): Promise<void> {
    const { data, error } = await this.client.functions.invoke('resend-invitation', {
      body: { membershipId },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
  }

  public async accept(token: string): Promise<string> {
    const { data, error } = await this.client.rpc('accept_invitation', { p_token: token })
    if (error) throw error
    return data as string
  }
}
