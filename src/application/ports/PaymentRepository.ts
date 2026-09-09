import { BusinessId, InvoiceId, PaymentId } from '../../domain/shared/EntityId'

export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'card' | 'other'
export type PaymentStatus = 'recorded' | 'reversed'

export interface Payment {
  id: PaymentId
  invoiceId: InvoiceId | null
  invoiceNumber: number | null
  customerDisplayName: string
  amountMinorUnits: bigint
  currencyCode: string
  currencyExponent: number
  paymentMethod: PaymentMethod
  reference: string | null
  notes: string | null
  paidAt: Date
  status: PaymentStatus
  reversalReason: string | null
  activeReceiptId: string | null
}

export interface RecordPaymentCommand {
  invoiceId: InvoiceId
  amountMinorUnits: bigint
  paymentMethod: PaymentMethod
  reference: string | null
  notes: string | null
  idempotencyKey: string
}

export interface RecordStandalonePaymentCommand {
  businessId: BusinessId
  customerDisplayName: string
  customerEmail: string | null
  customerPhone: string | null
  amountMinorUnits: bigint
  currencyCode: string
  currencyExponent: number
  paymentMethod: PaymentMethod
  reference: string | null
  notes: string | null
  idempotencyKey: string
}

export interface PaymentRepository {
  listForInvoice(invoiceId: InvoiceId): Promise<readonly Payment[]>
  listForBusiness(businessId: BusinessId): Promise<readonly Payment[]>
  record(command: RecordPaymentCommand): Promise<PaymentId>
  recordStandalone(command: RecordStandalonePaymentCommand): Promise<PaymentId>
  reverse(paymentId: PaymentId, reason: string | null): Promise<void>
}
