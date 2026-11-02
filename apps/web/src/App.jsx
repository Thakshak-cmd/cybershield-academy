import { useEffect, useRef, useState } from "react";
import { ChallengeScreen } from "./ChallengeScreen.jsx";
import { ProgressScreen } from "./ProgressScreen.jsx";
import { BossScreen } from "./BossScreen.jsx";
import { AuthScreen } from "./AuthScreen.jsx";
import { HomeScreen } from "./HomeScreen.jsx";
import { ManualScreen } from "./ManualScreen.jsx";
import { WelcomeScreen } from "./WelcomeScreen.jsx";
import { Link, useRoute } from "./useRoute.jsx";
import { PALETTES, usePalette } from "./usePalette.js";
import { Icon } from "./components/Icon.jsx";
import { setSoundEnabled, soundEnabled } from "./sound.js";
import { api } from "./api.js";
import "./App.css";

const SCREEN_TITLES = {
  "/": "Briefing",
  "/assignment": "Assignment",
  "/manual": "Field manual",
  "/progress": "Progress",
  "/boss": "The Aurora Breach",
  "/welcome": "How it works"
};

export function App() {
  const [live, setLive] = useState(/** @type {boolean|null} */ (null));
  const [session, setSession] = useState(
    /** @type {{ handle: string, isStudyParticipant: boolean, welcomed?: boolean }|null} */ (null)
  );
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const [path, navigate] = useRoute();
  const main = useRef(/** @type {HTMLElement|null} */ (null));
  const firstRoute = useRef(true);

  const { palette, setPalette, following, pinned } =
    usePalette({ isStudyParticipant: !!session?.isStudyParticipant });

  useEffect(() => {
    (async () => {
      const isLive = await api.connect();
      setLive(isLive);

      // Offline means fixture data and no real accounts, so the sign-in screen
      // would be a dead end -- there is nothing to sign in to.
      if (!isLive) {
        setSession({ handle: "guest", isStudyParticipant: false, welcomed: true });
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

  // Each screen gets its own document title, so a screen reader announces where
  // a navigation landed and the browser's history and tabs say something useful.
  // Focus moves to the new screen for the same reason; without it a screen
  // reader stays on the link that was clicked and the change goes unannounced.
  // A new account sees the welcome before anything else, wherever the address
  // bar points. Known only to the server, so it holds on any machine.
  const needsWelcome = !!session && session.welcomed === false;

  useEffect(() => {
    document.title = `${!session ? "Sign in" : needsWelcome ? "Welcome" : (SCREEN_TITLES[path] ?? "Briefing")} · CyberShield Academy`;
    if (firstRoute.current) { firstRoute.current = false; return; }
    main.current?.focus({ preventScroll: true });
  }, [path, !!session, needsWelcome]);

  async function signOut() {
    await api.logout();
    setSession(null);
    navigate("/");
  }

  /**
   * Signing in always starts at the briefing. It used to keep whatever the
   * address bar held, so signing out on the assignment screen -- or following
   * a link to it -- dropped the next sign-in straight into a lesson.
   */
  function signedIn(result) {
    setSession(result);
    navigate("/");
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

        {session && !needsWelcome && (
          <nav className="chrome__nav" aria-label="Sections">
            <Link to="/" navigate={navigate}
                  className={path === "/" ? "navlink navlink--on" : "navlink"}>
              Briefing
            </Link>
            <Link to="/assignment" navigate={navigate}
                  className={path === "/assignment" ? "navlink navlink--on" : "navlink"}>
              Assignment
            </Link>
            <Link to="/manual" navigate={navigate}
                  className={path === "/manual" ? "navlink navlink--on" : "navlink"}>
              Field manual
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
      <main className="route" key={!session ? "signin" : needsWelcome ? "welcome" : path} ref={main} tabIndex={-1}>
        {!session ? (
          <AuthScreen onAuthenticated={signedIn} />
        ) : needsWelcome ? (
          <WelcomeScreen
            handle={session.handle}
            onDone={() => { setSession({ ...session, welcomed: true }); navigate("/"); }}
          />
        ) : path === "/welcome" ? (
          <WelcomeScreen handle={session.handle} reread onDone={() => navigate("/")} />
        ) : path === "/assignment" ? (
          <ChallengeScreen onLeave={() => navigate("/")} />
        ) : path === "/manual" ? (
          <ManualScreen />
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
            onOpenWelcome={() => navigate("/welcome")}
          />
        )}
      </main>
    </>
  );
}
