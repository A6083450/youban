# WeChat Open Platform Web Login Design

## Context

The current H5 login page creates a private `youban://web-login` QR payload and
waits for a logged-in YouBan mini-program session to approve it. That is a
YouBan cross-device confirmation flow, not WeChat Open Platform website login.
The unibest migration also has no mini-program scanner/approval implementation,
so retaining that flow would leave the migrated product incomplete.

The replacement must provide real WeChat website QR login on H5 while keeping
the mini-program's native `uni.login` flow. The approved WeChat website
application and the mini-program are bound to the same WeChat Open Platform
account, and the configured callback domain is `youban.me`.

## Goals

- Render the official WeChat website-login QR inside the existing YouBan H5
  login page.
- Complete OAuth only on the server and issue the existing HttpOnly Web
  session.
- Use UnionID as the shared identity between website and mini-program login.
- Register first-time website users directly from authorized WeChat profile
  data; a missing avatar must not block login.
- Preserve the mini-program requirement that the user actively chooses an
  avatar before its local login session is persisted.
- Retire the custom Web challenge, short-code, polling, and mini-program
  approval flow from all active contracts and UI.

## Non-Goals

- Deploying the change or changing production secrets.
- Replacing mini-program `uni.login` with website OAuth.
- Supporting WeChat Official Account in-app OAuth.
- Migrating historical accounts from plaintext identifiers. Raw WeChat
  identifiers were intentionally never stored, so only login-time migration is
  possible.
- Deleting the existing `web_login_challenges` SQLite table. It becomes inert
  so existing databases do not require a destructive schema migration.

## User Experience

### H5

The login card keeps the YouBan brand and public share-code entry. Its primary
content becomes an official embedded WeChat QR widget with the copy
`使用微信扫码登录`. The page no longer displays a YouBan short code, challenge
ID, or custom QR.

When configuration is missing or the widget cannot load, the card displays a
stable localized error and a retry button. It must not silently fall back to the
custom mini-program confirmation flow.

After authorization, the callback sets the Web session and returns a minimal
same-origin completion document that navigates the top-level window to
`/#/pages/index/index`. Stable callback failures navigate the top-level window
back to the login page with a non-sensitive error code.

### Mini-Program

The `MP-WEIXIN` login branch remains the explicit avatar chooser followed by
`uni.login`. No website QR widget code or external WeChat login script may be
present in the mini-program build.

## OAuth Flow

1. H5 calls `POST /api/v2/auth/wechat-web/start`.
2. The backend creates:
   - a random OAuth `state` sent to WeChat;
   - an independent random browser verifier stored in an HttpOnly cookie;
   - hashes of both values in a five-minute, single-use database record.
3. The start response returns only the public widget configuration:
   `app_id`, `scope=snsapi_login`, the fixed callback URI, and `state`.
4. H5 loads the official HTTPS `WxLogin` script once and mounts it into the
   login-card container.
5. WeChat redirects the widget to
   `GET /api/v2/auth/wechat-web/callback?code=...&state=...`.
6. The backend atomically validates and consumes the state record, including
   the browser verifier cookie, expiry, and one-time-use constraint.
7. The backend exchanges the temporary code at WeChat's server endpoint, then
   fetches the authorized profile. It requires a non-empty UnionID and verifies
   that the profile openid matches the token response.
8. Authentication resolves or creates the YouBan account by the namespaced
   UnionID digest, imports safe profile fields, issues a Web session, and writes
   the existing `youban_session` HttpOnly cookie.
9. No WeChat access token, refresh token, code, openid, UnionID, website secret,
   or raw provider error is returned to JavaScript, stored in logs, or persisted
   in plaintext.

## API Contracts

### `POST /api/v2/auth/wechat-web/start`

Response:

```json
{
  "app_id": "public website AppID",
  "scope": "snsapi_login",
  "redirect_uri": "https://youban.me/api/v2/auth/wechat-web/callback",
  "state": "single-use random state"
}
```

