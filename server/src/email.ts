import nodemailer from "nodemailer";
import type { Listing, Reservation } from "./db";

const smtpConfigured = Boolean(process.env.SMTP_HOST);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    console.log(`[email:dev] To: ${to} | Subject: ${subject}\n${html}\n`);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM ?? "no-reply@example.com",
      to,
      subject,
      html,
    });
  } catch (err) {
    // Email failures must not break the reservation flow; log and continue.
    console.error(`Failed to send email to ${to}:`, err);
  }
}

function formatGame(listing: Listing): string {
  const date = listing.gameDate.toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  });
  return `${listing.opponent} on ${date} — Section ${listing.section}, Row ${listing.row}, Seats ${listing.seats}`;
}

export function notifyAdminOfRequest(reservation: Reservation, listing: Listing): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn("ADMIN_EMAIL not set; skipping admin notification.");
    return Promise.resolve();
  }
  return sendEmail(
    adminEmail,
    `New reservation request #${reservation.id} (${reservation.quantity} tickets)`,
    `<h2>New reservation request</h2>
     <p><strong>${reservation.name}</strong> (${reservation.email}) requested
     <strong>${reservation.quantity}</strong> ticket(s):</p>
     <p>${formatGame(listing)}</p>
     <p>Total: $${(reservation.quantity * listing.pricePerTicket).toFixed(2)}</p>
     <p>Confirm it from the admin page or via
     <code>POST /api/admin/reservations/${reservation.id}/confirm</code>.</p>`
  );
}

export function notifyUserRequestPending(reservation: Reservation, listing: Listing): Promise<void> {
  return sendEmail(
    reservation.email,
    "Your ticket reservation request is pending",
    `<h2>Thanks, ${reservation.name}!</h2>
     <p>We received your request for <strong>${reservation.quantity}</strong> ticket(s):</p>
     <p>${formatGame(listing)}</p>
     <p>Your reservation is <strong>pending</strong>. You'll get another email once it's confirmed.
     No tickets are held until then.</p>`
  );
}

export function notifyUserConfirmed(reservation: Reservation, listing: Listing): Promise<void> {
  return sendEmail(
    reservation.email,
    "Your tickets are confirmed!",
    `<h2>You're all set, ${reservation.name}!</h2>
     <p>Your <strong>${reservation.quantity}</strong> ticket(s) are confirmed:</p>
     <p>${formatGame(listing)}</p>
     <p>Total due: $${(reservation.quantity * listing.pricePerTicket).toFixed(2)}</p>`
  );
}

export function notifyUserRejected(reservation: Reservation, listing: Listing): Promise<void> {
  return sendEmail(
    reservation.email,
    "Your ticket reservation request was declined",
    `<p>Hi ${reservation.name},</p>
     <p>Unfortunately your request for ${reservation.quantity} ticket(s)
     (${formatGame(listing)}) could not be fulfilled.</p>`
  );
}
