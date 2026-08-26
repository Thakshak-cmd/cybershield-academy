import { ICONS } from "./icons.js";
import "./Icon.css";

/**
 * One glyph.
 *
 * Decorative by default. An icon that repeats a label sitting next to it is noise
 * to a screen reader, so it is hidden unless a `label` is given -- which is the
 * case only where the icon is the sole carrier of meaning.
 *
 * @param {{ name: string, size?: number, label?: string, className?: string }} props
 */
export function Icon({ name, size = 18, label, className = "" }) {
  const glyph = ICONS[name];
  if (!glyph) return null;

  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
    >
      {glyph.paths.map((d, i) => <path key={i} d={d} />)}
      {(glyph.circles || []).map(([cx, cy, r], i) => (
        <circle key={`c${i}`} cx={cx} cy={cy} r={r} />
      ))}
    </svg>
  );
}
