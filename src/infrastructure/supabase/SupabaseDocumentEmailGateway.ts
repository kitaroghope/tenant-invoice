import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DocumentEmailGateway,
  EmailMessage,
  EmailMessageStatus,
  EmailResourceType,
} from '../../application/ports/DocumentEmailGateway'

interface EmailMessageDbRow {
  id: string
  recipient_email: string
  subject: string
  status: EmailMessageStatus
  error_message: string | null
  sent_at: string | null
  created_at: string
}

export class SupabaseDocumentEmailGateway implements DocumentEmailGateway {
  public constructor(private readonly client: SupabaseClient) {}

  public async listForResource(businessId: string, resourceType: EmailResourceType, resourceId: string): Promise<readonly EmailMessage[]> {
    const { data, error } = await this.client
      .from('email_messages')
      .select('id, recipient_email, subject, status, error_message, sent_at, created_at')
      .eq('business_id', businessId)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as EmailMessageDbRow[]).map((row) => ({
      id: row.id,
      recipientEmail: row.recipient_email,
      subject: row.subject,
      status: row.status,
      errorMessage: row.error_message,
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
      createdAt: new Date(row.created_at),
    }))
  }

  public async send(businessId: string, resourceType: EmailResourceType, resourceId: string, recipientEmail: string): Promise<void> {
    const { data, error } = await this.client.functions.invoke('send-document-email', {
      body: { businessId, resourceType, resourceId, recipientEmail },
    })
    if (error) throw new Error(await extractFunctionErrorMessage(error))
    if (data?.error) throw new Error(data.error)
  }
}

// A non-2xx Edge Function response surfaces here as a FunctionsHttpError whose generic
// message ("Edge Function returned a non-2xx status code") hides the JSON {error: "..."}
// body the function actually sent — that body lives on error.context, a Response object,
// and has to be parsed separately to recover the real message.
async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // Response body wasn't JSON; fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : 'Could not send this email'
}
