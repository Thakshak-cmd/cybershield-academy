import { useState } from "react";
import { Window } from "./components/Window.jsx";
import { BreachDiagram } from "./components/BreachDiagram.jsx";
import { Icon } from "./components/Icon.jsx";
import { api } from "./api.js";
import "./AuthScreen.css";

/**
 * The title screen: sign in or enrol.
 *
 * Asks for a handle rather than an email, and says why. Participants are told
 * their identity is held separately from anything they do on the platform, so the
 * sign-up screen is the first place that promise has to be visibly kept.
 *
 * @param {{ onAuthenticated: (result: { handle: string, isStudyParticipant: boolean }) => void }} props
 */
export function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState(/** @type {"login"|"register"} */ ("login"));
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [studyCode, setStudyCode] = useState("");
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);

  const registering = mode === "register";

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.authenticate(mode, {
        handle,
        password,
        ...(registering && studyCode ? { studyCode } : {})
      });
      onAuthenticated(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="title">
      {/* The first screen anyone sees, so it establishes the world before asking
          for anything. The art is the same breach diagram the capstone uses,
          fully compromised and live -- the thing the learner will spend the
          session taking back. */}
      <section className="title__hero" aria-labelledby="title-name">
        <h1 id="title-name" className="title__name pixel">
          CyberShield <span>Academy</span>
        </h1>
        <p className="title__tag">
          It is three in the morning and Aurora Store is under attack. The night shift is you.
        </p>
        <div className="title__art" aria-hidden="true">
          <BreachDiagram compromised={["browser", "database", "session"]} secured={[]} attacking />
        </div>
        <ul className="title__skills">
          <li><Icon name="database" size={16} /> Stop injected queries</li>
          <li><Icon name="browser" size={16} /> Stop injected scripts</li>
          <li><Icon name="forgery" size={16} /> Stop forged requests</li>
        </ul>
        <p className="title__rule">Close every hole. Break nothing a real customer relies on.</p>
      </section>

    <div className="auth">
      <Window title={registering ? "New recruit" : "Sign in"}>
        <form className="auth__form" onSubmit={submit}>
          <p className="auth__intro">
            {registering
              ? "Aurora's blue team is short-handed. Pick a handle — not your name, not an email."
              : "Welcome back."}
          </p>

          <label className="field">
            <span className="label">Handle</span>
            <input
              className="field__input"
              value={handle}
              onChange={e => setHandle(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              required
            />
          </label>

          <label className="field">
            <span className="label">Password</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={registering ? "new-password" : "current-password"}
              required
            />
            {registering && (
              <span className="field__hint">
                At least 10 characters. Length beats punctuation — a short phrase works well.
              </span>
            )}
          </label>

          {registering && (
            <label className="field">
              <span className="label">Study code <span className="field__optional">optional</span></span>
              <input
                className="field__input"
                value={studyCode}
                onChange={e => setStudyCode(e.target.value)}
                spellCheck="false"
              />
              <span className="field__hint">
                Only if you were given one. It marks your activity as study data.
              </span>
            </label>
          )}

          {error && <p className="auth__error" role="alert">{error}</p>}

          <button className="auth__submit pixel" type="submit" disabled={busy}>
            <span className="cmd__caret">▸</span>
            {busy ? "Working…" : registering ? "Enlist" : "Sign in"}
          </button>

          <button
            type="button"
            className="auth__switch"
            onClick={() => { setMode(registering ? "login" : "register"); setError(null); }}
          >
            {registering ? "Already have a handle? Sign in" : "New here? Create a handle"}
          </button>
        </form>
      </Window>

      <p className="auth__privacy">
        Your handle is the only thing we store about you. Everything you do on the
        platform is recorded against a random identifier that is not derived from it.
      </p>
    </div>
    </div>
  );
}
