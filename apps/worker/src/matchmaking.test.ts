import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAP } from '@crowntag/content';
import { reserveJoinSlot, setArenaOccupancy } from './matchmaking';

describe('matchmaking occupancy (humans only toward Cap)', () => {
  it('routes a second join to the same arena when occupancy is human count 1 (bots filled Arena)', () => {
    let reserved = reserveJoinSlot([], 1, CAP);
    assert.equal(reserved.arenaId, 'arena-1');

    // Arena filled bots to Cap but only 1 human — Matchmaker must see humans only.
    const occupied = setArenaOccupancy(reserved.arenas, 'arena-1', 1, reserved.nextSeq);
    reserved = reserveJoinSlot(occupied.arenas, occupied.nextSeq, CAP);

    assert.equal(reserved.arenaId, 'arena-1');
  });

  it('creates a new arena if occupancy were wrongly reported as Cap (documents why humans-only)', () => {
    let reserved = reserveJoinSlot([], 1, CAP);
    assert.equal(reserved.arenaId, 'arena-1');

    // Bug pattern: reporting getFighterCount() (humans+bots) makes Cap look full.
    const occupied = setArenaOccupancy(reserved.arenas, 'arena-1', CAP, reserved.nextSeq);
    reserved = reserveJoinSlot(occupied.arenas, occupied.nextSeq, CAP);

    assert.equal(reserved.arenaId, 'arena-2');
  });

  it('treats an arena at human Cap as full and creates a new arena', () => {
    let reserved = reserveJoinSlot([], 1, CAP);
    assert.equal(reserved.arenaId, 'arena-1');

    const occupied = setArenaOccupancy(reserved.arenas, 'arena-1', CAP, reserved.nextSeq);
    reserved = reserveJoinSlot(occupied.arenas, occupied.nextSeq, CAP);

    assert.equal(reserved.arenaId, 'arena-2');
  });
});
