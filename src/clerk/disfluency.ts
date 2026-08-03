/**
 * Elide STT disfluencies from quoted text using a mechanical, marked rule.
 * Replaces filled pauses with ellipsis markers; never paraphrases.
 * The kept Snippet stays verbatim (Q-12).
 *
 * The rules are deliberately dumb: filled pauses are replaced only when they
 * stand alone as tokens (surrounded by spaces or string boundaries), never
 * when they sit inside a word ("human" stays), and discourse markers only
 * when the comma marks them as particles rather than verb phrases
 * ("you know the answer" stays). Everything that is not a disfluency —
 * word order, word choice, punctuation — is left exactly as spoken.
 */
export function elideDisfluencies(text: string): string {
 if (text.length === 0) return text;
 const paused = text
  // False starts: the comma is what marks "I mean"/"you know" as a
  // discourse particle rather than a real verb phrase.
  .replace(/\bI mean,/gi, '…')
  .replace(/\byou know,/gi, '…')
  // Filled pauses as standalone interjections, longer forms first so the
  // boundary still holds once the short form would otherwise match first.
  // A comma after the pause is part of the disfluent utterance (STT renders
  // the pause as punctuation) and elides with it: "I was, um, thinking"
  // reads as "I was, … thinking", not "I was, …, thinking".
  .replace(/\b(?:uhh|umm|uh|um|er|ah|hm|mm)\b,?/gi, '…');
 // Collapse runs of ellipsis markers separated only by whitespace — the
 // elision is one marked gap, not a stutter of markers. The whitespace
 // after the FINAL marker is not consumed: "… metaphors" keeps its space.
 const collapsed = paused.replace(/…(?:[ \t]+…)+/g, '…');
 // Normalize whitespace after elision (collapse multiple spaces).
 return collapsed.replace(/ {2,}/g, ' ').trim();
}
