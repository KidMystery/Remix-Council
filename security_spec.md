# Security Specification: AI Council Chamber Firestore Rules

## 1. Data Invariants
- **Identity Isolation**: A user can strictly only read, create, update, and delete their own documents within `/users/{userId}/**`. Cross-user access is impossible.
- **Relational Ownership Invariant**: In `/users/{userId}/sessions/{sessionId}`, `incoming().userId` must strictly match `request.auth.uid` and path variable `{userId}`.
- **ID Guarding**: All document IDs and user IDs must conform to regex `^[a-zA-Z0-9_-]+$` with length `<= 128`.
- **Schema Completeness & Type Safety**:
  - `CouncilSession`: Must contain `id` (string <= 128), `userId` (string <= 128), `title` (string <= 500), `createdAt` (number), and `updatedAt` (number). If present, `rounds` must be a list with size `<= 50`. `attachedFiles` list size `<= 100`.
  - `UserSettings`: Must contain `updatedAt` (number). Optional `settings`, `personas`, and `synthesizer` must conform to valid nested structures.
- **Immutable Keys**: `id`, `userId`, and `createdAt` are immutable after session document creation.
- **Default Deny**: Global catch-all denying all reads and writes across unmapped paths.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Identity Spoofing - Session Owner Mismatch)**
   - Attack: Write a session under `/users/user_123/sessions/sess_1` where `userId: "attacker_999"`.
   - Expected: `PERMISSION_DENIED`

2. **Payload 2 (Cross-User Write Infiltration)**
   - Attack: Authenticated as `user_A`, attempting `setDoc` at `/users/user_B/sessions/sess_2`.
   - Expected: `PERMISSION_DENIED`

3. **Payload 3 (Path Variable Poisoning)**
   - Attack: Injecting a 2KB junk character string or invalid regex chars into `{sessionId}` or `{userId}` (e.g. `../../etc/passwd` or `a*b$c!`).
   - Expected: `PERMISSION_DENIED`

4. **Payload 4 (Ghost Field / Shadow Key Injection)**
   - Attack: Creating a session with extra malicious properties `{ isSuperAdmin: true, billingOverride: "free" }`.
   - Expected: `PERMISSION_DENIED`

5. **Payload 5 (Immutable Field Mutation - Hijack Owner)**
   - Attack: Updating existing session to change `userId` or `id`.
   - Expected: `PERMISSION_DENIED`

6. **Payload 6 (Immutable Field Mutation - Roll Back Creation Time)**
   - Attack: Updating existing session with a modified `createdAt` timestamp.
   - Expected: `PERMISSION_DENIED`

7. **Payload 7 (Denial of Wallet - Title Length Overflow)**
   - Attack: Creating a session with a `title` containing 50,000 characters.
   - Expected: `PERMISSION_DENIED`

8. **Payload 8 (Unbounded Array Injection - Rounds Exhaustion)**
   - Attack: Injecting an array of 5,000 artificial round objects to exceed document boundaries.
   - Expected: `PERMISSION_DENIED`

9. **Payload 9 (Unauthenticated Anonymous Snooping)**
   - Attack: Reading `/users/user_123/settings/global_preferences` without valid Firebase Auth tokens.
   - Expected: `PERMISSION_DENIED`

10. **Payload 10 (Type Poisoning - String for Numeric Timestamp)**
    - Attack: Setting `createdAt: "yesterday"` or `updatedAt: false`.
    - Expected: `PERMISSION_DENIED`

11. **Payload 11 (Unmapped Collection Creation)**
    - Attack: Attempting to create documents in arbitrary collections like `/admin_secrets/` or `/user_backups/`.
    - Expected: `PERMISSION_DENIED`

12. **Payload 12 (Settings Tampering by Third-Party)**
    - Attack: Authenticated user attempting to overwrite `/users/target_user/settings/global_preferences`.
    - Expected: `PERMISSION_DENIED`

---

## 3. Rules Verification Matrix

| Vulnerability Vector | Defense Mechanism | Rule Function Gate | Status |
|---|---|---|---|
| ID Poisoning | Regex & Size check | `isValidId(userId) && isValidId(sessionId)` | Hardened |
| Cross-User Access | UID Verification | `isOwner(userId)` | Hardened |
| Type Poisoning | Strict Schema Validation | `isValidCouncilSession(data)` | Hardened |
| Field Tampering | Immutability check | `incoming().userId == existing().userId` | Hardened |
| Memory/Cost Bomb | Array & String bounds | `data.title.size() <= 500 && data.rounds.size() <= 50` | Hardened |
| Catch-All Bleed | Top-level reject | `match /{document=**} { allow read, write: if false; }` | Hardened |

---

## 4. Operational & Deployment Setup Guide

### Firebase Authentication Setup
1. **Enable Google Provider**:
   - Go to **Firebase Console → Authentication → Sign-in method**.
   - Enable **Google** as a sign-in provider. If disabled, login requests will fail with `auth/operation-not-allowed`.
2. **Configure Authorized Domains**:
   - Go to **Firebase Console → Authentication → Settings → Authorized domains**.
   - Add the domain where the app is hosted (e.g. Railway domain, custom domain, or preview host). If missing, sign-in will fail with `auth/unauthorized-domain`.

### Server API Route Protection
1. **Owner Authentication**:
   - The server enforces owner authentication on protected endpoints (`/api/council`, `/api/council/account`, `/api/council/extract-archive`, `/api/council/import-github`).
   - Set `OWNER_UID` or `OWNER_EMAIL` in the server environment to strictly bind protected API access to your Firebase account.
   - In production environments, if neither `OWNER_UID` nor `OWNER_EMAIL` is set, the server fails closed (HTTP 403) to prevent unauthorized API execution.
   - For non-interactive or headless clients, `COUNCIL_ACCESS_SECRET` may optionally be set as a shared secret header fallback.
2. **Public Endpoints**:
   - `/api/health`: Public health check (HTTP 200).
   - `/api/council/models`: Public cached OpenRouter model catalog with per-IP rate-limiting.

