# Partner Lifecycle Enhancements Plan

## Goal

Implement a complete partner lifecycle in Herman Admin:

- Create
- Inactivate
- Activate
- Delete

Also add a partner inventory card on the Partners screen that shows all partners in the database, their status, organization count, and total user count across owned organizations.

## Lifecycle Rules

### Create

- Create a new partner record.
- Configure the partner's partner tier.
- Allow the addition of a Partner Admin user.
- Allow assignment of organizations to the partner.
- Support the common case where the partner later creates organizations for itself after receiving login access.

### Partner Admin Rights

Partner Admin users should be able to:

- log in to Herman Admin
- see the organizations their partner owns
- activate new organizations
- add, modify, and delete users for owned organizations
- add, modify, and delete groups for owned organizations

### Inactivate

- Inactivate the partner account without deleting database records.
- Disable partner admin logins.
- Inactivate all organizations associated with the partner.
- Disable all users associated with those organizations from accessing Herman applications.
- Show a serious confirmation warning before execution.
- Warning must include impacted counts:
  - partner admins
  - organizations
  - users

This action is intended for partner usage-agreement noncompliance.

### Activate

- Reactivate an inactive partner.
- Reactivate partner admins.
- Reactivate all organizations associated with the partner.
- Reactivate all users associated with those organizations.

This action is intended for reinstatement after a partner resolves a compliance breach.

### Delete

- A partner must be inactive before deletion is allowed.
- Deleting an inactive partner also deletes its organizations.
- The delete path is destructive and should be clearly labeled as such in the UI.

### Organization Assignment and Reassignment

- Organizations must be assignable to a partner.
- Organizations must also be transferable from one partner to another.
- Reassignment should be fully supported as a normal portfolio-management action.

## Backend Work

### API

Add partner lifecycle endpoints in `app/api/v1/routes/resellers.py`:

- partner action endpoint for:
  - `inactivate`
  - `activate`
  - `delete`
- optional impact summary support if needed by the warning dialogs

### Services

Add partner lifecycle helpers in `app/services.py` to:

- compute impacted counts for a partner
- disable partner admin users and revoke active admin sessions
- inactivate all tenant/user access for partner-owned organizations
- reactivate partner admins, organizations, and users
- delete an inactive partner and cascade through owned organizations using the existing tenant delete flow where possible

### Authorization

- Reuse existing admin permission gates:
  - `resellers.read`
  - `resellers.create`
  - `resellers.write`
- Ensure partner reassignment validates access to both the source organization and the destination partner scope.

## Frontend Work

### Partner Inventory Card

Add a new card on the Partners screen that lists:

- partner name
- partner status
- managed organization count
- total user count across partner organizations

### Lifecycle Controls

Add lifecycle controls to the selected partner workspace:

- Inactivate Partner
- Activate Partner
- Delete Partner

### Warning and Confirmation UX

- Inactivate modal must use strong warning language.
- Inactivate modal must show impacted partner-admin, organization, and user counts.
- Activate modal should confirm restoration of access.
- Delete modal must clearly state that deleting an inactive partner also deletes its organizations.

### Create Flow

- Keep partner creation streamlined.
- After creation, make it easy to create the Partner Admin user immediately.

## Verification

### Backend

- Create partner
- Create partner admin
- Assign organization
- Reassign organization between partners
- Inactivate partner and verify partner admins, organizations, and users lose access
- Reactivate partner and verify access returns
- Block delete when partner is active
- Delete inactive partner and verify owned organizations are removed

### Frontend

- Verify inventory card renders correct counts and status
- Verify lifecycle buttons reflect partner status
- Verify warning dialogs show correct impact counts
- Verify transfer actions still work after lifecycle changes

## Notes

- The implementation should prefer reusing existing tenant lifecycle utilities rather than introducing a second lifecycle model for tenant/user access.
- The partner key is system-generated and should remain internal.
