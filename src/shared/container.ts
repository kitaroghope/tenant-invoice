import { QueryClient } from '@tanstack/react-query'
import { loadRuntimeConfiguration, createSupabaseClient } from '../infrastructure/supabase/client'
import { SupabaseBusinessRepository } from '../infrastructure/supabase/SupabaseBusinessRepository'
import { ListBusinesses } from '../application/use-cases/ListBusinesses'
import { CreateBusiness } from '../application/use-cases/CreateBusiness'
import { SupabaseAuthGateway } from '../infrastructure/supabase/SupabaseAuthGateway'
import { SupabaseMembershipGateway } from '../infrastructure/supabase/SupabaseMembershipGateway'
import { SupabaseCustomerRepository } from '../infrastructure/supabase/SupabaseCustomerRepository'
import { SupabaseProductRepository } from '../infrastructure/supabase/SupabaseProductRepository'
import { SupabaseInvoiceRepository } from '../infrastructure/supabase/SupabaseInvoiceRepository'
import { SupabasePaymentRepository } from '../infrastructure/supabase/SupabasePaymentRepository'
import { SupabaseReceiptRepository } from '../infrastructure/supabase/SupabaseReceiptRepository'
import { SupabasePlatformAdminGateway } from '../infrastructure/supabase/SupabasePlatformAdminGateway'
import { SupabaseDocumentEmailGateway } from '../infrastructure/supabase/SupabaseDocumentEmailGateway'

class ApplicationContainer {
  public readonly queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  })
  public readonly configuration = loadRuntimeConfiguration()
  public readonly listBusinesses: ListBusinesses
  public readonly createBusiness: CreateBusiness
  public readonly businessRepository: SupabaseBusinessRepository
  public readonly authGateway: SupabaseAuthGateway
  public readonly membershipGateway: SupabaseMembershipGateway
  public readonly customerRepository: SupabaseCustomerRepository
  public readonly productRepository: SupabaseProductRepository
  public readonly invoiceRepository: SupabaseInvoiceRepository
  public readonly paymentRepository: SupabasePaymentRepository
  public readonly receiptRepository: SupabaseReceiptRepository
  public readonly platformAdminGateway: SupabasePlatformAdminGateway
  public readonly documentEmailGateway: SupabaseDocumentEmailGateway

  public constructor() {
    if (!this.configuration) throw new Error('Supabase configuration is required')
    const client = createSupabaseClient(this.configuration)
    this.authGateway = new SupabaseAuthGateway(client)
    this.businessRepository = new SupabaseBusinessRepository(client)
    this.membershipGateway = new SupabaseMembershipGateway(client)
    this.customerRepository = new SupabaseCustomerRepository(client)
    this.productRepository = new SupabaseProductRepository(client)
    this.invoiceRepository = new SupabaseInvoiceRepository(client)
    this.paymentRepository = new SupabasePaymentRepository(client)
    this.receiptRepository = new SupabaseReceiptRepository(client)
    this.platformAdminGateway = new SupabasePlatformAdminGateway(client)
    this.documentEmailGateway = new SupabaseDocumentEmailGateway(client)
    this.listBusinesses = new ListBusinesses(this.businessRepository)
    this.createBusiness = new CreateBusiness(this.businessRepository)
  }
}

export const container = new ApplicationContainer()
