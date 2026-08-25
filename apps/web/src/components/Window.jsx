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
 * @param {React.ReactNode} props.children
 */
export function Window({ title, badge, tone = "default", flush = false, children, ...rest }) {
  return (
    <section className={`win win--${tone}`} {...rest}>
      {title && (
        <header className="win__bar">
          <span className="win__title pixel">{title}</span>
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
