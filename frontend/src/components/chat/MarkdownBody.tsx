import React from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';

/**
 * Module-level remark plugins array.
 *
 * Hoisted from JSX so every render of `MarkdownBody` hands react-markdown
 * the same array reference. Inline literals (e.g. `[remarkGfm]`) would
 * create a fresh array on every render and defeat react-markdown's
 * internal memoization, forcing a full markdown re-parse of every
 * unchanged message body in the chat list.
 */
const REMARK_PLUGINS: PluggableList = [remarkGfm];

/**
 * Module-level components map for react-markdown overrides.
 *
 * Hoisted from JSX for the same reason as `REMARK_PLUGINS` — stable
 * identity across renders is required for react-markdown to short-circuit
 * unchanged subtrees in the chat list.
 */
const MARKDOWN_COMPONENTS: Components = {
  // Open links in new tab
  a: ({ children: linkChildren, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {linkChildren}
    </a>
  ),
  // Prevent images from rendering (security + layout)
  img: () => null,
};

/**
 * Renders a chat message body as markdown with CRT-themed styling.
 *
 * Supports: headers, bold/italic, bullet/numbered lists, code blocks,
 * inline code, links, blockquotes, horizontal rules, tables (GFM),
 * strikethrough, and task lists.
 *
 * Wraps react-markdown with remark-gfm for GitHub Flavored Markdown
 * (tables, strikethrough, task lists, autolinks) and custom component
 * overrides to match the retro terminal aesthetic.
 *
 * The `remarkPlugins` and `components` props are hoisted to module-level
 * constants so they keep stable identity across every render. The
 * surrounding `React.memo` then meaningfully short-circuits re-renders
 * when only the parent updates with the same `children` string.
 */
export const MarkdownBody = React.memo(function MarkdownBody({
  children,
}: {
  children: string;
}) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {children}
      </Markdown>
    </div>
  );
});
