import { BusinessId, ProductId } from '../shared/EntityId'
import { ValidationError } from '../shared/DomainError'

export interface ProductProperties {
  id: ProductId
  businessId: BusinessId
  name: string
  description: string | null
  unit: string
  priceMinorUnits: bigint | null
  priceCurrencyCode: string | null
  stockQuantity: string | null
  deletedAt: Date | null
}

export class Product {
  private constructor(private readonly properties: ProductProperties) {}

  public static restore(properties: ProductProperties): Product {
    if (!properties.name.trim()) throw new ValidationError('Product name is required')
    return new Product({ ...properties, name: properties.name.trim() })
  }

  public get id(): ProductId { return this.properties.id }
  public get businessId(): BusinessId { return this.properties.businessId }
  public get name(): string { return this.properties.name }
  public get description(): string | null { return this.properties.description }
  public get unit(): string { return this.properties.unit }
  public get priceMinorUnits(): bigint | null { return this.properties.priceMinorUnits }
  public get priceCurrencyCode(): string | null { return this.properties.priceCurrencyCode }
  // A decimal string, not a number: matches the numeric(18,3) column and avoids float
  // rounding on quantities like 0.5 kg. Null means stock isn't tracked for this product.
  public get stockQuantity(): string | null { return this.properties.stockQuantity }
  public get isDeleted(): boolean { return this.properties.deletedAt !== null }
}
