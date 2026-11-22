import { gameOf, type Routine } from '../../shared/routine';

const pointLabel = /\b(?:waypoint|point)\s*#?\s*(\d+|s)\b/i;

export function isWaypointCommand(prompt: string) {
  return /^\s*(?:please\s+)?(?:move|shift|nudge|push)\b/i.test(prompt) && pointLabel.test(prompt);
}

export function waypointMove(prompt: string, routine: Routine) {
  const label = prompt.match(pointLabel)?.[1];
  const index = label?.toLowerCase() === 's' ? 0 : Number(label);
  const point = routine.waypoints[index];
  if (!point) throw new Error(`Point ${label} is missing from this auto. Use a label on the field.`);

  // Accept the point before or after the movement, including "on the point 9".
  const movement = prompt.toLowerCase().trim().replace(/^((please\s+)?(move|shift|nudge|push))\s+/, '')
    .replace(/(?:\b(?:on|at)\s+)?(?:\bthe\s+)?\b(?:waypoint|point)\s*#?\s*(?:\d+|s)\b/, '')
    .trim().replace(/[.!]$/, '').trim().replace(/\s+/g, ' ');
  const match = /^(?:(\d*\.?\d+)\s*(?:m|meters?|metres?)\s+)?(?:(?:farther|further)\s+)?(forwards?|backwards?|back|left|right)(?:\s+(?:by\s+)?(\d*\.?\d+)\s*(?:m|meters?|metres?))?$/.exec(movement);
  if (!match || (match[1] && match[3])) throw new Error('Try “move point 9 forward 0.5 m”.');
  const distance = Number(match[1] ?? match[3] ?? 0.5);
  if (!(distance > 0)) throw new Error('Enter a distance greater than zero.');

  const previous = routine.waypoints[index - 1];
  const next = routine.waypoints[index + 1];
  const dx = previous ? point.x - previous.x : (next?.x ?? point.x) - point.x;
  const dy = previous ? point.y - previous.y : (next?.y ?? point.y) - point.y;
  if (!dx && !dy && point.heading == null) throw new Error('Set a heading for this point so it has a direction.');
  const angle = dx || dy ? Math.atan2(dy, dx) : point.heading!;
  const direction = match[2];
  const offset = direction.startsWith('back') ? Math.PI : direction === 'left' ? Math.PI / 2 : direction === 'right' ? -Math.PI / 2 : 0;
  const x = point.x + distance * Math.cos(angle + offset);
  const y = point.y + distance * Math.sin(angle + offset);
  const field = gameOf(routine).field;
  if (x < 0 || x > field.length || y < 0 || y > field.width) throw new Error('That move would put the point outside the field.');
  return { id: point.id, x, y };
}
