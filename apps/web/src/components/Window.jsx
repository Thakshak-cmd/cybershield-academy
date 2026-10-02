import { useId } from "react";
import "./Window.css";

/**
 * The bordered window.
 *
 * Every panel in the game world is one of these, which is what carries the JRPG
 * identity without a single sprite: a double rule with corner pips, drawn in CSS
 * rather than 9-sliced from an image. That matters for the schedule -- the chrome
 * is the cheapest half of the visual treatment and it does most of the work
 * (docs/game-design.md section 7).
 *
 * @param {object} props
 * @param {string} [props.title]     shown in the frame's title bar, pixel type
 * @param {React.ReactNode} [props.badge]  right-aligned chip in the title bar
 * @param {"default"|"breach"|"secure"|"quiet"} [props.tone]
 * @param {boolean} [props.flush]    drop the inner padding, for code panes
 * @param {"h1"|"h2"|"h3"|"span"} [props.as]
 *   the title's element. A heading by default, so a screen-reader user can move
 *   between panels the way a sighted one scans their title bars. The first
 *   window on a screen is usually its h1; "span" is for a frame whose title is
 *   a label above a heading of its own.
 * @param {React.ReactNode} props.children
 */
export function Window({ title, badge, tone = "default", flush = false, as: Title = "h2", children, ...rest }) {
  const id = useId();
  const named = title && Title !== "span";
  return (
    <section className={`win win--${tone}`} aria-labelledby={named ? id : undefined} {...rest}>
      {title && (
        <header className="win__bar">
          <Title id={id} className="win__title pixel">{title}</Title>
          {badge && <span className="win__badge">{badge}</span>}
        </header>
      )}
      <div className={flush ? "win__body win__body--flush" : "win__body"}>{children}</div>
    </section>
  );
}

/**
 * A row of diamonds standing in for a count.
 *
 * Reading "two of three attacks repelled" off three shapes is faster than off a
 * fraction, and it keeps the suites legible at a glance during the moment that
 * matters -- when the verdict lands.
 *
 * A filled pip always means a good outcome and is therefore always green. The
 * alarm colour belongs to the window border, not to a shape that would otherwise
 * mean "succeeded" and "danger" simultaneously.
 *
 * @param {{ total: number, filled: number, tone?: "breach"|"secure" }} props
 */
export function Pips({ total, filled, tone = "secure" }) {
  return (
    <span className={`pips pips--${tone}`} role="img"
          aria-label={`${filled} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < filled ? "pip pip--on" : "pip"} />
      ))}
    </span>
  );
}
