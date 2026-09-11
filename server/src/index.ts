import "dotenv/config";
import path from "path";
import fs from "fs";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, initDb, listings, reservations } from "./db";
import { syncBroncosSchedule } from "./espn";
import {
  notifyAdminOfRequest,
  notifyUserRequestPending,
  notifyUserConfirmed,
  notifyUserRejected,
} from "./email";

const app = express();

app.use(cors());
app.use(express.json());

// ---------- Public routes ----------

// List all listings (including sold-out ones, so the UI can show them as sold out)
app.get("/api/listings", async (_req, res, next) => {
  try {
    const rows = await db.select().from(listings).orderBy(asc(listings.gameDate));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const reservationSchema = z.object({
  listingId: z.number().int().positive(),
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("A valid email is required"),
  quantity: z.number().int().min(2, "Quantity must be at least 2"),
});

// Request a reservation. Does NOT decrement inventory — that happens on admin confirmation.
app.post("/api/reservations", async (req, res, next) => {
  try {
    const parsed = reservationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { listingId, name, email, quantity } = parsed.data;

    const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
    if (!listing) {
      return res.status(404).json({ error: "Listing not found" });
    }
    if (listing.ticketsAvailable === 0) {
      return res.status(409).json({ error: "This game is sold out." });
    }
    if (quantity > listing.ticketsAvailable) {
      return res.status(409).json({
        error: `Only ${listing.ticketsAvailable} ticket(s) remain for this game.`,
      });
    }

    const [reservation] = await db
      .insert(reservations)
      .values({ listingId, name, email, quantity })
      .returning();

    // Fire both notification emails; failures are logged inside the email module.
    await Promise.all([
      notifyAdminOfRequest(reservation, listing),
      notifyUserRequestPending(reservation, listing),
    ]);

    res.status(201).json(reservation);
  } catch (err) {
    next(err);
  }
});

// ---------- Admin routes (protected by x-admin-token header) ----------

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "ADMIN_TOKEN is not configured on the server." });
  }
  if (req.header("x-admin-token") !== token) {
    return res.status(401).json({ error: "Invalid admin token" });
  }
  next();
}

const admin = express.Router();
admin.use(requireAdmin);

admin.get("/reservations", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const rows = await db
      .select()
      .from(reservations)
      .leftJoin(listings, eq(reservations.listingId, listings.id))
      .where(status ? eq(reservations.status, status) : undefined)
      .orderBy(desc(reservations.createdAt));
    res.json(rows.map((r) => ({ ...r.reservations, listing: r.listings })));
  } catch (err) {
    next(err);
  }
});

