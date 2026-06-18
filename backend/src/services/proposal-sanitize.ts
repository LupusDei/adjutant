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
 * Two layers:
 *   1. sanitize-html with an explicit allowlist (tags / attributes / URL schemes).
 *   2. A CSS pass that neutralizes external/script resource references that live
 *      inside inline `style` attributes and `<style>` blocks (sanitize-html does not
 *      parse CSS bodies). This enforces the "self-contained, no external fetch"
 *      contract (NFR-002) on top of the script-execution defenses in layer 1.
 */

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

// --- Layer 2: CSS resource neutralization -----------------------------------

const EXTERNAL_URL_PLACEHOLDER = "url()";

/**
 * Neutralize resource references inside CSS text (both inline `style` attributes and
 * `<style>` block bodies appear in the sanitized HTML string, so we operate on the
 * whole document text). Keeps `data:` URIs; strips everything else that would fetch
 * or execute: external `url(...)`, `@import`, and `expression(...)`.
 */
function neutralizeCss(html: string): string {
  let out = html;

  // 1. `@import url("https://…")` or `@import "https://…"` — drop the whole rule.
  out = out.replace(/@import\b[^;]*;?/gi, (rule) => {
    return /url\(\s*['"]?data:/i.test(rule) || /['"]data:/i.test(rule) ? rule : "";
  });

  // 2. `url(...)` — keep data: URIs, neutralize anything else (external http(s),
  //    protocol-relative, javascript:, etc.).
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, _quote, target: string) => {
    return /^\s*data:/i.test(target) ? match : EXTERNAL_URL_PLACEHOLDER;
  });

  // 3. Legacy CSS `expression(...)` (old IE script vector) — strip the call.
  out = out.replace(/expression\s*\([^)]*\)/gi, "");

  return out;
}

/**
 * Sanitize an untrusted proposal HTML fragment into safe, self-contained HTML.
 * Always returns a string (never throws); an unsafe input that reduces to nothing
 * returns the empty string (callers fall back to a markdown render).
 */
export function sanitizeProposalHtml(html: string): string {
  if (!html) return "";
  const stage1 = sanitizeHtml(html, SANITIZE_OPTIONS);
  return neutralizeCss(stage1);
}
