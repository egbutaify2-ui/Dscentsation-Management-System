# Order fulfilment location lookup

## API contract

`GET /api/v1/locations` requires an authenticated DMS session and returns the locations the current employee may select for order fulfilment:

```json
{
  "data": [
    {
      "id": "location UUID",
      "code": "SHERATON",
      "name": "Sheraton Store (SHERATON)",
      "isActive": true
    }
  ]
}
```

The `name` field is a UI-ready display label and includes the location code when present. The response intentionally omits address, contact name, contact phone and other internal location fields. No `meta` object is returned for this non-paginated lookup.

## Access policy

- Owner and Manager receive all active locations.
- Staff receive only active locations with an explicit `user_location_access` row for their user ID.
- Unknown roles, inactive locations and unassigned Staff locations are not returned.
- The endpoint requires authentication and introduces no new location permission code or role-permission grant. Order CRUD remains independently gated by `orders.view`, `orders.create` and `orders.update`.

The same active-location and role/assignment rule is checked by the Order service on every create and amendment. An unknown, inactive or unauthorised submitted location is rejected with HTTP 403 and `LOCATION_ACCESS_DENIED`; frontend filtering is not treated as a security boundary.

The dedicated Ajose Warehouse-to-assigned-Sheraton pickup remains an action-scoped inventory-transfer exception. Its existing explicit action permission and destination-assignment checks do not add Warehouse to a Staff member's general order-fulfilment options.

## Availability model boundary

The current `locations` schema has one availability state: `is_active`. This endpoint treats `is_active = true` as available and excludes inactive rows. There is no separate `is_available`, operational-hours or temporary-unavailability field in the current schema. Any future requirement for those states needs an approved data-model change rather than an invented filter.

## CI action policy

The DMS workflow uses only the following reviewed, immutable action references. The repository's GitHub Actions policy must permit these three exact action references under **Allow selected actions and reusable workflows**:

- `actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`
- `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1`
- `actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444`

The workflow retains `contents: read` and does not request write permissions or automate commits/pushes. Do not enable all Marketplace actions as a workaround.
