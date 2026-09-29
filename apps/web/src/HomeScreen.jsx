import { useEffect, useState } from "react";
import { Window } from "./components/Window.jsx";
import { Portrait } from "./components/Portrait.jsx";
import { PostureGauge } from "./components/PostureGauge.jsx";
import { Icon } from "./components/Icon.jsx";
import { SKILL_ICONS } from "./components/icons.js";
import { SKILL_NAMES } from "./ProgressScreen.jsx";
import { composeBriefing, ago } from "./briefing.js";
import { api } from "./api.js";
import "./HomeScreen.css";

/** Titles for the shift log. The full lessons live on the server. */
const LESSON_TITLES = {
  "lesson-sqli": "Injected queries",
  "lesson-xss": "Injected scripts",
  "lesson-csrf": "Forged requests"
};

/**
 * The shift briefing: where a signed-in learner lands.
 *
 * Deliberately does not ask the model what to serve next. Doing so records a
 * recommendation.served event, and the assignment screen asks again when it
 * opens -- two recommendations per ticket would halve the follow-through rate
 * the study reports. The briefing says why the next ticket will be chosen; the
 * assignment screen is where it is chosen.
 *
 * @param {{ handle: string, onTakeTicket: () => void, onOpenCapstone: () => void,
 *           onOpenProgress: () => void }} props
 */
export function HomeScreen({ handle, onTakeTicket, onOpenCapstone, onOpenProgress }) {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    let cancelled = false;
    api.progress()
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="home__error">{error}</p>;
  if (!data) return <div className="home__loading label">Reading the overnight reports…</div>;

  const { lines, capstoneCall } = composeBriefing({ ...data, handle });
  const skills = Object.keys(SKILL_NAMES).filter(s => s in data.mastery);
  const reached = skills.filter(s => (data.mastery[s] ?? 0) >= 0.7).length;
  const badgeName = id => data.allBadges?.find(b => b.id === id)?.name ?? id;
  const title = id => data.titles?.[id]?.title ?? id;
  const isDrill = id => !!data.nodes?.find(n => n.id === id)?.isDrill;

  return (
    <div className="home">
      <div className="home__main">
        <Window title="Shift briefing" badge={<span className="label">from incident response</span>}>
          <div className="briefing">
            <Portrait name="Marcus" role="Incident response" />
            <div className="briefing__body">
              {lines.map((line, i) => <p key={i} className="briefing__line">{line}</p>)}
              <div className="briefing__actions">
                <button className="cmd cmd--primary pixel" onClick={onTakeTicket} autoFocus>
                  <span className="cmd__caret">▸</span>
                  Take the next ticket
                </button>
                {capstoneCall && (
                  <button className="cmd pixel briefing__capstone" onClick={onOpenCapstone}>
                    <span className="cmd__caret">▸</span>
                    Open the Aurora Breach
                  </button>
                )}
              </div>
            </div>
          </div>
        </Window>

        <Window title="Shift log" badge={<span className="label">latest first</span>}>
          {data.recent?.length ? (
            <ul className="shiftlog">
              {data.recent.map((r, i) => (
                <li key={i} className={`shiftlog__row shiftlog__row--${
                  r.kind === "badge" || r.kind === "lesson" ? "badge" : r.correct ? "held" : "open"}`}>
                  <Icon name={r.kind === "badge" ? "shieldCheck" : r.kind === "lesson" ? "book"
                    : r.correct ? "check" : "fracture"} size={15} />
                  <span className="shiftlog__what">
                    {r.kind === "badge"
                      ? <>Commendation: <strong>{badgeName(r.badgeId)}</strong></>
                      : r.kind === "lesson"
                        ? <>Briefing: <strong>{LESSON_TITLES[r.lessonId] ?? r.lessonId}</strong></>
                        : title(r.challengeId)}
                  </span>
                  <span className="shiftlog__outcome label">
                    {r.kind === "badge" ? "earned" : r.kind === "lesson" ? "filed"
                      : r.correct ? (r.xp ? `cleared · +${r.xp} xp` : "held")
                      : isDrill(r.challengeId) ? "missed" : "didn't hold"}
                  </span>
                  <span className="shiftlog__when label">{ago(r.occurredAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="shiftlog__empty">Nothing yet. Your first ticket will show up here.</p>
          )}
        </Window>
      </div>

      <aside className="home__side">
        {data.posture && (
          <Window title="Aurora's posture" tone={data.posture.score < 50 ? "breach" : "default"}>
            <div className="home__posture">
              <PostureGauge score={data.posture.score} label={data.posture.label} size={128} />
              <p className="home__note">{data.posture.closed} of {data.posture.total} holes closed</p>
            </div>
          </Window>
        )}

        <Window title="Your skills">
          {data.degraded ? (
            <p className="home__note">The adaptive model isn't responding, so mastery is unavailable right now.</p>
          ) : (
            <ul className="skillbars">
              {skills.map(s => (
                <li key={s} className="skillbar">
                  <span className="skillbar__head">
                    <Icon name={SKILL_ICONS[s]} size={14} />
                    <span className="skillbar__name">{SKILL_NAMES[s]}</span>
                    <span className="skillbar__val">{(data.mastery[s] ?? 0).toFixed(2)}</span>
                  </span>
                  <span className="stat__track">
                    <span className="stat__fill" style={{ width: `${Math.min(1, data.mastery[s] ?? 0) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button className="home__more" onClick={onOpenProgress}>Full character sheet</button>
        </Window>

        <Window title="The Aurora Breach" tone={capstoneCall ? "breach" : "quiet"}>
          <p className={capstoneCall ? "capstone__gate capstone__gate--open" : "capstone__gate"}>
            <Icon name={data.posture?.capstoneHeld ? "shieldCheck" : capstoneCall ? "fracture" : "lock"} size={14} />{" "}
            {data.posture?.capstoneHeld
              ? "Held. The chain is broken."
              : capstoneCall
                ? "Open. All three skills are holding up."
                : `Locked until all three skills reach 0.70. ${reached} of ${skills.length} there.`}
          </p>
        </Window>
      </aside>
    </div>
  );
}
