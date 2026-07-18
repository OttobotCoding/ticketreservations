import type { Listing, Reservation } from "./types";

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export function fetchListings(): Promise<Listing[]> {
  return fetch("/api/listings").then((r) => handle<Listing[]>(r));
}

export function createReservation(input: {
  listingId: number;
  name: string;
  email: string;
  quantity: number;
}): Promise<Reservation> {
  return fetch("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => handle<Reservation>(r));
}

export function fetchReservations(token: string): Promise<Reservation[]> {
  return fetch("/api/admin/reservations", {
    headers: { "x-admin-token": token },
  }).then((r) => handle<Reservation[]>(r));
}

export function confirmReservation(token: string, id: number): Promise<Reservation> {
  return fetch(`/api/admin/reservations/${id}/confirm`, {
    method: "POST",
    headers: { "x-admin-token": token },
  }).then((r) => handle<Reservation>(r));
}

export function rejectReservation(
  token: string,
  id: number,
  reason?: string
): Promise<Reservation> {
  return fetch(`/api/admin/reservations/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: JSON.stringify(reason ? { reason } : {}),
  }).then((r) => handle<Reservation>(r));
}

export function updateListing(
  token: string,
  id: number,
  fields: Partial<Pick<Listing, "section" | "row" | "seats" | "pricePerTicket" | "ticketsAvailable">>
): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: JSON.stringify(fields),
  }).then((r) => handle<Listing>(r));
}

export function syncSchedule(token: string): Promise<{ total: number; added: number }> {
  return fetch("/api/admin/sync-schedule", {
    method: "POST",
    headers: { "x-admin-token": token },
  }).then((r) => handle<{ total: number; added: number }>(r));
}

export function createListing(
  token: string,
  fields: {
    opponent: string;
    gameDate: string;
    opponentLogo?: string | null;
    section?: string;
    row?: string;
    seats?: string;
    pricePerTicket?: number;
    ticketsAvailable?: number;
  }
): Promise<Listing> {
  return fetch("/api/admin/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: JSON.stringify(fields),
  }).then((r) => handle<Listing>(r));
}

export function deleteListing(token: string, id: number): Promise<{ ok: boolean }> {
  return fetch(`/api/admin/listings/${id}`, {
    method: "DELETE",
    headers: { "x-admin-token": token },
  }).then((r) => handle<{ ok: boolean }>(r));
}
