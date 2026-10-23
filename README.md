# Authflow — Centralized Authorization Server

This repository implements a centralized authorization/authentication server (backend only) with Sequelize models/migrations, an OAuth2-style Authorization Code flow with PKCE, refresh-token rotation, cookie-based SSO session detection, and audit logging.

This README documents backend setup, architecture, security considerations, tests, and operational notes. Client/frontends (PKCE examples) are maintained separately and are not included in this repository.

---

## Quick overview

- Features:
  - Authorization Code flow (server-side exchange)
  - PKCE support (S256 + PLAIN)
  - Refresh token rotation
  - Session cookie for SSO checks (`GET /api/auth/session`)
  - Client credentials endpoint for machine-to-machine tokens
  - Audit logging hooks

- Tech stack:
  - Node.js + Express
  - Sequelize ORM + migrations
  - JWT (`jsonwebtoken`), `bcrypt`, `crypto`
  - Validation with `zod`
  - Tests: `vitest` + `supertest`

---

## Repository structure (high level)

- `src/` — application source
  - `app.js` — express app, CORS and middleware
  - `server.js` — http server entry
  - `modules/auth/` — register/login/authorize/token/session/logout handlers and service logic
  - `config/` — runtime/environment configuration
  - `database/` — DB bootstrap and dynamic model loader
- `models/` — Sequelize model definitions used for migrations and runtime
- `migrations/` — Sequelize migration scripts
- `seeders/` — optional seed data
- Frontend clients (PKCE examples) are kept separately from this backend repository; consult your frontend project for SPA examples.
- `test/` and `src/modules/**/__test__/` — test suites

---

## Important files

- `src/modules/auth/auth.controller.js` — HTTP handlers for `/authorize`, `/token`, `/login`, `/refresh`, `/logout`, `/session`
  - Note: handler implementations live in `src/modules/auth/controllers/` (`auth.controller.js` now re-exports them).
