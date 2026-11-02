import { useEffect, useRef, useState } from "react";
import { Window, Pips } from "./components/Window.jsx";
import { Reward } from "./components/Reward.jsx";
import { Portrait } from "./components/Portrait.jsx";
import { DiffView } from "./components/DiffView.jsx";
import { PostureGauge } from "./components/PostureGauge.jsx";
import { LessonScreen } from "./LessonScreen.jsx";
import { BreakScreen, ThanksScreen } from "./Interludes.jsx";
import { play } from "./sound.js";
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
/** @param {{ onLeave?: () => void }} [props] */
export function ChallengeScreen({ onLeave } = {}) {
  const [challenge, setChallenge] = useState(/** @type {Challenge|null} */ (null));
  const [reason, setReason] = useState("");
  const [mastery, setMastery] = useState(/** @type {Record<string, number>} */ ({}));
  const [patch, setPatch] = useState("");
  const [picked, setPicked] = useState(/** @type {number[]} */ ([]));
  const [verdict, setVerdict] = useState(/** @type {Verdict|null} */ (null));
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(/** @type {string[]} */ ([]));
  const [decision, setDecision] = useState(/** @type {"approve"|"reject"|null} */ (null));
  const [rejectReason, setRejectReason] = useState(/** @type {string|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  /**
   * The lesson flow ahead of a skill's first ticket: an optional break, the
   * lesson, then (after the last lesson) a thank-you, then the ticket.
   *
   * @type {[{ stage: "break"|"lesson"|"thanks", lessonId: string, next: any,
   *           filed: { title: string }[], total: number }|null, Function]}
   */
  const [briefing, setBriefing] = useState(/** @type {any} */ (null));
  const [filedNote, setFiledNote] = useState(/** @type {string|null} */ (null));
  const openedAt = useRef(Date.now());

  /**
   * Fetch whatever the adaptive layer serves next and reset the screen for it.
   *
   * If this is the learner's first ticket in a skill, the server says which
   * briefing is due and the lesson comes first. The recommendation is kept and
   * opened afterwards, so the ticket that follows the lesson is the one the
   * model chose -- follow-through is unaffected.
   */
  async function load(isCancelled = () => false) {
    const next = await api.next();
    if (isCancelled() || !next.challenge) return;
    if (next.lesson) {
      // A break before every lesson but the first: the first follows the
      // welcome, which is pause enough.
      const { lessons } = await api.lessons().catch(() => ({ lessons: [] }));
      if (isCancelled()) return;
      const filed = lessons.filter(l => l.completed).map(l => ({ title: l.title }));
      setBriefing({
        stage: filed.length ? "break" : "lesson",
        lessonId: next.lesson.id, next, filed, total: lessons.length || 3
      });
      return;
    }
    await open(next, isCancelled);
  }

  /** @param {any} next */
  async function open(next, isCancelled = () => false) {
    const started = await api.start(next.challenge.id);
    if (isCancelled()) return;
    setChallenge(next.challenge);
    setReason(next.reason);
    setMastery(next.mastery || {});
    setPatch(next.challenge.vulnerable);
    setHints(started.hints ?? []);
    openedAt.current = Date.now();
  }

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, []);

  const isSpot = challenge?.format === "spot";
  const isReview = challenge?.format === "review";
  const isHarden = challenge?.format === "harden";

  async function deploy() {
    if (!challenge || busy) return;
    if (isSpot && picked.length === 0) {
      setError("Choose a line first.");
      return;
    }
    if (isReview && !decision) {
      setError("Approve the change, or request changes.");
      return;
    }
    if (isReview && decision === "reject" && !rejectReason) {
      setError("Say what is wrong with it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const submission = isSpot ? picked
        : isReview && decision
          ? { decision, reason: decision === "reject" ? (rejectReason ?? undefined) : undefined }
          : patch;
      const result = await api.attempt(challenge.id, submission, Date.now() - openedAt.current);
      setVerdict(result);
      play(result.passed ? (result.newBadges?.length ? "badge" : "solve") : "fail",
           { pinnedOff: api.isStudyParticipant() });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Reset for whatever the adaptive layer serves next, without a page reload. */
  async function nextAssignment() {
    setVerdict(null);
    setFiledNote(null);
    setPicked([]);
    setDecision(null);
    setRejectReason(null);
    setChallenge(null);
    await load();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Hints come from the server, which records that one was taken. */
  async function takeHint() {
    if (!challenge || hints.length >= (challenge.hintCount ?? 0)) return;
    try {
      const r = await api.takeHint(challenge.id, hints.length);
      setHints(r.hints);
      play("hint", { pinnedOff: api.isStudyParticipant() });
    } catch (err) {
      setError(err.message);
    }
  }

  async function toTicket(next) {
    setBriefing(null);
    await open(next);
    window.scrollTo({ top: 0 });
  }

  if (briefing?.stage === "break") {
    return (
      <BreakScreen
        filed={briefing.filed}
        upcoming={briefing.next.lesson}
        total={briefing.total}
        onStart={() => setBriefing({ ...briefing, stage: "lesson" })}
        onLeave={onLeave}
      />
    );
  }

  if (briefing?.stage === "thanks") {
    return <ThanksScreen onContinue={() => toTicket(briefing.next)} onLeave={onLeave} />;
  }

  if (briefing) {
    return (
      <LessonScreen
        lessonId={briefing.lessonId}
        onDone={async (/** @type {{ xpAwarded?: number, reread?: boolean }} */ result = {}) => {
          const filedNow = briefing.filed.length + (result.reread ? 0 : 1);
          setFiledNote(result.xpAwarded
            ? `Briefing filed in the field manual · +${result.xpAwarded} XP`
            : "Briefing filed in the field manual");
          // After the last lesson, the author's thank-you -- but never to a
          // study participant, for whom it would read as the end of the session.
          if (filedNow >= briefing.total && !api.isStudyParticipant()) {
            setBriefing({ ...briefing, stage: "thanks" });
            window.scrollTo({ top: 0 });
            return;
          }
          await toTicket(briefing.next);
        }}
      />
    );
  }

  if (!challenge) {
    return <div className="loading label">Loading assignment…</div>;
  }

  const attacksRepelled = verdict ? verdict.security.passed : 0;
  const attacksTotal = verdict ? verdict.security.total : challenge.attackCount;
  const funcPassing = verdict ? verdict.functional.passed : 0;
  const funcTotal = verdict ? verdict.functional.total : challenge.functionalCount;

  // What a screen-reader user hears when the verdict lands. Kept in a region
  // that is always on the page, so the change of text is what gets announced.
  const announcement = !verdict ? ""
    : verdict.passed ? `Hole closed. ${verdict.xpAwarded ?? 0} XP.${verdict.newBadges?.length ? ` ${verdict.newBadges.length} new commendation${verdict.newBadges.length > 1 ? "s" : ""}.` : ""}`
    : verdict.parseError ? "That doesn't parse. Check the syntax and deploy again."
    : `${(FAILURE_COPY[challenge.format ?? "patch"] ?? FAILURE_COPY.patch)[0]}. ` +
      `${verdict.security.passed} of ${verdict.security.total} attacks repelled, ` +
      `${verdict.functional.passed} of ${verdict.functional.total} checks passing.`;

  return (
    <div className="screen">
      <p className="visually-hidden" aria-live="polite">{announcement}</p>
      {filedNote && <p className="filed-note" role="status">{filedNote}</p>}
      <Window
        as="span"
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
          {isSpot ? (
            <Window
              title="Point at the flaw"
              badge={<span className="label">
                pick {challenge.flawedCount ?? 1} line{(challenge.flawedCount ?? 1) === 1 ? "" : "s"}
              </span>}
              flush
            >
              <CodeBlock
                source={challenge.vulnerable}
                picked={picked}
                onPick={n => {
                  setVerdict(null);
                  setError(null);
                  setPicked(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);
                }}
              />
            </Window>
          ) : isReview ? (
            <>
              <Window
                title={`Pull request from ${(challenge.prAuthor ?? "a teammate").replace(/\s*\(.*\)/, "")}`}
                badge={<span className="label">{challenge.file}</span>}
                flush
              >
                <DiffView before={challenge.vulnerable} after={challenge.proposed ?? ""} />
              </Window>

              <Window title="Your review">
                <fieldset className="review">
                  <legend className="visually-hidden">Your decision</legend>
                  <label className={decision === "approve" ? "review__choice review__choice--on" : "review__choice"}>
                    <input type="radio" name="decision" checked={decision === "approve"}
                           onChange={() => { setDecision("approve"); setVerdict(null); setError(null); }} />
                    <span className="pixel">Approve and merge</span>
                  </label>
                  <label className={decision === "reject" ? "review__choice review__choice--on" : "review__choice"}>
                    <input type="radio" name="decision" checked={decision === "reject"}
                           onChange={() => { setDecision("reject"); setVerdict(null); setError(null); }} />
                    <span className="pixel">Request changes</span>
                  </label>
                </fieldset>

                {decision === "reject" && (
                  <fieldset className="review__reasons">
                    <legend className="label">What is wrong with it?</legend>
                    {(challenge.reasons ?? []).map(r => (
                      <label key={r.id} className={rejectReason === r.id ? "reason reason--on" : "reason"}>
                        <input type="radio" name="reason" checked={rejectReason === r.id}
                               onChange={() => { setRejectReason(r.id); setVerdict(null); setError(null); }} />
                        <span>{r.text}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </Window>
            </>
          ) : (
            <>
              <Window title={isHarden ? "The configuration as it stands" : "The code as it stands"} tone="quiet" flush>
                <CodeBlock source={challenge.vulnerable} />
              </Window>

              <Window title={isHarden ? "Your configuration" : "Your patch"}
                      badge={<span className="label">editable</span>} flush>
                <textarea
                  className="editor"
                  value={patch}
                  spellCheck="false"
                  onChange={e => { setPatch(e.target.value); setVerdict(null); }}
                  aria-label={isHarden ? "Your configuration" : "Your patch"}
                />
              </Window>
            </>
          )}
        </div>

        <aside className="stage__side">
          {!verdict && <SuitesTip />}
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
                  {busy ? "Checking…"
                    : isSpot ? "That's the one"
                    : isReview ? "Submit review"
                    : isHarden ? "Apply configuration"
                    : "Deploy patch"}
                </button>
              </li>
              <li>
                <button className="cmd pixel" onClick={takeHint}
                        disabled={hints.length >= challenge.hintCount}
                        title="A hint costs XP, and a hinted solve does not count towards mastery">
                  <span className="cmd__caret">▸</span>
                  Ask for a hint
                  <span className="cmd__note label">
                    {challenge.hintCount - hints.length} left
                  </span>
                </button>
              </li>
            </menu>
            {error && <p className="error" role="alert">{error}</p>}
          </Window>

          <Window title="Field notes" tone="quiet">
            <p className="label reason">{reason}</p>
            <MasteryBar skill={challenge.skill} value={mastery[challenge.skill] ?? 0.15} />
            {hints.length > 0 && (
              <>
                <ol className="hints">
                  {hints.map((h, i) => <li key={i}>{h}</li>)}
                </ol>
                <p className="hints__cost label">
                  hinted solves earn less xp and do not move mastery
                </p>
              </>
            )}
          </Window>
        </aside>
      </div>

      {verdict?.passed ? (
        <Reward
          xp={verdict.xpAwarded ?? 0}
          badges={verdict.newBadges ?? []}
          firstAttempt={verdict.attemptNo === 1 && hints.length === 0}
          streak={verdict.streak ?? 0}
          onDone={nextAssignment}
        />
      ) : verdict ? (
        <Verdict verdict={verdict} format={challenge.format ?? "patch"} />
      ) : null}
    </div>
  );
}

/**
 * Code with line numbers. When `onPick` is given the lines become choosable,
 * which is the whole interaction for a spot item -- no editor, no typing, one
 * decision per line.
 *
 * @param {{ source: string, picked?: number[], onPick?: (line: number) => void }} props
 */
function CodeBlock({ source, picked = [], onPick }) {
  const lines = source.split("\n");
  const pickable = typeof onPick === "function";
  return (
    // Pickable lines are toggle buttons in a named group. A listbox would promise
    // arrow-key movement and single-tab-stop behaviour that this does not have;
    // buttons promise exactly what they do.
    <pre className={pickable ? "code code--pickable" : "code"} role={pickable ? "group" : undefined}
         aria-label={pickable ? "The code. Choose the line with the flaw." : undefined}>
      {lines.map((line, i) => {
        const n = i + 1;
        const on = picked.includes(n);
        const Tag = pickable ? "button" : "span";
        return (
          <Tag
            className={`code__line${on ? " code__line--picked" : ""}`}
            key={i}
            {...(pickable ? {
              type: "button",
              "aria-pressed": on,
              onClick: () => onPick(n)
            } : {})}
          >
            <span className="code__num">{n}</span>
            <span className="code__text">{line || " "}</span>
          </Tag>
        );
      })}
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
            <span className="visually-hidden">{r.pass ? "Passed: " : "Failed: "}</span>
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

/** What a failed attempt means, in the terms of the thing that was attempted. */
const FAILURE_COPY = {
  patch: ["Still exploitable",
    "The patch has not closed the hole, or it has closed it by breaking something a real customer relies on. The failures above say which."],
  harden: ["Still exposed",
    "The configuration still leaves a way in, or it closes one by breaking something the shop needs. The failures above say which."],
  spot: ["Not that line",
    "Read each wrong choice's note above -- it says why that line is sound. The flaw is where input stops being data."],
  review: ["Review not accepted",
    "Either the change is not what it seems, or the objection is not what is actually wrong with it. The notes above say which."]
};

/** @param {{ verdict: Verdict, format: string }} props */
function Verdict({ verdict, format }) {
  const [title, body] = FAILURE_COPY[format] ?? FAILURE_COPY.patch;
  const posture = verdict.posture;
  return (
    <Window tone="breach" title={title}>
      <div className="verdict__row">
        <p className="verdict">{body}</p>
        {/* The consequence: the company reacts to what shipped. Spot items never
            move it -- pointing at the wrong line leaves nothing open. */}
        {posture?.incident && (
          <div className="consequence">
            <PostureGauge score={posture.score} label={posture.label} size={120} />
            <p className="consequence__text">
              {posture.delta < 0
                ? `Aurora's posture fell by ${-posture.delta}. `
                : "Logged as an incident. "}
              The attacker still has a way in.
              <span className="consequence__hint"> It recovers as you close holes.</span>
            </p>
          </div>
        )}
      </div>
    </Window>
  );
}

/**
 * A one-time pointer to the two suites, on a learner's first ticket.
 *
 * The welcome explains them; this shows where they are, at the moment they
 * matter. Remembered per account in this browser: it is a reading aid, not
 * study data, and on a shared lab machine each participant's account still
 * sees it once. Storage can be unavailable, in which case it simply shows.
 */
function SuitesTip() {
  const key = `cybershield.tip.suites.${api.subject() ?? "guest"}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  if (dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(key, "1"); } catch { /* shows again next time; harmless */ }
    setDismissed(true);
  }

  return (
    <div className="tip" role="note">
      <p className="tip__text">
        <strong>Two checks, both must pass.</strong> The attack suite needs the attack to fail;
        the functional suite needs the shop to keep working. They run when you submit.
      </p>
      <button className="tip__dismiss" onClick={dismiss}>Got it</button>
    </div>
  );
}
