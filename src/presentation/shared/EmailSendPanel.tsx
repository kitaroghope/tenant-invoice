import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { container } from '../../shared/container'
import { Banner } from './Banner'
import type { EmailResourceType } from '../../application/ports/DocumentEmailGateway'

export function EmailSendPanel({
  businessId,
  resourceType,
  resourceId,
  defaultRecipientEmail,
}: {
  businessId: string
  resourceType: EmailResourceType
  resourceId: string
  defaultRecipientEmail: string | null
}) {
  const queryClient = useQueryClient()
  const queryKey = ['email-messages', resourceType, resourceId]
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipientEmail ?? '')

  const history = useQuery({
    queryKey,
    queryFn: () => container.documentEmailGateway.listForResource(businessId, resourceType, resourceId),
  })

  const send = useMutation({
    mutationFn: () => container.documentEmailGateway.send(businessId, resourceType, resourceId, recipientEmail.trim()),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  })

  return (
    <div className="email-send-panel no-print">
      <span className="step-label">Email this {resourceType}</span>
      <div className="form-grid customer-form-grid">
        <label>
          Recipient email
          <input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="customer@example.com" />
        </label>
        <button className="secondary" disabled={send.isPending || !recipientEmail.trim()} onClick={() => send.mutate()}>
          {send.isPending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {send.error && <Banner tone="error">{send.error instanceof Error ? send.error.message : 'Could not send this email.'}</Banner>}
      {send.isSuccess && <Banner tone="success">Email sent to {recipientEmail}.</Banner>}

      {history.data && history.data.length > 0 && (
        <div className="email-history">
          {history.data.map((message) => (
            <div className="email-history-row" key={message.id}>
              <span className={`status-pill ${message.status === 'failed' ? 'suspended' : message.status === 'sent' || message.status === 'delivered' ? 'active' : 'invited'}`}>
                {message.status}
              </span>
              <span>{message.recipientEmail}</span>
              <small>{(message.sentAt ?? message.createdAt).toLocaleString()}</small>
              {message.errorMessage && <small className="email-history-error">{message.errorMessage}</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
