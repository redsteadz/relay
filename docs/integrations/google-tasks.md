---
status: accepted
owner: integrations
last_verified: 2026-08-28
sources:
  - https://developers.google.com/workspace/tasks/reference/rest
---

# Google Tasks

Google Tasks is first action provider. Connector authorization is separate and encrypted — even
when the same Google account also has a Gmail connection, the two are distinct rows in
`connections` (different `provider` values), so disconnecting one never touches the other. Relay
creates a task only from a user-owned action rule with operation `create-task`.

## Connector OAuth

`apps/api` owns the PKCE/state-cookie OAuth flow at `/api/connectors/google-tasks`, mirroring the
Gmail connector's shape:

- `GET /authorize` redirects to Google requesting only the `https://www.googleapis.com/auth/tasks`
  scope — full read/write, since `create-task` needs write, but nothing broader. No profile/email
  scope is requested and no userinfo call is made just to label the connection with an account
  name; `external_account_id` is left null, so a user can hold exactly one Google Tasks connection
  at a time.
- `GET /callback` validates PKCE state against an `HttpOnly` cookie scoped to
  `/api/connectors/google-tasks` (its own cookie name, so a concurrent Gmail connect attempt can't
  collide with it), exchanges the code, and envelope-encrypts the refresh token into `connections`
  with `@relay/crypto`.
- `GET /task-lists` refreshes an access token from the stored encrypted refresh token and lists the
  user's task lists (id + title only) for rule target selection.
- `POST /disconnect` best-effort revokes the token with Google, then — because
  `action_rules.connection_id` is `ON DELETE RESTRICT` — detaches and disables (`enabled = false`,
  `connection_id = null`) any action rule still pointing at the connection before deleting the
  credential row. If the connection id doesn't belong to the caller, it reports nothing deleted
  rather than a false success.

Mapped fields are title, notes, due date, and selected task list. Relay stores Google task ID as
provider reference. Because insert does not offer a Relay-controlled idempotency key, notes carry a
stable Relay action marker and ambiguous retries reconcile the target list before another insert.
Exact marker format and search limitations require implementation validation.

Approval is default. Automatic task creation is enabled per rule only. Deleting or completing tasks
is outside MVP scope.

Related: [action model](../architecture/action-model.md).