- `src/modules/auth/auth.service.js` — core auth logic: create/consume authorization codes (PKCE), create sessions, refresh rotation, token generation
- `models/authorizationCode.js` — authorization code model (stores `codeChallenge`, `codeChallengeMethod`)
- `src/database/index.js` — dynamic model loader (Windows-safe file:// import fix)
- `src/modules/practice/` — authenticated practice completion and XP/points endpoints

---

## Environment & setup

Prerequisites:

- Node.js 22.18+ or 24 LTS
- A PostgreSQL database configured via `DATABASE_URL`

Install:

```bash
npm install
```

Environment variables (summary) — set these in `.env` or your deployment environment:

- `DATABASE_URL` — PostgreSQL connection string
- `TEST_DATABASE_URL` — separate PostgreSQL database for integration tests; tests never fall back to `DATABASE_URL`
- `DB_SSL` — set to `false` for a local PostgreSQL database without TLS
- `JWT_SECRET` — secret for signing access tokens
- `FRONTEND_ORIGINS` — comma-separated allowed origins for CORS
- `FRONTEND_LOGIN_URL` — URL to redirect unauthenticated authorize requests to (SPA login)
- `AUTH_COOKIE_DOMAIN` — optional, domain to set on SSO cookie for cross-site SSO
- `ALLOW_CROSS_SITE_SSO` — set to `"true"` to allow `SameSite=None` on auth cookies (requires `secure`)
- `NODE_ENV` — `development` or `production`

Database setup and migrations:

```bash
# run migrations (uses sequelize-cli config in repo)
npx sequelize-cli db:migrate

# run seeders if needed
npx sequelize-cli db:seed:all
```

## WordWell practice rewards

Users have `xp` and `points` integer balances stored on the `Users` row. The
backend owns the practice vocabulary and answer key. WordWell requests a
user-specific quiz using the user's bearer access token:

```http
GET /api/practice/quiz
Authorization: Bearer <access-token>
```

The response contains questions with opaque option IDs and no correct answers.
Submit the selections to be graded against the server-stored answer key:

```http
POST /api/practice/complete
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "quizId": "<quiz-id-from-GET>",
  "answers": [
    { "questionId": "<question-id>", "optionId": "<selected-option-id>" }
  ]
}
```

Include one selected option for each of the five question IDs returned by the
quiz endpoint.

Each correct answer awards 20 XP and 5 points. The quiz is associated with the
authenticated user, expires after 30 minutes, and can only be completed once.
`GET /api/practice/progress` returns the current `{ userId, xp, points }`
balances. Apply all pending migrations before using these endpoints.

`GET /api/practice/leaderboard` requires bearer authentication and returns the
top 100 users ordered by XP, with email addresses used as display names and a
stable rank for each entry.

`POST /api/practice/pet/feed` requires the same bearer authentication. The server
deducts 10 points under a user row lock, returns the current balances, and rejects
insufficient funds with HTTP 409. Pet happiness is currently displayed for the
current page session; no persistent pet-state model is implemented.

---

## Running the app

Development:

```bash
npm run dev   # or whatever start script you prefer
```

Run the tests:

```bash
npm test -- --run
```

The default suite runs mocked auth/security and practice tests without connecting
to a database. Database integration tests require a separate test database:

```bash
# Set TEST_DATABASE_URL and JWT_SECRET in your environment first.
npx sequelize-cli db:migrate --env test
npx sequelize-cli db:seed:all --env test
npm run test:integration
```

Integration tests include real concurrent code exchanges, refreshes, quiz
completions, and coin deductions. Do not point `TEST_DATABASE_URL` at a database
used by the app: these tests create and delete their own records.

WordWell uses a hash router. Its login URL is normally
`http://localhost:5173/#/login`, and a browser client's registered callback is
`http://localhost:5173/#/callback`. Browser clients must have no client secret and
use S256 PKCE. Login requests accepting `application/json` receive a validated
`redirectUrl`; other OAuth login requests retain HTTP redirects.

---

## Security & production notes (do not skip)

- Cookie SSO:
  - The project supports setting an SSO cookie with `SameSite=None` to enable cross-site SSO when `ALLOW_CROSS_SITE_SSO` is `true`. This requires `secure` cookies (HTTPS) and careful `AUTH_COOKIE_DOMAIN` configuration.
  - For central-auth-domain SSO (e.g., auth.example.com used by multiple client apps), set `AUTH_COOKIE_DOMAIN=.example.com` and make sure all client apps are in that domain space.

- CORS:
  - `FRONTEND_ORIGINS` should be restricted to known client origins. The server uses explicit methods/headers and enables `credentials` when configured.

- PKCE:
  - The server stores the `code_challenge` and `code_challenge_method` on the authorization code record and verifies `code_verifier` during token exchange. S256 is supported and recommended.

- Refresh token rotation:
  - Refresh tokens are rotated on use — old refresh tokens are invalidated.

- Secrets:
  - Keep `JWT_SECRET` and any client secrets safe and rotated periodically.

- Rate limiting & abuse:
  - All API endpoints share the global rate limit; login and registration have stricter per-endpoint limits.

- HTTPS/HSTS:
  - Serve the production auth service over HTTPS and enable HSTS. Cookies with `SameSite=None` require `secure`.

---

## Tests and CI

- Unit and integration tests use `vitest`. Auth flows including PKCE token exchange are covered by tests under `src/modules/auth/__test__/`.

Typical test command:

```bash
npm run test
```

If you add CI (GitHub Actions, etc.), run migrations in a test DB and execute the test command.

---

## Troubleshooting

- "Received protocol 'c:'" when importing models on Windows: ensure `src/database/index.js` converts model paths to `file://` URLs (this repo includes that fix).
- Authorization code reuse / invalid code: Authorization codes are single-use, short-lived, and verified against `client_id` and `redirect_uri` when exchanged.
- If login redirects issue: check `FRONTEND_LOGIN_URL` and ensure client params (`client_id`, `redirect_uri`) are passed through.

---

## Where to look next in the code

- `src/modules/auth/auth.controller.js` — request/response handling and cookie setting
- `src/modules/auth/auth.service.js` — business logic (create/consume code, PKCE verification, sessions)
- `models/authorizationCode.js` and matching migrations — DB schema for codes
- `src/app.js` — CORS config and middleware

---

## Contributing

PRs welcome. When contributing:

- Run tests locally (`npm run test`) and ensure new behavior is covered
- Follow existing code style

Generated on: 2026-04-21
