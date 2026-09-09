export class DomainError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends DomainError {}
export class CurrencyMismatchError extends DomainError {}
