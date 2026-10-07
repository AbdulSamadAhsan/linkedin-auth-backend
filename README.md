# Node.js + MongoDB authentication backend

Separate backend for the React app at `F:\linkedin-auth`. Built with Express and Mongoose. Requires Node.js 24+ and MongoDB running locally, or a MongoDB Atlas connection string.

## Start

Dependencies and `.env` are already set up on this machine. MongoDB is installed as the Windows `MongoDB` service.

```powershell
cd F:\linkedin-auth-backend
npm run dev
```

API: http://127.0.0.1:4000/api/health

On another machine, run `npm install` and copy `.env.example` to `.env` first. Set `MONGODB_URI` in `.env` to your connection string. Do not commit `.env`.

Default database: `mongodb://127.0.0.1:27017/linkedin_auth`. Collections: `users` and `sessions`. Startup waits for MongoDB and index creation before accepting requests. Existing SQLite files, if any, are left untouched; accounts are not migrated automatically.

In a separate terminal, start the frontend:

```powershell
cd F:\linkedin-auth
npm run dev
```

Open http://127.0.0.1:5173/join to create an account, then use /login to sign in. Successful authentication opens /account. Sign out revokes the session. Vite proxies /api to port 4000. Keep the browser hostname consistent between visits.

## API

| Method | Path | Body / result |
| --- | --- | --- |
| GET | /api/health | Database health; 200 when MongoDB responds, 503 otherwise |
| POST | /api/auth/register | `{ "email": "you@example.com", "password": "at-least-8-characters", "remember": true }` |
| POST | /api/auth/login | Same fields as registration |
| GET | /api/auth/me | Current user's id, email, createdAt; requires cookie |
| POST | /api/auth/logout | `{}`; revokes session and clears cookie |

Registration returns 201. Other successful auth requests return 200. Errors have a `message` field and use 400 validation, 401 unauthenticated, 403 rejected origin, 409 duplicate email, 413 oversized body, 415 unsupported content type, or 429 too many attempts. Mutations require application/json. Browser requests must include credentials; the existing React API helper does this.

## Security and storage

- Passwords are salted and hashed with scrypt. Raw passwords are never saved.
- Emails are trimmed/lowercased with a unique MongoDB index to prevent concurrent duplicates.
- Passwords must contain 8–128 characters during registration.
- MongoDB stores hashes of random 256-bit session tokens. Cookies are HttpOnly and SameSite=Lax, with Secure enabled in production.
- Remember me enables a persistent 30-day cookie/session; otherwise the cookie is browser-session-only with a server-side 12-hour limit.
- Login rotates the current session; logout revokes it. Expiration is checked on every protected request, independently of MongoDB's asynchronous TTL cleanup.
- JSON payload limit: 10 KB. Authentication attempts: 20 per IP per 15 minutes. The local rate limiter uses memory and resets on restart.
- Browser origins are checked against FRONTEND_ORIGINS; request types and cookie settings protect against cross-site form submissions.
- Public user responses never contain password hashes or session tokens.

## Configuration

`.env.example` documents PORT, HOST, NODE_ENV, MONGODB_URI, FRONTEND_ORIGINS, and ALLOW_ALL_ORIGINS. Set ALLOW_ALL_ORIGINS=true only when the API must accept browser requests from any origin; the server echoes each requesting origin so credentialed cookies continue to work. HOST defaults to 127.0.0.1 for local access. Update the frontend vite.config.js proxy if changing PORT.

For deployment use HTTPS, NODE_ENV=production, a protected MongoDB account, and a same-origin /api reverse proxy. The Vite development proxy is not included in static production builds. Configure trusted proxies explicitly for your environment and a shared limiter if running multiple instances.

## Tests

```powershell
npm test
```

Tests require local MongoDB on port 27017. They create uniquely named `linkedin_auth_test_<random-id>` databases and remove only those test databases afterward. They cover validation, uniqueness, hashing, cookies, failed login, persistence across application restarts, session rotation, expiration, logout, origin restrictions, invalid JSON, and rate limiting.

## Scope

Email/password authentication is functional. Google/Microsoft/Apple OAuth, phone sign-in, email verification, and password-reset delivery require additional provider/email configuration and are not implemented.

## Vercel deployment

Frontend: https://linkedin-auth-five.vercel.app
Backend: https://linkedin-auth-backend.vercel.app
Health check: https://linkedin-auth-backend.vercel.app/api/health

The root app.js is the Vercel entry point; local npm start continues using src/server.js. Vercel reuses the app and MongoDB pool across warm invocations. Local .env files are excluded from deployment uploads.

Production FRONTEND_ORIGINS is configured for the frontend URL. To enable cloud authentication, set MONGODB_URI as a secret in this backend project's Production environment in Vercel, pointing to a hosted MongoDB database accessible from Vercel. Then redeploy with:

```powershell
cd F:\linkedin-auth-backend
npx vercel deploy --prod
```

Production MONGODB_URI is configured as a Vercel secret for the hosted ecommerce database. Live registration, login, account access, and logout have been verified. Local users have not been uploaded; local npm start still uses the development .env database.

The auth rate limiter remains per-instance in memory. For public use at scale, configure a shared store or Vercel Firewall rate limiting.

