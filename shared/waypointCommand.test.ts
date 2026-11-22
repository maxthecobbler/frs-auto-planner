import { describe, expect, it } from 'vitest';
import { blankRoutine, makeWaypoint } from './routine';
import { isWaypointCommand, waypointMove } from '../app/src/waypointCommand';

describe('numbered waypoint edits', () => {
  const routine = blankRoutine();
  routine.waypoints = Array.from({ length: 10 }, (_, i) => makeWaypoint(i, 2, null));

  it('moves the displayed point 9 half a meter along the incoming leg', () => {
    const prompt = 'move farther forward on the point 9';
    expect(isWaypointCommand(prompt)).toBe(true);
    expect(waypointMove(prompt, routine)).toEqual({ id: routine.waypoints[9].id, x: 9.5, y: 2 });
  });

  it('accepts explicit distances and rejects moves outside the field', () => {
    expect(waypointMove('move point 9 left 1 meter', routine).y).toBe(3);
    expect(() => waypointMove('move point 9 forward 10 m', routine)).toThrow(/outside/);
    expect(() => waypointMove('move point 10 forward', routine)).toThrow(/missing/);
  });

  it('uses the field dimensions of the routine’s game', () => {
    const reefscape = blankRoutine('Reefscape', 'reefscape');
    reefscape.waypoints = [makeWaypoint(16, 2), makeWaypoint(16.5, 2)];
    expect(waypointMove('move point 1 forward 0.5 m', reefscape).x).toBe(17);
    expect(() => waypointMove('move point 1 forward 1.1 m', reefscape)).toThrow(/outside/);
    expect(() => waypointMove('move point 1 forward 0.5 m', { ...reefscape, game: 'rebuilt' })).toThrow(/outside/);
  });
});
