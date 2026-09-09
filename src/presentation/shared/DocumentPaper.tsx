import type { CSSProperties, ReactNode } from 'react'
import { container } from '../../shared/container'
import type { Business } from '../../domain/business/Business'

interface DocumentPaperProps {
  business: Business
  documentType: string
  statusLabel: string
  billToLabel: string
  billToName: string
  numberLabel: string
  numberValue: string
  printFormat: 'a4' | 'thermal'
  children: ReactNode
}

// Statuses worth stamping across the document so a glance (or a photocopy) can't be
// mistaken for a live, payable original.
const WATERMARKED_STATUSES = new Set(['DRAFT', 'VOID', 'PAID'])

// The one renderer shared by every document surface — draft preview, issued view, and
// print — so a business's logo, accent color, and template choice show up identically
// everywhere instead of each page reimplementing its own "paper" markup.
export function DocumentPaper({ business, documentType, statusLabel, billToLabel, billToName, numberLabel, numberValue, printFormat, children }: DocumentPaperProps) {
  const logoUrl = business.logoAssetPath ? container.businessRepository.getLogoUrl(business.logoAssetPath) : null
  const style = { '--doc-accent': business.accentColor || '#17233d' } as CSSProperties

  return (
    <section className={`paper template-${business.templateId}${printFormat === 'thermal' ? ' thermal' : ''}`} style={style}>
      {WATERMARKED_STATUSES.has(statusLabel) && (
        <div className={`document-watermark watermark-${statusLabel.toLowerCase()}`} aria-hidden="true">{statusLabel}</div>
      )}
      <header>
        <div className="document-brand-block">
          {logoUrl && <img className="document-logo" src={logoUrl} alt="" />}
          <div>
            <span className="document-brand">{business.tradingName || business.legalName}</span>
            <small>{documentType}</small>
          </div>
        </div>
        <strong>{statusLabel}</strong>
      </header>
      <div className="bill-meta">
        <div><small>{billToLabel}</small><h2>{billToName}</h2></div>
        <div><small>{numberLabel}</small><p>{numberValue}</p></div>
      </div>

      {children}

      {(business.addressLines.length > 0 || business.taxId || business.paymentInstructions) && (
        <div className="document-footer">
          {business.addressLines.length > 0 && <p>{business.addressLines.join(' · ')}</p>}
          {business.taxId && <p>Tax ID: {business.taxId}</p>}
          {business.paymentInstructions && <p>{business.paymentInstructions}</p>}
        </div>
      )}
    </section>
  )
}
