/**
 * adj-200.2.3 — SECURITY-CRITICAL proposal HTML sanitizer.
 *
 * Composed proposal documents are served to UNAUTHENTICATED viewers via the public
 * `GET /p/:token` route (and rendered in sandboxed in-app web views / iOS WebViews).
 * This module is the single, load-bearing security boundary for that content.
 *
 * Policy:
 *   ALLOW  — semantic HTML (headings, lists, tables, code/pre, blockquote, etc.),
 *            inline `style` attributes, `<style>` blocks, inline `<svg>` drawings,
 *            `<img>` with `data:` URIs only, and `<a>` http/https/mailto links.
 *   STRIP  — `<script>` (incl. SVG-borne), `on*` event handlers, `javascript:` URLs,
 *            `<iframe>`/`<object>`/`<embed>`, external resource URLs (external
 *            `<img src>`, external CSS `url()` / `@import`), and CSS `expression()`.
 *
 * Layers:
 *   1. sanitize-html with an explicit allowlist (tags / attributes / URL schemes).
 *   2. A mutation-XSS (mXSS) fixpoint pass: sanitize-html parses with htmlparser2,
 *      which keeps some constructs (e.g. an `<img>` inside `<svg><style>…`) as raw
 *      text — but a SPEC-COMPLIANT browser parser (parse5/Chrome/WebKit) re-parses
 *      that raw text into LIVE elements with LIVE event handlers (classic mXSS). We
 *      defend the class by re-serializing the sanitized output through parse5 — the
 *      same algorithm the browser uses — and re-running the allowlist to a fixpoint,
 *      so anything the browser would resurrect is itself sanitized. The public /p
 *      route adds CSP on top, but the composed document is ALSO rendered on surfaces
 *      with NO CSP (iOS WKWebView loadHTMLString, non-CSP embeds), so the sanitizer
 *      must stand alone here. (adj-200.2.3.1, NFR-001.)
 *   3. A CSS pass that neutralizes external/script resource references that live
 *      inside inline `style` attributes and `<style>` blocks (sanitize-html does not
 *      parse CSS bodies). This enforces the "self-contained, no external fetch"
 *      contract (NFR-002) on top of the script-execution defenses above.
 */

import { parseFragment, serialize } from "parse5";
import sanitizeHtml from "sanitize-html";

// --- Allowlists -------------------------------------------------------------

const SEMANTIC_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "span", "div", "section", "article", "header", "footer", "main", "aside", "nav",
  "figure", "figcaption", "blockquote", "q", "cite", "abbr", "address",
  "b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "mark", "del", "ins",
  "br", "hr", "wbr",
  "code", "pre", "kbd", "samp", "var", "time", "details", "summary",
  "dl", "dt", "dd", "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "a", "img", "style",
];

// SVG drawing elements only. Deliberately EXCLUDES <script>, <foreignObject>,
// <image>, <use>, and <a> — each can execute script or fetch external resources.
const SVG_TAGS = [
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "defs", "linearGradient", "radialGradient", "stop",
  "clipPath", "mask", "pattern", "marker", "symbol", "title", "desc", "style",
];

