import { useEffect, useRef, useState } from "react";
import { Window, Pips } from "./components/Window.jsx";
import { Reward } from "./components/Reward.jsx";
import { Portrait } from "./components/Portrait.jsx";
import { api } from "./api.js";
import "./ChallengeScreen.css";

/** @typedef {import("./api.js").Challenge} Challenge */
/** @typedef {import("./api.js").Verdict} Verdict */
/** @typedef {import("./api.js").RuleResult} RuleResult */

/**
 * The core loop, on one screen.
 *
 * Ticket and vulnerable code on the left, editor below, suites and commands on
 * the right. The two suites sit side by side deliberately: closing the hole
 * without breaking the feature is the whole puzzle, and separating them across
 * screens would hide the tension that makes it one.
 */
export function ChallengeScreen() {
  const [challenge, setChallenge] = useState(/** @type {Challenge|null} */ (null));
  const [reason, setReason] = useState("");
  const [mastery, setMastery] = useState(/** @type {Record<string, number>} */ ({}));
  const [patch, setPatch] = useState("");
  const [verdict, setVerdict] = useState(/** @type {Verdict|null} */ (null));
  const [busy, setBusy] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const openedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await api.next();
      if (cancelled || !next.challenge) return;
      await api.start(next.challenge.id);
      setChallenge(next.challenge);
      setReason(next.reason);
      setMastery(next.mastery || {});
      setPatch(next.challenge.vulnerable);
      openedAt.current = Date.now();
    })();
    return () => { cancelled = true; };
  }, []);

  async function deploy() {
    if (!challenge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.attempt(challenge.id, patch, Date.now() - openedAt.current);
      setVerdict(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Reset for whatever the adaptive layer serves next, without a page reload. */
  async function nextAssignment() {
    setVerdict(null);
    setHintsShown(0);
    setChallenge(null);
    const next = await api.next();
    if (!next.challenge) return;
    await api.start(next.challenge.id);
    setChallenge(next.challenge);
    setReason(next.reason);
    setMastery(next.mastery || {});
    setPatch(next.challenge.vulnerable);
    openedAt.current = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function takeHint() {
    if (hintsShown < (challenge?.hintCount ?? 0)) setHintsShown(h => h + 1);
  }

  if (!challenge) {
    return <div className="loading label">Loading assignment…</div>;
  }

  const attacksRepelled = verdict ? verdict.security.passed : 0;
  const attacksTotal = verdict ? verdict.security.total : challenge.attackCount;
  const funcPassing = verdict ? verdict.functional.passed : 0;
  const funcTotal = verdict ? verdict.functional.total : challenge.functionalCount;

  return (
    <div className="screen">
      <Window
        title={`Ticket ${challenge.id.toUpperCase()}`}
        badge={<span className="label">{challenge.repo} · {challenge.tier}</span>}
      >
        <div className="ticket">
          <Portrait name={challenge.reportedBy ?? "Unassigned"} />
          <div className="ticket__text">
            <h1 className="ticket__title">{challenge.title}</h1>
            <p className="ticket__brief">{challenge.brief}</p>
            <p className="label ticket__file">{challenge.file}</p>
          </div>
        </div>
      </Window>

      <div className="stage">
        <div className="stage__main">
          <Window title="The code as it stands" tone="quiet" flush>
            <CodeBlock source={challenge.vulnerable} />
          </Window>

          <Window title="Your patch" badge={<span className="label">editable</span>} flush>
            <textarea
              className="editor"
              value={patch}
              spellCheck="false"
              onChange={e => { setPatch(e.target.value); setVerdict(null); }}
              aria-label="Your patch"
            />
          </Window>
        </div>

        <aside className="stage__side">
          <Window
            title="Attack suite"
            tone={verdict ? (attacksRepelled === attacksTotal ? "secure" : "breach") : "default"}
            badge={<span className="label">must all fail</span>}
          >
            <div className="suite">
              {/* A filled pip always means a good outcome, so it is always green.
                  Colouring them red while the suite is incomplete would make the
                  same shape mean "repelled" and "alarming" at once, on a screen
                  whose entire arc is red becoming green. The window's border
                  carries the alarm instead. */}
              <Pips total={attacksTotal} filled={attacksRepelled} />
              <span className="suite__count pixel">
                {verdict ? `${attacksRepelled}/${attacksTotal} repelled` : "not run"}
              </span>
            </div>
            {verdict && <RuleList results={verdict.security.results} />}
          </Window>

          <Window
            title="Functional suite"
            tone={verdict ? (funcPassing === funcTotal ? "secure" : "breach") : "default"}
            badge={<span className="label">must all pass</span>}
          >
            <div className="suite">
              <Pips total={funcTotal} filled={funcPassing} />
              <span className="suite__count pixel">
                {verdict ? `${funcPassing}/${funcTotal} passing` : "not run"}
              </span>
            </div>
            {verdict && <RuleList results={verdict.functional.results} />}
          </Window>

          <Window title="Commands">
            <menu className="commands">
              <li>
                <button className="cmd cmd--primary pixel" onClick={deploy} disabled={busy}>
                  <span className="cmd__caret">▸</span>
                  {busy ? "Checking…" : "Deploy patch"}
                </button>
              </li>
              <li>
                <button className="cmd pixel" onClick={takeHint}
                        disabled={hintsShown >= challenge.hintCount}>
                  <span className="cmd__caret">▸</span>
                  Ask for a hint
                  <span className="cmd__note label">
                    {challenge.hintCount - hintsShown} left
                  </span>
                </button>
              </li>
            </menu>
            {error && <p className="error">{error}</p>}
          </Window>

          <Window title="Field notes" tone="quiet">
            <p className="label reason">{reason}</p>
            <MasteryBar skill="sqli" value={mastery.sqli ?? 0.15} />
            {hintsShown > 0 && (
              <ol className="hints">
                {Array.from({ length: hintsShown }, (_, i) => (
                  <li key={i}>{api.hint(i)}</li>
                ))}
              </ol>
            )}
          </Window>
        </aside>
      </div>

      {verdict?.passed ? (
        <Reward
          xp={verdict.xpAwarded ?? 0}
          badges={verdict.newBadges ?? []}
          firstAttempt={verdict.attemptNo === 1 && hintsShown === 0}
          onDone={nextAssignment}
        />
      ) : verdict ? (
        <Verdict verdict={verdict} />
      ) : null}
    </div>
  );
}

/** @param {{ source: string }} props */
function CodeBlock({ source }) {
  const lines = source.split("\n");
  return (
    <pre className="code">
      {lines.map((line, i) => (
        <span className="code__line" key={i}>
          <span className="code__num">{i + 1}</span>
          <span className="code__text">{line || " "}</span>
        </span>
      ))}
    </pre>
  );
}

/** @param {{ results: RuleResult[] }} props */
function RuleList({ results }) {
  return (
    <ul className="rules">
      {results.map(r => (
        <li key={r.id} className={r.pass ? "rule rule--pass" : "rule rule--fail"}>
          <span className="rule__mark" aria-hidden="true">{r.pass ? "✦" : "✕"}</span>
          <span>
            <code className="rule__id">{r.id}</code>
            {!r.pass && r.evidence && <span className="rule__why">{r.evidence}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** @param {{ skill: string, value: number }} props */
function MasteryBar({ skill, value }) {
  return (
    <div className="mastery">
      <span className="label">{skill} mastery</span>
      <span className="mastery__track">
        <span className="mastery__fill" style={{ width: `${value * 100}%` }} />
      </span>
      <span className="mastery__val pixel">{value.toFixed(2)}</span>
    </div>
  );
}

/** @param {{ verdict: Verdict }} props */
function Verdict({ verdict }) {
  const won = verdict.passed;
  return (
    <Window
      tone={won ? "secure" : "breach"}
      title={won ? "Hole closed" : "Still exploitable"}
      badge={won && <span className="label">+{verdict.xpAwarded} xp</span>}
    >
      <p className="verdict">
        {won
          ? "The input never becomes part of the query text, so there is nothing to escape and no payload shape to anticipate. Every legitimate search still works, apostrophes included."
          : "The patch has not closed the hole, or it has closed it by breaking something a real customer relies on. The failures above say which."}
      </p>
    </Window>
  );
}
