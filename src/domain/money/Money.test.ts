import { describe, expect, it } from 'vitest'
import { Currency } from './Currency'
import { Money } from './Money'

const ugx = new Currency({ code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', exponent: 0 })
const usd = new Currency({ code: 'USD', name: 'US Dollar', symbol: '$', exponent: 2 })
const kwd = new Currency({ code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD', exponent: 3 })

describe('Money', () => {
  it('parses zero-decimal currencies', () => expect(Money.parse('25000', ugx).minorUnits).toBe(25000n))
  it('parses two-decimal currencies', () => expect(Money.parse('25.50', usd).minorUnits).toBe(2550n))
  it('parses three-decimal currencies', () => expect(Money.parse('1.234', kwd).minorUnits).toBe(1234n))
  it('rejects excessive precision', () => expect(() => Money.parse('1.001', usd)).toThrow())
  it('rejects cross-currency arithmetic', () => expect(() => Money.parse('1', usd).add(Money.parse('1', ugx))).toThrow())
  it('supports fractional quantities', () => expect(Money.parse('10.00', usd).multiplyDecimal('1.5').minorUnits).toBe(1500n))
  it('calculates percentages in basis points', () => expect(Money.parse('100.00', usd).percentage(1800).minorUnits).toBe(1800n))
})
