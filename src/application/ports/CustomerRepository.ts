import { Customer } from '../../domain/customer/Customer'
import { BusinessId, CustomerId } from '../../domain/shared/EntityId'

export interface CreateCustomerCommand {
  businessId: BusinessId
  displayName: string
  email: string | null
  phone: string | null
  taxId: string | null
}

export interface UpdateCustomerCommand {
  displayName: string
  email: string | null
  phone: string | null
  taxId: string | null
}

export interface CustomerRepository {
  listActive(businessId: BusinessId): Promise<readonly Customer[]>
  listDeleted(businessId: BusinessId): Promise<readonly Customer[]>
  create(command: CreateCustomerCommand): Promise<CustomerId>
  update(id: CustomerId, command: UpdateCustomerCommand): Promise<void>
  softDelete(id: CustomerId, reason: string | null): Promise<void>
  restore(id: CustomerId): Promise<void>
}
