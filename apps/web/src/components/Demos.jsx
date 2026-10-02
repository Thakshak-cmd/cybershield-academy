import { useMemo, useState } from "react";
import "./Demos.css";

/**
 * "See it happen": one live demonstration per skill.
 *
 * Each is a simulation, never an execution. The SQL demo only builds strings;
 * the XSS demo parses into an inert document (DOMParser output has no browsing
 * context, so it runs no script and loads nothing) and reports what the browser
 * *would* have built; the CSRF demo narrates a request. Each pairs the broken
 * version with the fixed one on the same input, because the lesson is the
 * contrast, and shows the fix still doing the honest job -- the same two-suite
 * tension the tickets are scored on.
 *
 * @param {{ kind: "sqli"|"xss"|"csrf" }} props
 */
export function Demo({ kind }) {
  if (kind === "sqli") return <SqliDemo />;
  if (kind === "xss") return <XssDemo />;
  return <CsrfDemo />;
}

/* ------------------------------------------------------------------ SQLi */

const SQL_PRESETS = [
  { label: "A normal search", value: "laptop" },
  { label: "An honest apostrophe", value: "O'Brien's Guide" },
  { label: "What an attacker types", value: "x' OR '1'='1" }
];

/**
 * Walk the query as the database's tokenizer would, marking each character of
 * the input as inside the string literal (data) or outside it (code).
 *
 * @param {string} input
 */
export function classifySqlInput(input) {
  const before = "SELECT id, name FROM products WHERE name LIKE '%";
  const after = "%'";
  const full = before + input + after;
  let inLiteral = false;
  /** @type {boolean[]} whether each character of `full` is inside a literal */
  const literal = [];
  for (let i = 0; i < full.length; i++) {
    const ch = full[i];
    if (ch === "'") {
      // '' inside a literal is an escaped quote, not the end of it.
      if (inLiteral && full[i + 1] === "'") { literal.push(true, true); i++; continue; }
      // The quote that opens or closes a literal is syntax, not data -- and when
      // it came from the input, it is the character that did the escaping.
      literal.push(false);
      inLiteral = !inLiteral;
      continue;
    }
    literal.push(inLiteral);
  }
  const start = before.length;
  const marks = [...input].map((_, i) => literal[start + i]);
  // From the first character that escaped to the end: everything after the
  // break-out is the customer writing the query, whichever parts of it happen
  // to sit inside quotes of their own.
  const first = marks.indexOf(false);
  const escaped = first < 0 ? "" : input.slice(first).trim();
  return {
    before, after, escaped, balanced: !inLiteral,
    marks: marks.map((m, i) => (first >= 0 && i >= first ? false : m))
  };
}

function SqliDemo() {
  const [input, setInput] = useState(SQL_PRESETS[0].value);
  const [mode, setMode] = useState(/** @type {"pasted"|"param"} */ ("pasted"));
  const { before, after, marks, escaped, balanced } = useMemo(() => classifySqlInput(input), [input]);

  return (
    <div className="demo">
      <p className="demo__intro">Type into Aurora's search box and watch the query the route sends.</p>
      <DemoInput label="Search box" value={input} onChange={setInput} presets={SQL_PRESETS} />
      <Toggle
        value={mode}
        onChange={setMode}
        options={[["pasted", "Pasted into the string"], ["param", "Parameterised"]]}
      />

      {mode === "pasted" ? (
        <>
          <pre className="demo__code" aria-label="The query sent to the database">
            {before}
            {[...input].map((ch, i) => (
              <span key={i} className={marks[i] ? "demo__data" : "demo__escaped"}>{ch}</span>
            ))}
            {after}
          </pre>
          {escaped ? (
            <p className="demo__verdict demo__verdict--bad">
              Part of what was typed is no longer inside the value: <code>{escaped}</code>.
              {" "}The database reads it as SQL. For an honest customer that means an error;
              {" "}for an attacker, it means they are writing the query.
            </p>
          ) : !balanced ? (
            <p className="demo__verdict demo__verdict--bad">
              The apostrophe ended the string early, so the query no longer parses.
            </p>
          ) : (
            <p className="demo__verdict">All of it stayed inside the value. This time.</p>
          )}
        </>
      ) : (
        <>
          <pre className="demo__code" aria-label="The query and its parameters">
            {"SELECT id, name FROM products WHERE name LIKE ?\n"}
            <span className="demo__muted">{"params: "}</span>
            <span className="demo__data">{JSON.stringify([`%${input}%`])}</span>
          </pre>
          <p className="demo__verdict demo__verdict--good">
            The query text never changes. Whatever is typed travels separately and is only ever a value,
            and O&apos;Brien&apos;s Guide is found like any other book.
          </p>
        </>
      )}
      <Legend items={[["demo__data", "data"], ["demo__escaped", "read as SQL"]]} />
      <Announce text={mode === "param" ? "Parameterised. The input is only ever a value."
        : escaped ? "Part of the input is now read as SQL."
        : !balanced ? "The query no longer parses."
        : "All of the input stayed inside the value."} />
    </div>
  );
}

