import { useEffect, useState } from "react";
import { fetchListings } from "../api";
import type { Listing } from "../types";
import ReserveModal from "./ReserveModal";

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Listing | null>(null);

  const load = () => {
    setLoading(true);
    fetchListings()
      .then(setListings)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <p className="muted">Loading listings…</p>;
  if (error) return <p className="error">Failed to load listings: {error}</p>;

  return (
    <>
      <div className="rows">
        {listings.map((l) => {
          const notOnSale = l.ticketsAvailable === 0 && l.pricePerTicket === 0;
          const soldOut = l.ticketsAvailable === 0 && !notOnSale;
          return (
            <div key={l.id} className={`row${soldOut || notOnSale ? " sold-out" : ""}`}>
              {l.opponentLogo && (
                <img className="row-watermark" src={l.opponentLogo} alt="" aria-hidden="true" />
              )}
              {l.opponentLogo && <img className="row-logo" src={l.opponentLogo} alt="" />}
              <div className="row-main">
                <h2>{l.opponent}</h2>
                <p className="muted">
                  {new Date(l.gameDate).toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" · "}Sec {l.section} · Row {l.row} · Seats {l.seats}
                </p>
              </div>
              <div className="row-count">
                <p className={soldOut || notOnSale ? "count muted" : "count available"}>
                  {notOnSale ? "\u2014" : l.ticketsAvailable}
                </p>
                <p className="muted label">tickets</p>
              </div>
              <div className="row-price">
                <p className="price">${l.pricePerTicket.toFixed(0)}</p>
                <p className="muted label">per ticket</p>
              </div>
              <button disabled={soldOut || notOnSale} onClick={() => setSelected(l)}>
                {notOnSale ? "Coming Soon" : soldOut ? "Sold Out" : "Reserve"}
              </button>
            </div>
          );
        })}
      </div>
      {selected && (
        <ReserveModal
          listing={selected}
          onClose={() => setSelected(null)}
          onReserved={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </>
  );
}