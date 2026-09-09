import type { SupabaseClient } from '@supabase/supabase-js'
import { Business, type TemplateId } from '../../domain/business/Business'
import { BusinessId } from '../../domain/shared/EntityId'
import type { BusinessRepository, CreateBusinessCommand, UpdateBrandingCommand } from '../../application/ports/BusinessRepository'

interface BusinessRow {
  id: string
  legal_name: string
  trading_name: string | null
  default_currency_code: string
  locale: string
  timezone: string
  deleted_at: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country_code: string | null
  tax_id: string | null
  invoice_prefix: string | null
  receipt_prefix: string | null
  payment_instructions: string | null
  accent_color: string | null
  logo_asset_path: string | null
  template_id: TemplateId
}

const BUSINESS_ASSETS_BUCKET = 'business-assets'

export class SupabaseBusinessRepository implements BusinessRepository {
  public constructor(private readonly client: SupabaseClient) {}

  public async listActive(): Promise<readonly Business[]> {
    const { data, error } = await this.client.from('businesses').select('*').is('deleted_at', null).order('legal_name')
    if (error) throw error
    return (data as BusinessRow[]).map((row) => this.toDomain(row))
  }

  public async create(command: CreateBusinessCommand): Promise<BusinessId> {
    const { data, error } = await this.client.rpc('create_business', {
      p_legal_name: command.legalName,
      p_trading_name: command.tradingName,
      p_default_currency_code: command.defaultCurrencyCode,
      p_locale: command.locale,
      p_timezone: command.timezone,
    })
    if (error) throw error
    return BusinessId.from(data as string)
  }

  public async findById(id: BusinessId): Promise<Business | null> {
    const { data, error } = await this.client.from('businesses').select('*').eq('id', id.toString()).is('deleted_at', null).maybeSingle()
    if (error) throw error
    return data ? this.toDomain(data as BusinessRow) : null
  }

  public async updateBranding(id: BusinessId, command: UpdateBrandingCommand): Promise<void> {
    const { error } = await this.client
      .from('businesses')
      .update({
        legal_name: command.legalName,
        trading_name: command.tradingName,
        address_line1: command.addressLine1,
        address_line2: command.addressLine2,
        city: command.city,
        region: command.region,
        postal_code: command.postalCode,
        country_code: command.countryCode,
        tax_id: command.taxId,
        invoice_prefix: command.invoicePrefix,
        receipt_prefix: command.receiptPrefix,
        payment_instructions: command.paymentInstructions,
        accent_color: command.accentColor,
        logo_asset_path: command.logoAssetPath,
        template_id: command.templateId,
      })
      .eq('id', id.toString())
    if (error) throw error
  }

  public async uploadLogo(businessId: BusinessId, file: File): Promise<string> {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
    if (!['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(extension)) {
      throw new Error('Logo must be a PNG, JPEG, WebP, or SVG file')
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('Logo must be smaller than 2MB')
    }
    const path = `${businessId.toString()}/logos/${crypto.randomUUID()}.${extension}`
    const { error } = await this.client.storage.from(BUSINESS_ASSETS_BUCKET).upload(path, file, { upsert: false })
    if (error) throw error
    return path
  }

  public getLogoUrl(assetPath: string): string {
    return this.client.storage.from(BUSINESS_ASSETS_BUCKET).getPublicUrl(assetPath).data.publicUrl
  }

  private toDomain(row: BusinessRow): Business {
    return Business.restore({
      id: BusinessId.from(row.id),
      legalName: row.legal_name,
      tradingName: row.trading_name,
      defaultCurrencyCode: row.default_currency_code,
      locale: row.locale,
      timezone: row.timezone,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      city: row.city,
      region: row.region,
      postalCode: row.postal_code,
      countryCode: row.country_code,
      taxId: row.tax_id,
      invoicePrefix: row.invoice_prefix,
      receiptPrefix: row.receipt_prefix,
      paymentInstructions: row.payment_instructions,
      accentColor: row.accent_color,
      logoAssetPath: row.logo_asset_path,
      templateId: row.template_id,
    })
  }
}
