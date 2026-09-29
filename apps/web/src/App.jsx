import { useEffect, useState } from "react";
import { ChallengeScreen } from "./ChallengeScreen.jsx";
import { ProgressScreen } from "./ProgressScreen.jsx";
import { BossScreen } from "./BossScreen.jsx";
import { AuthScreen } from "./AuthScreen.jsx";
import { HomeScreen } from "./HomeScreen.jsx";
import { Link, useRoute } from "./useRoute.jsx";
import { PALETTES, usePalette } from "./usePalette.js";
import { Icon } from "./components/Icon.jsx";
import { setSoundEnabled, soundEnabled } from "./sound.js";
import { api } from "./api.js";
import "./App.css";

export function App() {
  const [live, setLive] = useState(/** @type {boolean|null} */ (null));
  const [session, setSession] = useState(
    /** @type {{ handle: string, isStudyParticipant: boolean }|null} */ (null)
  );
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const [path, navigate] = useRoute();

  const { palette, setPalette, following, pinned } =
    usePalette({ isStudyParticipant: !!session?.isStudyParticipant });

  useEffect(() => {
    (async () => {
      const isLive = await api.connect();
      setLive(isLive);

      // Offline means fixture data and no real accounts, so the sign-in screen
      // would be a dead end -- there is nothing to sign in to.
      if (!isLive) {
        setSession({ handle: "guest", isStudyParticipant: false });
      } else if (api.hasToken()) {
        try {
          setSession(await api.me());
        } catch {
          // Expired or rejected: clear it rather than looping on a bad token.
          api.clearToken();
        }
      }
      setReady(true);
    })();
  }, []);

  async function signOut() {
    await api.logout();
    setSession(null);
  }

  if (!ready) return <div className="boot label">Starting up…</div>;

  return (
    <>
      <header className="chrome">
        <span className="chrome__mark pixel">CyberShield Academy</span>
        <span className="chrome__sep">/</span>
        <span className="label">
          {session ? `Aurora Store · ${session.handle}` : "Aurora Store · Blue Team"}
        </span>

        {session && (
          <nav className="chrome__nav" aria-label="Sections">
            <Link to="/" navigate={navigate}
                  className={path === "/" ? "navlink navlink--on" : "navlink"}>
              Briefing
            </Link>
            <Link to="/assignment" navigate={navigate}
                  className={path === "/assignment" ? "navlink navlink--on" : "navlink"}>
              Assignment
            </Link>
            <Link to="/progress" navigate={navigate}
                  className={path === "/progress" ? "navlink navlink--on" : "navlink"}>
              Progress
            </Link>
            <Link to="/boss" navigate={navigate}
                  className={path === "/boss" ? "navlink navlink--on" : "navlink"}>
              The Aurora Breach
            </Link>
          </nav>
        )}
        {live === false && (
          <span className="offline label" title="Start the API to score against the real validator">
            offline · fixture data
          </span>
        )}
        {session?.isStudyParticipant && <span className="study label">study participant</span>}

        <div className="chrome__right">
          {!pinned && (
            <nav className="chrome__switch" aria-label="Appearance">
              <button
                className={following ? "swatch swatch--on" : "swatch"}
                onClick={() => setPalette(null)}
                aria-pressed={following}
                title="Follow the system setting"
              >
                Auto
              </button>
              {PALETTES.map(p => (
                <button
                  key={p.id}
                  className={!following && p.id === palette ? "swatch swatch--on" : "swatch"}
                  onClick={() => setPalette(p.id)}
                  aria-pressed={!following && p.id === palette}
                  title={`${p.note} · ${p.scheme}`}
                >
                  {p.name}
                </button>
              ))}
            </nav>
          )}
          {/* Pinned off for study participants, like the palette: one participant
              hearing cues another did not would be a variable in the study. */}
          {!pinned && (
            <button
              className={sound ? "swatch swatch--icon swatch--on" : "swatch swatch--icon"}
              onClick={() => { setSoundEnabled(!sound); setSound(!sound); }}
              aria-pressed={sound}
              aria-label={sound ? "Sound on" : "Sound off"}
              title={sound ? "Sound on" : "Sound off"}
            >
              <Icon name={sound ? "soundOn" : "soundOff"} size={15} />
            </button>
          )}
          {session && live && (
            <button className="swatch" onClick={signOut}>Sign out</button>
          )}
        </div>
      </header>

      {/* Keyed on the route so each screen enters rather than swapping in place.
          One short movement, not a choreography -- navigation happens constantly
          and anything longer becomes a delay. */}
      <main className="route" key={session ? path : "signin"}>
        {!session ? (
          <AuthScreen onAuthenticated={setSession} />
        ) : path === "/assignment" ? (
          <ChallengeScreen />
        ) : path === "/progress" ? (
          <ProgressScreen onOpenChallenge={() => navigate("/assignment")} />
        ) : path === "/boss" ? (
          <BossScreen onLeave={() => navigate("/progress")} />
        ) : (
          // Anything unrecognised lands on the briefing, the one screen that
          // always makes sense to arrive at.
          <HomeScreen
            handle={session.handle}
            onTakeTicket={() => navigate("/assignment")}
            onOpenCapstone={() => navigate("/boss")}
            onOpenProgress={() => navigate("/progress")}
          />
        )}
      </main>
    </>
  );
}
