import { useEffect, useState } from "react";
import { BadgeArt } from "./BadgeArt.jsx";
import { getBadge } from "../../../../content/badges.js";
import "./Reward.css";

/**
 * The moment a patch lands.
 *
 * Until this existed, solving a challenge made a box appear. The platform's whole
 * claim is that gamification sustains engagement, and it was awarding points into
 * a void -- nothing marked the difference between getting it right and reading an
 * error message.
 *
 * The XP counts rather than appearing. A number that ticks upward is doing the
 * one thing a static number cannot: making the size of the reward felt rather
 * than read.
 *
 * @param {{ xp: number, badges: string[], firstAttempt: boolean, streak?: number, onDone?: () => void,
 *           title?: string, doneLabel?: string }} props
 */
export function Reward({ xp, badges = [], firstAttempt, streak = 0, onDone,
                        title = "Hole closed", doneLabel = "Next assignment" }) {
  const shown = useCountUp(xp, 900);

  return (
    <div className="reward" role="status">
      <div className="reward__burst" aria-hidden="true" />

      <div className="reward__head">
        <span className="reward__title pixel">{title}</span>
        {firstAttempt && <span className="reward__flag label">first attempt, unaided</span>}
        {streak >= 2 && (
          <span className="reward__flag reward__flag--streak label">{streak} in a row</span>
        )}
      </div>

      <div className="reward__xp">
        <span className="reward__xpval pixel">+{shown}</span>
        <span className="label">xp</span>
      </div>

      {badges.length > 0 && (
        <div className="reward__badges">
          {badges.map((id, i) => {
            const badge = getBadge(id);
            if (!badge) return null;
            return (
              <div className="reward__badge" key={id}
                   style={{ animationDelay: `${400 + i * 220}ms` }}>
                <BadgeArt art={badge.art} size={56} title={badge.name} />
                <span className="reward__badgename pixel">{badge.name}</span>
                <span className="reward__badgedesc">{badge.description}</span>
              </div>
            );
          })}
        </div>
      )}

      {onDone && (
        <button className="cmd cmd--primary pixel reward__next" onClick={onDone}>
          <span className="cmd__caret">▸</span>
          {doneLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Count from zero to a target.
 *
 * Eased rather than linear, so it decelerates into the final number instead of
 * stopping dead.
 *
 * The animation is an enhancement; landing on the value is not. requestAnimationFrame
 * is suspended entirely while a tab is hidden -- not throttled, stopped -- so a
 * learner who submits a patch and switches tab returns to a reward panel reading
 * "+0" with nothing to restart it. The value is therefore set outright whenever
 * the page is not visible, and again if it becomes hidden mid-count.
 *
 * Reduced motion lands immediately for the same reason: an animated counter is
 * exactly what that setting exists to turn off.
 */
function useCountUp(target, duration) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || document.hidden) {
      setValue(target);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = now => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // If the tab is hidden part-way through, rAF stops and never resumes from
    // where it left off. Snap rather than leave a half-counted number.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        setValue(target);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [target, duration]);

  return value;
}
