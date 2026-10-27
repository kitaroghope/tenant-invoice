import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { DocumentPaper } from '../shared/DocumentPaper'
import { Business, type TemplateId } from '../../domain/business/Business'
import { standardizeLogoFile } from '../shared/logoImage'
import { ExportSection } from './ExportSection'
import { documentTemplates } from '../shared/documentTemplates'

interface FormState {
  legalName: string
  tradingName: string
  addressLine1: string
  addressLine2: string
  city: string
  region: string
  postalCode: string
  countryCode: string
  taxId: string
  invoicePrefix: string
  receiptPrefix: string
  paymentInstructions: string
  accentColor: string
  templateId: TemplateId
}

function toFormState(business: Business): FormState {
  return {
    legalName: business.legalName,
    tradingName: business.tradingName ?? '',
    addressLine1: business.addressLine1 ?? '',
    addressLine2: business.addressLine2 ?? '',
    city: business.city ?? '',
    region: business.region ?? '',
    postalCode: business.postalCode ?? '',
    countryCode: business.countryCode ?? '',
    taxId: business.taxId ?? '',
    invoicePrefix: business.invoicePrefix ?? '',
    receiptPrefix: business.receiptPrefix ?? '',
    paymentInstructions: business.paymentInstructions ?? '',
    accentColor: business.accentColor ?? '#17233d',
    templateId: business.templateId,
  }
}

