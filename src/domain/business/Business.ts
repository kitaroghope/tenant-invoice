import { BusinessId } from '../shared/EntityId'
import { ValidationError } from '../shared/DomainError'

export type TemplateId = 'classic' | 'modern' | 'compact'

export interface BusinessBranding {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  countryCode: string | null
  taxId: string | null
  invoicePrefix: string | null
  receiptPrefix: string | null
  paymentInstructions: string | null
  accentColor: string | null
  logoAssetPath: string | null
  templateId: TemplateId
}

export interface BusinessProperties extends BusinessBranding {
  id: BusinessId
  legalName: string
  tradingName: string | null
  defaultCurrencyCode: string
  locale: string
  timezone: string
  deletedAt: Date | null
}

export class Business {
  private constructor(private readonly properties: BusinessProperties) {}

  public static restore(properties: BusinessProperties): Business {
    if (!properties.legalName.trim()) throw new ValidationError('Legal name is required')
    return new Business({ ...properties, legalName: properties.legalName.trim() })
  }

  public get id(): BusinessId { return this.properties.id }
  public get legalName(): string { return this.properties.legalName }
  public get tradingName(): string | null { return this.properties.tradingName }
  public get defaultCurrencyCode(): string { return this.properties.defaultCurrencyCode }
  public get locale(): string { return this.properties.locale }
  public get timezone(): string { return this.properties.timezone }
  public get isDeleted(): boolean { return this.properties.deletedAt !== null }

  public get addressLine1(): string | null { return this.properties.addressLine1 }
  public get addressLine2(): string | null { return this.properties.addressLine2 }
  public get city(): string | null { return this.properties.city }
  public get region(): string | null { return this.properties.region }
  public get postalCode(): string | null { return this.properties.postalCode }
  public get countryCode(): string | null { return this.properties.countryCode }
  public get taxId(): string | null { return this.properties.taxId }
  public get invoicePrefix(): string | null { return this.properties.invoicePrefix }
  public get receiptPrefix(): string | null { return this.properties.receiptPrefix }
  public get paymentInstructions(): string | null { return this.properties.paymentInstructions }
  public get accentColor(): string | null { return this.properties.accentColor }
  public get logoAssetPath(): string | null { return this.properties.logoAssetPath }
  public get templateId(): TemplateId { return this.properties.templateId }

  public get addressLines(): readonly string[] {
    const cityLine = [this.city, this.region, this.postalCode].filter(Boolean).join(', ')
    return [this.addressLine1, this.addressLine2, cityLine || null, this.countryCode].filter((line): line is string => Boolean(line))
  }
}
