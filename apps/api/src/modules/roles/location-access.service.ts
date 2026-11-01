import { pool } from '../../db/pool.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { hasPermission } from './permission.service.js';

export interface PickupTransferScope {
  sourceLocationId: string;
  destinationLocationId: string;
  pickupMode: string;
}

/** Owner/Manager have global access; Staff require an explicit active location assignment. */
export async function canAccessStockLocation(
  user: AuthenticatedUser,
  locationId: string,
): Promise<boolean> {
  if (user.roleCode === 'OWNER' || user.roleCode === 'MANAGER') return true;
  if (user.roleCode !== 'STAFF') return false;

  const result = await pool.query(
    `
      SELECT 1
      FROM user_location_access ula
      JOIN locations l ON l.id = ula.location_id
      WHERE ula.user_id = $1 AND ula.location_id = $2 AND l.is_active = true
      LIMIT 1
    `,
    [user.id, locationId],
  );
  return result.rowCount === 1;
}

/**
 * ADR-016 pickup is an action-scoped exception, not a Warehouse assignment.
 * Canonical Warehouse/Sheraton IDs must come from trusted server configuration;
 * this foundation does not invent or seed physical locations.
 */
export async function canUseWarehouseSheratonPickup(input: {
  user: AuthenticatedUser;
  transfer: PickupTransferScope;
  configuredWarehouseLocationId: string | undefined;
  configuredSheratonLocationIds: readonly string[];
}): Promise<boolean> {
  const { user, transfer, configuredWarehouseLocationId, configuredSheratonLocationIds } = input;

  if (
    user.roleCode !== 'STAFF' ||
    !configuredWarehouseLocationId ||
    transfer.pickupMode !== 'destination_staff_pickup' ||
    transfer.sourceLocationId !== configuredWarehouseLocationId ||
    !configuredSheratonLocationIds.includes(transfer.destinationLocationId) ||
    !hasPermission(user.permissions, 'inventory.transfer.pickup_warehouse_to_assigned_sheraton')
  ) {
    return false;
  }

  return canAccessStockLocation(user, transfer.destinationLocationId);
}
