import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------- Schema ----------

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  espnEventId: text("espn_event_id").unique(),
  opponent: text("opponent").notNull(),
  opponentLogo: text("opponent_logo"),
  gameDate: integer("game_date", { mode: "timestamp_ms" }).notNull(),
  section: text("section").notNull(),
  row: text("row").notNull(),
  seats: text("seats").notNull(), // e.g. "5-8"
  pricePerTicket: real("price_per_ticket").notNull(),
  ticketsAvailable: integer("tickets_available").notNull(),
});

// status: PENDING | CONFIRMED | REJECTED
export const reservations = sqliteTable("reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id")
    .notNull()
    .references(() => listings.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull().default("PENDING"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
});

export type Listing = typeof listings.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;

// ---------- Client ----------

const client = createClient({ url: process.env.DB_URL ?? "file:dev.db" });
export const db = drizzle(client);

// ---------- Init: create tables (runs on server start) ----------

export async function initDb(): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      espn_event_id TEXT UNIQUE,
      opponent TEXT NOT NULL,
      opponent_logo TEXT,
      game_date INTEGER NOT NULL,
      section TEXT NOT NULL,
      row TEXT NOT NULL,
      seats TEXT NOT NULL,
      price_per_ticket REAL NOT NULL,
      tickets_available INTEGER NOT NULL
    )`);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER
    )`);
}
