import type { Beispielfragen } from '../typen'

/**
 * Beispielfragen für die offene Leiste und die Anschlussfragen: exakter Pfad
 * zuerst, dann der längste passende Präfix, sonst die allgemeinen.
 */
export function beispielfragen(fragen: Beispielfragen, pfad: string | null): string[] {
  if (!pfad) return fragen.allgemein
  const exakt = fragen.exakt?.[pfad]
  if (exakt) return exakt
  const basis = Object.keys(fragen.jeSeite)
    .filter((schluessel) => schluessel !== '/')
    .filter((schluessel) => pfad === schluessel || pfad.startsWith(`${schluessel}/`))
    .sort((a, b) => b.length - a.length)[0]
  return basis ? fragen.jeSeite[basis]! : fragen.jeSeite['/'] ?? fragen.allgemein
}

/** Wo der Assistent nicht erscheint, z. B. Impressum und Datenschutz. */
export function assistentAufPfad(ausgenommen: string[], pfad: string | null): boolean {
  if (!pfad) return false
  return !ausgenommen.some((basis) => pfad === basis || pfad.startsWith(`${basis}/`))
}