The response sets a short-lived cookie named `youban_wechat_oauth` with
`HttpOnly; Secure; SameSite=Lax; Path=/api/v2/auth/wechat-web; Max-Age=300`.
Missing website credentials return HTTP 503 with the stable detail
`微信扫码登录尚未配置`.

### `GET /api/v2/auth/wechat-web/callback`

The callback accepts only `code` and `state`. It returns a minimal HTML
completion document rather than JSON because it runs inside the official QR
widget frame. Success sets `youban_session` with the existing seven-day Web
session policy and clears `youban_wechat_oauth`. Failure clears the OAuth
cookie and navigates to one of these stable UI codes:

- `denied`: WeChat returned no authorization code.
- `expired`: state is unknown, expired, used, or not bound to this browser.
- `provider`: WeChat token/profile exchange failed.
- `identity`: UnionID was absent or the identity could not be resolved safely.

The callback never reflects raw query data into HTML. All HTML values are
fixed application constants or escaped values selected from the allowlist
above.

### Removed Active Contracts

The following routes and corresponding shared DTOs/frontend methods are
removed from active use and return 404:

- `POST /api/v2/auth/web/challenges`
- `GET /api/v2/auth/web/challenges/:challengeId/status`
- `POST /api/v2/auth/web/challenges/:challengeId/approve`
- `POST /api/v2/auth/web/challenges/:challengeId/exchange`

Legacy unversioned aliases are retired at the same time.

## Configuration

Website credentials are independent from mini-program credentials:

```text
WECHAT_WEB_APP_ID
WECHAT_WEB_APP_SECRET
WECHAT_WEB_REDIRECT_URI=https://youban.me/api/v2/auth/wechat-web/callback
```

`WECHAT_WEB_REDIRECT_URI` must be HTTPS and have the exact host `youban.me` in
production. It is server configuration, not an admin runtime setting. Secrets
remain in the server environment and are never written to runtime JSON or
returned by `/api/v2/settings`.

The existing `WECHAT_APP_ID` and `WECHAT_APP_SECRET` remain dedicated to
mini-program `jscode2session`.

## Identity Model

### Namespaced Digests

The server continues to avoid storing raw WeChat identifiers. New identity
lookups HMAC a namespaced subject:

- `wechat:unionid:<unionid>` for the cross-platform primary identity.
- the existing raw mini-program openid digest only for legacy lookup.

Website OAuth requires UnionID. Mini-program code exchange returns both openid
and UnionID. Production mini-program login rejects a missing UnionID so it
cannot silently create a second account; the existing explicit development
login mode may use a deterministic development identity.

### Legacy Login-Time Upgrade

On mini-program login:

1. Look up the UnionID digest.
2. If absent, look up the legacy raw-openid digest.
3. If the legacy identity exists, attach the UnionID digest to that user in the
   same transaction.
4. Otherwise create a new user and attach both the UnionID and legacy openid
   digests.

Because historical openids are stored only as digests, an old account cannot
be matched from website OAuth before that account performs this one-time
mini-program login. The local candidate database currently contains zero users
and identities. Production data must be counted read-only before deployment;
deployment is blocked if existing identities require a migration decision.

### Direct Website Registration

For an unknown UnionID, website OAuth creates the user in one transaction,
adds the UnionID identity, and marks the profile complete. The authorized
nickname is normalized and bounded; an empty nickname becomes `微信用户`.

An authorized HTTPS avatar is downloaded through a dedicated bounded importer
into the existing avatar directory. It accepts only JPEG, PNG, or WebP, applies
timeouts and byte limits, writes atomically, and returns only a server-managed
filename. Import failure leaves `avatar_file` null without failing login. The
UI already supports an initials fallback.

Readiness changes from `profile_complete && avatar_url` to
`profile_complete`. This keeps incomplete mini-program sessions blocked because
their profile is not marked complete until avatar upload succeeds, while
allowing an explicitly authorized website profile without an avatar.

## Data Storage

Add a `wechat_web_oauth_states` table with:

