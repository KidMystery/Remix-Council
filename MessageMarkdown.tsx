import React, { useState, useEffect, useMemo } from 'react';
import { marked, type RendererObject } from 'marked';
import DOMPurify from 'dompurify';

export interface MessageMarkdownProps {
  content: string;
  className?: string;
}

export const MessageMarkdown: React.FC<MessageMarkdownProps> = ({ content, className = '' }) => {
  const [debouncedContent, setDebouncedContent] = useState(content);

  // Debounce rapid markdown rendering by 120ms during streaming
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedContent(content);
    }, 120);

    return () => {
      clearTimeout(handler);
    };
  }, [content]);

  const sanitizedHtml = useMemo(() => {
    try {
      // Custom renderer: open links in a new tab with rel="noopener noreferrer"
      const renderer: RendererObject = {
        link({ href, title, tokens }) {
          const text = (tokens || [])
            .map((t: any) => (typeof t === 'string' ? t : t?.raw ?? ''))
            .join('');
          const safeHref = href && /^(https?:|mailto:|#|\/)/i.test(href) ? href : '#';
          return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;
        },
      };

      marked.use({ renderer, async: false });

      const rawHtml = marked.parse(debouncedContent || '', { async: false }) as string;

      // Pass the complete custom renderer HTML string through DOMPurify before use.
      return DOMPurify.sanitize(rawHtml, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel'],
      });
    } catch {
      return DOMPurify.sanitize(debouncedContent || '');
    }
  }, [debouncedContent]);

  return (
    <div
      className={`prose prose-invert max-w-none break-words text-sm leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};
