import { Currency } from './Currency'
import { CurrencyMismatchError, ValidationError } from '../shared/DomainError'

export class Money {
  private constructor(
    public readonly minorUnits: bigint,
    public readonly currency: Currency,
  ) {}

  public static fromMinorUnits(minorUnits: bigint, currency: Currency): Money {
    return new Money(minorUnits, currency)
  }

  public static zero(currency: Currency): Money {
    return new Money(0n, currency)
  }

  public static parse(value: string, currency: Currency): Money {
    const normalized = value.trim().replaceAll(',', '')
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) throw new ValidationError('Invalid monetary amount')
    const negative = normalized.startsWith('-')
    const unsigned = negative ? normalized.slice(1) : normalized
    const [whole = '0', fraction = ''] = unsigned.split('.')
    if (fraction.length > currency.exponent) {
      throw new ValidationError(`${currency.code} accepts at most ${currency.exponent} decimal places`)
    }
    const paddedFraction = fraction.padEnd(currency.exponent, '0')
    const scale = 10n ** BigInt(currency.exponent)
    const amount = BigInt(whole) * scale + BigInt(paddedFraction || '0')
    return new Money(negative ? -amount : amount, currency)
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.minorUnits + other.minorUnits, this.currency)
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.minorUnits - other.minorUnits, this.currency)
  }

  public multiply(quantity: bigint): Money {
    return new Money(this.minorUnits * quantity, this.currency)
  }

  public multiplyDecimal(value: string, precision = 3): Money {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new ValidationError('Invalid quantity')
    const [whole = '0', fraction = ''] = value.trim().split('.')
    if (fraction.length > precision) throw new ValidationError(`Quantity accepts at most ${precision} decimal places`)
    const scale = 10n ** BigInt(precision)
    const multiplier = BigInt(whole) * scale + BigInt(fraction.padEnd(precision, '0') || '0')
    const product = this.minorUnits * multiplier
    const rounded = (product + scale / 2n) / scale
    return new Money(rounded, this.currency)
  }

  public percentage(basisPoints: number): Money {
    if (!Number.isInteger(basisPoints) || basisPoints < 0) throw new ValidationError('Invalid percentage')
    const numerator = this.minorUnits * BigInt(basisPoints)
    return new Money((numerator + 5000n) / 10000n, this.currency)
  }

  // Plain "1234.50" with no currency symbol or locale grouping — for contexts that need
  // a number a spreadsheet can sum (CSV export), not a human-facing display string.
  public toPlainDecimalString(): string {
    const divisor = 10 ** this.currency.exponent
    return (Number(this.minorUnits) / divisor).toFixed(this.currency.exponent)
  }

  public format(locale: string): string {
    const divisor = 10 ** this.currency.exponent
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency.code,
      minimumFractionDigits: this.currency.exponent,
      maximumFractionDigits: this.currency.exponent,
    }).format(Number(this.minorUnits) / divisor)
  }

  private assertSameCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) {
      throw new CurrencyMismatchError(`Cannot combine ${this.currency.code} with ${other.currency.code}`)
    }
  }
}
