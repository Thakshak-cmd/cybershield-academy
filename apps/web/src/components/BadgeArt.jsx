import "./BadgeArt.css";

/**
 * Badge emblems.
 *
 * Drawn at 64 rather than reusing the 18px glyphs scaled up. A line icon enlarged
 * looks like a line icon enlarged: the weight goes wrong and the empty space in
 * the middle becomes obvious. These carry a filled shield ground, a device on top
 * and a rim, which is what makes them read as something awarded rather than
 * something labelled.
 *
 * Still SVG and still `currentColor` for the device, so a badge takes its colour
 * from the state around it and works in both palettes.
 */

const SHIELD = "M32 4 L58 14 v20 c0 15-11 25-26 30 C17 59 6 49 6 34 V14 Z";

/** @type {Record<string, { device: string[], circles?: [number,number,number][] }>} */
const DEVICES = {
  patch: {
    // A seam stitched closed.
    device: ["M20 34 h24", "M24 28 v12", "M32 26 v16", "M40 28 v12"]
  },
  database: {
    device: [
      "M20 24c0-2.2 5.4-4 12-4s12 1.8 12 4-5.4 4-12 4-12-1.8-12-4Z",
      "M20 24v8c0 2.2 5.4 4 12 4s12-1.8 12-4v-8",
      "M20 32v8c0 2.2 5.4 4 12 4s12-1.8 12-4v-8"
    ]
  },
  browser: {
    device: ["M18 20h28v22H18z", "M18 26h28", "M28 32l-3 3 3 3", "M36 32l3 3-3 3"],
    circles: [[21, 23, 1], [24.5, 23, 1]]
  },
  forgery: {
    device: ["M17 32h13", "M26 27.5 30.5 32 26 36.5", "M36 21h11v22H36", "M38.5 27 44 37", "M44 27 38.5 37"]
  },
  star: {
    device: ["M32 18 L36.6 28.4 47 29.4 39 36.6 41.4 47 32 41.4 22.6 47 25 36.6 17 29.4 27.4 28.4 Z"]
  },
  crown: {
    device: ["M18 40h28", "M18 40 21 22l7 8 4-11 4 11 7-8 3 18"]
  }
};

/**
 * @param {{ art: string, earned?: boolean, size?: number, title?: string }} props
 */
export function BadgeArt({ art, earned = true, size = 64, title }) {
  const device = DEVICES[art] ?? DEVICES.patch;

  return (
    <svg
      className={`badgeart${earned ? " badgeart--earned" : " badgeart--locked"}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      <path className="badgeart__ground" d={SHIELD} />
      <path className="badgeart__rim" d={SHIELD} fill="none" />
      <g className="badgeart__device" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {device.device.map((d, i) => <path key={i} d={d} />)}
        {(device.circles || []).map(([cx, cy, r], i) => (
          <circle key={`c${i}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
    </svg>
  );
}
