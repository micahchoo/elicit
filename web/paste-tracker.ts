/**
 * Ticket 048: per-box paste accounting for capture-channel detection.
 * A paste event adds the clipboard length to a running counter; an input
 * event resets it when the box empties, so it only ever counts pasted
 * characters still present. The capture is 'pasted' iff pasted characters
 * are a strict majority of the submitted text.
 *
 * Shared by the exchange, harvest and mode surfaces in main.ts and the
 * waiting surface's answer box (the seam, web/deps.ts) — the textarea is
 * the only dependency, so it needs no injection.
 */

export function pasteTracker(textarea: HTMLTextAreaElement) {
 let pastedChars = 0;
 textarea.addEventListener('paste', (e: ClipboardEvent) => {
  pastedChars += (e.clipboardData?.getData('text') ?? '').length;
 });
 textarea.addEventListener('input', () => {
  if (textarea.value.length === 0) pastedChars = 0;
 });
 return {
  isPasted(text: string): boolean {
   return pastedChars * 2 > text.length;
  },
  reset(): void {
   pastedChars = 0;
  },
 };
}
