import { ValidationError } from '../shared/DomainError'

// Minor-unit exponents for currencies that aren't the common two-decimal case.
// Mirrors the platform `currencies` reference table; used client-side for input/display
// before a full currencies lookup is wired through the UI.
const KNOWN_EXPONENTS: Record<string, number> = { UGX: 0, KWD: 3 }

export function resolveCurrencyExponent(code: string): number {
  return KNOWN_EXPONENTS[code] ?? 2
}

export interface CurrencyProperties {
  code: string
  name: string
  symbol: string
  exponent: number
}

export class Currency {
  public readonly code: string
  public readonly name: string
  public readonly symbol: string
  public readonly exponent: number

  public constructor(properties: CurrencyProperties) {
    const code = properties.code.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) throw new ValidationError('Currency code must contain three letters')
    if (!Number.isInteger(properties.exponent) || properties.exponent < 0 || properties.exponent > 6) {
      throw new ValidationError('Currency exponent must be an integer between 0 and 6')
    }
    this.code = code
    this.name = properties.name.trim()
    this.symbol = properties.symbol.trim()
    this.exponent = properties.exponent
  }

  public equals(other: Currency): boolean {
    return this.code === other.code && this.exponent === other.exponent
  }
}
