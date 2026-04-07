import React from 'react';
import Markdown from 'react-markdown';

/**
 * Renders a chat message body as markdown with CRT-themed styling.
 *
 * Supports: headers, bold/italic, bullet/numbered lists, code blocks,
 * inline code, links, blockquotes, and horizontal rules.
 *
 * Wraps react-markdown with custom component overrides to match
 * the retro terminal aesthetic and prevent layout-breaking elements.
 */
export const MarkdownBody = React.memo(function MarkdownBody({
  children,
}: {
  children: string;
}) {
  return (
    <div className="markdown-body">
      <Markdown
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
