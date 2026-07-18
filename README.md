# Football Tickets

Full-stack TypeScript app for reserving football game tickets.

- **Backend:** Express + Drizzle ORM + SQLite (via `@libsql/client` — pure npm packages,
  no install scripts, no native compilation, no separate migration step)
- **Frontend:** React + Vite
- **Email:** Nodemailer (SMTP), with a console-logging fallback for local dev

## How it works

On startup the server pulls the **Denver Broncos home schedule (preseason + regular
season) from ESPN's public API** (no API key needed) and creates a listing per home
game, including the opponent's logo.
New games arrive with placeholder pricing/seats and 0 tickets ("Not on sale yet" in the
UI) — you fill those in from the admin page.

1. The main page lists available tickets (count, price, game date, section/row/seats).
2. A user clicks **Reserve Tickets**, enters name/email/quantity, and submits.
   Two emails fire immediately: one to the admin, one to the user ("request pending").
   **Inventory is not decremented yet.**
3. The admin opens `/#/admin`, signs in with the admin token, and confirms (or rejects)
   the reservation. On confirmation, the ticket count is atomically decremented and the
   user gets a "tickets confirmed" email.

The admin page also lets you set section/row/seats, price, and ticket count per game,
and has a **Sync ESPN Schedule** button to refresh the schedule on demand. Re-syncing
never overwrites the pricing/seats/inventory you've entered and never duplicates games.

Games ESPN doesn't carry can be added manually via **+ Add Game Manually** on the admin
page (opponent, kickoff time, optional logo URL). Manual games are tagged MANUAL, are
never modified by ESPN re-syncs, and can be deleted as long as they have no
reservations.

Edge cases handled: requests for more tickets than remain are rejected (at request time
*and* re-checked atomically at confirmation time), sold-out games can't be reserved, and
a reservation can only be confirmed/rejected once.

## Setup

Requires Node 18+. No build tools, database server, or script approvals needed.

```bash
# 1. Install dependencies (root, then server + client)
npm install
npm run setup

# 2. Configure the server environment
copy server\.env.example server\.env     # (cp on macOS/Linux)
# then edit server/.env — at minimum set ADMIN_TOKEN

# 3. Run both servers (API on :3001, UI on :5173)
npm run dev
```

Open http://localhost:5173. On first start the server automatically creates the SQLite
database and imports the Broncos home schedule from ESPN — there is no migrate/generate
step. The admin page is at http://localhost:5173/#/admin: set price, seat location, and
ticket count for each game there to put it on sale.

If ESPN is unreachable at startup the server still runs (with no games); use the
Sync ESPN Schedule button in the admin page to retry.

## Environment variables (`server/.env`)

| Variable      | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `DB_URL`      | SQLite file, e.g. `file:dev.db` (created automatically)            |
| `ESPN_SCHEDULE_URLS` | Optional comma-separated override of the ESPN schedule endpoints (defaults to Broncos preseason + regular season) |
| `PORT`        | API port (default `3001`)                                           |
| `ADMIN_TOKEN` | Secret required in the `x-admin-token` header for all admin routes |
| `ADMIN_EMAIL` | Where "new reservation request" notifications are sent             |
| `SMTP_HOST`   | SMTP server hostname. **Leave empty to log emails to the console instead of sending** (handy for local dev) |
| `SMTP_PORT`   | SMTP port (`587` for STARTTLS, `465` for TLS)                      |
| `SMTP_SECURE` | `true` for port 465, otherwise `false`                             |
| `SMTP_USER`   | SMTP username                                                      |
| `SMTP_PASS`   | SMTP password / app password                                       |
| `EMAIL_FROM`  | From address, e.g. `"Football Tickets <no-reply@example.com>"`     |

Any SMTP provider works (Gmail app passwords, Mailtrap, Brevo, SES SMTP, etc.).
For local testing without an account, leave `SMTP_HOST` empty — every email is printed
to the server console instead.

## API

| Method | Route                                    | Auth            | Purpose                                   |
| ------ | ---------------------------------------- | --------------- | ----------------------------------------- |
| GET    | `/api/listings`                          | —               | All listings (sold-out included)          |
| POST   | `/api/reservations`                      | —               | Request a reservation (sends 2 emails)    |
| GET    | `/api/admin/reservations?status=PENDING` | `x-admin-token` | List reservations                         |
| POST   | `/api/admin/reservations/:id/confirm`    | `x-admin-token` | Confirm: decrement inventory + email user |
| POST   | `/api/admin/reservations/:id/reject`     | `x-admin-token` | Reject (no inventory change) + email user |
| PATCH  | `/api/admin/listings/:id`                | `x-admin-token` | Set section/row/seats/price/ticket count  |
| POST   | `/api/admin/sync-schedule`               | `x-admin-token` | Re-import the Broncos home schedule       |
| POST   | `/api/admin/listings`                    | `x-admin-token` | Manually add a game                       |
| DELETE | `/api/admin/listings/:id`                | `x-admin-token` | Delete a game (blocked if it has reservations) |

Confirm via curl instead of the UI if you prefer:

```bash
curl -X POST http://localhost:3001/api/admin/reservations/1/confirm \
  -H "x-admin-token: YOUR_ADMIN_TOKEN"
```

## Concurrency note

Confirmation runs in a transaction using a conditional
`UPDATE ... WHERE tickets_available >= quantity` decrement, so two concurrent
confirmations can never oversell a listing.

## Project structure

```
├── server/
│   └── src/
│       ├── db.ts      # Drizzle schema, SQLite client, auto-create tables on startup
│       ├── espn.ts    # ESPN schedule fetch + upsert (home games, opponent logos)
│       ├── index.ts   # Express app, public + admin routes
│       └── email.ts   # Nodemailer templates (console fallback)
└── client/
    └── src/
        ├── components/ListingsPage.tsx   # ticket cards
        ├── components/ReserveModal.tsx   # name/email/quantity form
        └── components/AdminPage.tsx      # confirm/reject pending reservations
```

## Deploying with Docker (e.g. Unraid)

The included `Dockerfile` builds both apps into a single container: Express serves the
built React frontend and the API on port 3001. The SQLite database lives in `/app/data`
— mount a volume there so data survives container updates.

```bash
docker build -t broncos-tickets .
docker run -d --name broncos-tickets --restart unless-stopped \
  -p 3001:3001 \
  -v /mnt/user/appdata/broncos-tickets/data:/app/data \
  -e ADMIN_TOKEN=your-long-random-token \
  -e ADMIN_EMAIL=you@example.com \
  -e SMTP_HOST=... -e SMTP_USER=... -e SMTP_PASS=... \
  broncos-tickets
```

Or use the included `docker-compose.yml`. For external access, point a reverse proxy
or Cloudflare Tunnel at port 3001.

## Resetting the data

Delete `server/dev.db` and restart — the schema is recreated and the schedule
re-imported from ESPN automatically.

> **Upgrading from a pre-ESPN version:** the listings table gained new columns
> (`espn_event_id`, `opponent_logo`), so delete your old `server/dev.db` once before
> starting the updated server.
"# ticketreservations" 
