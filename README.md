<p align="center">
  <img src="docs/banner.png" alt="Ada — internal intelligence" width="100%" />
</p>

**Ada** is a private work brain: answers grounded in your team's internal knowledge, with a calm, minimal interface.

## Setup

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and have a Postgres URL ready (the project is wired for **Supabase** by default).

2. Copy `backend/.env.example` to `backend/.env` and set at least `DATABASE_URL`, `JWT_SECRET`, and the storage variables your deployment needs.

3. From the repository root:

   ```bash
   docker compose up --build
   ```

4. Open [http://localhost:3000](http://localhost:3000).

**Profiles:** use `docker compose --profile local-db up --build` for a local Postgres container instead of Supabase; use `--profile schedule` for scheduled embedding refresh (see [SETUP.md](SETUP.md)).

For troubleshooting, Celery, and optional AI settings, see [SETUP.md](SETUP.md).
