import type { SupabaseClient } from '@supabase/supabase-js'
import { BusinessId, PaymentId } from '../../domain/shared/EntityId'
import type { Receipt, ReceiptLineItem, ReceiptRepository, ReceiptStatus } from '../../application/ports/ReceiptRepository'
import type { PaymentMethod, PaymentStatus } from '../../application/ports/PaymentRepository'

interface ReceiptRow {
  id: string
  receipt_number: number | null
  status: ReceiptStatus
  issued_at: string
  void_reason: string | null
  payments: PaymentRelation | PaymentRelation[] | null
}

interface InvoiceLineRelation {
  description: string
  quantity: string | number
  unit_price_minor_units: string | number
  line_total_minor_units: string | number
  position: number
}

interface InvoiceRelation {
  invoice_number: number | null
  invoice_line_items: InvoiceLineRelation[] | null
}

interface PaymentRelation {
  id: string
  customer_display_name: string
  customer_email: string | null
  amount_minor_units: string | number
  currency_code: string
  currency_exponent: number
  payment_method: PaymentMethod
  reference: string | null
  status: PaymentStatus
  invoices: InvoiceRelation | InvoiceRelation[] | null
}

const RECEIPT_COLUMNS =
  'id, receipt_number, status, issued_at, void_reason, ' +
  'payments(id, customer_display_name, customer_email, amount_minor_units, currency_code, currency_exponent, payment_method, reference, status, ' +
  'invoices(invoice_number, invoice_line_items(description, quantity, unit_price_minor_units, line_total_minor_units, position)))'

export class SupabaseReceiptRepository implements ReceiptRepository {
  public constructor(private readonly client: SupabaseClient) {}

  public async listForBusiness(businessId: BusinessId): Promise<readonly Receipt[]> {
    const { data, error } = await this.client
      .from('receipts')
      .select(RECEIPT_COLUMNS)
      .eq('business_id', businessId.toString())
      .order('issued_at', { ascending: false })
    if (error) throw error
    return (data as unknown as ReceiptRow[]).map((row) => this.toDomain(row))
  }

  public async findById(id: string): Promise<Receipt | null> {
    const { data, error } = await this.client
      .from('receipts')
      .select(RECEIPT_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data ? this.toDomain(data as unknown as ReceiptRow) : null
  }

  public async issue(paymentId: PaymentId): Promise<string> {
    const { data, error } = await this.client.rpc('issue_receipt', { p_payment_id: paymentId.toString() })
    if (error) throw error
    return data as string
  }

  private toDomain(row: ReceiptRow): Receipt {
    const payment = Array.isArray(row.payments) ? row.payments[0] : row.payments
    if (!payment) throw new Error('Receipt is missing its payment record')
    const invoiceRelation = Array.isArray(payment.invoices) ? payment.invoices[0] : payment.invoices

    return {
      id: row.id,
      receiptNumber: row.receipt_number,
      status: row.status,
      issuedAt: new Date(row.issued_at),
      voidReason: row.void_reason,
      payment: {
        id: PaymentId.from(payment.id),
        customerDisplayName: payment.customer_display_name,
        customerEmail: payment.customer_email,
        amountMinorUnits: BigInt(payment.amount_minor_units),
        currencyCode: payment.currency_code,
        currencyExponent: payment.currency_exponent,
        paymentMethod: payment.payment_method,
        reference: payment.reference,
        status: payment.status,
      },
      invoice: invoiceRelation
        ? {
            invoiceNumber: invoiceRelation.invoice_number,
            lines: (invoiceRelation.invoice_line_items ?? [])
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((line): ReceiptLineItem => ({
                description: line.description,
                quantity: String(line.quantity),
                unitPriceMinorUnits: BigInt(line.unit_price_minor_units),
                lineTotalMinorUnits: BigInt(line.line_total_minor_units),
              })),
          }
        : null,
    }
  }
}
