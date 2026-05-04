# Canonical User ID, Foundational Profile Seeding, And CQI Ingestion Plan

## Summary

We will do a coordinated cutover across the Herman platform with no backward-compatibility fallback. `user_id_hash` remains the only canonical cross-app user identifier. Herman Admin will also let admins choose an initial user type during user creation, and that choice will seed the user's foundational profile immediately so the platform can personalize before CQI is completed.

Implementation order:

1. `Herman-Admin`
2. Temporary Airtable import helper app
3. `herman_portal`
4. `prompt_transformer`
5. `herman-prompt`

Runtime model for now:

- `type_detail` is the foundational starting layer seeded from the admin-selected initial user type.
- CQI-derived data populates higher-order layer tables such as `brain_chemistry` and other applicable profile tables.
- `final_profile` remains the effective runtime profile table used by Prompt Transformer.
- A profile-builder/update step recomputes `final_profile` from `type_detail` plus any available higher-order layers.

## Repo 1: `Herman-Admin`

Admin owns canonical user creation and now also owns initial foundational profile selection at onboarding.

- Replace the current ad hoc user ID generator with the approved canonical `user_id_hash` generator.
- Use one shared canonical-ID creation path for user creation and admin creation.
- Treat `user_id_hash` as immutable after creation.
- Add an `initial_user_type` field to the user creation flow in the Admin UI and backend API.
- Require `initial_user_type` for new end-user creation unless there is an explicitly approved system default.
- On user creation:
  - create the canonical user row
  - create the user's foundational `type_detail` profile row from the selected initial user type
  - create or trigger creation of the corresponding `final_profile` row so runtime has an immediately usable effective profile
- Record enough metadata to trace which initial user type was selected for the user.
- Keep email as user metadata, not as the cross-app identity key.
- Do not add a permanent Herman Admin application endpoint whose main purpose is runtime "email to `user_id_hash` lookup."

Implementation notes:

- The selected initial user type should map to a predefined foundational profile template.
- The foundational template should populate the numeric profile fields and any enforcement defaults required for runtime.
- `final_profile` should initially mirror the foundational profile when no higher-order layer data exists yet.
- If the current schema has no dedicated place to store the chosen type label beyond `profile_version`, define a strict convention and use it consistently.

Required API/data changes:

- User creation payload gains `initial_user_type`.
- Admin-side profile seeding logic gains a deterministic mapping from `initial_user_type` to `type_detail` values.
- User update behavior must define whether `initial_user_type` is immutable after creation or admin-editable only before CQI data exists. Recommended default: immutable after creation unless explicitly reset through a dedicated admin action.

Tests:

- New user creation produces one canonical `user_id_hash`.
- User creation requires or applies a valid `initial_user_type`.
- Creating a user creates `type_detail` and `final_profile` rows keyed by the same `user_id_hash`.
- `final_profile` matches the seeded foundational profile when no CQI layers exist.
- Re-creating or updating a user does not generate a new canonical hash.

## Repo 2: Temporary Airtable Import Helper App

This is the short-term CQI bridge. It should use email only as an import reconciliation key, not as a permanent platform identity key.

- Read Airtable CQI/personality data.
- Normalize email exactly the same way the Herman platform normalizes email.
- Resolve the canonical user by `tenant_id + normalized email` against `auth_users`.
- Fail hard on:
  - no matching user
  - more than one matching user
  - missing tenant context
- Retrieve the canonical `user_id_hash`.
- Upsert CQI-derived data into the appropriate higher-order profile layer tables using only `user_id_hash`.
- After layer-table writes, recompute `final_profile` from the foundational `type_detail` layer plus the available CQI-derived layers.
- Never write profile rows keyed by email.
- Emit an operator-friendly import report showing matched users, unmatched rows, ambiguous rows, and successful profile recomputations.

Implementation notes:

- Direct DB read is the recommended temporary identity-resolution path.
- The helper should be treated as an internal ops/import tool, not a user-facing app.
- It should be safe to re-run without creating duplicate profile identities.
- The helper must not overwrite the canonical foundational type selection in `type_detail` unless the product explicitly decides CQI can change the foundational layer later.

Tests:

- Successful import resolves a user by `tenant_id + email` and writes by `user_id_hash`.
- Import populates higher-order layer rows without changing `type_detail`.
- Import recomputes `final_profile` after CQI data lands.
- Ambiguous email within scope fails clearly.
- Unknown email fails clearly.
- Re-import is idempotent for the same source row.

## Repo 3: `herman_portal`

Portal remains a strict pass-through of canonical identity for Herman Prompt launch.

- Resolve the user's canonical `user_id_hash` from `auth_users`.
- Mint Herman Prompt launch tokens with required claims:
  - `user_id_hash`
  - `display_name`
  - `tenant_id`
  - `external_user_id`
- Preserve `external_user_id` as the upstream authenticated identity claim.
- Do not derive or replace `user_id_hash` in Portal.
- Update docs to state that Herman Prompt must trust token `user_id_hash` directly.

Long-term CQI note:

