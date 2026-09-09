import type { SupabaseClient } from '@supabase/supabase-js'
import { BusinessId, CustomerId, InvoiceId, InvoiceLineId, ProductId } from '../../domain/shared/EntityId'
import type {
  CreateDraftCommand,
  InvoiceDetail,
  InvoiceLineItem,
  InvoiceRepository,
  InvoiceStatus,
  InvoiceSummary,
  UpdateDraftCommand,
  UpsertLineCommand,
} from '../../application/ports/InvoiceRepository'
import type { DiscountType } from '../../domain/invoice/InvoiceDraft'

interface InvoiceRow {
  id: string
  business_id: string
  customer_id: string | null
  customer_display_name: string
  customer_email: string | null
  customer_phone: string | null
  currency_code: string
  currency_exponent: number
  status: InvoiceStatus
  invoice_number: number | null
  issued_at: string | null
  due_at: string | null
  tax_basis_points: number
  discount_type: DiscountType
  discount_value: string | number
  subtotal_minor_units: string | number
  discount_minor_units: string | number
  tax_minor_units: string | number
  total_minor_units: string | number
  amount_paid_minor_units: string | number
  notes: string | null
  created_at: string
}

interface LineRow {
  id: string
  description: string
  quantity: string | number
  unit_price_minor_units: string | number
  line_total_minor_units: string | number
  position: number
  product_id: string | null
}

const SUMMARY_COLUMNS =
  'id, business_id, customer_id, customer_display_name, customer_email, customer_phone, currency_code, currency_exponent, status, invoice_number, issued_at, due_at, tax_basis_points, discount_type, discount_value, subtotal_minor_units, discount_minor_units, tax_minor_units, total_minor_units, amount_paid_minor_units, notes, created_at'

export class SupabaseInvoiceRepository implements InvoiceRepository {
  public constructor(private readonly client: SupabaseClient) {}

