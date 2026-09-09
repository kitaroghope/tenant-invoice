import { BusinessId, CustomerId } from '../shared/EntityId'
import { ValidationError } from '../shared/DomainError'

export interface CustomerProperties {
  id: CustomerId
  businessId: BusinessId
  displayName: string
  email: string | null
  phone: string | null
  taxId: string | null
  deletedAt: Date | null
}

export class Customer {
  private constructor(private readonly properties: CustomerProperties) {}

  public static restore(properties: CustomerProperties): Customer {
    if (!properties.displayName.trim()) throw new ValidationError('Customer name is required')
    return new Customer({ ...properties, displayName: properties.displayName.trim() })
  }

  public get id(): CustomerId { return this.properties.id }
  public get businessId(): BusinessId { return this.properties.businessId }
  public get displayName(): string { return this.properties.displayName }
  public get email(): string | null { return this.properties.email }
  public get phone(): string | null { return this.properties.phone }
  public get taxId(): string | null { return this.properties.taxId }
  public get isDeleted(): boolean { return this.properties.deletedAt !== null }
}
