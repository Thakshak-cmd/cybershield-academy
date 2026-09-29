import { useEffect, useState } from "react";
import { Window } from "./components/Window.jsx";
import { Portrait } from "./components/Portrait.jsx";
import { Icon } from "./components/Icon.jsx";
import { SKILL_ICONS } from "./components/icons.js";
import { LessonScreen } from "./LessonScreen.jsx";
import { api } from "./api.js";
import "./ManualScreen.css";

/**
 * The field manual: every briefing file the learner has been handed.
 *
 * Unfiled ones are listed but closed. They arrive with the first ticket that
 * needs them -- opening one early would mean reading about a vulnerability
 * with nothing in front of you to apply it to, and would put the instruction
 * at a different point for different participants.
 */
export function ManualScreen() {
  const [lessons, setLessons] = useState(/** @type {any[]|null} */ (null));
  const [open, setOpen] = useState(/** @type {string|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  function refresh() {
    api.lessons().then(d => setLessons(d.lessons)).catch(err => setError(err.message));
  }
  useEffect(refresh, []);

  if (open) {
    return (
      <LessonScreen
        lessonId={open}
        doneLabel="Back to the manual"
        onDone={() => { setOpen(null); refresh(); window.scrollTo({ top: 0 }); }}
      />
    );
  }

  if (error) return <p className="manual__error">{error}</p>;
  if (!lessons) return <div className="manual__loading label">Finding the manual…</div>;

  const filed = lessons.filter(l => l.completed).length;

  return (
    <div className="manual">
      <Window title="Field manual" badge={<span className="label">{filed} of {lessons.length} filed</span>}>
        <p className="manual__intro">
          Every briefing you've been handed, kept for when you need it. New ones arrive with the first
          ticket that needs them.
        </p>
        <ul className="manual__list">
          {lessons.map(l => (
            <li key={l.id} className={l.completed ? "manual__item" : "manual__item manual__item--sealed"}>
              <Portrait name={l.from} size={44} />
              <span className="manual__text">
                <span className="manual__title">
                  <Icon name={SKILL_ICONS[l.skill]} size={15} /> {l.title}
                </span>
                <span className="label">{l.completed ? `from ${l.from}` : "arrives with your first ticket in this skill"}</span>
              </span>
              {l.completed ? (
                <button className="cmd pixel manual__open" onClick={() => setOpen(l.id)}>
                  <span className="cmd__caret">▸</span> Reread
                </button>
              ) : (
                <Icon name="lock" size={16} className="manual__lock" label="Not yet filed" />
              )}
            </li>
          ))}
        </ul>
      </Window>
    </div>
  );
}
