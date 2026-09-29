import "./PostureGauge.css";

/**
 * Aurora's security posture as a gauge.
 *
 * The consequence loop made visible: holes closed push the needle up, recent
 * incidents drag it down, and it recovers as the learner does. The label and the
 * number both carry the state, so neither colour nor the needle's angle alone
 * has to be read.
 *
 * @param {{ score: number, label: string, size?: number }} props
 */
export function PostureGauge({ score, label, size = 150 }) {
  const clamped = Math.max(0, Math.min(100, score));
  // A 180-degree arc from left to right; the needle sweeps across it.
  const angle = Math.PI * (1 - clamped / 100);
  const r = 44;
  const cx = 60, cy = 58;
  const nx = cx + r * 0.82 * Math.cos(angle);
  const ny = cy - r * 0.82 * Math.sin(angle);
  const arc = (from, to) => {
    const a0 = Math.PI * (1 - from / 100), a1 = Math.PI * (1 - to / 100);
    const x0 = cx + r * Math.cos(a0), y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const band = clamped < 25 ? "attack" : clamped < 50 ? "exposed" : clamped < 75 ? "holding" : "hardened";

  return (
    <figure className={`gauge gauge--${band}`} style={{ width: size }}>
      <svg viewBox="0 0 120 70" role="img" aria-label={`Aurora security posture ${clamped} of 100, ${label}`}>
        <path className="gauge__track" d={arc(0, 100)} />
        <path className="gauge__fill" d={arc(0, Math.max(0.5, clamped))} />
        {[25, 50, 75].map(t => {
          const a = Math.PI * (1 - t / 100);
          return (
            <line key={t} className="gauge__tick"
                  x1={cx + (r - 6) * Math.cos(a)} y1={cy - (r - 6) * Math.sin(a)}
                  x2={cx + (r + 5) * Math.cos(a)} y2={cy - (r + 5) * Math.sin(a)} />
          );
        })}
        <line className="gauge__needle" x1={cx} y1={cy} x2={nx} y2={ny} />
        <circle className="gauge__hub" cx={cx} cy={cy} r="3" />
      </svg>
      <figcaption className="gauge__caption">
        <span className="gauge__score pixel">{clamped}</span>
        <span className="gauge__label label">{label}</span>
      </figcaption>
    </figure>
  );
}
