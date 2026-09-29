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

  "harden-101": [
    {
      label: "grant only what the storefront uses",
      expect: "pass",
      source: `async function setupAppUser(db) {
  await db.query("CREATE USER IF NOT EXISTS 'aurora_app'@'%'");
  await db.query("GRANT SELECT ON aurora.products TO 'aurora_app'@'%'");
  await db.query("GRANT SELECT, INSERT ON aurora.orders TO 'aurora_app'@'%'");
}`
    },
    {
      label: "revoke everything",
      // Safe and useless: the shop cannot read its own catalogue.
      expect: ["sql.app-can-read", "sql.app-can-write"],
      source: `async function setupAppUser(db) {
  await db.query("CREATE USER IF NOT EXISTS 'aurora_app'@'%'");
  await db.query("REVOKE ALL PRIVILEGES ON aurora.* FROM 'aurora_app'@'%'");
}`
    },
    {
      label: "read-only",
      // Closer, but checkout needs to write an order.
      expect: ["sql.app-can-write"],
      source: `async function setupAppUser(db) {
  await db.query("GRANT SELECT ON aurora.* TO 'aurora_app'@'%'");
}`
    }
  ],

  "harden-201": [
    {
      label: "keep 'self', drop the unsafe sources",
      expect: "pass",
      source: `app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "https://cdn.aurora.shop"]
    }
  }
}));`
    },
    {
      label: "switch the policy off",
      expect: ["csp.enabled"],
      source: `app.use(helmet({ contentSecurityPolicy: false }));`
    },
    {
      label: "block every script",
      expect: ["csp.allows-own-scripts"],
      source: `app.use(helmet({
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'self'"], scriptSrc: ["'none'"] }
  }
}));`
    },
    {
      label: "remove only the wildcard",
      // 'unsafe-inline' alone is enough to run an injected <script>.
      expect: ["csp.no-unsafe-sources"],
      source: `app.use(helmet({
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"] }
  }
}));`
    }
  ],

  "harden-301": [
    {
      label: "lax and httpOnly",
      expect: "pass",
      source: `app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));`
    },
    {
      label: "strict",
      // Blocks the forgery and signs out everyone arriving from an email link.
      expect: ["cookie.survives-email-links"],
      source: `app.use(session({
  secret: process.env.SESSION_SECRET,
  cookie: { httpOnly: true, secure: true, sameSite: 'strict' }
}));`
    },
    {
      label: "fix SameSite, forget httpOnly",
      expect: ["cookie.not-script-readable"],
      source: `app.use(session({
  secret: process.env.SESSION_SECRET,
  cookie: { httpOnly: false, secure: true, sameSite: 'lax' }
}));`
    },
    {
      label: "fix httpOnly, forget SameSite",
      expect: ["cookie.samesite-restricted"],
      source: `app.use(session({
  secret: process.env.SESSION_SECRET,
  cookie: { httpOnly: true, secure: true, sameSite: 'none' }
}));`
    }
  ],

  "sec-107": [
    {
      label: "look the column up in a table",
      expect: "pass",
      source: `const SORTS = { price: 'price', name: 'name', newest: 'created_at' };
app.get('/api/catalogue', async (req, res) => {
  const { sort } = req.query;
  const column = SORTS[sort] ?? 'name';
  const sql = \`SELECT id, name, price FROM products ORDER BY \${column}\`;
  const rows = await db.query(sql);
  res.json(rows);
});`
    },
    {
      label: "check against a list, then use it",
      expect: "pass",
      source: `const ALLOWED = ['price', 'name'];
app.get('/api/catalogue', async (req, res) => {
  const { sort } = req.query;
  const column = ALLOWED.includes(sort) ? sort : 'name';
  const sql = \`SELECT id, name, price FROM products ORDER BY \${column}\`;
  const rows = await db.query(sql);
  res.json(rows);
});`
    },
    {
      label: "bind it as a parameter",
      // What every earlier challenge taught -- and here it silently stops sorting.
      expect: ["sql.sort-still-applies"],
      source: `app.get('/api/catalogue', async (req, res) => {
  const { sort } = req.query;
  const sql = 'SELECT id, name, price FROM products ORDER BY ?';
  const rows = await db.query(sql, [sort]);
  res.json(rows);
});`
    },
    {
      label: "strip anything that is not a letter",
      // Keeps the sort working and still lets password_hash through.
      expect: ["sqli.identifier-allowlisted"],
      source: `app.get('/api/catalogue', async (req, res) => {
  const { sort } = req.query;
  const clean = sort.replace(/[^a-z_]/gi, '');
  const sql = \`SELECT id, name, price FROM products ORDER BY \${clean}\`;
  const rows = await db.query(sql);
  res.json(rows);
});`
    }
  ],

  "sec-205": [
    {
      label: "parse it and allow only web schemes",
      expect: "pass",
      source: `function renderSeller(seller) {
  const link = document.createElement('a');
  link.textContent = seller.name;
  const url = new URL(seller.website, location.origin);
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    link.href = url.href;
  }
  document.querySelector('#seller').append(link);
}`
    },
    {
      label: "block javascript:",
      expect: ["xss.url-scheme-allowlisted"],
      source: `function renderSeller(seller) {
  const link = document.createElement('a');
  link.textContent = seller.name;
  if (!seller.website.includes('javascript:')) {
    link.href = seller.website;
  }
  document.querySelector('#seller').append(link);
}`
    },
    {
      label: "stop linking",
      expect: ["output.link-still-works"],
      source: `function renderSeller(seller) {
  const link = document.createElement('a');
  link.textContent = seller.name;
  document.querySelector('#seller').append(link);
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
