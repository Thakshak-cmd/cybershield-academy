import "./BreachDiagram.css";

/**
 * Aurora's architecture, drawn with the breach on it.
 *
 * This is the boss "entity", and it is deliberately not a creature. No asset pack
 * contains a sprite for cross-site request forgery, and bolting a monster onto it
 * would be decoration with no relationship to what the learner is doing. The
 * adversary here *is* the system in a compromised state, which is both the honest
 * picture and the one that changes as the patches land.
 *
 * Coordinates are fixed rather than measured, unlike the skill tree: this is a
 * drawing with a known composition, not boxes laid out by CSS, so a viewBox scales
 * it correctly at any size with nothing to keep in sync.
 *
 * @param {{
 *   compromised: string[],
 *   secured: string[],
 *   attacking?: boolean
 * }} props
 */
export function BreachDiagram({ compromised = [], secured = [], attacking = false }) {
  const state = id =>
    compromised.includes(id) ? "breached" : secured.includes(id) ? "secured" : "intact";

  const NODES = [
    { id: "browser", label: "Customer browser", x: 40, y: 108, w: 132, h: 54 },
    { id: "api", label: "Aurora API", x: 232, y: 108, w: 118, h: 54 },
    { id: "database", label: "Customer data", x: 412, y: 44, w: 128, h: 54 },
    { id: "session", label: "Session store", x: 412, y: 172, w: 128, h: 54 }
  ];

  const EDGES = [
    { from: "browser", to: "api", d: "M 172 135 L 232 135" },
    { from: "api", to: "database", d: "M 350 128 L 380 128 L 380 71 L 412 71" },
    { from: "api", to: "session", d: "M 350 142 L 380 142 L 380 199 L 412 199" }
  ];

  // An edge only reads as a live attack route when the thing it leads to is
  // actually breached. Colouring every edge red the moment anything is wrong
  // would make the picture say "everything is lost" during a partial fix.
  const edgeState = e =>
    state(e.to) === "breached" ? "breached" : state(e.to) === "secured" ? "secured" : "intact";

  const allSecured = compromised.length === 0 && secured.length > 0;

  return (
    <figure className={`breach${allSecured ? " breach--held" : ""}`}>
      <svg viewBox="0 0 580 270" className="breach__svg" role="img"
           aria-label={describe(compromised, secured)}>
        {EDGES.map(e => (
          <g key={`${e.from}-${e.to}`}>
            <path className={`edge edge--${edgeState(e)}`} d={e.d} fill="none" />
            {attacking && edgeState(e) === "breached" && (
              <path className="edge__pulse" d={e.d} fill="none" />
            )}
          </g>
        ))}

        {NODES.map(n => (
          <g key={n.id} className={`unit unit--${state(n.id)}`}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="2" className="unit__box" />
            <rect x={n.x + 3} y={n.y + 3} width={n.w - 6} height={n.h - 6} rx="1"
                  className="unit__inner" />
            <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 1} className="unit__label"
                  textAnchor="middle" dominantBaseline="middle">
              {n.label}
            </text>
            <text x={n.x + n.w / 2} y={n.y + n.h - 9} className="unit__state"
                  textAnchor="middle">
              {state(n.id) === "breached" ? "BREACHED"
                : state(n.id) === "secured" ? "HELD" : ""}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className="breach__caption label">
        {describe(compromised, secured)}
      </figcaption>
    </figure>
  );
}

function describe(compromised, secured) {
  if (compromised.length === 0 && secured.length > 0) return "The chain is broken. Nothing is reachable.";
  if (secured.length === 0) return "Three footholds, all still open.";
  return `${secured.length} closed, ${compromised.length} still open.`;
}
