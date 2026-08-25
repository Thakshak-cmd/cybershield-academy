/**
 * API layer.
 *
 * Falls back to fixture data when the backend is not reachable, so the interface
 * can be worked on without Atlas, a seeded database and the BKT service all
 * running. The shapes are exactly what the real endpoints return -- taken from
 * apps/api/src/routes -- so switching between them changes nothing downstream.
 */

const TOKEN_KEY = "cybershield.token";

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function call(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ------------------------------------------------------------------ fixtures */

const FIXTURE_CHALLENGE = {
  id: "sec-101",
  title: "The product search box returns other people's orders",
  skill: "sqli",
  subSkill: "sqli.parameterised-query",
  tier: "beginner",
  format: "patch",
  repo: "aurora-store",
  file: "routes/search.js",
  reportedBy: "Dan (QA)",
  brief:
    "QA typed a quote into the search box and the page filled with rows from a " +
    "table search should never touch. This is the gentlest version of the problem: " +
    "one input, one query, no login involved.",
  vulnerable:
    "app.get('/api/search', async (req, res) => {\n" +
    "  const { term } = req.query;\n\n" +
    "  const sql = `SELECT id, name, price FROM products\n" +
    "     WHERE name LIKE '%${term}%'`;\n\n" +
    "  const rows = await db.query(sql);\n" +
    "  res.json(rows);\n" +
    "});",
  attackCount: 2,
  functionalCount: 2,
  hintCount: 3
};

const FIXTURE_HINTS = [
  "The quote the tester typed ended the string early. Everything after it was read as instructions.",
  "Stripping the quote would break the O'Neill listing. What lets the database keep the value and the query separate?",
  "Pass the LIKE pattern as a bound parameter: db.query(sql, [`%${term}%`])."
];

/**
 * Offline scoring, matching the real validator's shape closely enough to build
 * against. The genuine verdict comes from packages/validator on the server; this
 * only has to be right about the *structure* of the response.
 *
 * It is regex-based and therefore approximate, which is the whole reason the real
 * validator parses instead. The first version here flagged any template literal
 * whenever "SELECT" appeared anywhere in the file, so a correct patch binding
 * [`%${term}%`] as a parameter was marked as still injecting -- a false failure on
 * the right answer. The interpolation has to be inside the SQL string itself.
 */
function fixtureVerdict(source) {
  // A template literal that contains BOTH a SQL keyword and a filled slot.
  const interpolates = /`[^`]*\bselect\b[^`]*\$\{[^}]*\}[^`]*`/is.test(source)
    || /`[^`]*\$\{[^}]*\}[^`]*\bfrom\b[^`]*`/is.test(source);
  const parameterised = /\.query\s*\([^,)]+,\s*\[/.test(source);
  const mutates = /\b(term|email)\s*\.\s*(replace|replaceAll|split|slice)\s*\(/.test(source);
  const blocklists = /\b(OR|UNION|SELECT|--)\b/.test(source) && /test\s*\(|includes\s*\(/.test(source);
  const queriesProducts = /products/i.test(source);

  const security = [
    { id: "sqli.no-string-interpolation", pass: !interpolates,
      evidence: interpolates ? "user input is spliced into the query text" : null },
    { id: "sqli.uses-parameterised-query", pass: parameterised,
      evidence: parameterised ? null : "values are not bound as query parameters" }
  ];
  const functional = [
    { id: "input.preserved-verbatim", pass: !mutates,
      evidence: mutates ? "rewrites the value a real user typed" : null },
    { id: "sql.queries-expected-table", pass: queriesProducts,
      evidence: queriesProducts ? null : 'no query against "products" remains' }
  ];
  if (blocklists) {
    functional.push({ id: "input.no-content-blocklist", pass: false,
      evidence: 'also rejects legitimate values such as "O\'Neill"' });
  }

  const tally = list => ({ passed: list.filter(r => r.pass).length, total: list.length, results: list });
  const all = [...security, ...functional];

  return {
    passed: all.every(r => r.pass),
    parseError: null,
    security: tally(security),
    functional: tally(functional),
    failedRules: all.filter(r => !r.pass).map(r => r.id)
  };
}

/* ------------------------------------------------------------------- exports */

export const api = {
  /**
   * Whether the real backend is answering. Decided once, by probing /api/health,
   * rather than inferred from the status of each call.
   *
   * Inferring it per-request does not work: Vite's dev proxy returns 500 when the
   * target is down, which is indistinguishable from a genuine 500 out of a live
   * API. Guessing from status codes would either swallow real server errors or
   * refuse to fall back, depending on which way the heuristic leaned. Probing
   * once makes the mode explicit, and a real error from a live API then surfaces
   * as an error rather than being quietly replaced by fixture data.
   */
  live: false,
  probed: false,

  async connect() {
    if (this.probed) return this.live;
    this.probed = true;
    try {
      const res = await fetch("/api/health", { signal: AbortSignal.timeout(1500) });
      this.live = res.ok;
    } catch {
      this.live = false;
    }
    return this.live;
  },

  async next() {
    if (!(await this.connect())) {
      return {
        challenge: FIXTURE_CHALLENGE,
        pMastery: 0.15,
        policy: "bkt-adaptive",
        reason: "sqli is weakest at 0.15",
        mastery: { sqli: 0.15, xss: 0.15, csrf: 0.15 },
        capstoneUnlocked: false
      };
    }
    return call("/api/next");
  },

  async start(challengeId) {
    if (!(await this.connect())) return { challenge: FIXTURE_CHALLENGE };
    return call(`/api/challenges/${challengeId}/start`, { method: "POST" });
  },

  async attempt(challengeId, source, durationMs) {
    if (!(await this.connect())) {
      const verdict = fixtureVerdict(source);
      return { ...verdict, attemptNo: 1, xpAwarded: verdict.passed ? 80 : 0, countedForMastery: true };
    }
    return call(`/api/challenges/${challengeId}/attempt`, {
      method: "POST",
      body: JSON.stringify({ source, durationMs })
    });
  },

  hint(index) {
    return FIXTURE_HINTS[index] ?? null;
  },

  /**
   * Whether this session belongs to a study participant, read from the token's
   * `study` claim.
   *
   * Decoded without verification, which is fine because nothing security-relevant
   * hangs on it: the server checks the signature on every request, and this only
   * decides whether the appearance control is shown. A tampered claim changes the
   * palette and nothing else.
   */
  isStudyParticipant() {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return false;
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.study === true;
    } catch {
      return false;
    }
  }
};
