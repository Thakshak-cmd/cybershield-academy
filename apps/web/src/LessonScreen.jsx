import { useEffect, useRef, useState } from "react";
import { Window } from "./components/Window.jsx";
import { Portrait } from "./components/Portrait.jsx";
import { Demo } from "./components/Demos.jsx";
import { api } from "./api.js";
import "./LessonScreen.css";

const STEPS = ["Theory", "See it", "Guided fix", "Check"];

/**
 * A briefing file: theory, a live demonstration, a guided fix, and a check.
 *
 * Taken once before a skill's first ticket, then filed in the field manual to
 * reread. The order is the pedagogy -- explain, show, do it together, recall --
 * so on a first read the steps open in turn; on a reread they are all open.
 * The server holds the answers and decides when the lesson counts as finished,
 * so the interface cannot be the thing that lets a step be skipped.
 *
 * @param {{ lessonId: string, onDone: () => void, doneLabel?: string }} props
 */
export function LessonScreen({ lessonId, onDone, doneLabel }) {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [practiceDone, setPracticeDone] = useState(false);
  const [answered, setAnswered] = useState(/** @type {Record<string, any>} */ ({}));
  const [busy, setBusy] = useState(false);
  const openedAt = useRef(Date.now());
  const top = useRef(/** @type {HTMLDivElement|null} */ (null));

  useEffect(() => {
    let cancelled = false;
    api.lesson(lessonId)
      .then(d => {
        if (cancelled) return;
        setData(d);
        setPracticeDone(!!d.practice?.done);
        if (d.completed) setReached(STEPS.length - 1);
        openedAt.current = Date.now();
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [lessonId]);

  if (error && !data) return <p className="lesson__error">{error}</p>;
  if (!data) return <div className="lesson__loading label">Opening the briefing file…</div>;

  const { lesson, completed } = data;
  const allAnswered = lesson.check.every(q => answered[q.id]);
  const canFile = completed || (practiceDone && allAnswered);

  function go(i) {
    setStep(i);
    setReached(r => Math.max(r, i));
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function file() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.completeLesson(lesson.id, Date.now() - openedAt.current);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lesson" ref={top}>
      <Window
        title={`Briefing file · ${lesson.title}`}
        badge={<span className="label">{completed ? "filed · reread" : "required before your first ticket"}</span>}
      >
        <div className="lesson__head">
          <Portrait name={lesson.from} />
          <p className="lesson__opener">&ldquo;{lesson.opener}&rdquo;</p>
        </div>

        <nav className="lesson__steps" aria-label="Briefing steps">
          {STEPS.map((name, i) => (
            <button
              key={name}
              className={`lesson__step${i === step ? " lesson__step--on" : ""}${i < reached || (i === 3 && canFile) ? " lesson__step--done" : ""}`}
              onClick={() => go(i)}
              disabled={i > reached}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="pixel">{i + 1}</span> {name}
            </button>
          ))}
        </nav>
      </Window>

      {step === 0 && (
        <Window title="Theory">
          <div className="theory">
            {lesson.theory.map(section => (
              <section key={section.heading} className="theory__section">
                <h2 className="theory__heading">{section.heading}</h2>
                {section.paragraphs.map((p, i) => <p key={i} className="theory__p">{p}</p>)}
                {section.code && <pre className="theory__code">{section.code}</pre>}
              </section>
            ))}
          </div>
          <Next onClick={() => go(1)}>See it happen</Next>
        </Window>
      )}

      {step === 1 && (
        <Window title="See it happen">
          <Demo kind={lesson.demo} />
          <Next onClick={() => go(2)}>Fix one with Marcus</Next>
        </Window>
      )}

      {step === 2 && (
        <Guided
          lesson={lesson}
          done={practiceDone}
          onDone={() => setPracticeDone(true)}
          onNext={() => go(3)}
        />
      )}

      {step === 3 && (
        <Window title="Quick check" badge={<span className="label">not scored</span>}>
          <div className="check">
            {lesson.check.map(q => (
              <Question
                key={q.id}
                lessonId={lesson.id}
                question={q}
                result={answered[q.id]}
                onAnswered={r => setAnswered(a => ({ ...a, [q.id]: r }))}
              />
            ))}
          </div>
          {error && <p className="lesson__error">{error}</p>}
          <div className="lesson__file">
            <button className="cmd cmd--primary pixel" onClick={file} disabled={!canFile || busy}>
              <span className="cmd__caret">▸</span>
              {busy ? "Filing…" : doneLabel ?? (completed ? "Back to the manual" : "File it in the manual and take the ticket")}
            </button>
            {!canFile && (
              <span className="label lesson__hint">
                {!practiceDone ? "Finish the guided fix first." : "Answer both questions to file it."}
              </span>
            )}
          </div>
        </Window>
      )}
    </div>
  );
}

/**
 * The faded worked example. Marcus has made the first move; the learner makes
 * the rest, scored by the same validator as a ticket.
 */
function Guided({ lesson, done, onDone, onNext }) {
  const [source, setSource] = useState(lesson.guided.start);
  const [verdict, setVerdict] = useState(/** @type {any} */ (null));
  const [canReveal, setCanReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  async function check() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api.practiseLesson(lesson.id, source);
      setVerdict(v);
      setCanReveal(v.canReveal);
      if (v.passed) onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    setBusy(true);
    try {
      const { solution } = await api.revealLesson(lesson.id);
      setSource(solution);
      setVerdict({ revealed: true });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const failures = verdict && !verdict.passed && !verdict.revealed
    ? [...(verdict.security?.results ?? []), ...(verdict.functional?.results ?? [])].filter(r => !r.pass)
    : [];

  return (
    <Window title="Guided fix" badge={<span className="label">{lesson.guided.file}</span>}>
      <p className="guided__brief">{lesson.guided.brief}</p>
      <ol className="guided__steps">
        {lesson.guided.steps.map((s, i) => (
          <li key={i} className={i === 0 ? "guided__step guided__step--done" : "guided__step"}>
            <span className="label">{i === 0 ? "Marcus" : "You"}</span> {s}
          </li>
        ))}
      </ol>
      <textarea
        className="editor guided__editor"
        value={source}
        onChange={e => setSource(e.target.value)}
        spellCheck={false}
        aria-label={`Patch for ${lesson.guided.file}`}
        rows={Math.max(8, source.split("\n").length + 1)}
      />

      {verdict?.passed && (
        <p className="guided__result guided__result--good">
          That holds. Both suites pass: the attack is stopped and the route still does its job.
        </p>
      )}
      {verdict?.revealed && (
        <p className="guided__result">
          Here's the finished fix. Compare it with where you got to; the ticket will ask for the same move.
        </p>
      )}
      {verdict?.parseError && (
        <p className="guided__result guided__result--bad">That doesn't parse: {verdict.parseError.message}</p>
      )}
      {failures.length > 0 && (
        <ul className="rules guided__fails">
          {failures.map(r => (
            <li key={r.id} className="rule rule--fail">
              <span className="rule__mark">✕</span>
              <span>
                <span className="rule__id">{r.describe ?? r.id}</span>
                {r.evidence && <span className="rule__why">{r.evidence}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="lesson__error">{error}</p>}

      <div className="guided__actions">
        {!done && (
          <button className="cmd cmd--primary pixel" onClick={check} disabled={busy}>
            <span className="cmd__caret">▸</span> {busy ? "Checking…" : "Check it"}
          </button>
        )}
        {!done && canReveal && (
          <button className="cmd pixel" onClick={reveal} disabled={busy}>
            <span className="cmd__caret">▸</span> Show me
          </button>
        )}
        {done && <Next onClick={onNext}>On to the check</Next>}
      </div>
    </Window>
  );
}

function Question({ lessonId, question, result, onAnswered }) {
  const [busy, setBusy] = useState(false);

  async function answer(choice) {
    if (busy || result) return;
    setBusy(true);
    try {
      onAnswered({ choice, ...(await api.checkLesson(lessonId, question.id, choice)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="question" disabled={!!result || busy}>
      <legend className="question__text">{question.question}</legend>
      {question.options.map(o => {
        const picked = result?.choice === o.id;
        const isAnswer = result && result.answer === o.id;
        return (
          <button
            key={o.id}
            type="button"
            className={`question__option${picked ? " question__option--picked" : ""}${isAnswer ? " question__option--answer" : ""}${picked && !result.correct ? " question__option--wrong" : ""}`}
            onClick={() => answer(o.id)}
          >
            {o.text}
          </button>
        );
      })}
      {result && (
        <p className={result.correct ? "question__why question__why--good" : "question__why question__why--bad"}>
          {result.explanation}
          {result.answerExplanation && <span className="question__answer"> {result.answerExplanation}</span>}
        </p>
      )}
    </fieldset>
  );
}

function Next({ onClick, children }) {
  return (
    <div className="lesson__next">
      <button className="cmd pixel" onClick={onClick}>
        <span className="cmd__caret">▸</span> {children}
      </button>
    </div>
  );
}

