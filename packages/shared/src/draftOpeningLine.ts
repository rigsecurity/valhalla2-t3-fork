const openingLines = [
  { line: "Hasta la vista, baby.", credit: "Terminator 2" },
  { line: "Feeling lucky, punk?", credit: "Inspired by Dirty Harry" },
  { line: "You’re gonna need a bigger boat.", credit: "Jaws" },
  { line: "May the Force be with you.", credit: "Star Wars" },
  { line: "To infinity and beyond!", credit: "Toy Story" },
  { line: "Just keep swimming.", credit: "Finding Nemo" },
  { line: "There’s no place like home.", credit: "The Wizard of Oz" },
  { line: "As you wish.", credit: "The Princess Bride" },
  { line: "We don’t need roadmaps.", credit: "Inspired by Back to the Future" },
  { line: "The beginning of a beautiful build.", credit: "Inspired by Casablanca" },
] as const;

export function draftOpeningLine(draftId: string | null | undefined) {
  let hash = 0;
  if (draftId) {
    for (let index = 0; index < draftId.length; index++) {
      hash = (Math.imul(hash, 31) + draftId.charCodeAt(index)) >>> 0;
    }
  }
  return openingLines[hash % openingLines.length] ?? openingLines[0];
}