// Re-sync the Broncos home schedule from ESPN on demand.
admin.post("/sync-schedule", async (_req, res, next) => {
  try {
    const result = await syncBroncosSchedule();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const listingCreateSchema = z.object({
  opponent: z.string().trim().min(1, "Opponent is required").max(200),
  gameDate: z.coerce.date().refine((d) => !isNaN(d.getTime()), "A valid game date is required"),
  opponentLogo: z.string().trim().url().nullish(),
  section: z.string().trim().min(1).max(50).default("TBD"),
  row: z.string().trim().min(1).max(50).default("TBD"),
  seats: z.string().trim().min(1).max(100).default("TBD"),
  pricePerTicket: z.number().min(0).default(0),
  ticketsAvailable: z.number().int().min(0).default(0),
});

// Manually add a game (e.g. one ESPN doesn't carry). Manual games have no
// espnEventId, so ESPN re-syncs never modify or duplicate them.
admin.post("/listings", async (req, res, next) => {
  try {
    const parsed = listingCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const [created] = await db
      .insert(listings)
      .values({ ...parsed.data, opponentLogo: parsed.data.opponentLogo ?? null })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// Delete a listing, but never one that has reservations attached.
admin.delete("/listings/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid listing id" });

    const [existingReservation] = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.listingId, id))
      .limit(1);
    if (existingReservation) {
      return res
        .status(409)
        .json({ error: "This game has reservations and cannot be deleted." });
    }

    const [deleted] = await db.delete(listings).where(eq(listings.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Listing not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const listingUpdateSchema = z
  .object({
    section: z.string().trim().min(1).max(50),
    row: z.string().trim().min(1).max(50),
    seats: z.string().trim().min(1).max(100),
    pricePerTicket: z.number().min(0),
    ticketsAvailable: z.number().int().min(0),
    note: z.string().trim().max(300).nullable(),
  })
  .partial();

// Set pricing / seat location / inventory on a listing.
admin.patch("/listings/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid listing id" });
    const parsed = listingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const [updated] = await db
      .update(listings)
      .set(parsed.data)
      .where(eq(listings.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Listing not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Confirm a pending reservation. Atomically decrements inventory —
// the conditional UPDATE guarantees we never oversell, even under concurrent confirms.
admin.post("/reservations/:id/confirm", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid reservation id" });

    const result = await db.transaction(async (tx) => {
      const [reservation] = await tx.select().from(reservations).where(eq(reservations.id, id));
      if (!reservation) return { status: 404 as const, error: "Reservation not found" };
      if (reservation.status !== "PENDING") {
        return { status: 409 as const, error: `Reservation is already ${reservation.status}.` };
      }

      const decremented = await tx
        .update(listings)
        .set({ ticketsAvailable: sql`${listings.ticketsAvailable} - ${reservation.quantity}` })
        .where(
          and(
            eq(listings.id, reservation.listingId),
            gte(listings.ticketsAvailable, reservation.quantity)
          )
        );
      if (decremented.rowsAffected === 0) {
        return {
          status: 409 as const,
          error: "Not enough tickets remain to confirm this reservation.",
        };
      }

      const [confirmed] = await tx
        .update(reservations)
        .set({ status: "CONFIRMED", confirmedAt: new Date() })
        .where(eq(reservations.id, id))
        .returning();
      const [listing] = await tx
        .select()
        .from(listings)
        .where(eq(listings.id, reservation.listingId));
      return { status: 200 as const, reservation: confirmed, listing };
    });

    if ("error" in result) return res.status(result.status).json({ error: result.error });

    const sent = await notifyUserConfirmed(result.reservation, result.listing);
    let reservation = result.reservation;
    if (sent) {
      [reservation] = await db
        .update(reservations)
        .set({ ticketEmailSentAt: new Date() })
        .where(eq(reservations.id, reservation.id))
        .returning();
    }
    res.json({ ...reservation, listing: result.listing });
  } catch (err) {
    next(err);
  }
});

const rejectSchema = z.object({
  reason: z.string().trim().max(500, "Reason must be 500 characters or fewer").optional(),
});

// Reject a pending reservation (no inventory change). Optional reason is stored
// and included in the decline email.
admin.post("/reservations/:id/reject", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid reservation id" });
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const reason = parsed.data.reason || null;

    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, id));
    if (!reservation) return res.status(404).json({ error: "Reservation not found" });
    if (reservation.status !== "PENDING") {
      return res.status(409).json({ error: `Reservation is already ${reservation.status}.` });
    }

    const [rejected] = await db
      .update(reservations)
      .set({ status: "REJECTED", rejectionReason: reason })
      .where(eq(reservations.id, id))
      .returning();
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, reservation.listingId));

    if (listing) await notifyUserRejected(rejected, listing, reason);
    res.json({ ...rejected, listing });
  } catch (err) {
    next(err);
  }
});

const trackingUpdateSchema = z
  .object({
    paymentMethod: z.string().trim().max(50).nullable(),
    paymentAmount: z.number().min(0).nullable(),
    paidAt: z.coerce.date().nullable(),
    adminNotes: z.string().trim().max(2000).nullable(),
  })
  .partial();

// Record payment / delivery details on a reservation for the admin tracking page.
// Separate from confirm/reject so it can be edited any time, for reservations in
// any status (e.g. logging a late payment on an already-confirmed reservation).
admin.patch("/reservations/:id/tracking", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid reservation id" });
    const parsed = trackingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const [updated] = await db
      .update(reservations)
      .set(parsed.data)
      .where(eq(reservations.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Reservation not found" });

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, updated.listingId));
    res.json({ ...updated, listing });
  } catch (err) {
    next(err);
  }
});

const reservationEditSchema = z
  .object({
    listingId: z.number().int().positive(),
    name: z.string().trim().min(1, "Name is required").max(200),
    email: z.string().trim().email("A valid email is required"),
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
  })
  .partial();

class InsufficientInventoryError extends Error {}

