export interface AdminBusinessRow {
  businessId: string
  legalName: string
  tradingName: string | null
  ownerEmail: string | null
  createdAt: string
  memberCount: number
  subscriptionStatus: string | null
  planCode: string | null
  platformSuspendedAt: string | null
}

export interface AdminAbuseReportRow {
  id: string
  businessId: string
  reporterEmail: string | null
  note: string
  status: 'open' | 'resolved' | 'dismissed'
  resolutionNote: string | null
  createdAt: string
}

export interface OverrideSubscriptionCommand {
  businessId: string
  planCode?: string
  status?: string
  currentPeriodEnd?: string
}

export interface PlatformAdminGateway {
  listBusinesses(search: string): Promise<readonly AdminBusinessRow[]>
  suspendBusiness(businessId: string, reason: string): Promise<void>
  reinstateBusiness(businessId: string): Promise<void>
  overrideSubscription(command: OverrideSubscriptionCommand): Promise<void>
  listAbuseReports(status: 'open' | 'resolved' | 'dismissed' | null): Promise<readonly AdminAbuseReportRow[]>
  resolveAbuseReport(reportId: string, status: 'resolved' | 'dismissed', resolutionNote: string): Promise<void>
}