// Safe global presentation / structural attributes (includes SVG geometry attrs).
// `on*` handlers are intentionally ABSENT, so sanitize-html drops every event handler.
const GLOBAL_ATTRS = [
  "class", "id", "style", "title", "role", "lang", "dir",
  "aria-label", "aria-hidden", "aria-describedby", "aria-labelledby",
  "colspan", "rowspan", "scope", "align", "valign", "span", "datetime",
  // SVG presentation / geometry attributes (harmless, no script/fetch surface)
  "d", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
  "transform", "viewBox", "xmlns", "preserveAspectRatio", "version",
  "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "points", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
  "opacity", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline",
  "clip-path", "marker-end", "marker-start", "marker-mid", "patternUnits", "maskUnits",
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...SEMANTIC_TAGS, ...SVG_TAGS],
  allowedAttributes: {
    "*": GLOBAL_ATTRS,
    a: ["href", "target", "rel", "name", "download"],
    img: ["src", "alt", "width", "height", "style", "class", "id"],
  },
  // Links: navigational schemes only. javascript:/data:/etc. on <a> are dropped.
  allowedSchemes: ["http", "https", "mailto"],
  // Images: data: URIs ONLY — strips external http(s) img src (exfil / tracking pixels).
  allowedSchemesByTag: { img: ["data"] },
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
  // Protocol-relative ("//host/x") is treated as external and stripped.
  allowProtocolRelative: false,
  // We intentionally allow <style> (needed for self-contained documents). sanitize-html
  // flags it as "vulnerable"; layer 2 below neutralizes the actual CSS attack surface.
  allowVulnerableTags: true,
  // Drop the *contents* of these tags when the tag is disallowed (e.g. <script>).
  nonTextTags: ["script", "textarea", "option", "noscript"],
  // NOTE: `allowedStyles` is intentionally left unset so inline `style` bodies pass
  // through verbatim (no per-property whitelist); the dangerous CSS surface is removed
  // by neutralizeCss() in layer 2. Do NOT set `allowedStyles: {}` — in sanitize-html
  // that means "strip all styles", which would break self-contained rendering.
  parser: { lowerCaseAttributeNames: false }, // preserve viewBox, gradientTransform, etc.
  transformTags: {
    // The `data:` scheme filter (allowedSchemesByTag.img) admits ANY data: MIME,
    // including `data:text/html,<script>…>`. Images must be real images, so require
    // a `data:image/…` MIME and drop the src otherwise. (SVG images referenced via
    // <img> cannot execute script per the HTML spec, so data:image/svg+xml is safe.)
    img: (tagName, attribs) => {
      const src = attribs["src"];
      if (src !== undefined && !/^data:image\//i.test(src)) {
        delete attribs["src"];
      }
      return { tagName, attribs };
    },
  },
};

// --- Layer 3: scoped CSS resource neutralization ----------------------------

const EXTERNAL_URL_PLACEHOLDER = "url()";

/**
 * Minimal structural view of the parse5 nodes we walk. parse5's full tree-adapter
 * types are large and we touch only these fields; the default tree adapter always
 * produces element nodes with `attrs`/`childNodes` and text nodes with `value`.
 */
interface CssWalkNode {
  nodeName: string;
  tagName?: string;
  value?: string; // present on #text nodes
  attrs?: { name: string; value: string }[];
  childNodes?: CssWalkNode[];
}

// SVG presentation attributes whose value can be a CSS `url(...)` reference (paint
// servers, clip/mask/marker/filter). They fetch exactly like CSS `url()`, so they are
// neutralized alongside `style` — but, unlike the old whole-document scan, ONLY here.
const CSS_URL_ATTRS = new Set([
  "fill", "stroke", "clip-path", "mask", "filter",
  "marker-start", "marker-mid", "marker-end",
]);

/**
 * Decode CSS identifier escapes (CSS Syntax §4): `\<1–6 hex>` (+ one optional trailing
 * whitespace) → the code point, and `\<char>` → the literal char. A spec-compliant CSS
 * parser decodes these BEFORE tokenizing, so `\75rl(…)` and `\000075rl(…)` are really
 * `url(…)` and WOULD fetch. The bespoke regex layer was escape-blind (it matched the
 * literal ascii `url(`), letting escaped function names smuggle an external reference
 * past the self-contained guarantee — decode first so we see what the browser sees
 * (adj-200.2.3.2 / NFR-002).
 */
function decodeCssEscapes(css: string): string {
  return css.replace(
    /\\([0-9a-fA-F]{1,6})[ \t\n\f\r]?|\\([\s\S])/g,
    (_match, hex: string | undefined, literal: string | undefined): string => {
      if (hex !== undefined) {
        const cp = parseInt(hex, 16);
        // Null, out-of-range, and surrogate code points decode to U+FFFD per the spec.
        if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
        return String.fromCodePoint(cp);
      }
      return literal ?? "";
    },
  );
}

/** A `url(...)` target that fetches NOTHING external: `data:` URIs and in-document `#fragment` refs. */
function isSelfContainedUrlTarget(target: string): boolean {
  return /^\s*data:/i.test(target) || /^\s*#/.test(target);
}

/**
 * Neutralize external/script resource references inside a single CSS string — a
 * `<style>` body, a `style="…"` value, or an SVG paint attribute like `fill="url(…)"`.
 * Escapes are decoded first so escape-obfuscated `url()`/`@import`/`expression()` cannot
 * slip past (adj-200.2.3.2). If, even after decoding, the value carries no such
 * construct, the ORIGINAL text is returned untouched so legitimate CSS escapes
 * (e.g. `content:"\2014"`) are preserved.
 */
