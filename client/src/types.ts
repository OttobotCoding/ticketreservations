export interface Listing {
  id: number;
  espnEventId: string | null;
  opponentLogo: string | null;
  opponent: string;
  gameDate: string;
  section: string;
  row: string;
  seats: string;
  pricePerTicket: number;
  ticketsAvailable: number;
}

export type ReservationStatus = "PENDING" | "CONFIRMED" | "REJECTED";

export interface Reservation {
  id: number;
  listingId: number;
  name: string;
  email: string;
  quantity: number;
  status: ReservationStatus;
  rejectionReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  listing?: Listing;
}
