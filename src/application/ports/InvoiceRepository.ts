import { BusinessId, CustomerId, InvoiceId, InvoiceLineId, ProductId } from '../../domain/shared/EntityId'
import type { DiscountType } from '../../domain/invoice/InvoiceDraft'

export type InvoiceStatus = 'draft' | 'issued' | 'sent' | 'partially_paid' | 'paid' | 'void'

export interface InvoiceLineItem {
  id: InvoiceLineId
  description: string
  quantity: string
  unitPriceMinorUnits: bigint
  lineTotalMinorUnits: bigint
  position: number
  productId: ProductId | null
}

export interface InvoiceSummary {
  id: InvoiceId
  businessId: BusinessId
  status: InvoiceStatus
  invoiceNumber: number | null
  customerDisplayName: string
  currencyCode: string
  currencyExponent: number
  totalMinorUnits: bigint
  amountPaidMinorUnits: bigint
  issuedAt: Date | null
  dueAt: Date | null
  createdAt: Date
}

export interface InvoiceDetail extends InvoiceSummary {
  customerId: CustomerId | null
  customerEmail: string | null
  customerPhone: string | null
  taxBasisPoints: number
  discountType: DiscountType
  discountValue: bigint
  subtotalMinorUnits: bigint
  discountMinorUnits: bigint
  taxMinorUnits: bigint
  notes: string | null
  dueAt: Date | null
  lines: readonly InvoiceLineItem[]
}

export interface CreateDraftCommand {
  businessId: BusinessId
  customerId: CustomerId | null
  customerDisplayName: string
  customerEmail: string | null
  customerPhone: string | null
  currencyCode: string
  currencyExponent: number
  taxBasisPoints: number
  discountType: DiscountType
  discountValue: bigint
  dueAt: Date | null
  notes: string | null
}

export interface UpdateDraftCommand {
  customerId: CustomerId | null
  customerDisplayName: string
  customerEmail: string | null
  customerPhone: string | null
  taxBasisPoints: number
  discountType: DiscountType
  discountValue: bigint
  dueAt: Date | null
  notes: string | null
}

export interface UpsertLineCommand {
  description: string
  quantity: string
  unitPriceMinorUnits: bigint
  position: number
  productId: ProductId | null
}

export interface InvoiceRepository {
  listActive(businessId: BusinessId): Promise<readonly InvoiceSummary[]>
  listDeleted(businessId: BusinessId): Promise<readonly InvoiceSummary[]>
  findById(id: InvoiceId): Promise<InvoiceDetail | null>
  createDraft(command: CreateDraftCommand): Promise<InvoiceId>
  updateDraft(id: InvoiceId, command: UpdateDraftCommand): Promise<void>
  addLine(invoiceId: InvoiceId, businessId: BusinessId, command: UpsertLineCommand): Promise<InvoiceLineId>
  updateLine(lineId: InvoiceLineId, command: UpsertLineCommand): Promise<void>
  removeLine(lineId: InvoiceLineId): Promise<void>
  issue(id: InvoiceId, idempotencyKey: string): Promise<void>
  voidInvoice(id: InvoiceId, reason: string | null): Promise<void>
  softDeleteDraft(id: InvoiceId, reason: string | null): Promise<void>
  restoreDraft(id: InvoiceId): Promise<void>
}
