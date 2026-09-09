import type { SupabaseClient } from '@supabase/supabase-js'
import { BusinessId, InvoiceId, PaymentId } from '../../domain/shared/EntityId'
import type {
  Payment,
  PaymentMethod,
  PaymentRepository,
  PaymentStatus,
  RecordPaymentCommand,
  RecordStandalonePaymentCommand,
} from '../../application/ports/PaymentRepository'

interface PaymentRow {
  id: string
  invoice_id: string | null
  customer_display_name: string
  amount_minor_units: string | number
  currency_code: string
  currency_exponent: number
  payment_method: PaymentMethod
  reference: string | null
  notes: string | null
  paid_at: string
  status: PaymentStatus
  reversal_reason: string | null
  invoices: { invoice_number: number | null } | { invoice_number: number | null }[] | null
  receipts: { id: string; status: string }[] | null
}

const PAYMENT_COLUMNS =
  'id, invoice_id, customer_display_name, amount_minor_units, currency_code, currency_exponent, payment_method, reference, notes, paid_at, status, reversal_reason, invoices(invoice_number), receipts(id, status)'

export class SupabasePaymentRepository implements PaymentRepository {
  public constructor(private readonly client: SupabaseClient) {}

  public async listForInvoice(invoiceId: InvoiceId): Promise<readonly Payment[]> {
    const { data, error } = await this.client
      .from('payments')
      .select(PAYMENT_COLUMNS)
      .eq('invoice_id', invoiceId.toString())
      .order('paid_at', { ascending: false })
    if (error) throw error
    return (data as unknown as PaymentRow[]).map((row) => this.toDomain(row))
  }

  public async listForBusiness(businessId: BusinessId): Promise<readonly Payment[]> {
    const { data, error } = await this.client
      .from('payments')
      .select(PAYMENT_COLUMNS)
      .eq('business_id', businessId.toString())
      .order('paid_at', { ascending: false })
    if (error) throw error
    return (data as unknown as PaymentRow[]).map((row) => this.toDomain(row))
  }

  public async record(command: RecordPaymentCommand): Promise<PaymentId> {
    const { data, error } = await this.client.rpc('record_payment', {
      p_invoice_id: command.invoiceId.toString(),
      p_amount_minor_units: command.amountMinorUnits.toString(),
      p_payment_method: command.paymentMethod,
      p_reference: command.reference,
      p_notes: command.notes,
      p_idempotency_key: command.idempotencyKey,
    })
    if (error) throw error
    return PaymentId.from(data as string)
  }

  public async recordStandalone(command: RecordStandalonePaymentCommand): Promise<PaymentId> {
    const { data, error } = await this.client.rpc('record_standalone_payment', {
      p_business_id: command.businessId.toString(),
      p_customer_display_name: command.customerDisplayName,
      p_customer_email: command.customerEmail,
      p_customer_phone: command.customerPhone,
      p_amount_minor_units: command.amountMinorUnits.toString(),
      p_currency_code: command.currencyCode,
      p_currency_exponent: command.currencyExponent,
      p_payment_method: command.paymentMethod,
      p_reference: command.reference,
      p_notes: command.notes,
      p_idempotency_key: command.idempotencyKey,
    })
    if (error) throw error
    return PaymentId.from(data as string)
  }

  public async reverse(paymentId: PaymentId, reason: string | null): Promise<void> {
    const { error } = await this.client.rpc('reverse_payment', { p_payment_id: paymentId.toString(), p_reason: reason })
    if (error) throw error
  }

  private toDomain(row: PaymentRow): Payment {
    const invoiceRelation = Array.isArray(row.invoices) ? row.invoices[0] : row.invoices
    return {
      id: PaymentId.from(row.id),
      invoiceId: row.invoice_id ? InvoiceId.from(row.invoice_id) : null,
      invoiceNumber: invoiceRelation?.invoice_number ?? null,
      customerDisplayName: row.customer_display_name,
      amountMinorUnits: BigInt(row.amount_minor_units),
      currencyCode: row.currency_code,
      currencyExponent: row.currency_exponent,
      paymentMethod: row.payment_method,
      reference: row.reference,
      notes: row.notes,
      paidAt: new Date(row.paid_at),
      status: row.status,
      reversalReason: row.reversal_reason,
      activeReceiptId: (row.receipts ?? []).find((receipt) => receipt.status === 'issued')?.id ?? null,
    }
  }
}
