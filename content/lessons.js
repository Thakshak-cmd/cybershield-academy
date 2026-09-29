// @ts-check

/**
 * The three briefing files: one lesson per skill, taken before that skill's
 * first ticket and filed in the field manual afterwards.
 *
 * Each has four parts, in the order the learner meets them:
 *
 *   theory   what is going wrong and why the fix works, in Aurora's own code
 *   demo     a live, simulated "see it happen" -- nothing is executed
 *   guided   a faded worked example: Marcus makes the first move, the learner
 *            finishes it, scored by the real validator
 *   check    two unscored questions with an explanation for every option
 *
 * The guided fixes are deliberately *not* the first ticket of each skill. A
 * worked example that was the ticket's answer would turn the first unaided
 * attempt -- the observation BKT trains on -- into a copy.
 *
 * Kept as a module rather than JSON files read from disk so the API bundles
 * it: a serverless function cannot rely on the repository being on its
 * filesystem.
 *
 * Nothing here may reuse an item from the pre/post knowledge test.
 */

/**
 * @typedef {object} Lesson
 * @property {string} id
 * @property {"sqli"|"xss"|"csrf"} skill
 * @property {string} title
 * @property {string} from            the character handing the briefing over
 * @property {string} opener          their first line, in character
 * @property {{ heading: string, paragraphs: string[], code?: string }[]} theory
 * @property {"sqli"|"xss"|"csrf"} demo
 * @property {{ brief: string, file: string, start: string, solution: string,
 *              steps: string[], meta: Record<string, any>, rules: string[] }} guided
 * @property {{ id: string, question: string, options: { id: string, text: string }[],
 *              answer: string, explanations: Record<string, string> }[]} check
 */

