# TeamPulse

TeamPulse is a collaborative team workspace for organizing work by organization and board. Teams can create organizations, manage membership, and track issues across shared boards. Board updates are persisted in PostgreSQL, while a WebSocket service reports who is currently viewing a board.

## What you can do

- Create an account with email and password, or sign in with Google OAuth when configured.
- Create and manage organizations with administrator and member roles.
- Work from Frontend, Backend, and DevOps boards. Each board groups issues into **Upcoming**, **In Progress**, and **Done** sections.
- Create issues, move them through the workflow, and discuss work with comments.
- Invite organization members and accept invitations.
- See active board presence over WebSockets, with Redis Pub/Sub supporting presence and events across service instances.

## Technology

| Area | Technologies |
| --- | --- |
| Monorepo and runtime | Bun workspaces, Turborepo, TypeScript |
| Web application | React 19, React Router, Axios, Framer Motion, Lucide |
| REST API | Express 5, Zod, JWT, bcrypt |
| Realtime | WebSocket (`ws`), Redis (`ioredis`) |
| Data | PostgreSQL, Prisma 6, `@prisma/adapter-pg` |
| Integrations | Google OAuth (optional); Resend helper is present but email sending is not currently connected to the invitation route |

## Repository layout

```text
apps/
	frontend/   React single-page application
	backend/    Express REST API (port 4000)
	ws/         Authenticated board-presence WebSocket server (port 5000)
packages/
	db/         Prisma schema, migrations, generated client, PostgreSQL adapter
	redis/      Redis client, Pub/Sub, realtime events, and board presence
	ui/         Shared UI package
	eslint-config/       Shared lint configuration
	typescript-config/   Shared TypeScript configurations
```

## Prerequisites

- Git
- [Bun 1.4.0](https://bun.sh/) (the version declared by this repository)
- [Node.js 24 or newer](https://nodejs.org/) (the root package declares this engine requirement)
- PostgreSQL
- Redis for cross-instance realtime events and board presence
- Docker, if you want to run PostgreSQL and Redis in containers

Windows users can run the commands from PowerShell with Bun installed, or use WSL. The examples below use paths that work in Bash and PowerShell.

## Get the project

```sh
git clone https://github.com/jaideep-mahala/teamPulse-fullstack.git
cd teamPulse-fullstack
bun install
```

Install dependencies once from the repository root. Bun installs dependencies for all workspaces using `bun.lock`.

## Start the supporting services

Start PostgreSQL and Redis locally, or use Docker. These example containers publish the default ports used by the app:

```sh
docker run --name teampulse-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=teampulse -p 5432:5432 -d postgres:16-alpine
docker run --name teampulse-redis -p 6379:6379 -d redis:7-alpine
```

If you already have PostgreSQL or Redis running, use those services instead. The PostgreSQL database must exist and be reachable before applying migrations.

## Configure environment

Create `packages/db/.env` for Prisma CLI commands:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/teampulse?schema=public"
```

Create `apps/backend/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/teampulse?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
FRONTEND_URL="http://localhost:3000"
```

Use the same `JWT_SECRET` in the backend and WebSocket service. Update `DATABASE_URL` in all three files if your database credentials, host, port, or database name differ. Bun loads environment variables from the app's working directory, so the backend and WebSocket `.env` files are needed even though the Prisma CLI has its own file. Do not commit real secrets.

Google sign-in is optional. To enable it, add these values to `apps/backend/.env` and configure the same callback URL in your Google OAuth client:

```dotenv
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:4000/api/v1/auth/google/callback"
```

The frontend currently targets `http://localhost:4000` for API requests, `http://localhost:3000` for its development origin, and port `5000` for WebSockets. Keep those ports unless you also update the corresponding frontend configuration and API CORS origin.

Create `apps/ws/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/teampulse?schema=public"
JWT_SECRET="replace-with-the-same-long-random-secret-used-by-the-backend"
REDIS_URL="redis://localhost:6379"
```

## Prepare the database

From the repository root, run Prisma generation and apply the checked-in migrations:

```sh
cd packages/db
bunx prisma generate
bunx prisma migrate dev
cd ../..
```

Run migrations again after pulling schema changes that add a new migration. For a clean local database, `migrate dev` applies the existing migration history and creates the development database schema.

## Run the application

Start each process in its own terminal from the repository root. The API has no `dev` script, so start it directly with Bun.

**Terminal 1: REST API**

```sh
cd apps/backend
bun run index.ts
```

The API listens on `http://localhost:4000`. Check it at `http://localhost:4000/health`.

**Terminal 2: WebSocket service**

```sh
cd apps/ws
bun run dev
```

The WebSocket service listens on port `5000` by default.

**Terminal 3: Frontend**

```sh
cd apps/frontend
bun run dev
```

Open the local URL printed by Bun (normally `http://localhost:3000`). Sign up, create an organization, and open a board to try the workflow.

Stop any process with `Ctrl+C`. To restart Docker dependencies later:

```sh
docker start teampulse-postgres teampulse-redis
```

## Useful commands

Run these from the repository root unless noted otherwise:

| Command | Purpose |
| --- | --- |
| `bun install` | Install all workspace dependencies |
| `cd packages/db && bunx prisma generate` | Generate the Prisma client |
| `cd packages/db && bunx prisma migrate dev` | Apply migrations in development |
| `cd apps/backend && bun run index.ts` | Start the REST API |
| `cd apps/ws && bun run dev` | Start the WebSocket service |
| `cd apps/frontend && bun run dev` | Start the frontend development server |
| `cd apps/frontend && bun run build` | Build the frontend for production |

The root `bun run dev` command uses Turborepo, but it does not start the backend because the backend workspace does not currently define a `dev` script. Use the three-terminal instructions above for a complete local development setup.

## API overview

The Express API is rooted at `/api/v1` and uses JWT authentication for protected operations. It includes routes for:

- Signup, signin, Google OAuth, and the current user's profile
- Organization creation, lookup, update, and deletion
- Membership invitations and invitation acceptance
- Board creation, lookup, updates, and deletion
- Section and issue management, including moving issues between sections
- Issue comments

`GET /health` is an unauthenticated health check. The frontend and API are configured for local development; production deployments need the frontend API/WebSocket URLs, CORS origin, OAuth callback, and secrets configured for their deployment environment.

## Troubleshooting

- **Database connection errors:** Confirm PostgreSQL is running, the database exists, and each `DATABASE_URL` points to it. Check the `.env` file for the process you are starting.
- **Prisma migration errors:** Run `bun install`, then run `bunx prisma generate` and `bunx prisma migrate dev` from `packages/db`.
- **Authentication or presence failures:** Confirm `JWT_SECRET` is set and identical in `apps/backend/.env` and `apps/ws/.env`.
- **No active-user count or Redis warnings:** Confirm Redis is reachable at `REDIS_URL` (default `redis://localhost:6379`).
- **Frontend cannot reach the API:** Ensure the API uses port `4000` and the frontend is opened at `http://localhost:3000`, the origin allowed by the API's CORS configuration.
- **Google sign-in fails:** Verify all three Google OAuth variables and ensure the callback URL exactly matches the URL registered with Google.
