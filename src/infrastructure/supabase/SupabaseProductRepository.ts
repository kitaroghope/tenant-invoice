import type { SupabaseClient } from '@supabase/supabase-js'
import { Product } from '../../domain/product/Product'
import { BusinessId, ProductId } from '../../domain/shared/EntityId'
import type { CreateProductCommand, ProductRepository } from '../../application/ports/ProductRepository'

interface ProductPriceRow {
  currency_code: string
  unit_price_minor_units: string | number
  deleted_at: string | null
}

interface ProductRow {
  id: string
  business_id: string
  name: string
  description: string | null
  unit: string
  stock_quantity: string | number | null
  deleted_at: string | null
  product_prices: ProductPriceRow[] | null
}

export class SupabaseProductRepository implements ProductRepository {
  public constructor(private readonly client: SupabaseClient) {}

  public async listActive(businessId: BusinessId): Promise<readonly Product[]> {
    const { data, error } = await this.client
      .from('products')
      .select('id, business_id, name, description, unit, stock_quantity, deleted_at, product_prices(currency_code, unit_price_minor_units, deleted_at)')
      .eq('business_id', businessId.toString())
      .is('deleted_at', null)
      .order('name')
    if (error) throw error
    return (data as unknown as ProductRow[]).map((row) => this.toDomain(row))
  }

  public async listDeleted(businessId: BusinessId): Promise<readonly Product[]> {
    const { data, error } = await this.client
      .from('products')
      .select('id, business_id, name, description, unit, stock_quantity, deleted_at, product_prices(currency_code, unit_price_minor_units, deleted_at)')
      .eq('business_id', businessId.toString())
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (error) throw error
    return (data as unknown as ProductRow[]).map((row) => this.toDomain(row))
  }

  public async create(command: CreateProductCommand): Promise<ProductId> {
    const { data: userData, error: userError } = await this.client.auth.getUser()
    if (userError) throw userError
    const createdBy = userData.user?.id
    if (!createdBy) throw new Error('Authentication required')

    const { data, error } = await this.client
      .from('products')
      .insert({
        business_id: command.businessId.toString(),
        name: command.name,
        description: command.description,
        unit: command.unit,
        stock_quantity: command.stockQuantity,
        created_by: createdBy,
      })
      .select('id')
      .single()
    if (error) throw error
    const productId = (data as { id: string }).id

    // A price is optional at creation, but when given, this second write is not atomic
    // with the product insert above — a failure here leaves a priceless product rather
    // than nothing. Acceptable for catalog data; would need an RPC if this became
    // financially load-bearing before an invoice references it.
    if (command.priceMinorUnits !== null && command.priceCurrencyCode) {
      const { error: priceError } = await this.client.from('product_prices').insert({
        business_id: command.businessId.toString(),
        product_id: productId,
        currency_code: command.priceCurrencyCode,
        unit_price_minor_units: command.priceMinorUnits.toString(),
      })
      if (priceError) throw priceError
    }

    return ProductId.from(productId)
  }

  public async softDelete(id: ProductId, reason: string | null): Promise<void> {
    const { data: userData, error: userError } = await this.client.auth.getUser()
    if (userError) throw userError
    const deletedBy = userData.user?.id
    if (!deletedBy) throw new Error('Authentication required')

    const { error } = await this.client
      .from('products')
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy, deletion_reason: reason })
      .eq('id', id.toString())
    if (error) throw error
  }

  public async restore(id: ProductId): Promise<void> {
    const { error } = await this.client
      .from('products')
      .update({ deleted_at: null, deleted_by: null, deletion_reason: null })
      .eq('id', id.toString())
    if (error) throw error
  }

  public async setStock(id: ProductId, stockQuantity: string | null): Promise<void> {
    const { error } = await this.client
      .from('products')
      .update({ stock_quantity: stockQuantity })
      .eq('id', id.toString())
    if (error) throw error
  }

  private toDomain(row: ProductRow): Product {
    const activePrice = (row.product_prices ?? []).find((price) => price.deleted_at === null) ?? null
    return Product.restore({
      id: ProductId.from(row.id),
      businessId: BusinessId.from(row.business_id),
      name: row.name,
      description: row.description,
      unit: row.unit,
      priceMinorUnits: activePrice ? BigInt(activePrice.unit_price_minor_units) : null,
      priceCurrencyCode: activePrice?.currency_code ?? null,
      stockQuantity: row.stock_quantity === null ? null : String(row.stock_quantity),
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    })
  }
}
