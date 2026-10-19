# Express Authentication API

Node.js and Express authentication backend with MongoDB, cookies, and rate limiting.

[Live deployment](https://linkedin-auth-backend.vercel.app/api/health)

## Overview

- Express and Mongoose application
- Password handling and cookie support
- Rate limiting and security middleware
- Node.js authentication tests

## Stack

Express, MongoDB / Mongoose.

## Run locally

Requires Node.js `>=24`.

```bash
git clone https://github.com/AbdulSamadAhsan/linkedin-auth-backend.git
cd linkedin-auth-backend
npm install
```

Copy `.env.example` to `.env` and configure the values for your local environment before starting. Use your own database credentials and freshly generated secrets.

```bash
npm run dev
```

Use the local URL printed by the development server.

## Available checks

| Command | Script |
| --- | --- |
| `npm run test` | `node --test` |

These commands are defined by the project; documentation updates do not imply they have been run.

## Author

[Syed Abdul Samad Ahsan](https://github.com/AbdulSamadAhsan)
