export function hasPermission(
  grantedPermissions: readonly string[],
  requiredPermission: string,
): boolean {
  return grantedPermissions.includes(requiredPermission);
}
