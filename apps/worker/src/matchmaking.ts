import { CAP } from '@crowntag/content';

/** Occupancy row kept in Matchmaker DO storage. */
export type ArenaOccupancy = {
  id: string;
  /**
   * Reserved/reported human Player count toward Cap.
   * Bots are Arena-local and must not be included here.
   */
  fighterCount: number;
};

/**
 * Fullest non-full Arena, or a new id. Optimistically reserves one human Player slot.
 * Cap is max humans; bots fill Cap inside Arena and do not affect Matchmaker occupancy.
 */
export function reserveJoinSlot(
  arenas: ArenaOccupancy[],
  nextSeq: number,
  cap: number = CAP,
): { arenas: ArenaOccupancy[]; nextSeq: number; arenaId: string } {
  const open = arenas.filter((a) => a.fighterCount < cap);
  if (open.length === 0) {
    const arenaId = `arena-${nextSeq}`;
    return {
      arenas: [...arenas, { id: arenaId, fighterCount: 1 }],
      nextSeq: nextSeq + 1,
      arenaId,
    };
  }

  // Fullest first; tie-break lowest id for stability.
  open.sort((a, b) => b.fighterCount - a.fighterCount || a.id.localeCompare(b.id));
  const pick = open[0]!;
  const arenasNext = arenas.map((a) =>
    a.id === pick.id ? { ...a, fighterCount: a.fighterCount + 1 } : a,
  );
  return { arenas: arenasNext, nextSeq, arenaId: pick.id };
}

/** Undo a Matchmaker reservation when Arena rejects (Cap race). */
export function releaseJoinSlot(
  arenas: ArenaOccupancy[],
  arenaId: string,
): ArenaOccupancy[] {
  return arenas.map((a) =>
    a.id === arenaId
      ? { ...a, fighterCount: Math.max(0, a.fighterCount - 1) }
      : a,
  );
}

/** Authoritative human Player occupancy from Arena (connect / disconnect). */
export function setArenaOccupancy(
  arenas: ArenaOccupancy[],
  arenaId: string,
  fighterCount: number,
  nextSeq: number,
): { arenas: ArenaOccupancy[]; nextSeq: number } {
  const count = Math.max(0, Math.floor(fighterCount));
  const idx = arenas.findIndex((a) => a.id === arenaId);
  if (idx < 0) {
    if (count === 0) return { arenas, nextSeq };
    return {
      arenas: [...arenas, { id: arenaId, fighterCount: count }],
      nextSeq: Math.max(nextSeq, parseArenaSeq(arenaId) + 1),
    };
  }
  const arenasNext = arenas.map((a) =>
    a.id === arenaId ? { ...a, fighterCount: count } : a,
  );
  return { arenas: arenasNext, nextSeq };
}

function parseArenaSeq(arenaId: string): number {
  const m = /^arena-(\d+)$/.exec(arenaId);
  return m ? Number(m[1]) : 0;
}
