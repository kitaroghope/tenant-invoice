import type { BusinessRepository, CreateBusinessCommand } from '../ports/BusinessRepository'
import { BusinessId } from '../../domain/shared/EntityId'

export class CreateBusiness {
  public constructor(private readonly businesses: BusinessRepository) {}

  public execute(command: CreateBusinessCommand): Promise<BusinessId> {
    return this.businesses.create(command)
  }
}