export function SettingsPage({ business }: { business: Business }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<FormState>(toFormState(business))
  const [logoAssetPath, setLogoAssetPath] = useState(business.logoAssetPath)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(
    business.logoAssetPath ? container.businessRepository.getLogoUrl(business.logoAssetPath) : null,
  )
  const [processingLogo, setProcessingLogo] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [previewType, setPreviewType] = useState<'invoice' | 'receipt'>('invoice')

  // The object URL is only ours to revoke while it points at a local blob preview — the
  // remote getLogoUrl() result for an already-saved logo is a real URL other code may still
  // want, so only local blob: previews get cleaned up here.
  useEffect(() => {
    return () => {
      if (logoPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(logoPreviewUrl)
    }
  }, [logoPreviewUrl])

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['business', business.id.toString()] })

  const uploadLogo = useMutation({
    mutationFn: (file: File) => container.businessRepository.uploadLogo(business.id, file),
    onSuccess: (path) => setLogoAssetPath(path),
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Could not upload that logo'),
  })

  async function handleLogoSelected(file: File) {
    setFormError(null)
    setProcessingLogo(true)
    try {
      const standardized = await standardizeLogoFile(file)
      const nextPreviewUrl = URL.createObjectURL(standardized)
      setLogoPreviewUrl((previous) => {
        if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
        return nextPreviewUrl
      })
      uploadLogo.mutate(standardized)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not process that image')
    } finally {
      setProcessingLogo(false)
    }
  }

  const save = useMutation({
    mutationFn: () =>
      container.businessRepository.updateBranding(business.id, {
        legalName: form.legalName.trim(),
        tradingName: form.tradingName.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        addressLine2: form.addressLine2.trim() || null,
        city: form.city.trim() || null,
        region: form.region.trim() || null,
        postalCode: form.postalCode.trim() || null,
        countryCode: form.countryCode.trim().toUpperCase() || null,
        taxId: form.taxId.trim() || null,
        invoicePrefix: form.invoicePrefix.trim() || null,
        receiptPrefix: form.receiptPrefix.trim() || null,
        paymentInstructions: form.paymentInstructions.trim() || null,
        accentColor: form.accentColor || null,
        logoAssetPath,
        templateId: form.templateId,
      }),
    onSuccess: () => {
      setSaved(true)
      invalidate()
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Could not save changes'),
  })

  function field<K extends keyof FormState>(key: K) {
    return {
      value: form[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value })),
    }
  }

  const previewBusiness = Business.restore({
    id: business.id,
    legalName: form.legalName.trim() || 'Your Business',
    tradingName: form.tradingName.trim() || null,
    defaultCurrencyCode: business.defaultCurrencyCode,
    locale: business.locale,
    timezone: business.timezone,
    deletedAt: null,
    addressLine1: form.addressLine1.trim() || null,
    addressLine2: form.addressLine2.trim() || null,
    city: form.city.trim() || null,
    region: form.region.trim() || null,
    postalCode: form.postalCode.trim() || null,
    countryCode: form.countryCode.trim().toUpperCase() || null,
    taxId: form.taxId.trim() || null,
    invoicePrefix: form.invoicePrefix.trim() || null,
    receiptPrefix: form.receiptPrefix.trim() || null,
    paymentInstructions: form.paymentInstructions.trim() || null,
    accentColor: form.accentColor || null,
    logoAssetPath,
    templateId: form.templateId,
  })

  return (
    <div className="members-page settings-page">
      <div>
        <span className="eyebrow">Settings</span>
        <h1>Business & branding</h1>
      </div>

      <div className="settings-layout">
        <form
          className="invite-form"
          onSubmit={(event) => {
            event.preventDefault()
            setFormError(null)
            setSaved(false)
            save.mutate()
          }}
        >
          <span className="step-label">Business identity</span>
          <div className="form-grid customer-form-grid">
            <label>Legal name<input {...field('legalName')} required /></label>
            <label>Trading name<input {...field('tradingName')} placeholder="Optional" /></label>
            <label>Tax ID<input {...field('taxId')} placeholder="Optional" /></label>
          </div>

          <span className="step-label">Address</span>
          <div className="form-grid customer-form-grid">
            <label>Address line 1<input {...field('addressLine1')} placeholder="Optional" /></label>
            <label>Address line 2<input {...field('addressLine2')} placeholder="Optional" /></label>
            <label>City<input {...field('city')} placeholder="Optional" /></label>
            <label>Region<input {...field('region')} placeholder="Optional" /></label>
            <label>Postal code<input {...field('postalCode')} placeholder="Optional" /></label>
            <label>Country code<input {...field('countryCode')} placeholder="e.g. UG" maxLength={2} /></label>
          </div>

          <span className="step-label">Documents</span>
          <div className="form-grid customer-form-grid">
            <label>Invoice prefix<input {...field('invoicePrefix')} placeholder="e.g. INV-" /></label>
            <label>Receipt prefix<input {...field('receiptPrefix')} placeholder="e.g. RCT-" /></label>
          </div>
          <label>Payment instructions<input {...field('paymentInstructions')} placeholder="e.g. Mobile money: 0700 000000" /></label>

          <span className="step-label">Branding</span>
          <div className="form-grid customer-form-grid">
            <label>Accent color
              <input type="color" value={form.accentColor} onChange={(event) => setForm((current) => ({ ...current, accentColor: event.target.value }))} />
            </label>
            <label>Template
              <select value={form.templateId} onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value as TemplateId }))}>
                {documentTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.id === 'classic' ? ' — current design' : ''}</option>)}
              </select>
            </label>
            <label>Logo
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleLogoSelected(file)
                }}
              />
            </label>
          </div>
          <div className="template-gallery" aria-label="Document designs">
            {documentTemplates.map((template, index) => (
              <button key={template.id} type="button" className={`template-card ${form.templateId === template.id ? 'selected' : ''}`} aria-pressed={form.templateId === template.id} onClick={() => { setSaved(false); setForm((current) => ({ ...current, templateId: template.id })) }}>
                <span className={`template-mini mini-${template.id}`} style={{ '--doc-accent': form.accentColor } as React.CSSProperties} aria-hidden="true"><i /><i /><i /><i /></span>
                <span><strong>{String(index + 1).padStart(2, '0')} · {template.name}</strong>{template.id === 'classic' && <em>Current · recommended</em>}<small>{template.description}</small></span>
              </button>
            ))}
          </div>
          <p className="form-hint">All 10 designs use your logo, accent color, business details and payment instructions for both invoices and receipts. Save changes to apply your selection.</p>
          {logoPreviewUrl && (
            <div className="logo-preview">
              <img src={logoPreviewUrl} alt="Logo preview" />
              <span>Standardized to fit within 512×512px on upload.</span>
            </div>
          )}
          {processingLogo && <Banner tone="info">Processing image…</Banner>}
          {uploadLogo.isPending && <Banner tone="info">Uploading logo…</Banner>}

          {formError && <Banner tone="error">{formError}</Banner>}
          {saved && !formError && <Banner tone="success">Saved.</Banner>}
          <button className="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
        </form>

        <div className="settings-preview no-print">
          <span className="step-label">Live preview</span>
          <div className="template-preview-tabs" role="group" aria-label="Preview document type">
            <button type="button" aria-pressed={previewType === 'invoice'} onClick={() => setPreviewType('invoice')}>Invoice</button>
            <button type="button" aria-pressed={previewType === 'receipt'} onClick={() => setPreviewType('receipt')}>Receipt</button>
          </div>
          <DocumentPaper
            business={previewBusiness}
            documentType={previewType.toUpperCase()}
            statusLabel={previewType === 'invoice' ? 'DRAFT' : 'PAID'}
            billToLabel={previewType === 'invoice' ? 'Bill to' : 'Received from'}
            billToName="Sample Customer"
            numberLabel={previewType === 'invoice' ? 'Invoice number' : 'Receipt number'}
            numberValue={`${previewType === 'invoice' ? form.invoicePrefix : form.receiptPrefix}1`}
            printFormat="a4"
          >
            <table>
              <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
              <tbody><tr><td>Sample line item</td><td>1</td><td>100.00</td><td>100.00</td></tr></tbody>
            </table>
            <div className="totals">
              <p className="grand"><span>{previewType === 'invoice' ? 'Total due' : 'Amount received'}</span><strong>100.00</strong></p>
            </div>
          </DocumentPaper>
        </div>
      </div>

      <ExportSection business={business} />
    </div>
  )
}
