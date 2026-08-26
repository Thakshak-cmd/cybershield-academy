import "./Portrait.css";

/**
 * Character portraits.
 *
 * These were two letters in a box, which read as a placeholder because it was
 * one. Aurora's staff are the only people in the fiction — every ticket arrives
 * from one of them — so leaving them as initials meant the narrative framing had
 * no faces in it at all.
 *
 * Drawn as flat shapes rather than shaded illustration: it holds up at 56px,
 * takes its colours from the palette tokens, and stays legible in both. Each
 * character is distinguished by silhouette first — hair shape and shoulders —
 * because that is what reads at this size, not features.
 */

/** @type {Record<string, { hair: string[], accent?: string[], tone: string }>} */
const FACES = {
  /** Support. Long hair, headset. */
  priya: {
    tone: "warm",
    hair: [
      "M12 20c0-7 5-11 12-11s12 4 12 11v6c0 2-1 3-2 3v-6c-3 1-7-1-10-3-2 3-6 5-10 5v4c-1 0-2-1-2-3z",
      "M13 26v10c0 2 1 4 3 5M35 26v10c0 2-1 4-3 5"
    ],
    accent: ["M11 24a4 4 0 0 1 0 6", "M37 24a4 4 0 0 0 0 6", "M37 30v4h-5"]
  },
  /** QA. Short crop, glasses. */
  dan: {
    tone: "cool",
    hair: ["M13 22c0-8 4-12 11-12s11 4 11 12v2c-2-4-4-6-7-6-4 0-6 3-8 3s-4-1-5-2z"],
    accent: ["M16 25h6M26 25h6M22 26h4"]
  },
  /** Incident response. Cap. */
  marcus: {
    tone: "warm",
    hair: ["M11 22c0-7 5-12 13-12s13 5 13 12H11z", "M11 22h28l4 3H8z"]
  },
  /** The learner. Deliberately the plainest silhouette. */
  you: {
    tone: "cool",
    hair: ["M14 22c0-7 4-11 10-11s10 4 10 11v3c-2-3-5-5-10-5s-8 2-10 5z"]
  }
};

/**
 * Which face belongs to a name from the content.
 * Falls back to the learner's own silhouette rather than to nothing.
 */
function faceFor(name = "") {
  const key = name.toLowerCase();
  if (key.includes("priya")) return "priya";
  if (key.includes("dan")) return "dan";
  if (key.includes("marcus")) return "marcus";
  return "you";
}

/**
 * @param {{ name?: string, size?: number, role?: string }} props
 */
export function Portrait({ name = "", size = 56, role }) {
  const face = FACES[faceFor(name)];
  const label = name.replace(/\(.*\)/, "").trim() || "You";
  const subtitle = role ?? (name.match(/\((.*)\)/)?.[1] ?? "");

  return (
    <figure className="portrait">
      <div className="portrait__frame" style={{ width: size, height: size }}>
        <svg viewBox="0 0 48 48" width={size} height={size} role="img"
             aria-label={`Portrait of ${label}`}>
          {/* Shoulders, behind everything. */}
          <path className="portrait__body" d="M6 48c0-9 7-14 18-14s18 5 18 14z" />
          {/* Head. */}
          <ellipse className={`portrait__skin portrait__skin--${face.tone}`}
                   cx="24" cy="24" rx="11" ry="12.5" />
          {/* Eyes, as marks rather than features. */}
          <path className="portrait__eyes" d="M19.5 24h1.6M26.9 24h1.6" />
          {/* Hair or headwear, which is what actually distinguishes them. */}
          <g className="portrait__hair">
            {face.hair.map((d, i) => <path key={i} d={d} />)}
          </g>
          {face.accent && (
            <g className="portrait__accent">
              {face.accent.map((d, i) => <path key={i} d={d} />)}
            </g>
          )}
        </svg>
      </div>
      <figcaption className="portrait__caption">
        <span className="portrait__name">{label}</span>
        {subtitle && <span className="portrait__role label">{subtitle}</span>}
      </figcaption>
    </figure>
  );
}