- When the real CQI tool replaces the Airtable helper, Portal or the invitation/welcome flow should launch CQI with a trusted identity handoff tied to the canonical user record.
- The long-term CQI flow should not rely on email lookup once the CQI app is integrated.

Tests:

- Launch token contains the exact stored canonical `user_id_hash`.
- `external_user_id` is present.
- Login/launch flow always uses the canonical stored user hash.

## Repo 4: `prompt_transformer`

Transformer remains the owner of transformation-profile data and continues to use `final_profile` as the runtime effective profile.

- Change public API contracts from `user_id` to `user_id_hash`.
- Rename internal parameters, schema fields, logs, and request-record fields that currently use `user_id` when they mean the canonical user hash.
- Require `user_id_hash` on:
  - transform requests
  - conversation score reads
  - resolved-profile reads
- Keep runtime reads pointed at `final_profile`.
- Do not move runtime composition into Prompt Transformer request-time resolution in this phase.
- Add or standardize deterministic profile-builder logic that can compute `final_profile` from:
  - foundational `type_detail`
  - CQI-driven higher-order layers
  - any future supported layers
- Define precedence rules for recomputing `final_profile` and keep them outside the request-time transformation path.

Implementation notes:

- This phase should make `type_detail` meaningful immediately.
- `brain_chemistry`, `environment_details`, and `behaviorial_adj` can remain optional inputs to the builder.
- `final_profile` must always exist for active users once Admin onboarding completes.

Required interface changes:

- `POST /api/transform_prompt`: request field `user_id_hash`, response field `user_id_hash`
- `GET /api/conversation_scores/{conversation_id}`: query param `user_id_hash`
- `GET /api/profiles/resolve`: query param `user_id_hash`

Tests:

- All API tests use `user_id_hash`.
- Transform and score endpoints persist and return the canonical `user_id_hash`.
- Users with only foundational `type_detail` data still get a valid `final_profile`.
- Users with CQI layer data get a recomputed `final_profile`.
- Profile resolution works for both pre-CQI and post-CQI users.

## Repo 5: `herman-prompt`

Herman Prompt becomes the strict consumer of the canonical launch contract and surfaces the seeded foundational/effective profile state immediately.

- Remove launch-token fallback derivation entirely.
- Require signed launch token `user_id_hash` and trust it directly.
- Keep `external_user_id` only as upstream identity metadata, never as a source for a replacement hash.
- Move bootstrap profile loading off Prompt Transformer and onto the authoritative bootstrap data source.
- Return bootstrap payload with:
  - `user_id_hash`
  - `display_name`
  - `tenant_id`
  - base summary profile identifier/label
  - `prompt_enforcement_level`
- For users who have not completed CQI yet, bootstrap should still return the seeded profile information created from the admin-selected initial user type.
- If the user's bootstrap profile record is missing, show the blocking error state instead of silently defaulting.
- Update transformer client calls to use `user_id_hash` only.
- Keep demo mode separate and explicitly non-production.
- Keep feedback writes keyed by canonical `user_id_hash`.

Tests:

- Signed launch token with canonical `user_id_hash` bootstraps successfully.
- Token missing `user_id_hash` fails.
- Bootstrap reads authoritative profile/enforcement data directly.
- Newly created users without CQI data still receive valid profile/enforcement bootstrap state.
- Chat, Guide Me, feedback, and conversations all use the same canonical `user_id_hash`.
- Transformer calls use `user_id_hash` only.

## Long-Term CQI Replacement

After the temporary Airtable helper is retired:

- The welcome flow should include the normal password/invitation link plus a CQI launch link.
- That CQI launch should authenticate the user with a trusted signed handoff or token exchange tied to the canonical user record.
- The CQI app should write higher-order profile results directly using the trusted canonical `user_id_hash`.
- After CQI submission, the platform should recompute `final_profile` from `type_detail` plus CQI-derived layers.
- Email lookup should disappear from the CQI runtime path entirely.

## Cutover Validation

Run after all repos are updated.

- Create a user in Admin with a chosen `initial_user_type`.
- Verify canonical `user_id_hash` plus seeded `type_detail` and `final_profile` rows.
- Verify the temporary Airtable helper can resolve that user by `tenant_id + email` and populate higher-order profile data by `user_id_hash`.
- Verify the helper recomputes `final_profile`.
- Verify Portal launch token contains that exact `user_id_hash`.
- Verify Herman Prompt bootstraps using the token `user_id_hash` directly.
- Verify Herman Prompt reads bootstrap display/enforcement state from the authoritative source.
- Verify Prompt Transformer receives and persists the same canonical `user_id_hash`.
- Verify user experience is useful both before CQI completion and after CQI-derived updates land.

## Assumptions

- This is a coordinated cross-repo cutover with no legacy fallback support.
- The temporary Airtable helper is an internal operator tool, not a permanent product surface.
- Email may be used only for temporary import reconciliation with tenant scoping.
- `user_id_hash` remains the only canonical cross-app user key.
- `type_detail` is the foundational starting layer.
- `final_profile` remains the effective runtime profile table in this phase.
- CQI updates higher-order layers and then triggers `final_profile` recomputation rather than replacing the foundational type directly.
