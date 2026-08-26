import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./SkillTree.css";

/**
 * The skill tree as a connected graph.
 *
 * Connectors are drawn from **measured** node positions rather than from
 * coordinates baked into the layout. Positioning nodes by hand and drawing lines
 * to where they are assumed to be is what makes SVG overlays fragile: the
 * assumption breaks on a different viewport, or when the pixel font finishes
 * loading and every box shifts a few pixels. Measuring after layout, and
 * remeasuring whenever the container resizes, means the lines cannot disagree
 * with the boxes.
 *
 * @param {{
 *   nodes: { id: string, skill: string, masteryRequired: number, isDrill: boolean,
 *            isBoss: boolean, requires: string|null }[],
 *   titles: Record<string, { title: string, tier: string }>,
 *   mastery: Record<string, number>,
 *   unlocked: string[],
 *   cleared: string[],
 *   onSelect?: (id: string) => void
 * }} props
 */
export function SkillTree({ nodes, titles, mastery, unlocked, cleared, onSelect }) {
  const containerRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const nodeRefs = useRef(/** @type {Map<string, HTMLElement>} */ (new Map()));
  const [edges, setEdges] = useState(/** @type {any[]} */ ([]));
  const [size, setSize] = useState({ width: 0, height: 0 });

  const unlockedSet = new Set(unlocked);
  const clearedSet = new Set(cleared);

  const state = useCallback(
    /** @param {{ id: string }} node */
    node => {
      if (clearedSet.has(node.id)) return "cleared";
      if (unlockedSet.has(node.id)) return "open";
      return "locked";
    },
    [unlocked, cleared]
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const box = container.getBoundingClientRect();
    setSize({ width: box.width, height: box.height });

    /** Centre of a node, relative to the container rather than the viewport. */
    const centreOf = id => {
      const el = nodeRefs.current.get(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.left - box.left + r.width / 2,
        top: r.top - box.top,
        bottom: r.bottom - box.top
      };
    };

    const next = [];
    for (const node of nodes) {
      if (!node.requires) continue;
      const from = centreOf(node.requires);
      const to = centreOf(node.id);
      if (!from || !to) continue;
      next.push({
        key: `${node.requires}->${node.id}`,
        x1: from.x, y1: from.bottom,
        x2: to.x, y2: to.top,
        // A connector only reads as "travelled" once its prerequisite is done.
        lit: clearedSet.has(node.requires)
      });
    }
    setEdges(next);
  }, [nodes, cleared]);

  // Layout effect, not effect: measuring after paint would show one frame with
  // the lines in their previous positions.
  useLayoutEffect(measure, [measure]);

  // Two mechanisms on purpose.
  //
  // ResizeObserver is the right tool -- it catches the container changing for any
  // reason, including a sibling growing. But it is not universally available, and
  // it was found to be entirely inert in one embedded browser during development:
  // not even the initial callback that observe() is specified to deliver. Relying
  // on it alone means the connectors silently detach from the boxes in exactly the
  // environments hardest to notice it in.
  //
  // A window resize listener covers the overwhelmingly common case in every
  // browser. Together they degrade rather than fail.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(container);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => {
    // Web fonts land after first paint and change every box's height. Without
    // this the connectors sit a few pixels off until something else forces a
    // remeasure, which looks like a rendering bug rather than a loading state.
    if (!document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) measure(); });
    return () => { cancelled = true; };
  }, [measure]);

  const bySkill = groupBy(nodes, n => n.skill);

  return (
    <div className="tree" ref={containerRef}>
      <svg
        className="tree__links"
        width={size.width}
        height={size.height}
        aria-hidden="true"
        focusable="false"
      >
        {edges.map(e => (
          <path
            key={e.key}
            className={e.lit ? "link link--lit" : "link"}
            // A vertical-then-horizontal elbow rather than a straight diagonal:
            // it reads as circuitry, and it stays legible when two nodes are
            // nearly but not exactly aligned.
            d={elbow(e)}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="tree__branches">
        {Object.entries(bySkill).map(([skill, branch]) => (
          <div className="branch" key={skill}>
            <header className="branch__head">
              <span className="branch__name pixel">{skill}</span>
              <span className="branch__value">{(mastery[skill] ?? 0).toFixed(2)}</span>
            </header>

            {branch.map(node => {
              const s = state(node);
              const meta = titles[node.id] ?? { title: node.id, tier: "" };
              return (
                <button
                  key={node.id}
                  ref={el => { if (el) nodeRefs.current.set(node.id, el); else nodeRefs.current.delete(node.id); }}
                  className={`node node--${s}${node.isBoss ? " node--boss" : ""}`}
                  disabled={s === "locked"}
                  onClick={() => onSelect?.(node.id)}
                  aria-label={`${meta.title}, ${s}`}
                >
                  <span className="node__top">
                    {node.isBoss && <span className="node__boss label">boss</span>}
                    <span className="node__title">{meta.title}</span>
                  </span>
                  <span className="node__foot label">
                    {s === "cleared" ? "cleared"
                      : s === "open" ? (node.isDrill ? "practice drill" : `open · ${meta.tier}`)
                      : `needs ${node.masteryRequired.toFixed(2)} mastery`}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Vertical out, across, vertical in. */
function elbow({ x1, y1, x2, y2 }) {
  if (Math.abs(x1 - x2) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mid = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`;
}

function groupBy(items, key) {
  /** @type {Record<string, any[]>} */
  const out = {};
  for (const item of items) (out[key(item)] ||= []).push(item);
  return out;
}
