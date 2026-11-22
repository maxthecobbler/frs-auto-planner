import { useEffect, useMemo, useRef, useState } from 'react';
import runtimeCode from '../../runtime-dist/frs-auto-runtime.js?raw';
import { useStore } from './store';
import { useGame, useRoutine } from './useSchedule';
import type { Routine } from '../../shared/routine';
import { PLANNER_URL, RUNTIME_FILE } from '../../shared/config';

/** Script that installs the runtime in the FRS tab with these routines preloaded. */
export function runtimeScript(routines: Routine[]): string {
  // `</` must not appear raw if someone pastes this into an HTML context
  const json = JSON.stringify(routines).replace(/</g, '\\u003c');
  return `(function(){window.__FRS_AUTO_EMBED=${json};${runtimeCode}\n})();`;
}

export function bookmarklet(routines: Routine[]): string {
  return 'javascript:' + encodeURIComponent(runtimeScript(routines) + 'void 0');
}

/**
 * The auto-updating bookmark: a tiny loader that fetches the newest runtime from the planner
 * website every time it's clicked. Autos come in through the panel's ↻ Sync button.
 */
export function loaderBookmarklet(): string {
  const src = JSON.stringify(PLANNER_URL + RUNTIME_FILE);
  const code =
    `(function(){var d=document,s=d.createElement('script');s.src=${src}+'?t='+Date.now();` +
    `s.onerror=function(){var b=d.createElement('div');b.textContent='FRS Auto: could not load from the planner website. Check your connection and try again.';` +
    `b.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#8f2a1c;color:#fff;padding:8px 14px;border-radius:8px;font:13px system-ui,sans-serif';` +
    `d.body.appendChild(b);setTimeout(function(){b.remove()},6000)};d.head.appendChild(s)})();void 0`;
  return 'javascript:' + encodeURIComponent(code);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SendToFRS({ onClose }: { onClose: () => void }) {
  const current = useRoutine();
  const game = useGame();
  const routines = useStore((s) => s.routines);
  const [all, setAll] = useState(true);
  const [msg, setMsg] = useState('');
  const link = useRef<HTMLAnchorElement>(null);
  const loader = useRef<HTMLAnchorElement>(null);

  // current routine last, so it ends up selected in the game
  const payload = useMemo(() => (all ? [...routines.filter((r) => r.id !== current.id), current] : [current]), [all, routines, current]);
  const href = useMemo(() => bookmarklet(payload), [payload]);

  // React refuses javascript: hrefs, so set it on the DOM node directly
  useEffect(() => {
    link.current?.setAttribute('href', href);
    loader.current?.setAttribute('href', loaderBookmarklet());
  }, [href]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <h2>Send to FRS</h2>
        <ol className="steps">
          <li>
            <b>Drag this button to your bookmarks bar</b> (show it with ⌘⇧B). You only need to do this once:
            <div className="bm-row">
              <a ref={loader} className="bookmarklet" onClick={(e) => e.preventDefault()} draggable>
                ⚡ FRS Auto
              </a>
            </div>
            <span className="hint">It updates itself. Every click loads the newest version from this website, so you never need a new bookmark.</span>
          </li>
          <li>
            Open <a href={`https://${game.host}`} target="_blank" rel="noreferrer">{game.host}</a>, start a <b>Singleplayer</b> match or join a <b>Multiplayer</b> room, and click the bookmark. The FRS AUTO panel appears.
          </li>
          <li>
            Click <b>↻ Sync</b> in the panel to pull in your latest autos from this planner. A small window opens for a moment and closes itself; if your browser blocks it, allow pop-ups for frsim.com. Sync again whenever you change an auto.
          </li>
          <li>
            Choose an auto and click <b>Arm for Auto</b> before the match starts. It drives the routine when Auto begins and re-arms for the next match. (In Singleplayer, press <kbd>R</kbd> to restart and run it again.)
          </li>
          <li>
            Drive calibration follows your current robot automatically. You can see its speed and turn rate under <b>Setup &amp; calibration</b>.
            The first time in each game, open <b>Setup &amp; calibration</b> → <b>Calibrate</b> with the robot in open space.
          </li>
        </ol>
        <details className="offline">
          <summary>Offline bookmark (autos built in, doesn't update)</summary>
          <div className="bm-row">
            <a ref={link} className="bookmarklet alt" onClick={(e) => e.preventDefault()} draggable>
              ⚡ FRS Auto (offline)
            </a>
            <label className="check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include all {routines.length} routines (every game)
            </label>
          </div>
          <span className="hint">Works without reaching this website, but it carries a snapshot: re-drag it after changes.</span>
        </details>
        <div className="row">
          <button
            onClick={async () => flash((await copy(JSON.stringify(current))) ? 'Routine copied. In the game panel: Load routine → paste → Load.' : 'Copy failed')}
          >
            Copy routine (paste into the game panel)
          </button>
          <button onClick={async () => flash((await copy(runtimeScript(payload))) ? 'Script copied. Paste it into the DevTools console on the FRS tab.' : 'Copy failed')}>
            Copy console script
          </button>
        </div>
        {msg && <p className="flash">{msg}</p>}
        <p className="hint">
          FRS Auto runs in Singleplayer and regular Multiplayer. It's disabled in Ranked, events, and while spectating. Pressing any key or touching a real
          controller gives control straight back to you.
        </p>
      </div>
    </div>
  );
}
