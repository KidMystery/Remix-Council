/**
 * Chat attachments (Oracle) ride inline in a single message — there is no
 * part-by-part walk on this path. Oversize files are REFUSED with a visible
 * notice rather than silently sliced (the council must never quote a file it
 * only half-saw). Big artifacts belong in Nexus Lab, which reads every part.
 */

export const MAX_CHAT_ATTACHMENT_CHARS = 50_000;

export interface ChatAttachmentScreen<T> {
  accepted: T[];
  rejected: { name: string; chars: number }[];
}

export function screenChatAttachments<T extends { name: string; content: string }>(
  files: T[]
): ChatAttachmentScreen<T> {
  const accepted: T[] = [];
  const rejected: { name: string; chars: number }[] = [];
  for (const f of files) {
    if ((f.content || '').length > MAX_CHAT_ATTACHMENT_CHARS) {
      rejected.push({ name: f.name, chars: f.content.length });
    } else {
      accepted.push(f);
    }
  }
  return { accepted, rejected };
}
