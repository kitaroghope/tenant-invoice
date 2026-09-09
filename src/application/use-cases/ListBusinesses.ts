import { Business } from '../../domain/business/Business'
import { BusinessRepository } from '../ports/BusinessRepository'

export class ListBusinesses {
  public constructor(private readonly businesses: BusinessRepository) {}

  public execute(): Promise<readonly Business[]> {
    return this.businesses.listActive()
  }
}
