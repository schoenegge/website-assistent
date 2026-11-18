/**
 * Konfiguration des Website-Assistenten (Trello RSiNP4aZ, Karte 1 von 3).
 *
 * Zwei Dinge stehen hier bewusst als einzelne Konstante bzw. an einer Stelle:
 * der Modellname (Wechsel ohne Eingriff in die Chat-Logik) und der
 * Feature-Flag (Abschalten ohne Code-Änderung).
 */

import { pruefeKosten } from './kosten'
import { konfig, STANDARD_MODELL } from './konfig'

// Modell läuft im Regelfall über das Vercel AI Gateway, Schema
// <provider>/<modell>. Standard im Paket, je Website überschreibbar.
// Seit 18.11.2026 Sonnet 5.5: folgt den Regeln zuverlässiger, gleicher Preis,
// günstigeres Lesen aus dem Cache (Gateway-Preisliste 18.11.2026).
export function modell() {
  return konfig().modell ?? STANDARD_MODELL
}

// Obergrenze je Antwort. Kurz hält den Assistenten der System-Prompt (höchstens
// 120 Wörter), nicht dieses Limit. Es ist nur die Notbremse und liegt bewusst
// darüber, weil sich Denk- und Textanteil das Budget teilen: greift es, bricht
// die Antwort mitten im Satz ab, und der Besucher sieht einen Torso. Gemessen
// am 09.09.2026 über zwei Läufe der sieben Prüffragen: 256 bis 374 Tokens
// Ausgabe, jede Antwort mit finishReason "stop", keine abgeschnitten.
export const ASSISTENT_MAX_ANTWORT_TOKENS = 2000

// Wie viele Nachrichten aus dem Verlauf mitgeschickt werden. Begrenzt die
// Kosten je Runde und hält den Prompt-Cache-Prefix stabil. Seit der
// Qualifizierung (Karte 2, gZETzejB) 20 statt 12: bis zur Übergabe braucht ein
// Gespräch schnell sechs, sieben Wechsel, und die Kontaktdaten vom Anfang
// dürfen nicht aus dem Blick fallen.
export const ASSISTENT_MAX_VERLAUF = 20

export type FlagQuelle =
  | 'edge-config'
  | 'env'
  | 'default'
  // Seit Karte 3 (WBFWBr3s): der Flag steht auf an, der Kostendeckel hält den
  // Assistenten trotzdem aus.
  | 'kostendeckel'
  | 'kein-kostendeckel'
  | 'kostenstand-unbekannt'

export type FlagStand = {
  aktiv: boolean
  quelle: FlagQuelle
}

function deuteWert(wert: unknown): boolean | null {
  if (typeof wert === 'boolean') return wert
  if (typeof wert !== 'string') return null

  const normiert = wert.trim().toLowerCase()
  if (['an', 'ja', 'true', '1', 'on'].includes(normiert)) return true
  if (['aus', 'nein', 'false', '0', 'off'].includes(normiert)) return false
  return null
}

/**
 * Liest den Flag aus Vercel Edge Config, falls eine Verbindung hinterlegt ist.
 * Das ist der Weg, auf dem sich der Assistent ohne Deployment abschalten
 * lässt: Wert im Edge-Config-Store ändern, die nächste Anfrage sieht ihn.
 * Fällt die Abfrage aus, wird bewusst nicht geworfen, sondern auf die
 * Umgebungsvariable zurückgefallen.
 */
async function leseEdgeConfig(): Promise<boolean | null> {
  const verbindung = process.env.EDGE_CONFIG
  if (!verbindung) return null

  try {
    const url = new URL(verbindung)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/item/assistent_aktiv`

    const antwort = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1000),
    })

    if (!antwort.ok) return null
    return deuteWert(await antwort.json())
  } catch {
    return null
  }
}

/**
 * Stand des Schalters ohne Kostenprüfung. Reihenfolge: Edge Config, dann
 * Umgebungsvariable, sonst aus.
 */
async function schalterStand(): Promise<FlagStand> {
  const ausEdgeConfig = await leseEdgeConfig()
  if (ausEdgeConfig !== null) {
    return { aktiv: ausEdgeConfig, quelle: 'edge-config' }
  }

  const ausEnv = deuteWert(process.env.ASSISTENT_AKTIV)
  if (ausEnv !== null) {
    return { aktiv: ausEnv, quelle: 'env' }
  }

  return { aktiv: false, quelle: 'default' }
}

let deckelWarnungGezeigt = false

/**
 * Ist der Assistent an? Erst der Schalter (Edge Config, Umgebungsvariable,
 * sonst aus), dann der monatliche Kostendeckel aus `assistent-kosten.ts`
 * (Karte 3 von 3, WBFWBr3s). Ist der Deckel erreicht, gilt der Flag als aus,
 * ohne dass jemand eingreifen muss: das Widget verschwindet, die Route
 * antwortet 503.
 *
 * In Produktion läuft der Assistent nur mit gesetztem Deckel und lesbarem
 * Kostenstand. Fehlt eins davon, bleibt er aus, statt ohne Grenze zu laufen.
 * Auf Previews und lokal läuft er ohne Deckel weiter, mit Warnung im Log.
 */
export async function assistentAktiv(): Promise<FlagStand> {
  const schalter = await schalterStand()
  if (!schalter.aktiv) return schalter

  const kosten = await pruefeKosten()
  const produktion = process.env.VERCEL_ENV === 'production'

  if (kosten.lage === 'deckel-erreicht') {
    return { aktiv: false, quelle: 'kostendeckel' }
  }
  if (kosten.lage === 'kein-deckel') {
    if (produktion) return { aktiv: false, quelle: 'kein-kostendeckel' }
    if (!deckelWarnungGezeigt) {
      deckelWarnungGezeigt = true
      console.warn('[assistent] Kein Kostendeckel gesetzt (ASSISTENT_KOSTEN_DECKEL_USD). Außerhalb der Produktion erlaubt.')
    }
  }
  if (kosten.lage === 'unbekannt' && produktion) {
    return { aktiv: false, quelle: 'kostenstand-unbekannt' }
  }

  return schalter
}
