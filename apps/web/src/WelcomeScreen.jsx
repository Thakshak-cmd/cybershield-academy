import { useRef, useState } from "react";
import { Window } from "./components/Window.jsx";
import { Portrait } from "./components/Portrait.jsx";
import { Icon } from "./components/Icon.jsx";
import { api } from "./api.js";
import "./WelcomeScreen.css";

/**
 * The welcome: one screen, read once, before a new recruit's first shift.
 *
 * Without it a new account went from signing up to a lesson with no sense of
 * what the platform is or how a ticket is judged. One screen rather than a
 * tour: everything a newcomer needs before starting fits on it, and nothing
 * here should take more than a minute -- every second of it is inside the
 * study's time to first action.
 *
 * Reopenable from the briefing ("How it works"), which records a reread.
 *
 * @param {{ handle: string, reread?: boolean, onDone: () => void }} props
 */
export function WelcomeScreen({ handle, reread = false, onDone }) {
  const [busy, setBusy] = useState(false);
  const openedAt = useRef(Date.now());

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      await api.welcome(Date.now() - openedAt.current);
    } catch {
      // Never strand someone on the welcome because the record failed.
    } finally {
      onDone();
    }
  }

  return (
    <div className="welcome">
      <Window as="h1" title={reread ? "How it works" : "Welcome to the night shift"}>
        <div className="welcome__intro">
          <Portrait name="Marcus" role="Incident response" />
          <div>
            <p className="welcome__lead">
              {reread ? "A quick refresher." : `Welcome to the Blue Team, ${handle}.`}
            </p>
            <p className="welcome__text">
              Aurora Store has security holes that attackers already know about. You're the newest
              engineer on the night shift, and your job is to close them, one ticket at a time.
            </p>
          </div>
        </div>

        <ul className="welcome__steps">
          <li className="welcome__step">
            <Icon name="book" size={22} />
            <span>
              <strong>Learn</strong>
              Before your first ticket in each kind of attack, a short briefing explains it and shows it happening.
            </span>
          </li>
          <li className="welcome__step">
            <Icon name="shieldCheck" size={22} />
            <span>
              <strong>Fix</strong>
              Each ticket is a piece of Aurora's code or configuration with a hole in it. Spot it, fix it, or judge a colleague's fix, without breaking what the shop needs.
            </span>
          </li>
          <li className="welcome__step">
            <Icon name="gauge" size={22} />
            <span>
              <strong>Grow</strong>
              The next ticket is chosen for you from how you're doing, and the company's security improves as you go.
            </span>
          </li>
        </ul>

        <div className="welcome__ticket">
          <span className="label">How a fix is judged</span>
          <div className="welcome__suites">
            <p><span className="welcome__mark" aria-hidden="true">✦</span> <strong>Attack suite:</strong> the attack must fail.</p>
            <p><span className="welcome__mark" aria-hidden="true">✦</span> <strong>Functional suite:</strong> the shop must still work.</p>
          </div>
          <p className="welcome__note">Both have to pass. A fix that blocks the attack by breaking the feature doesn't count.</p>
        </div>

        <p className="welcome__help">
          Stuck? Ask for a hint (it costs a little XP). Everything you've learned stays in
          the <strong>field manual</strong>.
        </p>

        <div className="welcome__actions">
          <button className="cmd cmd--primary pixel" onClick={start} disabled={busy} autoFocus>
            <span className="cmd__caret">▸</span>
            {reread ? "Back to the briefing" : "Start my first shift"}
          </button>
        </div>
      </Window>
    </div>
  );
}
