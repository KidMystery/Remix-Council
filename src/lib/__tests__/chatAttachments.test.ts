import { describe, it, expect } from 'vitest';
import { MAX_CHAT_ATTACHMENT_CHARS, screenChatAttachments } from '../chatAttachments';

describe('screenChatAttachments', () => {
  it('accepts files at or under the cap in full — never sliced', () => {
    const files = [
      { name: 'notes.txt', content: 'a'.repeat(MAX_CHAT_ATTACHMENT_CHARS) },
      { name: 'spend.csv', content: 'date,amt\n2026-01-01,40' },
    ];
    const screen = screenChatAttachments(files);
    expect(screen.rejected).toEqual([]);
    expect(screen.accepted).toHaveLength(2);
    expect(screen.accepted[0].content.length).toBe(MAX_CHAT_ATTACHMENT_CHARS);
  });

  it('refuses files over the cap and reports their true size', () => {
    const files = [
      { name: 'repo.zip', content: 'x'.repeat(MAX_CHAT_ATTACHMENT_CHARS + 1) },
      { name: 'ok.txt', content: 'fine' },
    ];
    const screen = screenChatAttachments(files);
    expect(screen.accepted.map((f) => f.name)).toEqual(['ok.txt']);
    expect(screen.rejected).toEqual([{ name: 'repo.zip', chars: MAX_CHAT_ATTACHMENT_CHARS + 1 }]);
  });
});
