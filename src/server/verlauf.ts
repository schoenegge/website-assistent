import type { UIMessage } from 'ai'

/**
 * Chatverläufe speichern (Oliver 18.11.2026, Variante 2: ganze Gespräche, geschwärzt, 12 Monate, Frist Oliver 18.11.2026).
 *
 * Nach jeder Antwort geht der bisherige Verlauf an den n8n-Workflow „Websites: Chatverläufe
 * speichern (12 Monate)“ (Hetzner, Helsinki). Dort wird er je Sitzung fortgeschrieben, ein zweiter
 * Workflow löscht täglich alles, was 12 Monate nicht mehr geändert wurde.
 *
 * - Ohne CHATLOG_URL und CHATLOG_SECRET (Vercel) passiert nichts. So bleibt die Speicherung
 *   aus, bis die Datenschutzerklärung sie nennt.
 * - Vor dem Senden werden Mail-Adressen, Telefonnummern und IBANs geschwärzt. Namen und
 *   Adressen lassen sich nicht sicher erkennen, das sagt die Datenschutzerklärung.
 * - Fehler oder Zeitüberschreitung stören die Antwort nie.
 */

export type VerlaufNachricht = { rolle: 'besucher' | 'assistent'; text: string }

const MAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g
// Ziffernfolgen mit Leerzeichen, Punkt, Strich, Schrägstrich oder Klammern; geschwärzt ab 7 Ziffern,
// damit Preise, Jahreszahlen und Postleitzahlen stehen bleiben.
const NUMMER = /\+?\(?\d[\d\s./()-]{5,}\d/g
const DATUM = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/

export function schwaerze(text: string): string {
  return text
    .replace(MAIL, '[Mail entfernt]')
    .replace(IBAN, '[IBAN entfernt]')
    .replace(NUMMER, (treffer) =>
      (treffer.match(/\d/g)?.length ?? 0) >= 7 && !DATUM.test(treffer.trim()) ? '[Nummer entfernt]' : treffer,
    )
}

function textAus(nachricht: UIMessage): string {
  return nachricht.parts
    .filter((teil): teil is { type: 'text'; text: string } => teil.type === 'text')
    .map((teil) => teil.text)
    .join('\n')
    .trim()
}

export async function speichereVerlauf(angaben: {
  site: string
  sitzung: string | null
  seite: string | null
  nachrichten: UIMessage[]
  antwort: string
  lead: boolean
}): Promise<void> {
  const url = process.env.CHATLOG_URL
  const geheimnis = process.env.CHATLOG_SECRET
  if (!url || !geheimnis || !angaben.sitzung) return

  const verlauf: VerlaufNachricht[] = angaben.nachrichten
    .map((n) => ({ rolle: n.role === 'assistant' ? ('assistent' as const) : ('besucher' as const), text: textAus(n) }))
    .concat(angaben.antwort.trim() ? [{ rolle: 'assistent' as const, text: angaben.antwort.trim() }] : [])
    .filter((n) => n.text.length > 0)
    .map((n) => ({ ...n, text: schwaerze(n.text).slice(0, 4000) }))

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chatlog-secret': geheimnis },
      body: JSON.stringify({
        site: angaben.site,
        sitzung: angaben.sitzung,
        seite: angaben.seite ?? '',
        lead: angaben.lead,
        nachrichten: verlauf,
      }),
      signal: AbortSignal.timeout(2500),
    })
  } catch (fehler) {
    console.warn('[assistent] Chatverlauf nicht gespeichert:', (fehler as Error).name)
  }
}
