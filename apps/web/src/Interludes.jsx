import { Window } from "./components/Window.jsx";
import { Icon } from "./components/Icon.jsx";
import "./Interludes.css";

/**
 * The screens between a learner's lessons.
 *
 * Found in playtesting: a new learner met three lessons in about ten minutes --
 * lesson, a thirty-second drill, lesson, drill, lesson -- with nothing between
 * them, which felt like one long lecture. A break before each later lesson
 * marks where one topic ends and the next begins, and lets the learner choose
 * when to start. The order of tickets is unchanged; only the pacing is.
 */

/**
 * @param {{ filed: { title: string }[], upcoming: { title: string, from: string },
 *           total: number, onStart: () => void, onLeave?: () => void }} props
 */
export function BreakScreen({ filed, upcoming, total, onStart, onLeave }) {
  return (
    <div className="interlude">
      <Window as="h1" title="Take a breather">
        <p className="interlude__lead">
          That's {filed.length} of {total} briefings done.
        </p>
        <ul className="interlude__done">
          {filed.map(l => (
            <li key={l.title}><Icon name="check" size={15} /> {l.title}</li>
          ))}
        </ul>
        <p className="interlude__text">
          Next up is a new kind of attack: <strong>{upcoming.title.toLowerCase()}</strong>,
          from {upcoming.from.replace(/\s*\(.*\)/, "")}. There's no timer, so start whenever you're ready.
        </p>
        <div className="interlude__actions">
          {onLeave && <button className="interlude__link" onClick={onLeave}>Back to the briefing</button>}
          <button className="cmd cmd--primary pixel" onClick={onStart} autoFocus>
            <span className="cmd__caret">▸</span> Start when ready
          </button>
        </div>
      </Window>
    </div>
  );
}

/**
 * Shown once, after the last of the lessons. Not shown to study participants:
 * in the middle of a study session it would read as "you're finished", and
 * cut short the time-on-task the study measures.
 *
 * @param {{ onContinue: () => void, onLeave?: () => void }} props
 */
export function ThanksScreen({ onContinue, onLeave }) {
  return (
    <div className="interlude">
      <Window as="h1" title="Thank you">
        <p className="interlude__lead interlude__lead--big">Thank you for trying my app out!</p>
        <p className="interlude__text">
          That's all three briefings done. You can keep going: there are more tickets in each
          skill, and the Aurora Breach opens once all three are strong.
        </p>
        <div className="interlude__actions">
          {onLeave && <button className="interlude__link" onClick={onLeave}>Back to the briefing</button>}
          <button className="cmd cmd--primary pixel" onClick={onContinue} autoFocus>
            <span className="cmd__caret">▸</span> Keep playing
          </button>
        </div>
      </Window>
    </div>
  );
}
