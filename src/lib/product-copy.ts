/** Display vocabulary only. Stored identities, API fields and raw source text stay intact. */
export function productMessage(text: string): string {
  return text.replace(/\b(teachers?|courses?)\b/gi, word => {
    const plural = word.toLowerCase().endsWith('s');
    const replacement = word.toLowerCase().startsWith('teacher') ? `facilitator${plural ? 's' : ''}` : `program${plural ? 's' : ''}`;
    return word === word.toUpperCase() ? replacement.toUpperCase() : /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
}