  public async listActive(businessId: BusinessId): Promise<readonly InvoiceSummary[]> {
    const { data, error } = await this.client
      .from('invoices')
      .select(SUMMARY_COLUMNS)
      .eq('business_id', businessId.toString())
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as unknown as InvoiceRow[]).map((row) => this.toSummary(row))
  }

  public async listDeleted(businessId: BusinessId): Promise<readonly InvoiceSummary[]> {
    const { data, error } = await this.client
      .from('invoices')
      .select(SUMMARY_COLUMNS)
      .eq('business_id', businessId.toString())
      .not('deleted_at', 'is', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as unknown as InvoiceRow[]).map((row) => this.toSummary(row))
  }

  public async findById(id: InvoiceId): Promise<InvoiceDetail | null> {
    const { data, error } = await this.client
      .from('invoices')
      .select(SUMMARY_COLUMNS)
      .eq('id', id.toString())
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    const { data: lineRows, error: lineError } = await this.client
      .from('invoice_line_items')
      .select('id, description, quantity, unit_price_minor_units, line_total_minor_units, position, product_id')
      .eq('invoice_id', id.toString())
      .order('position')
    if (lineError) throw lineError

    const row = data as unknown as InvoiceRow
    return {
      ...this.toSummary(row),
      customerId: row.customer_id ? CustomerId.from(row.customer_id) : null,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      taxBasisPoints: row.tax_basis_points,
      discountType: row.discount_type,
      discountValue: BigInt(row.discount_value),
      subtotalMinorUnits: BigInt(row.subtotal_minor_units),
      discountMinorUnits: BigInt(row.discount_minor_units),
      taxMinorUnits: BigInt(row.tax_minor_units),
      notes: row.notes,
      dueAt: row.due_at ? new Date(row.due_at) : null,
      lines: (lineRows as unknown as LineRow[]).map((line) => this.toLine(line)),
    }
  }

  public async createDraft(command: CreateDraftCommand): Promise<InvoiceId> {
    const { data: userData, error: userError } = await this.client.auth.getUser()
    if (userError) throw userError
    const createdBy = userData.user?.id
    if (!createdBy) throw new Error('Authentication required')

    const { data, error } = await this.client
      .from('invoices')
      .insert({
        business_id: command.businessId.toString(),
        customer_id: command.customerId?.toString() ?? null,
        customer_display_name: command.customerDisplayName,
        customer_email: command.customerEmail,
        customer_phone: command.customerPhone,
        currency_code: command.currencyCode,
        currency_exponent: command.currencyExponent,
        tax_basis_points: command.taxBasisPoints,
        discount_type: command.discountType,
        discount_value: command.discountValue.toString(),
        due_at: command.dueAt?.toISOString() ?? null,
        notes: command.notes,
        created_by: createdBy,
      })
      .select('id')
      .single()
    if (error) throw error
    return InvoiceId.from((data as { id: string }).id)
  }

  public async updateDraft(id: InvoiceId, command: UpdateDraftCommand): Promise<void> {
    const { error } = await this.client
      .from('invoices')
      .update({
        customer_id: command.customerId?.toString() ?? null,
        customer_display_name: command.customerDisplayName,
        customer_email: command.customerEmail,
        customer_phone: command.customerPhone,
        tax_basis_points: command.taxBasisPoints,
        discount_type: command.discountType,
        discount_value: command.discountValue.toString(),
        due_at: command.dueAt?.toISOString() ?? null,
        notes: command.notes,
      })
      .eq('id', id.toString())
    if (error) throw error
  }

  public async addLine(invoiceId: InvoiceId, businessId: BusinessId, command: UpsertLineCommand): Promise<InvoiceLineId> {
    const { data, error } = await this.client
      .from('invoice_line_items')
      .insert({
        invoice_id: invoiceId.toString(),
        business_id: businessId.toString(),
        description: command.description,
        quantity: command.quantity,
        unit_price_minor_units: command.unitPriceMinorUnits.toString(),
        position: command.position,
        product_id: command.productId?.toString() ?? null,
      })
      .select('id')
      .single()
    if (error) throw error
    return InvoiceLineId.from((data as { id: string }).id)
  }

  public async updateLine(lineId: InvoiceLineId, command: UpsertLineCommand): Promise<void> {
    const { error } = await this.client
      .from('invoice_line_items')
      .update({
        description: command.description,
        quantity: command.quantity,
        unit_price_minor_units: command.unitPriceMinorUnits.toString(),
        position: command.position,
        product_id: command.productId?.toString() ?? null,
      })
      .eq('id', lineId.toString())
    if (error) throw error
  }

  public async removeLine(lineId: InvoiceLineId): Promise<void> {
    const { error } = await this.client.from('invoice_line_items').delete().eq('id', lineId.toString())
    if (error) throw error
  }

  public async issue(id: InvoiceId, idempotencyKey: string): Promise<void> {
    const { error } = await this.client.rpc('issue_invoice', {
      p_invoice_id: id.toString(),
      p_idempotency_key: idempotencyKey,
    })
    if (error) throw error
  }

  public async voidInvoice(id: InvoiceId, reason: string | null): Promise<void> {
    const { error } = await this.client.rpc('void_invoice', { p_invoice_id: id.toString(), p_reason: reason })
    if (error) throw error
  }

  public async softDeleteDraft(id: InvoiceId, reason: string | null): Promise<void> {
    const { data: userData, error: userError } = await this.client.auth.getUser()
    if (userError) throw userError
    const deletedBy = userData.user?.id
    if (!deletedBy) throw new Error('Authentication required')

    const { error } = await this.client
      .from('invoices')
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy, deletion_reason: reason })
      .eq('id', id.toString())
    if (error) throw error
  }

  public async restoreDraft(id: InvoiceId): Promise<void> {
    const { error } = await this.client
      .from('invoices')
      .update({ deleted_at: null, deleted_by: null, deletion_reason: null })
      .eq('id', id.toString())
    if (error) throw error
  }

  private toSummary(row: InvoiceRow): InvoiceSummary {
    return {
      id: InvoiceId.from(row.id),
      businessId: BusinessId.from(row.business_id),
      status: row.status,
      invoiceNumber: row.invoice_number,
      customerDisplayName: row.customer_display_name,
      currencyCode: row.currency_code,
      currencyExponent: row.currency_exponent,
      totalMinorUnits: BigInt(row.total_minor_units),
      amountPaidMinorUnits: BigInt(row.amount_paid_minor_units),
      issuedAt: row.issued_at ? new Date(row.issued_at) : null,
      dueAt: row.due_at ? new Date(row.due_at) : null,
      createdAt: new Date(row.created_at),
    }
  }

  private toLine(row: LineRow): InvoiceLineItem {
    return {
      id: InvoiceLineId.from(row.id),
      description: row.description,
      quantity: String(row.quantity),
      unitPriceMinorUnits: BigInt(row.unit_price_minor_units),
      lineTotalMinorUnits: BigInt(row.line_total_minor_units),
      position: row.position,
      productId: row.product_id ? ProductId.from(row.product_id) : null,
    }
  }
}
