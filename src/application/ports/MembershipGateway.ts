export interface AssignableRole {
  id: string
  code: string
  name: string
}

export interface MemberRow {
  membershipId: string
  roleId: string
  roleName: string
  status: 'invited' | 'active' | 'suspended'
  invitedAt: string | null
  createdAt: string
}

export interface InviteMemberCommand {
  businessId: string
  email: string
  roleId: string
}

export interface MembershipGateway {
  listAssignableRoles(): Promise<readonly AssignableRole[]>
  listMembers(businessId: string): Promise<readonly MemberRow[]>
  invite(command: InviteMemberCommand): Promise<void>
  revoke(membershipId: string): Promise<void>
  resend(membershipId: string): Promise<void>
  accept(token: string): Promise<string>
}
