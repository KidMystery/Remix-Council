import React, { useState, useEffect, useMemo } from 'react';
import { marked } from 'marked';
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
      const rawHtml = marked.parse(debouncedContent || '', { async: false }) as string;
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
