# Security Specification & Threat Model

## 1. Data Invariants
1. **Workspace Isolation**: Every product, staff profile, order, movement, and transfer receipt belongs to an existing `/workspaces/{workspaceId}` document.
2. **Verified Staff Authentication**: All Firestore reads and writes require `request.auth != null` and `request.auth.token.email_verified == true`.
3. **Identity Integrity**: On creation, `createdByUid` (and `actorUid` on movements) must strictly equal `request.auth.uid`, and `ownerUid` must match the parent workspace's `ownerUid`.
4. **Immutable Audit Trail**: `movements` cannot be updated or deleted once created; `createdAt` and `ownerUid` on all entities are immutable.
5. **Terminal State Protection**: Orders in terminal status (`cancelado` or `entregado` + `pagado`) cannot be arbitrarily reverted by non-admin staff without explicit admin privilege.
6. **Bounded Payloads & Strict Schemas**: Every string has strict `.size()` limits, every array has `.size() <= N` bounds, and every document enforces `keys().hasAll(...)` and `keys().hasOnly(...)` to block shadow fields.
7. **PII Isolation**: Staff operational roster (`/staff/{staffId}`) holds only display names and operational roles—no email addresses or phone numbers.

## 2. Dirty Dozen Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Order Creation**: `auth = null` attempting `create` on `/workspaces/ws1/orders/ord1`.
2. **Unverified Email Spoofing**: `auth = { uid: 'u1', token: { email: 'perrodog1515@gmail.com', email_verified: false } }` attempting `create` on `/workspaces/ws1/orders/ord1`.
3. **Shadow Field Injection**: Authenticated owner adding `isAdminOverride: true` or `extraField: 123` to a `Product` creation payload.
4. **ID Poisoning**: Authenticated owner attempting `create` with a 200-character document ID containing spaces or `$` characters.
5. **Identity Spoofing on Movement**: Authenticated user attempting to create a `Movement` with `actorUid: 'someone_else'`.
6. **Client Timestamp Tampering**: Authenticated user attempting to create an `Order` with `createdAt` set to a forged past date instead of `request.time`.
7. **Mutation of Immutable Audit Log**: Authenticated user attempting `update` or `delete` on `/workspaces/ws1/movements/mov1`.
8. **Blanket Collection Scraping**: Authenticated non-owner/non-member attempting `list` on `/workspaces/ws1/orders` without matching `ownerUid` or `createdByUid`.
9. **Orphaned Subcollection Write**: Authenticated user attempting `create` on `/workspaces/nonexistent/orders/ord1` where parent workspace does not exist.
10. **Negative Price / Type Poisoning**: Authenticated user attempting `create` on `Product` with `basePrice: -50` or `basePrice: "100"`.
11. **Oversized String Denial-of-Wallet**: Authenticated user attempting `update` on `Order` with a 5,000-character `notes` field (exceeds `400` limit).
12. **Privilege Escalation on Workspace**: Non-owner attempting to `update` `/workspaces/ws1` to change `ownerUid` to their own UID.
