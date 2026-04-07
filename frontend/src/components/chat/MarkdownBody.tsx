import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
 */
export const MarkdownBody = React.memo(function MarkdownBody({
  children,
}: {
  children: string;
}) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {children}
      </Markdown>
    </div>
  );
});
