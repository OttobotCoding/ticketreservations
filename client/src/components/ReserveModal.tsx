import { FormEvent, useState } from "react";
import { createReservation } from "../api";
import type { Listing } from "../types";

interface Props {
  listing: Listing;
  onClose: () => void;
  onReserved: () => void;
}

export default function ReserveModal({ listing, onClose, onReserved }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createReservation({ listingId: listing.id, name, email, quantity });
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {success ? (
          <>
            <h2>Request received!</h2>
            <p>
              Your reservation is <strong>pending confirmation</strong>. Check {email} for a
              confirmation of your request — you'll get another email once your tickets are
              secured.
            </p>
            <button onClick={onReserved}>Done</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2>Reserve Tickets</h2>
            <p className="muted">
              {listing.opponent} — Section {listing.section}, Row {listing.row}, Seats{" "}
              {listing.seats}
            </p>
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Number of tickets (max {listing.ticketsAvailable})
              <input
                type="number"
                min={2}
                step={2}
                max={listing.ticketsAvailable}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
              />
            </label>
            <p>
              Total: <strong>${(quantity * listing.pricePerTicket || 0).toFixed(2)}</strong>
            </p>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
