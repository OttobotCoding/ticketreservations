import { useCallback, useEffect, useMemo, useState } from "react";
import { exportTrackingCsv, fetchReservations, updateTracking } from "../api";
import type { Reservation } from "../types";

const PAYMENT_METHODS = ["Venmo", "Zelle", "PayPal", "Cash", "Check", "Other"];

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function TrackingPage() {
  const [token, setToken] = useState(() => localStorage.getItem("adminToken") ?? "");
  const [authed, setAuthed] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "CONFIRMED" | "REJECTED">(
    "ALL"
  );
  const [paidFilter, setPaidFilter] = useState<"ALL" | "PAID" | "UNPAID">("ALL");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (t: string) => {
    setError(null);
    try {
      const data = await fetchReservations(t);
      setReservations(data);
      setAuthed(true);
      localStorage.setItem("adminToken", t);
    } catch (e) {
      setAuthed(false);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await exportTrackingCsv(token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reservations.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (paidFilter === "PAID" && r.paidAt === null) return false;
      if (paidFilter === "UNPAID" && r.paidAt !== null) return false;
      if (!q) return true;
      const haystack = `${r.name} ${r.email} ${r.listing?.opponent ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [reservations, search, statusFilter, paidFilter]);

  if (!authed) {
    return (
      <form
        className="admin-login"
        onSubmit={(e) => {
          e.preventDefault();
          void load(token);
        }}
      >
        <h2>Tracking</h2>
        <p className="muted">Admin-only detailed ticket &amp; payment records.</p>
        <label>
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_TOKEN from server/.env"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    );
  }

  const totalCollected = reservations.reduce((sum, r) => sum + (r.paymentAmount ?? 0), 0);

  return (
    <div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="available">{notice}</p>}

      <div className="admin-toolbar">
        <h2>Ticket Tracking ({filtered.length})</h2>
        <button disabled={exporting} onClick={() => void doExport()}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      <p className="muted">
        Total recorded payments: <strong>${totalCollected.toFixed(2)}</strong>
      </p>

      <div className="tracking-filters">
        <input
          className="tracking-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, or opponent…"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="ALL">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select value={paidFilter} onChange={(e) => setPaidFilter(e.target.value as typeof paidFilter)}>
          <option value="ALL">Paid + unpaid</option>
          <option value="PAID">Paid only</option>
          <option value="UNPAID">Unpaid only</option>
        </select>
      </div>

      <table className="admin-table tracking-table">
        <thead>
          <tr>
            <th>Buyer</th>
            <th>Game</th>
            <th>Qty / Total</th>
            <th>Status</th>
            <th>Requested / Confirmed</th>
            <th>Ticket Email</th>
            <th>Payment</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <TrackingRow
              key={r.id}
              r={r}
              token={token}
              onSaved={() => void load(token)}
              onError={setError}
            />
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No reservations match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TrackingRow({
  r,
  token,
  onSaved,
  onError,
}: {
  r: Reservation;
  token: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState(r.paymentMethod ?? "");
  const [paymentAmount, setPaymentAmount] = useState(
    r.paymentAmount !== null ? String(r.paymentAmount) : ""
  );
  const [paidAt, setPaidAt] = useState(() => (r.paidAt ? toLocalInputValue(r.paidAt) : ""));
  const [adminNotes, setAdminNotes] = useState(r.adminNotes ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    paymentMethod !== (r.paymentMethod ?? "") ||
    paymentAmount !== (r.paymentAmount !== null ? String(r.paymentAmount) : "") ||
    paidAt !== (r.paidAt ? toLocalInputValue(r.paidAt) : "") ||
    adminNotes !== (r.adminNotes ?? "");

  const total = r.listing ? (r.quantity * r.listing.pricePerTicket).toFixed(2) : null;

  const save = async () => {
    setSaving(true);
    try {
      await updateTracking(token, r.id, {
        paymentMethod: paymentMethod.trim() || null,
        paymentAmount: paymentAmount.trim() === "" ? null : Number(paymentAmount),
        paidAt: paidAt ? new Date(paidAt).toISOString() : null,
        adminNotes: adminNotes.trim() || null,
      });
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const markPaidNow = () => {
    setPaidAt(toLocalInputValue(new Date().toISOString()));
    if (!paymentAmount && total) setPaymentAmount(total);
  };

  return (
    <tr>
      <td>
        <strong>{r.name}</strong>
        <br />
        <span className="muted">{r.email}</span>
      </td>
      <td>
        {r.listing ? (
          <>
            {r.listing.opponent}
            <br />
            <span className="muted">
              Sec {r.listing.section} · Row {r.listing.row} · Seats {r.listing.seats}
            </span>
          </>
        ) : (
          `Listing #${r.listingId}`
        )}
      </td>
      <td>
        {r.quantity} ticket(s)
        {total && (
          <>
            <br />
            <span className="muted">${total}</span>
          </>
        )}
      </td>
      <td>
        <span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span>
      </td>
      <td>
        <span className="muted">Req: {fmtDateTime(r.createdAt)}</span>
        <br />
        <span className="muted">Conf: {fmtDateTime(r.confirmedAt)}</span>
      </td>
      <td>
        {r.ticketEmailSentAt ? (
          <>
            <span className="badge confirmed">SENT</span>
            <br />
            <span className="muted">{fmtDateTime(r.ticketEmailSentAt)}</span>
            <br />
            <span className="muted">to {r.email}</span>
          </>
        ) : (
          <span className="badge pending">NOT SENT</span>
        )}
      </td>
      <td className="tracking-payment-cell">
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="">Method…</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          className="wide"
          placeholder="Amount"
          value={paymentAmount}
          onChange={(e) => setPaymentAmount(e.target.value)}
        />
        <input
          type="datetime-local"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
        />
        {!paidAt && (
          <button type="button" className="secondary" onClick={markPaidNow}>
            Mark paid now
          </button>
        )}
      </td>
      <td className="tracking-notes-cell">
        <textarea
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          placeholder="Notes (delivery, follow-ups, etc.)"
          rows={2}
        />
        <button disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "…" : "Save"}
        </button>
      </td>
    </tr>
  );
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time, not an ISO string.
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
