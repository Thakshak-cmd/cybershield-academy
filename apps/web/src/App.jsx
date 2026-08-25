import { useEffect, useState } from "react";
import { ChallengeScreen } from "./ChallengeScreen.jsx";
import { api } from "./api.js";
import "./App.css";

const PALETTES = [
  { id: "nightwatch", name: "Nightwatch", note: "night shift, operations room" },
  { id: "vellum", name: "Vellum", note: "a case file on a desk" }
];

/**
 * The palette switcher is a temporary reviewing aid, not a product feature.
 * Once a palette is chosen the other is deleted and this comes out with it.
 */
export function App() {
  const [palette, setPalette] = useState("nightwatch");
  const [live, setLive] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-palette", palette);
  }, [palette]);

  useEffect(() => { api.connect().then(setLive); }, []);

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

        <div className="chrome__switch">
          <span className="label">palette</span>
          {PALETTES.map(p => (
            <button
              key={p.id}
              className={p.id === palette ? "swatch swatch--on pixel" : "swatch pixel"}
              onClick={() => setPalette(p.id)}
              title={p.note}
            >
              {p.name}
            </button>
          ))}
        </div>
      </header>
      <ChallengeScreen />
    </>
  );
}
