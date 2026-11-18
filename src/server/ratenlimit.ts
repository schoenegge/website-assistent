import { createHash } from 'node:crypto'

import { erhoeheZaehler } from './speicher'

/**
 * Rate-Limit des Website-Assistenten (Trello WBFWBr3s, Karte 3 von 3).
 *
 * Gezählt wird jede Nachricht an `/api/assistent`, zweifach:
 *
 * - **je Sitzung** (Kennung aus dem `sessionStorage` des Browsers), das ist das
 *   Limit, das die Karte verlangt;
 * - **je IP-Adresse**, weil die Sitzungskennung vom Browser kommt und ein
 *   Skript sie bei jeder Anfrage neu würfeln kann. Die Adresse wird nur als
 *   gekürzter Hash als Schlüssel verwendet, nie im Klartext gespeichert.
 *
 * Bemessung, damit ein normales Gespräch nie anstößt: Eine Antwort braucht
 * 6,5 bis 8,3 Sekunden (gemessen 24.09.2026 auf der Preview), das Eingabefeld ist
 * währenddessen gesperrt, und ein Mensch liest und tippt danach. Mehr als drei,
 * vier Nachrichten pro Minute schafft von Hand niemand. Die Testgespräche von
 * Karte 2 (`scripts/assistent-qualifizierung-pruefen.mjs`) kamen mit ein bis
 * vier Besuchernachrichten bis zur Übergabe aus, zwei Gespräche in derselben
 * Sitzung mit sieben. Die Grenzen unten liegen jeweils deutlich darüber und
 * lassen sich per Umgebungsvariable ohne Code-Änderung verschieben.
 */

type Fenster = { name: string; max: number; ms: number }

function zahl(name: string, standard: number): number {
  const wert = Number(process.env[name])
  return Number.isFinite(wert) && wert > 0 ? Math.floor(wert) : standard
}

const MINUTE = 60 * 1000
const STUNDE = 60 * MINUTE
const TAG = 24 * STUNDE

function fensterSitzung(): Fenster[] {
  return [
    { name: 'sitzung-minute', max: zahl('ASSISTENT_LIMIT_SITZUNG_MINUTE', 8), ms: MINUTE },
    { name: 'sitzung-stunde', max: zahl('ASSISTENT_LIMIT_SITZUNG_STUNDE', 60), ms: STUNDE },
  ]
}

function fensterIp(): Fenster[] {
  // Großzügiger als je Sitzung: hinter einer Firmen-IP können mehrere
  // Besucher gleichzeitig sitzen.
  return [
    { name: 'ip-minute', max: zahl('ASSISTENT_LIMIT_IP_MINUTE', 15), ms: MINUTE },
    { name: 'ip-tag', max: zahl('ASSISTENT_LIMIT_IP_TAG', 200), ms: TAG },
  ]
}

export function besucherIp(request: Request): string {
  const echt = request.headers.get('x-real-ip')
  if (echt) return echt.trim()
  const weitergeleitet = request.headers.get('x-forwarded-for')
  if (weitergeleitet) return weitergeleitet.split(',')[0]!.trim()
  return 'unbekannt'
}

function kurzHash(wert: string) {
  return createHash('sha256').update(wert).digest('hex').slice(0, 24)
}

export type LimitErgebnis =
  | { erlaubt: true }
  | { erlaubt: false; fenster: string; wiederInSekunden: number }

/**
 * Zählt die Anfrage und sagt, ob sie durch darf. Ohne Sitzungskennung zählt
 * die IP doppelt (als Sitzung und als IP), damit das Weglassen der Kennung
 * kein Schlupfloch ist.
 */
export async function pruefeRatenlimit(
  sitzung: string | null,
  ip: string,
): Promise<LimitErgebnis> {
  const ipSchluessel = kurzHash(ip)
  const sitzungSchluessel = sitzung ? kurzHash(`s:${sitzung}`) : `ohne:${ipSchluessel}`

  const pruefungen = [
    ...fensterSitzung().map((f) => ({ ...f, schluessel: `assistent:rl:${f.name}:${sitzungSchluessel}` })),
    ...fensterIp().map((f) => ({ ...f, schluessel: `assistent:rl:${f.name}:${ipSchluessel}` })),
  ]

  const staende = await Promise.all(pruefungen.map((p) => erhoeheZaehler(p.schluessel, p.ms)))

  for (let i = 0; i < pruefungen.length; i++) {
    const p = pruefungen[i]!
    if (staende[i]! > p.max) {
      return { erlaubt: false, fenster: p.name, wiederInSekunden: Math.ceil(p.ms / 1000) }
    }
  }
  return { erlaubt: true }
}