/** @type {Lesson[]} */
export const LESSONS = [
  {
    id: "lesson-sqli",
    skill: "sqli",
    title: "Injected queries",
    from: "Dan (QA)",
    opener: "Before you touch anything that talks to the database, here's what actually goes wrong.",
    theory: [
      {
        heading: "Data and code end up in one string",
        paragraphs: [
          "A SQL query is a small program. When the route builds it by pasting the customer's input into the text, the database receives one string and cannot tell which characters the developer wrote and which the customer typed.",
          "So a quote in the input closes the string literal early, and whatever follows it is read as SQL. The customer has stopped supplying a value and started writing part of the query."
        ],
        code: "const sql = `SELECT id, name FROM products WHERE name LIKE '%${term}%'`;"
      },
      {
        heading: "Why cleaning the input isn't the fix",
        paragraphs: [
          "Stripping quotes breaks honest input: a customer searching for O'Brien's Guide gets nothing. It also misses places with no quotes to strip at all, like a numeric id or a column name.",
          "Any fix that tries to predict dangerous characters is guessing at the database's grammar. The reliable fix never lets input near the grammar in the first place."
        ]
      },
      {
        heading: "The fix: parameterised queries",
        paragraphs: [
          "Write the query with a placeholder, ?, where the value goes, and pass the value separately. The driver sends it to the database as data, so it can never become syntax, whatever it contains.",
          "Placeholders stand for values only. Table names, column names and sort direction can't be placeholders; for those, choose from a fixed list of allowed options. And the database account should only be able to do what the app needs, so a mistake anywhere costs less."
        ],
        code: "const sql = 'SELECT id, name FROM products WHERE name LIKE ?';\nconst rows = await db.query(sql, [`%${term}%`]);"
      }
    ],
    demo: "sqli",
    guided: {
      brief: "The product page looks items up by id, and the id comes straight from the URL. Marcus has already swapped the value for a placeholder. Finish the fix: the query still isn't being given the id.",
      file: "routes/product.js",
      start:
`app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;

  // Marcus: value replaced with a placeholder. Now pass the id separately.
  const sql = 'SELECT id, name, price FROM products WHERE id = ?';

  const [product] = await db.query(sql);
  res.json(product);
});`,
      solution:
`app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;

  const sql = 'SELECT id, name, price FROM products WHERE id = ?';

  const [product] = await db.query(sql, [id]);
  res.json(product);
});`,
      steps: [
        "Marcus replaced ${id} in the SQL with ?.",
        "Pass the value as the second argument to db.query, in an array: one entry per ?."
      ],
      meta: { dbMethod: "query", inputNames: ["id"], expectedTable: "products" },
      rules: ["sqli.no-string-interpolation", "sqli.uses-parameterised-query",
              "input.preserved-verbatim", "sql.queries-expected-table"]
    },
    check: [
      {
        id: "obrien",
        question: "With a parameterised query, a customer searches for O'Brien's Guide. What happens?",
        options: [
          { id: "found", text: "The search runs normally and finds the book." },
          { id: "error", text: "The database reports a syntax error." },
          { id: "stripped", text: "The quote is removed, then the search runs." }
        ],
        answer: "found",
        explanations: {
          found: "Right. The whole input is a value, so the quote is just a character in it. Nothing needs removing.",
          error: "That's what happens with string pasting: the quote ends the literal early. A placeholder keeps it inside the value.",
          stripped: "Nothing is stripped. Parameterising doesn't clean input; it keeps input out of the grammar, so there's nothing to clean."
        }
      },
      {
        id: "placeholder",
        question: "Which of these can't be a ? placeholder?",
        options: [
          { id: "like", text: "The search term in WHERE name LIKE ?" },
          { id: "order", text: "The column name after ORDER BY" },
          { id: "email", text: "The email in WHERE email = ?" }
        ],
        answer: "order",
        explanations: {
          like: "That's a value, which is exactly what placeholders are for.",
          order: "Right. A column name is part of the query's structure, not a value. Pick it from a fixed list of allowed columns instead.",
          email: "That's a value, so a placeholder is the right fix."
        }
      }
    ]
  },

  {
    id: "lesson-xss",
    skill: "xss",
    title: "Injected scripts",
    from: "Priya (Support)",
    opener: "Customers type things into Aurora all day. Here's how some of that ends up running in other people's browsers.",
    theory: [
      {
        heading: "The page is code too",
        paragraphs: [
          "HTML isn't just text to the browser; it's instructions. Setting innerHTML asks the browser to parse a string as markup, so a tag in a customer's review becomes a real element on the page.",
          "Some elements run script. An image with an onerror attribute runs that attribute as JavaScript when the image fails to load, inside the page of whoever is reading the review, signed in as them."
        ],
        code: "note.innerHTML = order.deliveryNote;"
      },
      {
        heading: "Put text in as text",
        paragraphs: [
          "textContent inserts characters exactly as they are. Nothing is parsed, so a < is shown as a <, not the start of a tag. The fix belongs where data meets the page, the sink, not somewhere upstream.",
          "Removing <script> tags doesn't work: there are many other ways to run script, and the browser's parser is more forgiving than any filter."
        ],
        code: "note.textContent = order.deliveryNote;"
      },
      {
        heading: "More than one layer",
        paragraphs: [
          "Some places need more than textContent. A link's href can hold a javascript: URL, which runs when clicked, so only allow http and https there.",
          "A Content Security Policy is the second line: it tells the browser which scripts the site actually ships, so an injected one that slips through has nowhere to run."
        ]
      }
    ],
    demo: "xss",
    guided: {
      brief: "The account page greets customers by the display name they chose. Priya flagged that a name can contain markup. Marcus left a note on the line; make the name go in as text.",
      file: "public/account.js",
      start:
`function showGreeting(user) {
  const greeting = document.querySelector('#greeting');

  // Marcus: the display name is data. Put it in as text, not markup.
  greeting.innerHTML = user.displayName;
}`,
      solution:
`function showGreeting(user) {
  const greeting = document.querySelector('#greeting');

  greeting.textContent = user.displayName;
}`,
      steps: [
        "Marcus found the sink: the line that writes the name into the page.",
        "Swap innerHTML for the property that inserts plain text."
      ],
      meta: { inputNames: ["displayName", "user"] },
      rules: ["xss.no-html-sink", "xss.uses-safe-sink", "output.reaches-the-page",
              "output.no-markup-stripping"]
    },
    check: [
      {
        id: "safe-sink",
        question: "Which is safe for a review a customer wrote?",
        options: [
          { id: "text", text: "el.textContent = review" },
          { id: "strip", text: "el.innerHTML = review.replace(/<script>/g, '')" },
          { id: "html", text: "el.innerHTML = review" }
        ],
        answer: "text",
        explanations: {
          text: "Right. The review is shown exactly as written and never parsed as markup.",
          strip: "Script doesn't need a <script> tag. An <img onerror=...> passes straight through this filter.",
          html: "This parses the review as HTML, so any tags in it become live elements."
        }
      },
      {
        id: "href",
        question: "A profile link is built from a customer's website field. What else does it need?",
        options: [
          { id: "nothing", text: "Nothing, if it's set with textContent elsewhere." },
          { id: "scheme", text: "Only allow http: and https: URLs in the href." },
          { id: "encode", text: "URL-encode the whole value." }
        ],
        answer: "scheme",
        explanations: {
          nothing: "An href isn't text content. A javascript: URL there runs when clicked, whatever the visible text says.",
          scheme: "Right. Allow the schemes you expect rather than trying to block the dangerous ones.",
          encode: "Encoding the whole value breaks real links and still doesn't say which schemes are allowed."
        }
      }
    ]
  },

  {
    id: "lesson-csrf",
    skill: "csrf",
    title: "Forged requests",
    from: "Marcus (Incident Response)",
    opener: "This one doesn't need a single malicious character in Aurora's code. It uses the browser's own good manners.",
    theory: [
      {
        heading: "The browser sends the cookie for you",
        paragraphs: [
          "When a signed-in customer's browser makes a request to Aurora, it attaches Aurora's session cookie automatically, even when another site started the request. A hidden form on a page they happened to visit can post to Aurora's account routes.",
          "Aurora sees a valid session and does what it's asked: changes the email address, moves the payout account. The customer never clicked anything on Aurora."
        ]
      },
      {
        heading: "Prove the request came from Aurora's own page",
        paragraphs: [
          "A CSRF token is a secret, random value Aurora puts in its own forms and remembers in the session. Another site can make the browser send a request, but it can't read Aurora's pages, so it can't learn the token to include.",
          "Every request that changes something must carry a token that matches, and a missing token must be rejected too. Checking only when one is present lets the forged request, which has none, straight through."
        ],
        code: "if (csrfToken !== req.session.csrfToken) {\n  return res.status(403).json({ error: 'Invalid request token.' });\n}"
      },
      {
        heading: "A second layer: SameSite cookies",
        paragraphs: [
          "Marking the session cookie SameSite=Lax tells the browser not to attach it to cross-site form posts at all. Strict goes further but also drops the cookie when a customer follows a link from an email, which signs them out.",
          "And a GET request should never change anything. Links, images and prefetching all make GETs without asking."
        ]
      }
    ],
    demo: "csrf",
    guided: {
      brief: "The newsletter toggle changes a customer's settings, so another site could flip it. Marcus already reads the token from the form. Finish the fix: refuse the request unless it matches the one in the session.",
      file: "routes/newsletter.js",
      start:
`app.post('/api/account/newsletter', async (req, res) => {
  // Marcus: the form now sends csrfToken. Reject the request unless it
  // matches req.session.csrfToken, before anything changes.
  const { subscribed, csrfToken } = req.body;

  await setNewsletter(req.session.userId, subscribed);
  res.json({ ok: true });
});`,
      solution:
`app.post('/api/account/newsletter', async (req, res) => {
  const { subscribed, csrfToken } = req.body;

  if (csrfToken !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid request token.' });
  }

  await setNewsletter(req.session.userId, subscribed);
  res.json({ ok: true });
});`,
      steps: [
        "Marcus made the form send its token, and read it from the body.",
        "Before setNewsletter runs, return a 403 unless csrfToken matches req.session.csrfToken."
      ],
      meta: { inputNames: ["subscribed"], expectedCall: "setNewsletter" },
      rules: ["csrf.verifies-token", "csrf.not-header-only", "csrf.still-performs-the-action"]
    },
    check: [
      {
        id: "why-token",
        question: "Why can't the attacker's page just include the right token?",
        options: [
          { id: "read", text: "It can't read Aurora's pages, so it never learns the token." },
          { id: "encrypted", text: "The token is encrypted, so it can't be copied." },
          { id: "blocked", text: "Browsers block forms that post to other sites." }
        ],
        answer: "read",
        explanations: {
          read: "Right. The browser will send the request, but it won't let another site read Aurora's responses, and that's where the token lives.",
          encrypted: "It doesn't need to be encrypted, just unguessable and unreadable from another site.",
          blocked: "Browsers happily send cross-site form posts. That's what makes the attack possible."
        }
      },
      {
        id: "check",
        question: "Which check is correct?",
        options: [
          { id: "strict", text: "if (csrfToken !== req.session.csrfToken) reject" },
          { id: "present", text: "if (csrfToken && csrfToken !== req.session.csrfToken) reject" },
          { id: "get", text: "Check the token on GET requests only" }
        ],
        answer: "strict",
        explanations: {
          strict: "Right. A missing token doesn't match, so it's rejected too.",
          present: "A forged request carries no token at all, so this check never runs for it.",
          get: "GETs shouldn't change anything in the first place. It's the POSTs that need the check."
        }
      }
    ]
  }
];

/** @param {string} id */
export function lessonById(id) {
  return LESSONS.find(l => l.id === id) ?? null;
}

/** @param {string} skill */
export function lessonForSkill(skill) {
  return LESSONS.find(l => l.skill === skill) ?? null;
}
