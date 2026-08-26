/**
 * The icon set.
 *
 * Drawn here rather than sourced, for now. Every glyph is stroke-only on a 24x24
 * grid with `currentColor`, so an icon takes the colour of whatever it sits in and
 * follows both palettes with no per-theme variants — the same reason the window
 * chrome is CSS rather than a nine-slice image.
 *
 * These are placeholders in the sense that they can be replaced, not in the sense
 * that they are unfinished: the stroke weight matches the 2px window rules
 * deliberately, so the set reads as part of the chrome.
 *
 * **Swapping in licensed art.** Add the file under `content/assets/icons/`, record
 * it in `content/assets/manifest.json` with its source and licence, and add the
 * name here pointing at the file instead of the path data. Nothing else changes.
 * See docs/game-design.md section 7 for why the manifest is not optional.
 */

/** @typedef {{ paths: string[], circles?: [number, number, number][] }} Glyph */

/** @type {Record<string, Glyph>} */
export const ICONS = {
  // ---- skills -----------------------------------------------------------
  /** SQL injection: a database cylinder. */
  database: {
    paths: [
      "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z",
      "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
      "M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"
    ]
  },

  /** Cross-site scripting: a browser window with a script mark. */
  browser: {
    paths: [
      "M3 5h18v14H3z",
      "M3 9h18",
      "M9 12.5 7 14.5l2 2",
      "M15 12.5l2 2-2 2"
    ],
    circles: [[5.5, 7, 0.7], [7.8, 7, 0.7]]
  },

  /** Request forgery: a request arriving from somewhere it should not. */
  forgery: {
    paths: [
      "M3 12h9",
      "M9 8.5 12.5 12 9 15.5",
      "M15 5.5 21 5.5 21 18.5 15 18.5",
      "M16.5 9.5 19.5 14.5",
      "M19.5 9.5 16.5 14.5"
    ]
  },

  // ---- system components ------------------------------------------------
  server: {
    paths: ["M3 4h18v6H3z", "M3 14h18v6H3z", "M6.5 7h.01", "M6.5 17h.01"]
  },

  key: {
    paths: ["M14 10.5 21 3.5", "M18 6.5l2 2", "M15.5 9l2 2"],
    circles: [[8.5, 15.5, 4.5]]
  },

  // ---- state ------------------------------------------------------------
  lock: {
    paths: ["M5 11h14v9H5z", "M8 11V7.5a4 4 0 0 1 8 0V11", "M12 15v2"]
  },

  check: {
    paths: ["M4.5 12.5 9.5 17.5 19.5 6.5"]
  },

  /** Boss: not a monster, a fracture. The adversary here is a broken system. */
  fracture: {
    paths: [
      "M12 2 4 8v8l8 6 8-6V8z",
      "M12 7.5 9.5 12h5L12 16.5"
    ]
  },

  // ---- rewards ----------------------------------------------------------
  shield: {
    paths: ["M12 2.5 20 6v6c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5V6z"]
  },

  shieldCheck: {
    paths: [
      "M12 2.5 20 6v6c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5V6z",
      "M8.5 11.8 11 14.3l4.5-4.6"
    ]
  }
};

/** Which glyph stands for each skill. */
export const SKILL_ICONS = {
  sqli: "database",
  xss: "browser",
  csrf: "forgery"
};

/** Which glyph stands for each part of the system in the breach diagram. */
export const COMPONENT_ICONS = {
  browser: "browser",
  api: "server",
  database: "database",
  session: "key"
};
