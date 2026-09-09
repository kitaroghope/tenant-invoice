import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import type { Business } from '../../domain/business/Business'

const emailSchema = z.email('Enter a valid email address')

export function MembersPage({ business }: { business: Business }) {
  const queryClient = useQueryClient()
  const businessId = business.id.toString()
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const roles = useQuery({
    queryKey: ['assignable-roles'],
    queryFn: () => container.membershipGateway.listAssignableRoles(),
  })
  const members = useQuery({
    queryKey: ['members', businessId],
    queryFn: () => container.membershipGateway.listMembers(businessId),
  })

  const invite = useMutation({
    mutationFn: (input: { email: string; roleId: string }) =>
      container.membershipGateway.invite({
        businessId,
        email: input.email,
        roleId: input.roleId,
      }),
    onSuccess: (_data, variables) => {
      setConfirmation(`Invitation sent to ${variables.email}.`)
      setEmail('')
      void queryClient.invalidateQueries({ queryKey: ['members', businessId] })
    },
  })

  const revoke = useMutation({
    mutationFn: (membershipId: string) => container.membershipGateway.revoke(membershipId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members', businessId] }),
  })

  const resend = useMutation({
    mutationFn: (membershipId: string) => container.membershipGateway.resend(membershipId),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setConfirmation(null)
    try {
      const validEmail = emailSchema.parse(email.trim().toLowerCase())
      if (!roleId) throw new Error('Choose a role')
      invite.mutate({ email: validEmail, roleId })
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to send that invitation')
    }
  }

  return (
    <div className="members-page">
      <div>
        <span className="eyebrow">Team</span>
        <h1>Members</h1>
      </div>

      <form className="invite-form" onSubmit={submit}>
        <span className="step-label">Invite someone</span>
        <div className="form-grid">
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required />
          </label>
          <label>
            Role
            <select value={roleId} onChange={(event) => setRoleId(event.target.value)} required disabled={roles.isLoading}>
              <option value="" disabled>{roles.isLoading ? 'Loading roles…' : 'Choose a role'}</option>
              {roles.data?.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <button className="primary" disabled={invite.isPending}>{invite.isPending ? 'Sending…' : 'Send invite'}</button>
        </div>
        {roles.error && <Banner tone="error">Could not load roles. Refresh and try again.</Banner>}
        {formError && <Banner tone="error">{formError}</Banner>}
        {invite.error && <Banner tone="error">{invite.error instanceof Error ? invite.error.message : 'Could not send that invitation'}</Banner>}
        {confirmation && <Banner tone="success">{confirmation}</Banner>}
      </form>

      <div>
        <span className="step-label">Everyone with access</span>
        {members.isLoading && <Loader fullRegion label="Loading members…" />}
        {members.error && <Banner tone="error">Could not load members for this business.</Banner>}
        {members.data && members.data.length <= 1 && <Banner tone="info">No one else has access yet. Invite your first team member above.</Banner>}
        {members.data && members.data.length > 0 && (
          <div className="member-list">
            {members.data.map((member) => (
              <div className="member-row" key={member.membershipId}>
                <div>
                  <span className={`status-pill ${member.status}`}>{member.status}</span>
                  <div className="member-role">{member.roleName}</div>
                </div>
                {member.status === 'invited' && (
                  <div className="member-actions">
                    <button onClick={() => resend.mutate(member.membershipId)} disabled={resend.isPending}>
                      {resend.isPending ? 'Resending…' : 'Resend'}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('Revoke this invitation? They will no longer be able to accept it.')) revoke.mutate(member.membershipId)
                      }}
                      disabled={revoke.isPending}
                    >
                      {revoke.isPending ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {resend.isSuccess && <Banner tone="success">A new invitation link has been emailed.</Banner>}
        {revoke.error && <Banner tone="error">Could not revoke that invitation.</Banner>}
      </div>
    </div>
  )
}
