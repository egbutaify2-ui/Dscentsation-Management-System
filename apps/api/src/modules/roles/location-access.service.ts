import type { QueryResultRow } from 'pg';
import { pool } from '../../db/pool.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { hasPermission } from './permission.service.js';

export interface PickupTransferScope {
  sourceLocationId: string;
  destinationLocationId: string;
  pickupMode: string;
}

export interface AccessibleStockLocation {
  id: string;
  code: string;
  /** UI-ready label. The location code is included when present. */
  name: string;
  isActive: true;
}

interface AccessibleStockLocationRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

/**
 * Returns fulfilment locations the authenticated employee may use.
 * Owner/Manager can use every active location; Staff require an active
 * user_location_access assignment. Shared read-only inventory visibility is
 * deliberately not treated as fulfilment authority.
 */
export async function listAccessibleStockLocations(
  user: Pick<AuthenticatedUser, 'id' | 'roleCode'>,
): Promise<AccessibleStockLocation[]> {
  const result = await pool.query<AccessibleStockLocationRow>(
    `
      SELECT l.id, l.code, l.name, l.is_active
      FROM locations l
      WHERE l.is_active = true
        AND (
          $1::boolean = true
          OR (
            $2::text = 'STAFF'
            AND EXISTS (
              SELECT 1
              FROM user_location_access ula
              WHERE ula.user_id = $3 AND ula.location_id = l.id
            )
          )
        )
      ORDER BY lower(l.name), lower(l.code), l.id
    `,
    [user.roleCode === 'OWNER' || user.roleCode === 'MANAGER', user.roleCode, user.id],
  );

  return result.rows.map((row) => {
    const code = row.code.trim();
    return {
      id: row.id,
      code: row.code,
      name: code ? `${row.name} (${code})` : row.name,
      isActive: true,
    };
  });
}

/** Owner/Manager have global active-location access; Staff require an active assignment. */
export async function canAccessStockLocation(
  user: Pick<AuthenticatedUser, 'id' | 'roleCode'>,
  locationId: string,
): Promise<boolean> {
  const result = await pool.query(
    `
      SELECT 1
      FROM locations l
      WHERE l.id = $1
        AND l.is_active = true
        AND (
          $2::text IN ('OWNER', 'MANAGER')
          OR (
            $2::text = 'STAFF'
            AND EXISTS (
              SELECT 1
              FROM user_location_access ula
              WHERE ula.user_id = $3 AND ula.location_id = l.id
            )
          )
        )
      LIMIT 1
    `,
    [locationId, user.roleCode, user.id],
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
