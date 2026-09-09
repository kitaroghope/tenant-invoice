import { ValidationError } from './DomainError'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export abstract class EntityId {
  protected constructor(private readonly value: string) {
    if (!UUID_PATTERN.test(value)) {
      throw new ValidationError(`Invalid UUID: ${value}`)
    }
  }

  public toString(): string {
    return this.value
  }

  public equals(other: EntityId): boolean {
    return this.value === other.value
  }
}

export class BusinessId extends EntityId {
  public static from(value: string): BusinessId {
    return new BusinessId(value)
  }
}

export class RoleId extends EntityId {
  public static from(value: string): RoleId {
    return new RoleId(value)
  }
}

export class UserId extends EntityId {
  public static from(value: string): UserId {
    return new UserId(value)
  }
}

export class CustomerId extends EntityId {
  public static from(value: string): CustomerId {
    return new CustomerId(value)
  }
}

export class ProductId extends EntityId {
  public static from(value: string): ProductId {
    return new ProductId(value)
  }
}

export class InvoiceId extends EntityId {
  public static from(value: string): InvoiceId {
    return new InvoiceId(value)
  }
}

export class InvoiceLineId extends EntityId {
  public static from(value: string): InvoiceLineId {
    return new InvoiceLineId(value)
  }
}

export class PaymentId extends EntityId {
  public static from(value: string): PaymentId {
    return new PaymentId(value)
  }
}
