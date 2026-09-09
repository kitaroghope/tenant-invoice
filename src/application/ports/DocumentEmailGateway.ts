export type EmailResourceType = 'invoice' | 'receipt'
export type EmailMessageStatus = 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed'

export interface EmailMessage {
  id: string
  recipientEmail: string
  subject: string
  status: EmailMessageStatus
  errorMessage: string | null
  sentAt: Date | null
  createdAt: Date
}

export interface DocumentEmailGateway {
  listForResource(businessId: string, resourceType: EmailResourceType, resourceId: string): Promise<readonly EmailMessage[]>
  send(businessId: string, resourceType: EmailResourceType, resourceId: string, recipientEmail: string): Promise<void>
}
