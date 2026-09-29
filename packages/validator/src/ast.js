import * as acorn from "acorn";
import * as walk from "acorn-walk";

/**
 * Parse a learner submission. A syntax error is a validation result, not a crash --
 * novices submit unparseable code constantly and the platform must respond with
 * something useful rather than a 500.
 */
export function parse(source) {
  try {
    return {
      ok: true,
      ast: acorn.parse(source, { ecmaVersion: 2023, sourceType: "module", locations: true })
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        message: err.message.replace(/\s*\(\d+:\d+\)$/, ""),
        line: err.loc ? err.loc.line : null,
        column: err.loc ? err.loc.column : null
      }
    };
  }
}

/** Collect every node of a given type. */
export function findAll(ast, type) {
  const out = [];
  walk.simple(ast, { [type]: node => out.push(node) });
  return out;
}

/** Does this node represent a call to `<object>.<method>(...)`? */
export function isMethodCall(node, method) {
  return node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === method;
}

/** Template literals with no interpolation are just strings; only filled slots matter. */
export function isInterpolated(node) {
  return node.type === "TemplateLiteral" && node.expressions.length > 0;
}

/**
 * Best-effort static text of a string-ish node, used only for SQL keyword sniffing.
 * Interpolated slots become whitespace rather than being guessed at.
 */
export function staticText(node) {
  if (!node) return "";
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    return node.quasis.map(q => (q.value.cooked === null ? "" : q.value.cooked)).join(" ");
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return staticText(node.left) + " " + staticText(node.right);
  }
  return "";
}

const SQL_RE = /\bselect\b[\s\S]*\bfrom\b|\bselect\b[\s\S]*\bwhere\b/i;

/** Does this node look like it carries a SQL statement? */
export function looksLikeSql(node) {
  return SQL_RE.test(staticText(node));
}

/** Identifier names read anywhere in a subtree. Used to spot input being mutated. */
export function identifiersIn(node) {
  const names = new Set();
  walk.full(node, n => {
    if (n.type === "Identifier") names.add(n.name);
  });
  return names;
}

/**
 * Map local `const`/`let` names to the expression they were initialised with.
 *
 * Needed because SQL is almost always built into a variable and only then passed to
 * the driver -- `db.query(sql)` hands the rule an Identifier, not the template
 * literal that actually splices the input.
 */
export function buildBindings(ast) {
  const bindings = new Map();
  for (const d of findAll(ast, "VariableDeclarator")) {
    if (d.id.type === "Identifier" && d.init) bindings.set(d.id.name, d.init);
  }
  return bindings;
}

/** Follow an Identifier back to its initialiser. Depth-capped against cycles. */
export function resolve(node, bindings, depth = 0) {
  if (!node || depth > 8) return node;
  if (node.type === "Identifier" && bindings.has(node.name)) {
    return resolve(bindings.get(node.name), bindings, depth + 1);
  }
  return node;
}

/** Assignments of the form `<something>.<prop> = <value>`. */
export function assignmentsTo(ast, prop) {
  const out = [];
  for (const node of findAll(ast, "AssignmentExpression")) {
    const left = node.left;
    if (
      left.type === "MemberExpression" &&
      !left.computed &&
      left.property.type === "Identifier" &&
      left.property.name === prop
    ) {
      out.push(node);
    }
  }
  return out;
}

/**
 * Does this expression carry any of the named values?
 *
 * Follows local bindings, so a value laundered through an intermediate variable
 * is still recognised as tainted -- which is exactly what a learner's first
 * attempt tends to do.
 */
export function carriesAny(node, names, bindings, depth = 0) {
  if (!node || depth > 8) return false;
  const resolved = resolve(node, bindings, depth);
  const seen = identifiersIn(resolved);
  if (names.some(n => seen.has(n))) return true;

  // An identifier that resolved to something else may itself be a rename of a
  // tainted value; keep following.
  for (const name of seen) {
    if (bindings.has(name) && depth < 8) {
      if (carriesAny(bindings.get(name), names, bindings, depth + 1)) return true;
    }
  }
  return false;
}

