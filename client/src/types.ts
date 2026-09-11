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
  note: string | null;
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
  ticketEmailSentAt: string | null;
  paymentMethod: string | null;
  paymentAmount: number | null;
  paidAt: string | null;
  adminNotes: string | null;
  listing?: Listing;
}
