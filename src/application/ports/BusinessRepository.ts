import { Business, type BusinessBranding } from '../../domain/business/Business'
import { BusinessId } from '../../domain/shared/EntityId'

export interface CreateBusinessCommand {
  legalName: string
  tradingName: string | null
  defaultCurrencyCode: string
  locale: string
  timezone: string
}

export interface UpdateBrandingCommand extends BusinessBranding {
  legalName: string
  tradingName: string | null
}

export interface BusinessRepository {
  listActive(): Promise<readonly Business[]>
  create(command: CreateBusinessCommand): Promise<BusinessId>
  findById(id: BusinessId): Promise<Business | null>
  updateBranding(id: BusinessId, command: UpdateBrandingCommand): Promise<void>
  uploadLogo(businessId: BusinessId, file: File): Promise<string>
  getLogoUrl(assetPath: string): string
}
