// @ts-check

/**
 * Reference answers for each challenge: at least one correct, and the plausible
 * wrong turns a learner actually takes.
 *
 * Authoring a challenge means authoring its rules, and rules are only right if
 * the wrong answers fail for the *right reasons*. These are the fixture that
 * proves it, shared by the CLI (`npm run check`) and the test suite so there is
 * one set to keep true rather than two.
 *
 * `expect` is what the challenge should say about each patch:
 *   "pass"        - both suites clean
 *   an id array   - exactly these rules must fail
 */

/**
 * @typedef {{ label: string, source: string, expect: "pass" | string[] }} ReferencePatch
 * @type {Record<string, ReferencePatch[]>}
 */
export const REFERENCE_PATCHES = {
  "sec-101": [
    {
      label: "parameterised query",
      expect: "pass",
      source: `app.get('/api/search', async (req, res) => {
  const { term } = req.query;
  const sql = 'SELECT id, name, price FROM products WHERE name LIKE ?';
  const rows = await db.query(sql, [\`%\${term}%\`]);
  res.json(rows);
});`
    },
    {
      label: "strip single quotes",
      // Still splices the value into the statement, and deletes the apostrophe
      // that O'Neill's listing depends on.
      expect: ["sqli.no-string-interpolation", "sqli.uses-parameterised-query", "input.preserved-verbatim"],
      source: `app.get('/api/search', async (req, res) => {
  const { term } = req.query;
  const safe = term.replace(/'/g, '');
  const sql = \`SELECT id, name, price FROM products WHERE name LIKE '%\${safe}%'\`;
  const rows = await db.query(sql);
});`
    }
  ],

  "sec-104": [
    {
      label: "parameterised query",
      expect: "pass",
      source: `app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const sql = 'SELECT id, role FROM users WHERE email = ? AND password_hash = ?';
  const [user] = await db.query(sql, [email, sha256(password)]);
  if (user) req.session.userId = user.id;
});`
    },
    {
      label: "strip single quotes",
      expect: ["sqli.no-string-interpolation", "sqli.uses-parameterised-query", "input.preserved-verbatim"],
      source: `app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const safe = email.replace(/'/g, '');
  const sql = \`SELECT id, role FROM users WHERE email = '\${safe}'\`;
  const [user] = await db.query(sql);
});`
    },
    {
      label: "blocklist SQL keywords",
      // Attackers write the same logic without the keywords; real customers
      // called Orwell get locked out.
      expect: ["sqli.no-string-interpolation", "sqli.uses-parameterised-query", "input.no-content-blocklist"],
      source: `app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (/\\b(OR|UNION|SELECT|--)\\b/i.test(email)) {
    return res.status(400).send('Invalid input');
  }
  const sql = \`SELECT id, role FROM users WHERE email = '\${email}'\`;
  const [user] = await db.query(sql);
});`
    }
  ],

  "sec-201": [
    {
      label: "render as text",
      expect: "pass",
      source: `function renderReview(review) {
  const card = document.createElement('div');
  card.className = 'review';
  const body = document.createElement('p');
  body.textContent = review.body;
  card.append(body);
  document.querySelector('#reviews').append(card);
}`
    },
    {
      label: "strip script tags",
      // Neither payload uses a script tag, and the filter mangles honest reviews.
      expect: ["xss.no-html-sink", "xss.uses-safe-sink", "output.no-markup-stripping"],
      source: `function renderReview(review) {
  const card = document.createElement('div');
  const body = document.createElement('p');
  const clean = review.body.replace(/<script[^>]*>.*?<\\/script>/gi, '');
  body.innerHTML = clean;
  card.append(body);
}`
    },
    {
      label: "stop rendering the review",
      expect: ["xss.uses-safe-sink", "output.reaches-the-page"],
      source: `function renderReview(review) {
  const card = document.createElement('div');
  card.className = 'review';
  document.querySelector('#reviews').append(card);
}`
    }
  ],

  "sec-204": [
    {
      label: "build the element, set its text",
      expect: "pass",
      source: `function showSearchBanner(term) {
  const banner = document.querySelector('#search-banner');
  banner.textContent = 'You searched for ';
  const strong = document.createElement('strong');
  strong.textContent = term;
  banner.append(strong);
  banner.hidden = false;
}`
    },
    {
      label: "encode before writing markup",
      // Also correct. A rule that failed this would teach that the right answer
      // is wrong, which is worse than missing a vulnerable one.
      expect: "pass",
      source: `function showSearchBanner(term) {
  const banner = document.querySelector('#search-banner');
  banner.innerHTML = 'You searched for <strong>' + escapeHtml(term) + '</strong>';
  banner.hidden = false;
}`
    },
    {
      label: "strip angle brackets",
      // Still writes markup: replace() is a filter, not an encoder, so the value
      // reaching innerHTML is unescaped however many characters were removed.
      expect: ["xss.no-html-sink", "xss.uses-safe-sink", "output.no-markup-stripping"],
      source: `function showSearchBanner(term) {
  const banner = document.querySelector('#search-banner');
  const clean = term.replace(/[<>]/g, '');
  banner.innerHTML = 'You searched for <strong>' + clean + '</strong>';
  banner.hidden = false;
}`
    },
    {
      label: "launder through a string method",
      // Taint has to survive term.slice(0), or any string method defeats the check.
      expect: ["xss.no-html-sink", "xss.uses-safe-sink"],
      source: `function showSearchBanner(term) {
  const banner = document.querySelector('#search-banner');
  const sneaky = term.slice(0);
  banner.innerHTML = 'You searched for <strong>' + sneaky + '</strong>';
}`
    }
  ],

  "sec-301": [
    {
      label: "compare a request token against the session",
      expect: "pass",
      source: `app.post('/api/account/address', async (req, res) => {
  const { line1, postcode, csrfToken } = req.body;
  if (csrfToken !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid request token.' });
  }
  await updateAddress(req.session.userId, { line1, postcode });
  res.json({ ok: true });
});`
    },
    {
      label: "check the Referer header",
      // Stripped by privacy settings and proxies, and trivially absent.
      expect: ["csrf.verifies-token", "csrf.not-header-only"],
      source: `app.post('/api/account/address', async (req, res) => {
  const { line1, postcode } = req.body;
  const referer = req.get('referer') || '';
  if (!referer.startsWith('https://aurora.shop')) {
    return res.status(403).json({ error: 'Bad referer' });
  }
  await updateAddress(req.session.userId, { line1, postcode });
  res.json({ ok: true });
});`
    },
    {
      label: "disable the endpoint",
      expect: ["csrf.still-performs-the-action"],
      source: `app.post('/api/account/address', async (req, res) => {
  const { csrfToken } = req.body;
  if (csrfToken !== req.session.csrfToken) return res.sendStatus(403);
  res.status(503).json({ error: 'Address changes are temporarily disabled.' });
});`
    }
  ]
};

