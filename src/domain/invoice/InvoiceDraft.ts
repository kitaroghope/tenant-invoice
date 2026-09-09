import { Currency } from '../money/Currency'
import { Money } from '../money/Money'
import { ValidationError } from '../shared/DomainError'

export interface DraftLineInput { description: string; quantity: string; unitPrice: string; productId: string | null }
export type DiscountType = 'none' | 'percentage' | 'fixed'

export class InvoiceDraft {
  public constructor(
    public readonly currency: Currency,
    public readonly lines: readonly DraftLineInput[],
    public readonly taxBasisPoints: number,
    public readonly discountType: DiscountType = 'none',
    public readonly discountValue: bigint = 0n,
  ) {
    if (!lines.length) throw new ValidationError('An invoice needs at least one line')
  }

  public lineTotal(line: DraftLineInput): Money {
    return Money.parse(line.unitPrice || '0', this.currency).multiplyDecimal(line.quantity || '0')
  }

  public subtotal(): Money {
    return this.lines.reduce((total, line) => total.add(this.lineTotal(line)), Money.zero(this.currency))
  }

  // Mirrors private.recompute_invoice_totals: percentage uses the same basis-points
  // convention as tax, fixed is a raw minor-unit amount, and neither can exceed the subtotal.
  public discount(): Money {
    const subtotal = this.subtotal()
    if (this.discountType === 'none') return Money.zero(this.currency)
    const raw = this.discountType === 'fixed'
      ? Money.fromMinorUnits(this.discountValue, this.currency)
      : subtotal.percentage(Number(this.discountValue))
    return raw.minorUnits > subtotal.minorUnits ? subtotal : raw
  }

  public discountedSubtotal(): Money {
    return this.subtotal().subtract(this.discount())
  }

  public tax(): Money { return this.discountedSubtotal().percentage(this.taxBasisPoints) }
  public total(): Money { return this.discountedSubtotal().add(this.tax()) }
}
