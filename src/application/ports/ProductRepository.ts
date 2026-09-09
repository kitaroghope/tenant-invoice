import { Product } from '../../domain/product/Product'
import { BusinessId, ProductId } from '../../domain/shared/EntityId'

export interface CreateProductCommand {
  businessId: BusinessId
  name: string
  description: string | null
  unit: string
  priceMinorUnits: bigint | null
  priceCurrencyCode: string | null
  stockQuantity: string | null
}

export interface ProductRepository {
  listActive(businessId: BusinessId): Promise<readonly Product[]>
  listDeleted(businessId: BusinessId): Promise<readonly Product[]>
  create(command: CreateProductCommand): Promise<ProductId>
  softDelete(id: ProductId, reason: string | null): Promise<void>
  restore(id: ProductId): Promise<void>
  // Manual correction (initial stock, restocking, physical count adjustment) — separate from
  // the automatic debit/credit that issuing/voiding an invoice performs server-side.
  setStock(id: ProductId, stockQuantity: string | null): Promise<void>
}
