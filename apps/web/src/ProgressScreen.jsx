import { useEffect, useState } from "react";
import { Window } from "./components/Window.jsx";
import { SkillTree } from "./components/SkillTree.jsx";
import { Icon } from "./components/Icon.jsx";
import { SKILL_ICONS } from "./components/icons.js";
import { api } from "./api.js";
import "./ProgressScreen.css";

const SKILL_NAMES = {
  sqli: "SQL Injection",
  xss: "Cross-Site Scripting",
  csrf: "Request Forgery"
};

const RANKS = [
  { at: 0.00, name: "Trainee", sigil: "T" },
  { at: 0.25, name: "Junior Analyst", sigil: "JA" },
  { at: 0.45, name: "Security Engineer", sigil: "SE" },
  { at: 0.65, name: "Senior Engineer", sigil: "SR" },
  { at: 0.85, name: "Blue Team Lead", sigil: "BT" }
];

/**
 * Character sheet and skill tree.
 *
 * The bars are the knowledge-tracing model's current belief, not a count of
 * things done. Each one says so in a sentence rather than showing the arithmetic:
 * a learner needs to know why the number moved, not how Bayes works.
 */
export function ProgressScreen({ onOpenChallenge }) {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    let cancelled = false;
    api.progress()
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="progress__error">{error}</p>;
  if (!data) return <div className="progress__loading label">Reading your file…</div>;

  const skills = Object.keys(SKILL_NAMES).filter(s => s in data.mastery || data.nodes.some(n => n.skill === s));
  const mean = skills.length
    ? skills.reduce((a, s) => a + (data.mastery[s] ?? 0), 0) / skills.length
    : 0;
  const rank = RANKS.reduce((best, r) => (mean >= r.at ? r : best), RANKS[0]);

  return (
    <div className="progress">
      {data.degraded && (
        <Window tone="breach" title="Mastery unavailable">
          <p className="progress__degraded">
            The adaptive model isn't responding, so mastery and unlocking are missing.
            Everything you've cleared is still recorded — that comes from your own history,
            not from a prediction.
          </p>
        </Window>
      )}

      <div className="progress__top">
        <Window title="Character sheet">
          <div className="sheet__rank">
            <span className="sheet__sigil pixel">{rank.sigil}</span>
            <span>
              <span className="sheet__rankname">{rank.name}</span>
              <span className="label sheet__sub">Aurora Store · Blue Team</span>
            </span>
            <span className="sheet__xp">
              <span className="sheet__xpval pixel">{data.xp}</span>
              <span className="label">xp</span>
            </span>
          </div>

          <div className="sheet__stats">
            {skills.map(skill => (
              <MasteryRow
                key={skill}
                icon={SKILL_ICONS[skill]}
                name={SKILL_NAMES[skill]}
                value={data.mastery[skill] ?? 0}
                // Count via the node's own skill field. Matching on an id prefix
                // assumed ids look like "sqli.something"; they look like "sec-101",
                // so every skill reported zero solved regardless of what was done.
                cleared={data.nodes.filter(n => n.skill === skill && data.cleared.includes(n.id)).length}
                nodes={data.nodes.filter(n => n.skill === skill)}
              />
            ))}
          </div>
        </Window>

        <Window title="The Aurora Breach" tone={data.capstoneUnlocked ? "breach" : "quiet"}>
          <p className="capstone__brief">
            A single incident chaining all three vulnerabilities. It tests whether what
            you've learned carries across, rather than one technique at a time.
          </p>
          <p className={data.capstoneUnlocked ? "capstone__gate capstone__gate--open" : "capstone__gate"}>
            <Icon name={data.capstoneUnlocked ? "fracture" : "lock"} size={14} />{" "}
            {data.capstoneUnlocked
              ? "Unlocked — every domain is holding up."
              : `Locked until all three skills reach 0.70. ${skills.filter(s => (data.mastery[s] ?? 0) >= 0.7).length} of ${skills.length} there.`}
          </p>
        </Window>
      </div>

      <Window title="Skill tree" badge={<span className="label">{data.cleared.length} cleared</span>}>
        <SkillTree
          nodes={data.nodes}
          titles={data.titles}
          mastery={data.mastery}
          unlocked={data.unlocked}
          cleared={data.cleared}
          onSelect={onOpenChallenge}
        />
      </Window>
    </div>
  );
}

/**
 * One skill's mastery, with the thresholds that matter marked on the track.
 *
 * The sentence underneath is the point. A bare 0.68 says nothing; "two clean
 * solves" says what moved it, and quietly explains why a hint-assisted answer
 * did not.
 */
function MasteryRow({ icon, name, value, cleared, nodes }) {
  const nextGate = nodes
    .map(n => n.masteryRequired)
    .filter(t => t > value)
    .sort((a, b) => a - b)[0];

  return (
    <div className="stat">
      <div className="stat__head">
        <Icon name={icon} size={16} className="stat__icon" />
        <span className="stat__name">{name}</span>
        <span className="stat__value">{value.toFixed(2)}</span>
      </div>

      <span className="stat__track">
        <span className="stat__fill" style={{ width: `${Math.min(1, value) * 100}%` }} />
        {nodes.map(n => n.masteryRequired).filter(t => t > 0 && t < 1).map(t => (
          <span key={t} className="stat__gate" style={{ left: `${t * 100}%` }} />
        ))}
      </span>

      <p className="stat__why">
        {cleared === 0
          ? "Nothing solved unaided yet, so this is the starting estimate."
          : `${cleared} solved unaided. Hints and retries still earn XP, but only a first attempt on your own moves this.`}
        {nextGate !== undefined && ` Next unlock at ${nextGate.toFixed(2)}.`}
      </p>
    </div>
  );
}
