import { useState } from 'react';
import { applyAutoHandles, blankRoutine, gameOf, makeAction, makeWaypoint, parseRoutine, type ActionType, type Routine } from '../../shared/routine';
import { useStore } from './store';
import { isWaypointCommand, waypointMove } from './waypointCommand';
import { useRoutine } from './useSchedule';

function generate(prompt: string, current: Routine): Routine {
  const game = gameOf(current);
  const routine = blankRoutine('Generated auto', game.id);
  routine.robotId = current.robotId;
  routine.constraints = { ...current.constraints };
  routine.waypoints = [makeWaypoint(current.waypoints[0]?.x ?? routine.waypoints[0].x, current.waypoints[0]?.y ?? routine.waypoints[0].y, current.waypoints[0]?.heading ?? routine.waypoints[0].heading)];
  const commands = prompt.toLowerCase().split(/\s*(?:\n|,|;|\bthen\b)\s*/).filter(Boolean);
  if (!commands.length) throw new Error('Enter at least one instruction.');
  for (const command of commands) {
    const move = /^(?:drive|move|go)\s+(forward|backward|back|left|right)\s+(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)$/.exec(command.trim());
    const action = /^(shoot|climb|wait|intake on|intake off|intake)(?:\s+for\s+(\d+(?:\.\d+)?)\s*(?:s|seconds?))?$/.exec(command.trim());
    if (move) {
      const prev = routine.waypoints[routine.waypoints.length - 1];
      const distance = Number(move[2]);
      if (!(distance > 0)) throw new Error('Drive distance must be greater than zero.');
      const heading = prev.heading ?? 0;
      const angle = heading + ({ forward: 0, backward: Math.PI, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 } as Record<string, number>)[move[1]];
      const x = prev.x + distance * Math.cos(angle), y = prev.y + distance * Math.sin(angle);
      if (x < 0 || x > game.field.length || y < 0 || y > game.field.width) throw new Error(`“${command}” would drive off the field.`);
      routine.waypoints.push(makeWaypoint(x, y, heading));
    } else if (action) {
      const types: Record<string, ActionType> = { shoot: 'shoot', climb: 'climb', wait: 'wait', intake: 'intakeFor', 'intake on': 'intakeOn', 'intake off': 'intakeOff' };
      if (action[2] && Number(action[2]) <= 0) throw new Error('Action duration must be greater than zero.');
      if (action[2] && (action[1] === 'intake on' || action[1] === 'intake off')) throw new Error('Use “intake for 2 seconds” for a timed intake.');
      const index = routine.waypoints.length - 1;
      const item = makeAction(types[action[1]], index ? { seg: index - 1, u: 1 } : { seg: 0, u: 0 }, game);
      if (action[2]) item.duration = Number(action[2]);
      routine.actions.push(item);
    } else throw new Error(`Could not understand “${command}”. Use the examples shown below.`);
  }
  if (routine.waypoints.length < 2) throw new Error('Add at least one drive instruction.');
  routine.waypoints = applyAutoHandles(routine.waypoints);
  return routine;
}

const API_TOKEN_KEY = 'frsAutoPlanner:aiApiKey';

function saved(key: string) {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

export function PromptPanel() {
  const current = useRoutine();
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [apiToken, setApiToken] = useState(() => saved(API_TOKEN_KEY));
  const [lookup, setLookup] = useState(false);
  const [useExamples, setUseExamples] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [taught, setTaught] = useState('');
  const teachSweep = async () => {
    setTeaching(true);
    setError('');
    setTaught('');
    try {
      const response = await fetch('https://auto-ai.tomh1.dev/teach/double-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken.trim()}` },
        body: JSON.stringify(current),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Update the Ubuntu generator to enable teaching.');
      const data = await response.json();
      if (!response.ok || !data.saved) throw new Error(data.error || 'Could not save this double sweep.');
      setTaught(`Saved “${current.name}”. Double sweep examples: ${data.examples ?? 1}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTeaching(false);
    }
  };
  const movePoint = () => {
    setError('');
    try {
      const move = waypointMove(prompt, current);
      const store = useStore.getState();
      store.checkpoint();
      store.moveWaypoint(move.id, move.x, move.y);
      store.select({ kind: 'wp', id: move.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const createAuto = async () => {
    setBusy(true);
    setError('');
    try {
      let routine: Routine;
      if (apiToken.trim()) {
        const response = await fetch('https://auto-ai.tomh1.dev/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken.trim()}` },
          body: JSON.stringify({ prompt, lookup, useExamples }),
        });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`AI gateway returned HTTP ${response.status}. Check the tunnel and Access policy for /generate.`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `AI server returned ${response.status}.`);
        routine = parseRoutine(JSON.stringify(data));
        routine.robotId = current.robotId;
        routine.constraints = { ...current.constraints };
      } else {
        routine = generate(prompt, current);
      }
      useStore.getState().importRoutines([routine]);
      setError('');
    } catch (e) {
      setError((e as Error).message || 'Could not reach the AI server. Check its URL, token, and CORS settings.');
    } finally {
      setBusy(false);
    }
  };
  return <section className="panel">
      <h3>Create an auto from text</h3>
      <details>
        <summary>Home hosted AI connection</summary>
        <label className="paste">API key<input type="password" value={apiToken} onChange={e => { setApiToken(e.target.value); try { localStorage.setItem(API_TOKEN_KEY, e.target.value); } catch {} }} placeholder="Paste your generated API key" /></label>
        <p className="hint"><a href="https://auto-ai.tomh1.dev/" target="_blank" rel="noreferrer">Sign in to generate a key</a>. Leave the key empty for built-in commands.</p>
      </details>
      <p className="hint">Describe the auto you want. Include your start position and robot direction if they differ from the defaults.</p>
      <p className="hint">To edit this auto, try “move point 9 forward 0.5 m”. Forward follows the direction from the previous point. The default move is 0.5 m.</p>
      <label className="paste">Auto instructions<textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Drive forward 2 meters, then shoot for 3 seconds" /></label>
      {apiToken.trim() && <label className="check"><input type="checkbox" checked={useExamples} onChange={e => setUseExamples(e.target.checked)} />Use recorded double sweep examples</label>}
      {apiToken.trim() && <label className="check"><input type="checkbox" checked={lookup} onChange={e => setLookup(e.target.checked)} />Look up FRC strategies</label>}
      {error && <p className="warn">{error}</p>}
      <div className="row">
        <button className="go" disabled={busy || teaching || !prompt.trim()} onClick={() => void createAuto()}>{busy ? 'Generating…' : 'Create auto'}</button>
        <button disabled={busy || teaching || !isWaypointCommand(prompt)} onClick={movePoint}>Move point</button>
      </div>
      {apiToken.trim() && <button disabled={busy || teaching || current.waypoints.length < 2} onClick={() => void teachSweep()}>
        {teaching ? 'Saving…' : 'Teach this double sweep variation'}
      </button>}
      {taught && <p role="status" className="hint">{taught}</p>}
  </section>;
}
