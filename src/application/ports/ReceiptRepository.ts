import { BusinessId, PaymentId } from '../../domain/shared/EntityId'
import type { PaymentMethod, PaymentStatus } from './PaymentRepository'

export type ReceiptStatus = 'issued' | 'void'

export interface ReceiptLineItem {
  description: string
  quantity: string
  unitPriceMinorUnits: bigint
  lineTotalMinorUnits: bigint
}

export interface Receipt {
  id: string
  receiptNumber: number | null
  status: ReceiptStatus
  issuedAt: Date
  voidReason: string | null
  payment: {
    id: PaymentId
    customerDisplayName: string
    customerEmail: string | null
    amountMinorUnits: bigint
    currencyCode: string
    currencyExponent: number
    paymentMethod: PaymentMethod
    reference: string | null
    status: PaymentStatus
  }
  // Present only when the payment this receipt was issued for was made against an invoice —
  // a standalone payment (Payments > Record standalone) has no items to itemize, and the
  // receipt for it stays a plain proof-of-payment.
  invoice: {
    invoiceNumber: number | null
    lines: readonly ReceiptLineItem[]
  } | null
}

export interface ReceiptRepository {
  listForBusiness(businessId: BusinessId): Promise<readonly Receipt[]>
  findById(id: string): Promise<Receipt | null>
  issue(paymentId: PaymentId): Promise<string>
}
