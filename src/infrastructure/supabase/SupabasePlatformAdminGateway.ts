import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AdminAbuseReportRow,
  AdminBusinessRow,
  OverrideSubscriptionCommand,
  PlatformAdminGateway,
} from '../../application/ports/PlatformAdminGateway'

interface AdminBusinessDbRow {
  business_id: string
  legal_name: string
  trading_name: string | null
  owner_email: string | null
  created_at: string
  member_count: number
  subscription_status: string | null
  plan_code: string | null
  platform_suspended_at: string | null
}

interface AbuseReportDbRow {
  id: string
  business_id: string
  reporter_email: string | null
  note: string
  status: 'open' | 'resolved' | 'dismissed'
  resolution_note: string | null
  created_at: string
}

export class SupabasePlatformAdminGateway implements PlatformAdminGateway {
  public constructor(private readonly client: SupabaseClient) {}

  public async listBusinesses(search: string): Promise<readonly AdminBusinessRow[]> {
    const { data, error } = await this.client.rpc('admin_list_businesses', { p_search: search || null })
    if (error) throw error
    return (data as AdminBusinessDbRow[]).map((row) => ({
      businessId: row.business_id,
      legalName: row.legal_name,
      tradingName: row.trading_name,
      ownerEmail: row.owner_email,
      createdAt: row.created_at,
      memberCount: row.member_count,
      subscriptionStatus: row.subscription_status,
      planCode: row.plan_code,
      platformSuspendedAt: row.platform_suspended_at,
    }))
  }

  public async suspendBusiness(businessId: string, reason: string): Promise<void> {
    const { error } = await this.client.rpc('admin_suspend_business', { p_business_id: businessId, p_reason: reason })
    if (error) throw error
  }

  public async reinstateBusiness(businessId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_reinstate_business', { p_business_id: businessId })
    if (error) throw error
  }

  public async overrideSubscription(command: OverrideSubscriptionCommand): Promise<void> {
    const { error } = await this.client.rpc('admin_override_subscription', {
      p_business_id: command.businessId,
      p_plan_code: command.planCode ?? null,
      p_status: command.status ?? null,
      p_current_period_end: command.currentPeriodEnd ?? null,
    })
    if (error) throw error
  }

  public async listAbuseReports(status: 'open' | 'resolved' | 'dismissed' | null): Promise<readonly AdminAbuseReportRow[]> {
    const { data, error } = await this.client.rpc('admin_list_abuse_reports', { p_status: status })
    if (error) throw error
    return (data as AbuseReportDbRow[]).map((row) => ({
      id: row.id,
      businessId: row.business_id,
      reporterEmail: row.reporter_email,
      note: row.note,
      status: row.status,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at,
    }))
  }

  public async resolveAbuseReport(reportId: string, status: 'resolved' | 'dismissed', resolutionNote: string): Promise<void> {
    const { error } = await this.client.rpc('admin_resolve_abuse_report', {
      p_report_id: reportId,
      p_status: status,
      p_resolution_note: resolutionNote,
    })
    if (error) throw error
  }
}