// Edit a reservation's name/email/quantity/game. If the reservation is
// CONFIRMED, inventory is correctly moved: the old quantity is returned to
// its original listing, then the new quantity is taken from the (possibly
// different) target listing, failing the whole edit if there isn't enough.
admin.patch("/reservations/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid reservation id" });
    const parsed = reservationEditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(reservations).where(eq(reservations.id, id));
        if (!existing) throw new Error("__NOT_FOUND__");

        const newListingId = parsed.data.listingId ?? existing.listingId;
        const newQuantity = parsed.data.quantity ?? existing.quantity;
        const newName = parsed.data.name ?? existing.name;
        const newEmail = parsed.data.email ?? existing.email;

        if (newListingId !== existing.listingId) {
          const [targetListing] = await tx.select().from(listings).where(eq(listings.id, newListingId));
          if (!targetListing) throw new Error("__INVALID_LISTING__");
        }

        const changedInventoryRelevantFields =
          newListingId !== existing.listingId || newQuantity !== existing.quantity;

        if (existing.status === "CONFIRMED" && changedInventoryRelevantFields) {
          // Return the tickets currently held against the old listing...
          await tx
            .update(listings)
            .set({ ticketsAvailable: sql`${listings.ticketsAvailable} + ${existing.quantity}` })
            .where(eq(listings.id, existing.listingId));

          // ...then try to take the new amount from the (possibly different) target listing.
          const decremented = await tx
            .update(listings)
            .set({ ticketsAvailable: sql`${listings.ticketsAvailable} - ${newQuantity}` })
            .where(and(eq(listings.id, newListingId), gte(listings.ticketsAvailable, newQuantity)));

          if (decremented.rowsAffected === 0) {
            throw new InsufficientInventoryError();
          }
        }

        const [saved] = await tx
          .update(reservations)
          .set({ listingId: newListingId, quantity: newQuantity, name: newName, email: newEmail })
          .where(eq(reservations.id, id))
          .returning();
        return saved;
      });

      const [listing] = await db.select().from(listings).where(eq(listings.id, updated.listingId));
      res.json({ ...updated, listing });
    } catch (err) {
      if (err instanceof InsufficientInventoryError) {
        return res
          .status(409)
          .json({ error: "Not enough tickets remain for that game/quantity to save this change." });
      }
      if (err instanceof Error && err.message === "__NOT_FOUND__") {
        return res.status(404).json({ error: "Reservation not found" });
      }
      if (err instanceof Error && err.message === "__INVALID_LISTING__") {
        return res.status(400).json({ error: "Selected game does not exist" });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Delete a reservation outright. If it was CONFIRMED, its tickets are
// returned to the listing's available count before the row is removed.
admin.delete("/reservations/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid reservation id" });

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(reservations).where(eq(reservations.id, id));
      if (!existing) return { status: 404 as const, error: "Reservation not found" };

      if (existing.status === "CONFIRMED") {
        await tx
          .update(listings)
          .set({ ticketsAvailable: sql`${listings.ticketsAvailable} + ${existing.quantity}` })
          .where(eq(listings.id, existing.listingId));
      }

      await tx.delete(reservations).where(eq(reservations.id, id));
      return {
        status: 200 as const,
        restoredTickets: existing.status === "CONFIRMED" ? existing.quantity : 0,
      };
    });

    if ("error" in result) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, restored: result.restoredTickets });
  } catch (err) {
    next(err);
  }
});

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Full ticket-tracking export for record-keeping outside the app (spreadsheet, etc.).
admin.get("/tracking/export", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(reservations)
      .leftJoin(listings, eq(reservations.listingId, listings.id))
      .orderBy(desc(reservations.createdAt));

    const header = [
      "Reservation ID",
      "Buyer Name",
      "Email",
      "Game",
      "Game Date",
      "Section",
      "Row",
      "Seats",
      "Quantity",
      "Price/Ticket",
      "Total Due",
      "Status",
      "Rejection Reason",
      "Requested At",
      "Confirmed At",
      "Ticket Email Sent At",
      "Payment Method",
      "Payment Amount",
      "Paid At",
      "Admin Notes",
    ];

    const lines = [header.map(csvCell).join(",")];
    for (const r of rows) {
      const res_ = r.reservations;
      const l = r.listings;
      const total = l ? res_.quantity * l.pricePerTicket : "";
      lines.push(
        [
          res_.id,
          res_.name,
          res_.email,
          l?.opponent ?? "",
          l ? new Date(l.gameDate).toISOString() : "",
          l?.section ?? "",
          l?.row ?? "",
          l?.seats ?? "",
          res_.quantity,
          l?.pricePerTicket ?? "",
          total,
          res_.status,
          res_.rejectionReason ?? "",
          new Date(res_.createdAt).toISOString(),
          res_.confirmedAt ? new Date(res_.confirmedAt).toISOString() : "",
          res_.ticketEmailSentAt ? new Date(res_.ticketEmailSentAt).toISOString() : "",
          res_.paymentMethod ?? "",
          res_.paymentAmount ?? "",
          res_.paidAt ? new Date(res_.paidAt).toISOString() : "",
          res_.adminNotes ?? "",
        ]
          .map(csvCell)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ticket-tracking-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(lines.join("\n"));
  } catch (err) {
    next(err);
  }
});

app.use("/api/admin", admin);

// ---------- Static frontend (production) ----------
// If the client has been built (e.g. in the Docker image), serve it from here
// so the whole app runs as a single container on one port.
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
  console.log("Serving frontend from", clientDist);
}

// ---------- Error handler ----------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------- Start ----------
const port = Number(process.env.PORT ?? 3001);

initDb()
  .then(async () => {
    try {
      const { total, added } = await syncBroncosSchedule();
      console.log(`ESPN sync: ${total} Broncos home games (${added} new).`);
    } catch (err) {
      console.warn("ESPN schedule sync failed (will retry via admin page):", err);
    }
    app.listen(port, () => {
      console.log(`API server listening on http://localhost:${port}`);
      if (!process.env.SMTP_HOST) {
        console.log("SMTP not configured — emails will be logged to this console.");
      }
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