/* ------------------------------------------------------------------- XSS */

const XSS_PRESETS = [
  { label: "A normal note", value: "Please leave it by the back door." },
  { label: "Some formatting", value: "Leave it with <b>number 12</b>." },
  { label: "What an attacker types", value: `Thanks! <img src=x onerror="stealSession()">` }
];

/**
 * What the browser would build from a string given to innerHTML, found by
 * parsing it into an inert document. Nothing is attached to the live page.
 *
 * @param {string} html
 */
function inspectMarkup(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return [...doc.body.querySelectorAll("*")].map(el => {
    const handlers = [...el.attributes].filter(a => /^on/i.test(a.name));
    const jsUrl = [...el.attributes].find(a => /^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value));
    return {
      tag: el.tagName.toLowerCase(),
      runs: handlers.map(a => `${a.name}="${a.value}"`).concat(jsUrl ? [`${jsUrl.name}="${jsUrl.value}"`] : [])
    };
  });
}

function XssDemo() {
  const [note, setNote] = useState(XSS_PRESETS[0].value);
  const [mode, setMode] = useState(/** @type {"html"|"text"} */ ("html"));
  const built = useMemo(() => inspectMarkup(note), [note]);
  const running = built.filter(b => b.runs.length);

  return (
    <div className="demo">
      <p className="demo__intro">
        A customer writes a delivery note. The courier's order page shows it. See what the courier's browser does with it.
      </p>
      <DemoInput label="Delivery note" value={note} onChange={setNote} presets={XSS_PRESETS} />
      <Toggle
        value={mode}
        onChange={setMode}
        options={[["html", "note.innerHTML = …"], ["text", "note.textContent = …"]]}
      />

      {mode === "html" ? (
        <>
          <div className="demo__panel">
            <span className="label">What the browser builds</span>
            {built.length === 0 ? (
              <p className="demo__plain">Just text. No elements this time.</p>
            ) : (
              <ul className="demo__elements">
                {built.map((b, i) => (
                  <li key={i} className={b.runs.length ? "demo__el demo__el--runs" : "demo__el"}>
                    <code>&lt;{b.tag}&gt;</code> element
                    {b.runs.map(r => <span key={r} className="demo__runs">runs script: <code>{r}</code></span>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {running.length ? (
            <p className="demo__verdict demo__verdict--bad">
              The note became live elements, and one of them runs script in the courier's browser, signed in as the courier.
            </p>
          ) : built.length ? (
            <p className="demo__verdict demo__verdict--bad">
              No script this time, but the customer is writing Aurora's markup. The next note might not be so polite.
            </p>
          ) : (
            <p className="demo__verdict">Nothing was built from it. This time.</p>
          )}
        </>
      ) : (
        <>
          <div className="demo__panel">
            <span className="label">What the courier sees</span>
            <p className="demo__plain demo__literal">{note}</p>
          </div>
          <p className="demo__verdict demo__verdict--good">
            Shown exactly as written. No elements are created, so there is nothing to run.
          </p>
        </>
      )}
      <Announce text={mode === "text" ? "Shown as text. Nothing is built."
        : running.length ? `The note becomes elements, and one runs script: ${running[0].runs[0]}.`
        : built.length ? "The note becomes elements, though none runs script."
        : "Just text. Nothing is built."} />
    </div>
  );
}

/* ------------------------------------------------------------------ CSRF */

function CsrfDemo() {
  const [token, setToken] = useState(false);
  const [sameSite, setSameSite] = useState(false);
  const [from, setFrom] = useState(/** @type {"stranger"|"aurora"|null} */ (null));

  const forged = from === "stranger";
  const cookieSent = !(forged && sameSite);
  const tokenOk = !forged; // Aurora's own page has the token; the stranger's cannot.
  const outcome = !from ? null
    : !cookieSent ? { ok: false, text: "401 · not signed in. Nothing changed." }
    : token && !tokenOk ? { ok: false, text: "403 · invalid request token. Nothing changed." }
    : forged ? { ok: false, breach: true, text: "200 · email changed to attacker@example.net" }
    : { ok: true, text: "200 · email changed to the address you typed" };

  return (
    <div className="demo">
      <p className="demo__intro">
        You're signed in to Aurora in one tab. Turn Aurora's defences on or off, then see what happens when a request arrives.
      </p>
      <div className="demo__switches">
        <label className="demo__switch">
          <input type="checkbox" checked={token} onChange={e => { setToken(e.target.checked); setFrom(null); }} />
          Aurora checks a CSRF token
        </label>
        <label className="demo__switch">
          <input type="checkbox" checked={sameSite} onChange={e => { setSameSite(e.target.checked); setFrom(null); }} />
          Session cookie is SameSite=Lax
        </label>
      </div>
      <div className="demo__buttons">
        <button className="cmd pixel" onClick={() => setFrom("stranger")}>
          <span className="cmd__caret">▸</span> Open a stranger's page
        </button>
        <button className="cmd pixel" onClick={() => setFrom("aurora")}>
          <span className="cmd__caret">▸</span> Change email on Aurora
        </button>
      </div>

      {from && (
        <ol className="demo__steps" key={`${from}-${token}-${sameSite}`}>
          <li>
            {forged
              ? <>The stranger's page quietly submits a hidden form to <code>aurora-store/api/account/email</code>.</>
              : <>You submit Aurora's own settings form to <code>aurora-store/api/account/email</code>.</>}
          </li>
          <li>
            {cookieSent
              ? <>The browser attaches <code>Cookie: session=…</code> automatically{forged ? ", because the request goes to Aurora." : "."}</>
              : <>The browser leaves the session cookie off: SameSite=Lax means no cookie on a cross-site form post.</>}
          </li>
          {cookieSent && token && (
            <li>
              {tokenOk
                ? <>The form carries the <code>csrfToken</code> Aurora put in it, and it matches the session.</>
                : <>The form has no <code>csrfToken</code>. The stranger's page can't read Aurora's pages to find one.</>}
            </li>
          )}
          <li className={outcome?.breach ? "demo__step--bad" : outcome?.ok ? "demo__step--good" : "demo__step--held"}>
            Aurora replies <code>{outcome?.text}</code>
          </li>
        </ol>
      )}
      {from === "stranger" && outcome?.breach && (
        <p className="demo__verdict demo__verdict--bad">
          Aurora saw a valid session and did as it was asked. You never clicked anything on Aurora.
        </p>
      )}
      {from === "aurora" && (token || sameSite) && (
        <p className="demo__verdict demo__verdict--good">
          The real form still works with the defences on. They stop the forgery, not the customer.
        </p>
      )}
      <Announce text={outcome ? `Aurora replies ${outcome.text}` : ""} />
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

/**
 * What each demo is showing, for a screen reader, in one short sentence.
 *
 * Always on the page, with only its text changing: a live region mounted at the
 * same moment as its content is often not announced at all. One summary per
 * demo, rather than every changing element marked live, so typing into the
 * search box is not read back a character at a time.
 */
function Announce({ text }) {
  return <p className="visually-hidden" aria-live="polite">{text}</p>;
}

function DemoInput({ label, value, onChange, presets }) {
  return (
    <div className="demo__input">
      <label className="label" htmlFor={`demo-${label}`}>{label}</label>
      <input id={`demo-${label}`} className="field__input" value={value}
             onChange={e => onChange(e.target.value)} spellCheck={false} autoComplete="off" />
      <div className="demo__presets">
        {presets.map(p => (
          <button key={p.label} type="button" aria-pressed={p.value === value}
                  className={p.value === value ? "demo__preset demo__preset--on" : "demo__preset"}
                  onClick={() => onChange(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ value, onChange, options }) {
  return (
    <div className="demo__toggle" role="group" aria-label="Which version">
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id}
                className={value === id ? "demo__tab demo__tab--on" : "demo__tab"}
                onClick={() => onChange(id)}>
          <code>{text}</code>
        </button>
      ))}
    </div>
  );
}

function Legend({ items }) {
  return (
    <p className="demo__legend">
      {items.map(([cls, text]) => <span key={cls}><span className={`demo__swatch ${cls}`}>ab</span> {text}</span>)}
    </p>
  );
}