function neutralizeCssText(css: string): string {
  const decoded = decodeCssEscapes(css);
  const hasResourceConstruct =
    /@import/i.test(decoded) || /\burl\s*\(/i.test(decoded) || /\bexpression\s*\(/i.test(decoded);
  if (!hasResourceConstruct) return css;

  let out = decoded;
  // `@import url("https://…")` / `@import "https://…"` — drop unless it targets data:.
  out = out.replace(/@import\b[^;]*;?/gi, (rule) =>
    /url\(\s*['"]?data:/i.test(rule) || /['"]data:/i.test(rule) ? rule : "",
  );
  // `url(...)` — keep data: and in-document `#fragment` refs; neutralize everything else
  // (external http(s), protocol-relative, javascript:, etc.).
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, _quote, target: string) =>
    isSelfContainedUrlTarget(target) ? match : EXTERNAL_URL_PLACEHOLDER,
  );
  // Legacy IE `expression(...)` script vector.
  out = out.replace(/expression\s*\([^)]*\)/gi, "");
  return out;
}

/** Recursively neutralize CSS only inside `<style>` bodies, `style=""`, and SVG paint attrs. */
function walkAndNeutralizeCss(node: CssWalkNode): void {
  const isStyleElement = node.tagName === "style";
  for (const child of node.childNodes ?? []) {
    // Neutralize CSS ONLY in an actual `<style>` body — never plain text/`<code>`/`<pre>`,
    // which is inert HTML text and must survive verbatim (adj-200.2.3.3).
    if (isStyleElement && child.nodeName === "#text" && typeof child.value === "string") {
      child.value = neutralizeCssText(child.value);
    }
    walkAndNeutralizeCss(child);
  }
  for (const attr of node.attrs ?? []) {
    if (attr.name === "style" || CSS_URL_ATTRS.has(attr.name.toLowerCase())) {
      attr.value = neutralizeCssText(attr.value);
    }
  }
}

/**
 * Scope CSS neutralization to ACTUAL CSS contexts only — `<style>` bodies, `style="…"`
 * attributes, and SVG paint attributes — by walking the parsed tree instead of the raw
 * document string. The previous whole-string scan rewrote any `url(...)`/`@import`/
 * `expression(...)` that merely APPEARED in visible prose or `<code>`/`<pre>`, corrupting
 * proposals that document CSS (adj-200.2.3.3). Input is already mXSS-stable
 * (sanitizeToFixpoint), so this re-parse + re-serialize introduces no new live nodes.
 */
function neutralizeCss(html: string): string {
  const fragment = parseFragment(html);
  // Safe cast: parse5's default tree adapter yields nodes shaped like CssWalkNode; we
  // mutate `attrs[].value` / text `value` in place on the very nodes serialize() reads.
  walkAndNeutralizeCss(fragment as unknown as CssWalkNode);
  return serialize(fragment);
}

// --- Layer 2: mutation-XSS fixpoint -----------------------------------------

// Re-serializing through parse5 + re-sanitizing converges fast (each pass exposes one
// layer of parser-confusion). A handful of passes is far more than any real payload
// needs; the cap is a safety bound so a pathological input can never loop forever.
const MAX_REPARSE_PASSES = 4;

/**
 * Re-parse an HTML fragment with parse5 (the spec-compliant, browser-equivalent
 * parser) and re-serialize it. Constructs that sanitize-html's htmlparser2 left as
 * raw text but a browser would promote to live nodes (mXSS) surface as real markup
 * here, where the next sanitize pass can strip them.
 */
function reserializeWithSpecParser(html: string): string {
  return serialize(parseFragment(html));
}

/**
 * Sanitize, then repeatedly (re-serialize through the spec parser → re-sanitize) until
 * the output is stable under a browser-equivalent re-parse. The fixpoint guarantees the
 * served markup contains no element a compliant parser would mutate into a live
 * script/event-handler node — closing the mXSS class (adj-200.2.3.1).
 */
function sanitizeToFixpoint(html: string): string {
  let current = sanitizeHtml(html, SANITIZE_OPTIONS);
  for (let pass = 0; pass < MAX_REPARSE_PASSES; pass++) {
    const next = sanitizeHtml(reserializeWithSpecParser(current), SANITIZE_OPTIONS);
    if (next === current) return current; // stable under spec re-parse — done
    current = next;
  }
  return current;
}

/**
 * Sanitize an untrusted proposal HTML fragment into safe, self-contained HTML.
 * Always returns a string (never throws); an unsafe input that reduces to nothing
 * returns the empty string (callers fall back to a markdown render).
 */
export function sanitizeProposalHtml(html: string): string {
  if (!html) return "";
  return neutralizeCss(sanitizeToFixpoint(html));
}
