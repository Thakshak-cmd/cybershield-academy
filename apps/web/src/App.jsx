import { useEffect, useState } from "react";
import { ChallengeScreen } from "./ChallengeScreen.jsx";
import { PALETTES, usePalette } from "./usePalette.js";
import { api } from "./api.js";
import "./App.css";

export function App() {
  const [live, setLive] = useState(null);
  const [isStudyParticipant, setIsStudyParticipant] = useState(false);

  const { palette, setPalette, following, pinned } = usePalette({ isStudyParticipant });

  useEffect(() => {
    api.connect().then(setLive);
    setIsStudyParticipant(api.isStudyParticipant());
  }, []);

  return (
    <>
      <header className="chrome">
        <span className="chrome__mark pixel">CyberShield Academy</span>
        <span className="chrome__sep">/</span>
        <span className="label">Aurora Store · Blue Team</span>
        {live === false && (
          <span className="offline label" title="Start the API to score against the real validator">
            offline · fixture data
          </span>
        )}

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
      </header>
      <ChallengeScreen />
    </>
  );
}
