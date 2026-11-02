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
 * @property {{ term: string, meaning: string }[]} keyTerms   plain-English definitions, shown first
 * @property {{ heading: string, paragraphs: string[], code?: string }[]} theory
 * @property {string} takeaway   the one thing to remember, in a sentence
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
    keyTerms: [
      {
        "term": "Database",
        "meaning": "Where a website keeps its information, such as products, orders and customer accounts."
      },
      {
        "term": "Query",
        "meaning": "A question the website asks its database, like \"find products called laptop\". Queries are written in a language called SQL (say \"sequel\")."
      },
      {
        "term": "String",
        "meaning": "A piece of text in code. It sits between quote marks, like 'laptop'."
      },
      {
        "term": "Placeholder",
        "meaning": "A ? in a query that marks where a value will go. The value itself is handed over separately."
      }
    ],
    theory: [
      {
        "heading": "How a search box talks to the database",
        "paragraphs": [
          "When you search Aurora's shop for \"laptop\", the website asks its database a question: find every product whose name contains \"laptop\". That question is called a query.",
          "The website builds the query by slotting whatever you typed into the middle of a line of SQL. In the code below, ${term} means \"put the customer's search here\"."
        ],
        "code": "const sql = `SELECT id, name FROM products WHERE name LIKE '%${term}%'`;"
      },
      {
        "heading": "Where it goes wrong",
        "paragraphs": [
          "The quote marks around the search tell the database \"this part is just text\". But a customer can type a quote mark too. When they do, the database thinks the text has ended, and reads whatever comes next as instructions.",
          "Think of a paper form where someone writes in the name box: \"Bob. Also, give Bob a refund.\" A clerk who can't tell the box's contents from the form's own wording might follow that extra instruction. That is SQL injection: typing instructions where only information should go."
        ]
      },
      {
        "heading": "Why deleting quote marks doesn't fix it",
        "paragraphs": [
          "An obvious idea is to remove quote marks from whatever customers type. But honest customers need them: a search for O'Brien's Guide would find nothing.",
          "And some parts of a query have no quote marks at all, such as a product number, so there is nothing to remove. Guessing which characters are dangerous is a losing game."
        ]
      },
      {
        "heading": "The fix: keep the customer's input separate",
        "paragraphs": [
          "Write the query with a ? where the customer's input goes, then hand the input over separately. The database always treats it as a value to look for, never as instructions, whatever it contains, quote marks included.",
          "One rule to remember: a ? can only stand in for a value, like a search word or an id. It can't stand in for part of the query's structure, such as a column name to sort by. Those must be picked from a fixed list of allowed names.",
          "As an extra layer of protection, the database login the website uses should only be allowed to do what the website needs."
        ],
        "code": "const sql = 'SELECT id, name FROM products WHERE name LIKE ?';\nconst rows = await db.query(sql, [`%${term}%`]);"
      }
    ],
    takeaway: "Never paste what a customer typed into a query. Put a ? there and pass their input separately.",
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
    keyTerms: [
      {
        "term": "Browser",
        "meaning": "The program you view websites in, such as Chrome, Safari or Firefox."
      },
      {
        "term": "HTML",
        "meaning": "The code a browser reads to build a web page, like <b>bold</b> for bold text or <img> for a picture."
      },
      {
        "term": "Script",
        "meaning": "A small program that runs inside a web page, in the visitor's browser, acting as that visitor."
      },
      {
        "term": "innerHTML / textContent",
        "meaning": "Two ways a website can put text onto a page: innerHTML treats it as HTML to build; textContent shows it as plain text."
      }
    ],
    theory: [
      {
        "heading": "Web pages are built from HTML",
        "paragraphs": [
          "A web page arrives in your browser as HTML: instructions such as \"make this bold\" or \"show a picture here\". The browser reads them and builds the page you see.",
          "Some HTML can run scripts. A script runs inside the page as the person looking at it, with their access: if they are signed in, so is the script."
        ]
      },
      {
        "heading": "Where it goes wrong",
        "paragraphs": [
          "Aurora shows customers' reviews and delivery notes on other people's screens. If the website puts that text on the page with innerHTML, it is telling the browser \"treat this as HTML and build it\".",
          "So if a customer types HTML into their note, the browser builds it. If that HTML runs a script, the script runs for everyone who views the note, signed in as them. That is cross-site scripting, or XSS."
        ],
        "code": "note.innerHTML = order.deliveryNote;"
      },
      {
        "heading": "The fix: put text on the page as text",
        "paragraphs": [
          "Use textContent instead. It shows the customer's words exactly as typed: a < appears as a < character, and nothing gets built or run.",
          "Make the change on the exact line where the text goes onto the page. Trying to delete <script> tags from the text doesn't work, because many other kinds of HTML can run scripts too."
        ],
        "code": "note.textContent = order.deliveryNote;"
      },
      {
        "heading": "Links need one more check",
        "paragraphs": [
          "A link's address can start with javascript: instead of https:, and clicking it runs code. So when a link is built from something a customer typed, only allow addresses that start with http: or https:.",
          "As a backup, a setting called a Content Security Policy tells the browser which scripts the website really uses, so an injected one has nowhere to run."
        ]
      }
    ],
    takeaway: "Customer text goes onto the page with textContent, never innerHTML.",
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
    keyTerms: [
      {
        "term": "Session",
        "meaning": "After you sign in, the website remembers you for a while. That remembering is your session."
      },
      {
        "term": "Cookie",
        "meaning": "A small note a website stores in your browser. Aurora's session cookie is how it knows the browser belongs to you."
      },
      {
        "term": "Request",
        "meaning": "Each time your browser asks a website to do something: show a page, or change your email address."
      },
      {
        "term": "CSRF token",
        "meaning": "A secret, random code Aurora puts into its own forms, so it can tell its own forms apart from anyone else's."
      }
    ],
    theory: [
      {
        "heading": "Your browser vouches for you automatically",
        "paragraphs": [
          "When you are signed in to Aurora, your browser holds Aurora's session cookie. Every time your browser sends a request to Aurora, it attaches that cookie automatically. That is what keeps you signed in as you move around the site."
        ]
      },
      {
        "heading": "Where it goes wrong",
        "paragraphs": [
          "The browser attaches the cookie even when a different website started the request. Imagine you are signed in to Aurora and you open a page from a stranger's email. That page can contain a hidden form that sends Aurora a request: \"change this account's email address\".",
          "Your browser adds your cookie, Aurora sees a signed-in customer, and makes the change. You never clicked anything on Aurora. This is cross-site request forgery, or CSRF: another website forging a request in your name."
        ]
      },
      {
        "heading": "The fix: a secret the other website can't know",
        "paragraphs": [
          "Aurora puts a secret, random code, a CSRF token, into its own forms, and remembers it in your session. When a request arrives, Aurora checks that the code matches.",
          "The stranger's page can make your browser send a request, but it can't read Aurora's pages, so it can never learn the code. Requests without the right code are refused, and that includes requests with no code at all."
        ],
        "code": "if (csrfToken !== req.session.csrfToken) {\n  return res.status(403).json({ error: 'Invalid request token.' });\n}"
      },
      {
        "heading": "Two extra layers",
        "paragraphs": [
          "Marking the session cookie SameSite=Lax tells the browser not to send it with forms posted from other websites at all.",
          "And a request that only fetches a page (called a GET request) should never change anything, because links and images make those requests all the time."
        ]
      }
    ],
    takeaway: "Every request that changes something must carry Aurora's secret token, and a missing token counts as a wrong one.",
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
