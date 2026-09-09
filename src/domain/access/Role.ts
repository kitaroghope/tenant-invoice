import { RoleId } from '../shared/EntityId'

export class Permission {
  public constructor(public readonly code: string) {}
}

export class Role {
  private readonly permissionCodes: ReadonlySet<string>

  public constructor(
    public readonly id: RoleId,
    public readonly name: string,
    permissions: readonly Permission[],
  ) {
    this.permissionCodes = new Set(permissions.map((permission) => permission.code))
  }

  public can(permissionCode: string): boolean {
    return this.permissionCodes.has(permissionCode)
  }
}
