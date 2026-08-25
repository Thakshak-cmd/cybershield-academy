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
