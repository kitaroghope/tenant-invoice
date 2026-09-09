import type { SupabaseClient } from '@supabase/supabase-js'
import { Customer } from '../../domain/customer/Customer'
import { BusinessId, CustomerId } from '../../domain/shared/EntityId'
import type {
  CreateCustomerCommand,
  CustomerRepository,
  UpdateCustomerCommand,
} from '../../application/ports/CustomerRepository'

interface CustomerRow {
  id: string
  business_id: string
  display_name: string
  email: string | null
  phone: string | null
  tax_id: string | null
  deleted_at: string | null
}

export class SupabaseCustomerRepository implements CustomerRepository {
  public constructor(private readonly client: SupabaseClient) {}

  public async listActive(businessId: BusinessId): Promise<readonly Customer[]> {
    const { data, error } = await this.client
      .from('customers')
      .select('id, business_id, display_name, email, phone, tax_id, deleted_at')
      .eq('business_id', businessId.toString())
      .is('deleted_at', null)
      .order('display_name')
    if (error) throw error
    return (data as CustomerRow[]).map((row) => this.toDomain(row))
  }

  public async listDeleted(businessId: BusinessId): Promise<readonly Customer[]> {
    const { data, error } = await this.client
      .from('customers')
      .select('id, business_id, display_name, email, phone, tax_id, deleted_at')
      .eq('business_id', businessId.toString())
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (error) throw error
    return (data as CustomerRow[]).map((row) => this.toDomain(row))
  }

  public async create(command: CreateCustomerCommand): Promise<CustomerId> {
    const { data: userData, error: userError } = await this.client.auth.getUser()
    if (userError) throw userError
    const createdBy = userData.user?.id
    if (!createdBy) throw new Error('Authentication required')

    const { data, error } = await this.client
      .from('customers')
      .insert({
        business_id: command.businessId.toString(),
        display_name: command.displayName,
        email: command.email,
        phone: command.phone,
        tax_id: command.taxId,
        created_by: createdBy,
      })
      .select('id')
      .single()
    if (error) throw error
    return CustomerId.from((data as { id: string }).id)
  }

  public async update(id: CustomerId, command: UpdateCustomerCommand): Promise<void> {
    const { error } = await this.client
      .from('customers')
      .update({
        display_name: command.displayName,
        email: command.email,
        phone: command.phone,
        tax_id: command.taxId,
      })
      .eq('id', id.toString())
    if (error) throw error
  }

  public async softDelete(id: CustomerId, reason: string | null): Promise<void> {
    const { data: userData, error: userError } = await this.client.auth.getUser()
    if (userError) throw userError
    const deletedBy = userData.user?.id
    if (!deletedBy) throw new Error('Authentication required')

    const { error } = await this.client
      .from('customers')
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy, deletion_reason: reason })
      .eq('id', id.toString())
    if (error) throw error
  }

  public async restore(id: CustomerId): Promise<void> {
    const { error } = await this.client
      .from('customers')
      .update({ deleted_at: null, deleted_by: null, deletion_reason: null })
      .eq('id', id.toString())
    if (error) throw error
  }

  private toDomain(row: CustomerRow): Customer {
    return Customer.restore({
      id: CustomerId.from(row.id),
      businessId: BusinessId.from(row.business_id),
      displayName: row.display_name,
      email: row.email,
      phone: row.phone,
      taxId: row.tax_id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    })
  }
}
