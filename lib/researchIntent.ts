export function hasResearchIntent(question: string): boolean {
  return /\bresearch\b|\blook up\b|\bfind out\b|\bsearch for\b/i.test(question);
}