/**
 * Boss reference answers, keyed by stage.
 *
 * A boss is only a transfer task if each stage needs a different technique. The
 * "one technique everywhere" entry exists to prove that: a learner who reaches
 * for a parameterised query three times closes exactly one of the three holes,
 * and the encounter has to say so.
 *
 * @type {Record<string, { label: string, sources: Record<string, string>,
 *                         expectPassed: string[] }[]>}
 */
export const BOSS_REFERENCE_PATCHES = {
  "sec-900": [
    {
      label: "all three, each with the right technique",
      expectPassed: ["ledger", "storefront", "checkout"],
      sources: {
        ledger: `app.get('/api/orders', async (req, res) => {
  const { reference } = req.query;
  const sql = 'SELECT id, total, placed_at FROM orders WHERE reference = ?';
  const rows = await db.query(sql, [reference]);
  res.json(rows);
});`,
        storefront: `function renderNote(order) {
  const row = document.querySelector('#order-' + order.id);
  row.querySelector('.note').textContent = order.deliveryNote;
}`,
        checkout: `app.post('/api/account/payout', async (req, res) => {
  const { sortCode, accountNumber, csrfToken } = req.body;
  if (csrfToken !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid request token.' });
  }
  await updatePayout(req.session.userId, { sortCode, accountNumber });
  res.json({ ok: true });
});`
      }
    },
    {
      label: "parameterised queries everywhere",
      // The whole point of the encounter. Binding parameters is exactly right for
      // the database and does nothing at all for the other two.
      expectPassed: ["ledger"],
      sources: {
        ledger: `app.get('/api/orders', async (req, res) => {
  const { reference } = req.query;
  const sql = 'SELECT id, total, placed_at FROM orders WHERE reference = ?';
  const rows = await db.query(sql, [reference]);
  res.json(rows);
});`,
        storefront: `function renderNote(order) {
  const row = document.querySelector('#order-' + order.id);
  row.querySelector('.note').innerHTML = order.deliveryNote;
}`,
        checkout: `app.post('/api/account/payout', async (req, res) => {
  const { sortCode, accountNumber } = req.body;
  await updatePayout(req.session.userId, { sortCode, accountNumber });
  res.json({ ok: true });
});`
      }
    },
    {
      label: "two of three, checkout left open",
      expectPassed: ["ledger", "storefront"],
      sources: {
        ledger: `app.get('/api/orders', async (req, res) => {
  const { reference } = req.query;
  const sql = 'SELECT id, total, placed_at FROM orders WHERE reference = ?';
  const rows = await db.query(sql, [reference]);
  res.json(rows);
});`,
        storefront: `function renderNote(order) {
  const row = document.querySelector('#order-' + order.id);
  row.querySelector('.note').textContent = order.deliveryNote;
}`,
        checkout: `app.post('/api/account/payout', async (req, res) => {
  const { sortCode, accountNumber } = req.body;
  const referer = req.get('referer') || '';
  if (!referer.startsWith('https://aurora.shop')) return res.sendStatus(403);
  await updatePayout(req.session.userId, { sortCode, accountNumber });
  res.json({ ok: true });
});`
      }
    }
  ]
};
