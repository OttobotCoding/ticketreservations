import { eq } from "drizzle-orm";
import { db, listings } from "./db";

// ESPN's public (unofficial, key-free) API. Broncos team id = 7 / abbreviation "den".
// seasontype=1 is preseason, seasontype=2 is the regular season.
const DEFAULT_URLS = [
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/den/schedule?seasontype=1",
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/den/schedule?seasontype=2",
];
const SCHEDULE_URLS = process.env.ESPN_SCHEDULE_URLS
  ? process.env.ESPN_SCHEDULE_URLS.split(",")
  : DEFAULT_URLS;
const BRONCOS_TEAM_ID = "7";

interface EspnGame {
  espnEventId: string;
  opponent: string;
  opponentLogo: string | null;
  gameDate: Date;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchBroncosHomeGames(): Promise<EspnGame[]> {
  const games: EspnGame[] = [];

  for (const url of SCHEDULE_URLS) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API returned ${res.status} for ${url}`);
    const data = (await res.json()) as any;

    for (const event of data.events ?? []) {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      const home = competitors.find((c: any) => c.homeAway === "home");
      const away = competitors.find((c: any) => c.homeAway === "away");
      // Home games only: the Broncos must be the home team.
      if (!home || !away || String(home.team?.id) !== BRONCOS_TEAM_ID) continue;

      const preseason = event.seasonType?.type === 1 ? " (Preseason)" : "";
      games.push({
        espnEventId: String(event.id),
        opponent: `vs. ${away.team?.displayName ?? "TBD"}${preseason}`,
        opponentLogo: away.team?.logos?.[0]?.href ?? null,
        gameDate: new Date(event.date),
      });
    }
  }
  return games;
}

/**
 * Upsert the Broncos home schedule into listings.
 * New games get placeholder price/seats/count (admin fills those in).
 * Existing ESPN games only get opponent/logo/date refreshed — admin-entered
 * pricing, seats, and inventory are never overwritten.
 * Manually added games (espnEventId = null) are never touched.
 */
export async function syncBroncosSchedule(): Promise<{ total: number; added: number }> {
  const games = await fetchBroncosHomeGames();
  let added = 0;

  for (const game of games) {
    const [existing] = await db
      .select()
      .from(listings)
      .where(eq(listings.espnEventId, game.espnEventId));

    if (existing) {
      await db
        .update(listings)
        .set({
          opponent: game.opponent,
          opponentLogo: game.opponentLogo,
          gameDate: game.gameDate,
        })
        .where(eq(listings.id, existing.id));
    } else {
      await db.insert(listings).values({
        ...game,
        section: "TBD",
        row: "TBD",
        seats: "TBD",
        pricePerTicket: 0,
        ticketsAvailable: 0,
      });
      added++;
    }
  }
  return { total: games.length, added };
}
