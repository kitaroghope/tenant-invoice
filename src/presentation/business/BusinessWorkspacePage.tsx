import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import { BusinessId } from '../../domain/shared/EntityId'
import { container } from '../../shared/container'
import { useAuth } from '../auth/AuthContext'
import { NewInvoicePage } from '../invoices/NewInvoicePage'
import { InvoicesListPage } from '../invoices/InvoicesListPage'
import { InvoiceDetailPage } from '../invoices/InvoiceDetailPage'
import { MembersPage } from './MembersPage'
import { CustomersPage } from './CustomersPage'
import { ProductsPage } from './ProductsPage'
import { OverviewPage } from './OverviewPage'
import { PaymentsPage } from './PaymentsPage'
import { ReceiptsListPage } from '../receipts/ReceiptsListPage'
import { ReceiptDetailPage } from '../receipts/ReceiptDetailPage'
import { SettingsPage } from './SettingsPage'

const navigation = [
  ['Overview', ''],
  ['Customers', 'customers'],
  ['Products', 'products'],
  ['Invoices', 'invoices'],
  ['Payments', 'payments'],
  ['Receipts', 'receipts'],
  ['Members', 'members'],
  ['Settings', 'settings'],
] as const

export function BusinessWorkspacePage() {
  const { businessId, '*': childPath } = useParams()
  const { user, loading, gateway } = useAuth()
  const business = useQuery({
    queryKey: ['business', businessId],
    queryFn: () => container.businessRepository.findById(BusinessId.from(businessId!)),
    enabled: Boolean(user && businessId),
  })

  if (loading) return <main className="centered">Opening workspace…</main>
  if (!user) return <Navigate to="/auth" replace />
  if (!businessId) return <Navigate to="/app" replace />
  if (business.isLoading) return <main className="centered">Loading business…</main>
  if (business.error || !business.data) return <main className="centered"><div><h2>Workspace unavailable</h2><p>You may not have access to this business.</p><Link to="/app">Return to businesses</Link></div></main>

  const base = `/app/businesses/${businessId}`
  const invoiceDetailId = childPath?.startsWith('invoices/') && childPath !== 'invoices/new' ? childPath.slice('invoices/'.length) : null
  const receiptDetailId = childPath?.startsWith('receipts/') ? childPath.slice('receipts/'.length) : null
  const isInvoiceWorkbench = childPath === 'invoices/new' || Boolean(invoiceDetailId) || Boolean(receiptDetailId)

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand-link" to="/app"><span>KI</span><strong>Kita Invoice</strong></Link>
        <div className="business-identity"><small>Current business</small><strong>{business.data.tradingName || business.data.legalName}</strong><span>{business.data.defaultCurrencyCode}</span></div>
        <nav>{navigation.map(([label, path]) => <NavLink end={!path} key={label} to={path ? `${base}/${path}` : base}>{label}</NavLink>)}</nav>
        <div className="sidebar-footer"><span>{user.email}</span><button onClick={() => void gateway.signOut()}>Sign out</button></div>
      </aside>
      <main className={isInvoiceWorkbench ? 'dashboard invoice-dashboard' : 'dashboard'}>
        {childPath === 'invoices/new' ? <NewInvoicePage business={business.data} />
          : invoiceDetailId ? <InvoiceDetailPage business={business.data} invoiceId={invoiceDetailId} />
          : childPath === 'invoices' ? <InvoicesListPage business={business.data} />
          : receiptDetailId ? <ReceiptDetailPage business={business.data} receiptId={receiptDetailId} />
          : childPath === 'receipts' ? <ReceiptsListPage business={business.data} />
          : childPath === 'payments' ? <PaymentsPage business={business.data} />
          : childPath === 'members' ? <MembersPage business={business.data} />
          : childPath === 'customers' ? <CustomersPage business={business.data} />
          : childPath === 'products' ? <ProductsPage business={business.data} />
          : childPath === 'settings' ? <SettingsPage business={business.data} />
          : !childPath ? <OverviewPage business={business.data} />
          : <section className="empty-state"><div className="empty-icon">🛠</div><h2>Not built yet</h2><p>This part of the workspace is still on the roadmap. Nothing here yet — check back soon.</p><Link className="secondary link-button" to={base}>Back to overview</Link></section>}
      </main>
    </div>
  )
}