- `state_hash` primary key;
- `browser_verifier_hash`;
- `created_at`;
- `expires_at`;
- nullable `consumed_at`.

Both hashes use one-way digests of high-entropy random values. Consumption uses
one database transaction and rejects rows already consumed or expired. Expired
rows may be deleted opportunistically when a new state is created.

The existing identities and sessions tables remain unchanged. The legacy Web
challenge table remains in the compatibility schema but has no HTTP consumer.

## Components

### Backend

- `wechat-web-oauth.ts`: builds provider URLs, exchanges code, fetches and
  validates provider profile data, and maps provider failures to stable errors.
- `wechat-avatar-import.ts`: validates and atomically imports authorized avatar
  bytes into `avatarsDir`.
- `authentication.ts`: owns OAuth state records, UnionID identity linking,
  direct website registration, and session issuance.
- `http/app.ts`: exposes the start/callback routes, cookies, stable completion
  HTML, and dependency injection used by tests.
- `settings.ts` and deployment files: load and document website-only settings.
- `wechat-code-exchange.ts`: returns the mini-program openid and UnionID instead
  of discarding UnionID.

### Shared Contracts

Replace challenge DTOs/routes with the website-login start response. Provider
profile types remain backend-private.

### H5 Frontend

- `wechat-login-widget.ts`: H5-only official script loader and typed `WxLogin`
  adapter.
- `pages/login/index.vue`: mounts the widget, maps stable callback errors to
  localized copy, retains retry and public share-code access, and preserves the
  separate `MP-WEIXIN` avatar login branch.
- remove the H5 custom challenge polling and short-code UI. The `qrcode`
  dependency remains because trip sharing and plan export still use it.

## Error Handling and Audit

- Start failures are JSON errors because H5 initiated them with `fetch`.
- Callback failures are fixed HTML completion responses suitable for the
  embedded frame.
- WeChat provider timeouts and malformed responses map to one stable provider
  error; logs contain an internal category but no credentials or identifiers.
- Authentication audit events record only operation, outcome, user ID when
  known, and a truncated digest already safe for audit use.
- Replayed, expired, forged, or cross-browser OAuth states never issue a
  session.

## Verification

### Automated

- Unit tests for mini-program code exchange returning UnionID without leaking
  `session_key`.
- Unit tests for website token/profile exchange, provider errors, and secret
  non-disclosure.
- Domain tests for state expiry/replay/browser binding, new website
  registration, existing UnionID login, legacy openid upgrade, nickname
  fallback, and missing avatar.
- HTTP tests for start/callback cookies, fixed redirects, 503 configuration,
  provider failures, HttpOnly session issuance, and retired challenge routes.
- Avatar importer tests for allowed types, size bounds, timeout/failure, and
  atomic file output.
- Shared-contract tests for the new route/DTO and absence of challenge DTOs.
- H5 tests proving official widget configuration and the absence of
  `youban://web-login`, short-code polling, and custom login QR generation.
- Existing mini-program avatar-login tests remain green.

### Builds and Runtime

Run the existing frontend test, lint, type-check, H5 build, and WeChat build
gates, plus the focused and full backend suites. Inspect the H5 output to prove
the official widget is present and inspect the mini-program output to prove it
is absent. Rebuild the isolated Docker candidate and verify its health and
login-page DOM in a fresh browser tab.

Real WeChat scanning is accepted only after a separately authorized deployment
sets the three website environment variables on `youban.me`. This code task
does not deploy, replace a running production service, or request the website
AppSecret in chat.

## Rollout and Rollback

Before deployment, query production counts for `users` and
`wechat_identities`. If nonzero legacy identities exist, stop and choose an
account-transition window before enabling website OAuth.

Deploy code and website credentials together. Acceptance requires an existing
mini-program account and a new website-first account to both complete QR login,
with the existing account resolving to the same user ID. Rollback removes the
website credentials and restores the previous application image; it must not
re-enable the custom mini-program challenge flow as a silent fallback.
