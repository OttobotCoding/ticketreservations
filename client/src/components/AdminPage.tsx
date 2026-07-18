import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  confirmReservation,
  createListing,
  deleteListing,
  fetchListings,
  fetchReservations,
  rejectReservation,
  syncSchedule,
  updateListing,
} from "../api";
import type { Listing, Reservation } from "../types";

export default function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem("adminToken") ?? "");
  const [authed, setAuthed] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (t: string) => {
    setError(null);
    try {
      const [resData, listData] = await Promise.all([fetchReservations(t), fetchListings()]);
      setReservations(resData);
      setListings(listData);
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

  const act = async (id: number, action: "confirm" | "reject") => {
    setBusyId(id);
    setError(null);
    try {
      if (action === "confirm") await confirmReservation(token, id);
      else await rejectReservation(token, id);
      await load(token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const { total, added } = await syncSchedule(token);
      setNotice(`Synced ${total} Broncos home games from ESPN (${added} new).`);
      await load(token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (!authed) {
    return (
      <form
        className="admin-login"
        onSubmit={(e) => {
          e.preventDefault();
          void load(token);
        }}
      >
        <h2>Admin</h2>
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

  const pending = reservations.filter((r) => r.status === "PENDING");
  const resolved = reservations.filter((r) => r.status !== "PENDING");

  return (
    <div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="available">{notice}</p>}

      <div className="admin-toolbar">
        <h2>Listings ({listings.length})</h2>
        <button disabled={syncing} onClick={() => void doSync()}>
          {syncing ? "Syncing…" : "Sync ESPN Schedule"}
        </button>
      </div>
      <AddGameForm token={token} onAdded={() => void load(token)} onError={setError} />
      <table className="admin-table listing-editor">
        <thead>
          <tr>
            <th>Game</th>
            <th>Section</th>
            <th>Row</th>
            <th>Seats</th>
            <th>Price ($)</th>
            <th>Available</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <ListingRow
              key={l.id}
              listing={l}
              token={token}
              onSaved={() => void load(token)}
              onError={setError}
            />
          ))}
        </tbody>
      </table>

      <h2>Pending reservations ({pending.length})</h2>
      {pending.length === 0 && <p className="muted">Nothing pending.</p>}
      <table className="admin-table">
        <tbody>
          {pending.map((r) => (
            <ReservationRow key={r.id} r={r} busy={busyId === r.id} onAct={act} />
          ))}
        </tbody>
      </table>

      {resolved.length > 0 && (
        <>
          <h2>History</h2>
          <table className="admin-table">
            <tbody>
              {resolved.map((r) => (
                <ReservationRow key={r.id} r={r} busy={false} onAct={act} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function AddGameForm({
  token,
  onAdded,
  onError,
}: {
  token: string;
  onAdded: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [opponent, setOpponent] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [logo, setLogo] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createListing(token, {
        opponent,
        gameDate: new Date(gameDate).toISOString(),
        opponentLogo: logo.trim() || null,
      });
      setOpponent("");
      setGameDate("");
      setLogo("");
      setOpen(false);
      onAdded();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <p>
        <button className="secondary" onClick={() => setOpen(true)}>
          + Add Game Manually
        </button>
        <span className="muted"> (e.g. a game ESPN doesn't list — never affected by re-sync)</span>
      </p>
    );
  }

  return (
    <form className="add-game" onSubmit={submit}>
      <label>
        Opponent
        <input
          value={opponent}
          onChange={(e) => setOpponent(e.target.value)}
          placeholder="vs. Arizona Cardinals (Preseason)"
          required
        />
      </label>
      <label>
        Kickoff
        <input
          type="datetime-local"
          value={gameDate}
          onChange={(e) => setGameDate(e.target.value)}
          required
        />
      </label>
      <label>
        Logo URL (optional)
        <input
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
          placeholder="https://a.espncdn.com/i/teamlogos/nfl/500/ari.png"
        />
      </label>
      <div className="row-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add Game"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="muted">Set seats, price, and ticket count in the table after adding.</p>
    </form>
  );
}

function ListingRow({
  listing,
  token,
  onSaved,
  onError,
}: {
  listing: Listing;
  token: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [section, setSection] = useState(listing.section);
  const [row, setRow] = useState(listing.row);
  const [seats, setSeats] = useState(listing.seats);
  const [price, setPrice] = useState(String(listing.pricePerTicket));
  const [available, setAvailable] = useState(String(listing.ticketsAvailable));
  const [saving, setSaving] = useState(false);

  const remove = async () => {
    if (!window.confirm(`Delete "${listing.opponent}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteListing(token, listing.id);
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    section !== listing.section ||
    row !== listing.row ||
    seats !== listing.seats ||
    Number(price) !== listing.pricePerTicket ||
    Number(available) !== listing.ticketsAvailable;

  const save = async () => {
    setSaving(true);
    try {
      await updateListing(token, listing.id, {
        section,
        row,
        seats,
        pricePerTicket: Number(price),
        ticketsAvailable: Number(available),
      });
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>
        <strong>{listing.opponent}</strong>
        {!listing.espnEventId && <span className="badge manual">MANUAL</span>}
        <br />
        <span className="muted">
          {new Date(listing.gameDate).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </td>
      <td><input value={section} onChange={(e) => setSection(e.target.value)} /></td>
      <td><input value={row} onChange={(e) => setRow(e.target.value)} /></td>
      <td><input className="wide" value={seats} onChange={(e) => setSeats(e.target.value)} /></td>
      <td>
        <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td>
        <input type="number" min="0" value={available} onChange={(e) => setAvailable(e.target.value)} />
      </td>
      <td>
        <div className="row-actions">
          <button disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "…" : "Save"}
          </button>
          <button disabled={saving} className="secondary" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function ReservationRow({
  r,
  busy,
  onAct,
}: {
  r: Reservation;
  busy: boolean;
  onAct: (id: number, action: "confirm" | "reject") => void;
}) {
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
      <td>{r.quantity} ticket(s)</td>
      <td>
        <span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span>
      </td>
      <td>
        {r.status === "PENDING" && (
          <div className="row-actions">
            <button disabled={busy} onClick={() => onAct(r.id, "confirm")}>
              {busy ? "…" : "Confirm"}
            </button>
            <button disabled={busy} className="secondary" onClick={() => onAct(r.id, "reject")}>
              Reject
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
