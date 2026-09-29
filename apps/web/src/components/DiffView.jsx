import "./DiffView.css";

/**
 * A line diff of a proposed change.
 *
 * Reviewing means reading what changed, not re-reading the whole file and
 * hunting for the difference. Removed lines are struck through as well as
 * coloured, so the diff still reads without colour vision or in greyscale print.
 *
 * @param {{ before: string, after: string }} props
 */
export function DiffView({ before, after }) {
  const rows = lineDiff(before, after);
  return (
    <pre className="diff" aria-label="Proposed change">
      {rows.map((r, i) => (
        <span key={i} className={`diff__line diff__line--${r.kind}`}>
          <span className="diff__mark" aria-hidden="true">
            {r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}
          </span>
          <span className="diff__text">
            {r.kind === "add" && <span className="visually-hidden">added: </span>}
            {r.kind === "del" && <span className="visually-hidden">removed: </span>}
            {r.text || " "}
          </span>
        </span>
      ))}
    </pre>
  );
}

/**
 * Longest-common-subsequence diff over lines.
 *
 * Quadratic, which is fine for a twenty-line handler and would not be for a
 * whole file -- the only inputs here are challenge snippets.
 *
 * @param {string} a
 * @param {string} b
 * @returns {{ kind: "same"|"add"|"del", text: string }[]}
 */
export function lineDiff(a, b) {
  const A = a.split("\n");
  const B = b.split("\n");
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  /** @type {{ kind: "same"|"add"|"del", text: string }[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ kind: "same", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: A[i++] }); }
    else { out.push({ kind: "add", text: B[j++] }); }
  }
  while (i < m) out.push({ kind: "del", text: A[i++] });
  while (j < n) out.push({ kind: "add", text: B[j++] });
  return out;
}
