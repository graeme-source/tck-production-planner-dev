/**
 * Turns per-file upload results into one plain sentence for a toast — or
 * null when everything landed. Exists because the recording modals used to
 * fire uploads without checking the answers, so a failed clip vanished
 * without a word (improvement 33 lost its "before" video that way,
 * 2026-08-27). Pure so that regression stays tested.
 */
export interface UploadAttempt {
  /** How the file reads in a sentence, e.g. "your BEFORE video". */
  label: string;
  ok: boolean;
  /** The server's error message, when there was a readable one. */
  error?: string;
}

export function summariseUploadFailures(attempts: UploadAttempt[], addAgainWhere: string): string | null {
  const failed = attempts.filter(a => !a.ok);
  if (failed.length === 0) return null;

  const names = failed.map(f => f.label);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const sentence = list.charAt(0).toUpperCase() + list.slice(1);
  // One reason is plenty for a toast — the first readable one stands for all.
  const reason = failed.find(f => f.error)?.error;
  const it = failed.length === 1 ? "it" : "them";
  return `${sentence} didn't upload${reason ? ` (${reason})` : ""}. Everything else is saved: open ${addAgainWhere} to add ${it} again.`;
}
