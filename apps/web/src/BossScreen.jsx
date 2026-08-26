import { useEffect, useRef, useState } from "react";
import { Window, Pips } from "./components/Window.jsx";
import { BreachDiagram } from "./components/BreachDiagram.jsx";
import { api } from "./api.js";
import "./BossScreen.css";

/**
 * The capstone encounter.
 *
 * Three files, three different bugs, one incident. All three are on screen at
 * once on purpose: the lesson is that the technique which closes one does
 * nothing for the others, and that only lands if the learner can see them
 * together and get a partial result.
 */
export function BossScreen({ bossId = "sec-900", onLeave }) {
  const [boss, setBoss] = useState(/** @type {any} */ (null));
  const [sources, setSources] = useState(/** @type {Record<string, string>} */ ({}));
  const [active, setActive] = useState(/** @type {string|null} */ (null));
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const openedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    api.boss(bossId)
      .then(d => {
        if (cancelled) return;
        setBoss(d.boss);
        setSources(Object.fromEntries(d.boss.stages.map(s => [s.id, s.vulnerable])));
        setActive(d.boss.stages[0]?.id ?? null);
        openedAt.current = Date.now();
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [bossId]);

  async function deploy() {
    if (busy || !boss) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.bossAttempt(boss.id, sources, Date.now() - openedAt.current));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !boss) return <p className="boss__error">{error}</p>;
  if (!boss) return <div className="boss__loading label">Reading the incident report…</div>;

  const stageResult = id => result?.stages?.find(s => s.stageId === id);

  // Before the first submission nothing is known to be safe, and the honest
  // picture of an unexamined breach is that all of it is still open.
  const compromised = result
    ? result.compromised
    : boss.stages.map(s => s.component);
  const secured = result ? result.secured : [];

  const held = result ? result.secured.length : 0;
  const activeStage = boss.stages.find(s => s.id === active);
  const activeResult = active ? stageResult(active) : null;

  return (
    <div className="boss">
      <Window
        title={boss.title}
        tone={result?.passed ? "secure" : "breach"}
        badge={<span className="label">{boss.repo} · capstone</span>}
      >
        <div className="boss__head">
          <p className="boss__brief">{boss.brief}</p>
          <BreachDiagram
            compromised={compromised}
            secured={secured}
            attacking={!result?.passed}
          />
        </div>
      </Window>

      <div className="boss__stages">
        {boss.stages.map(stage => {
          const r = stageResult(stage.id);
          const tone = !r ? "default" : r.passed ? "secure" : "breach";
          return (
            <button
              key={stage.id}
              className={`stagecard stagecard--${tone}${stage.id === active ? " stagecard--on" : ""}`}
              onClick={() => setActive(stage.id)}
            >
              <span className="stagecard__skill label">{stage.skill}</span>
              <span className="stagecard__title">{stage.title}</span>
              <span className="stagecard__state label">
                {!r ? "not checked" : r.passed ? "held" : "still open"}
              </span>
            </button>
          );
        })}
      </div>

      {activeStage && (
        <div className="boss__work">
          <Window
            title={activeStage.file}
            badge={<span className="label">{activeStage.skill}</span>}
          >
            <p className="stage__brief">{activeStage.brief}</p>
          </Window>

          <Window title="Your patch" badge={<span className="label">editable</span>} flush>
            <textarea
              className="editor"
              value={sources[activeStage.id] ?? ""}
              spellCheck="false"
              aria-label={`Patch for ${activeStage.file}`}
              onChange={e => {
                setSources(s => ({ ...s, [activeStage.id]: e.target.value }));
                setResult(null);
              }}
            />
          </Window>

          {activeResult && (
            <Window
              title="This stage"
              tone={activeResult.passed ? "secure" : "breach"}
            >
              <div className="stage__suites">
                <Suite label="Attack suite" bucket={activeResult.security} />
                <Suite label="Functional suite" bucket={activeResult.functional} />
              </div>
            </Window>
          )}
        </div>
      )}

      <Window title="Commands">
        <div className="boss__commands">
          <button className="cmd cmd--primary pixel" onClick={deploy} disabled={busy}>
            <span className="cmd__caret">▸</span>
            {busy ? "Checking all three…" : "Deploy all patches"}
          </button>
          <button className="cmd pixel" onClick={onLeave}>
            <span className="cmd__caret">▸</span>
            Withdraw
          </button>
          <span className="boss__tally pixel">
            {result ? `${held} of ${boss.stages.length} held` : "nothing checked yet"}
          </span>
        </div>
        {error && <p className="boss__error">{error}</p>}
        {result && !result.passed && (
          <p className="boss__note">
            A stage that is still open is not a mistake in the others. These are three
            different bugs — closing one says nothing about the rest.
          </p>
        )}
        {result?.passed && (
          <p className="boss__note boss__note--won">
            All three closed. The chain breaks anywhere you cut it, and you cut it
            everywhere.
          </p>
        )}
      </Window>
    </div>
  );
}

function Suite({ label, bucket }) {
  return (
    <div className="stage__suite">
      <span className="label">{label}</span>
      <Pips total={bucket.total} filled={bucket.passed} />
      {bucket.results.filter(r => !r.pass).map(r => (
        <span key={r.id} className="stage__fail">
          <code>{r.id}</code>
          {r.evidence && <span className="stage__why">{r.evidence}</span>}
        </span>
      ))}
    </div>
  );
}