/** Names of every function called anywhere, member calls included. */
export function calledNames(ast) {
  const names = new Set();
  for (const call of findAll(ast, "CallExpression")) {
    const callee = call.callee;
    if (callee.type === "Identifier") names.add(callee.name);
    else if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
      names.add(callee.property.name);
    }
  }
  return names;
}

/**
 * Does a tainted value reach this expression *without* passing through an
 * escaping call on the way?
 *
 * The distinction matters: escaping and then writing markup is a correct defence,
 * and a rule that only asked "does tainted input reach innerHTML" would mark the
 * right answer wrong. Teaching a learner that a correct patch is incorrect is a
 * worse failure than missing a vulnerable one.
 *
 * @param {any} node
 * @param {string[]} names
 * @param {Map<string, any>} bindings
 * @param {(name: string) => boolean} isEscaper
 */
export function unescapedTaint(node, names, bindings, isEscaper, depth = 0) {
  if (!node || depth > 8) return false;

  // A call to an escaper neutralises whatever it wraps, so stop descending into
  // its arguments -- but keep checking the callee's object, since
  // `escapeHtml(a) + b` must still see b.
  if (node.type === "CallExpression") {
    const callee = node.callee;
    const name =
      callee.type === "Identifier" ? callee.name
      : callee.type === "MemberExpression" && callee.property.type === "Identifier"
        ? callee.property.name
        : "";
    if (isEscaper(name)) return false;

    // The receiver matters as much as the arguments. `term.slice(0)` returns a
    // value derived from term, so checking only the arguments would let any
    // string method launder taint away.
    const viaReceiver =
      callee.type === "MemberExpression" &&
      unescapedTaint(callee.object, names, bindings, isEscaper, depth + 1);

    return viaReceiver
      || node.arguments.some(a => unescapedTaint(a, names, bindings, isEscaper, depth + 1));
  }

  if (node.type === "Identifier") {
    if (names.includes(node.name)) return true;
    const bound = bindings.get(node.name);
    return bound ? unescapedTaint(bound, names, bindings, isEscaper, depth + 1) : false;
  }

  if (node.type === "MemberExpression") {
    if (node.property.type === "Identifier" && names.includes(node.property.name)) return true;
    return unescapedTaint(node.object, names, bindings, isEscaper, depth + 1);
  }

  if (node.type === "BinaryExpression") {
    return unescapedTaint(node.left, names, bindings, isEscaper, depth + 1)
        || unescapedTaint(node.right, names, bindings, isEscaper, depth + 1);
  }

  if (node.type === "TemplateLiteral") {
    return node.expressions.some(e => unescapedTaint(e, names, bindings, isEscaper, depth + 1));
  }

  return false;
}

/** Key name of an object property, whether written `a: 1` or `"a": 1`. */
export function propKey(prop) {
  if (prop.type !== "Property") return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal") return String(prop.key.value);
  return null;
}

/** The value node for `key` in an object literal, or null. */
export function objectProp(obj, key) {
  if (!obj || obj.type !== "ObjectExpression") return null;
  const found = obj.properties.find(p => propKey(p) === key);
  return found ? found.value : null;
}

/** Every object literal in the file that declares `key`. */
export function objectsWithKey(ast, key) {
  return findAll(ast, "ObjectExpression").filter(o => objectProp(o, key) !== null);
}

/** A literal's value, or undefined for anything that is not a plain literal. */
export function literalValue(node) {
  if (!node) return undefined;
  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return undefined;
}

/** The string members of an array literal. Non-literal members are skipped. */
export function arrayStrings(node) {
  if (!node || node.type !== "ArrayExpression") return [];
  return node.elements.map(literalValue).filter(v => typeof v === "string");
}

/** Every string the file contains, template quasis included. */
export function allStrings(ast) {
  const out = [];
  for (const lit of findAll(ast, "Literal")) {
    if (typeof lit.value === "string") out.push({ text: lit.value, node: lit });
  }
  for (const tpl of findAll(ast, "TemplateLiteral")) {
    out.push({ text: tpl.quasis.map(q => q.value.cooked ?? "").join(" "), node: tpl });
  }
  return out;
}
