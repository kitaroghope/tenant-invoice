import { BusinessId, PaymentId } from '../../domain/shared/EntityId'
import type { PaymentMethod, PaymentStatus } from './PaymentRepository'

export type ReceiptStatus = 'issued' | 'void'

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
}

export interface ReceiptRepository {
  listForBusiness(businessId: BusinessId): Promise<readonly Receipt[]>
  findById(id: string): Promise<Receipt | null>
  issue(paymentId: PaymentId): Promise<string>
}
