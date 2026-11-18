/**
 * Kleiner Zähler-Speicher für den Website-Assistenten (Trello WBFWBr3s, Karte 3 von 3).
 *
 * Zwei Betriebsarten:
 *
 * 1. **Redis über REST (Upstash)**, wenn `KV_REST_API_URL` und
 *    `KV_REST_API_TOKEN` gesetzt sind (so legt die Vercel-Marketplace-
 *    Integration sie an) oder alternativ `UPSTASH_REDIS_REST_URL` und
 *    `UPSTASH_REDIS_REST_TOKEN`. Dann gelten Zähler über alle
 *    Serverinstanzen hinweg.
 * 2. **Arbeitsspeicher** der laufenden Instanz als Rückfall. Das hält, solange
 *    Vercel dieselbe Instanz wiederverwendet (Fluid Compute), lässt sich aber
 *    über parallele Instanzen verteilen. Dieselbe Schwäche hat das Rate-Limit
 *    des Kontaktformulars, siehe `src/app/api/contact/route.ts`.
 *
 * Bewusst ohne neues Paket: Upstash spricht HTTP, `fetch` reicht.
 */

type Rest = { url: string; token: string }

function restZugang(): Rest | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return { url: url.replace(/\/$/, ''), token }
}

export function speicherArt(): 'redis' | 'arbeitsspeicher' {
  return restZugang() ? 'redis' : 'arbeitsspeicher'
}

async function pipeline(zugang: Rest, befehle: (string | number)[][]): Promise<unknown[]> {
  const antwort = await fetch(`${zugang.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${zugang.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(befehle),
    cache: 'no-store',
    signal: AbortSignal.timeout(1500),
  })
  if (!antwort.ok) throw new Error(`Redis HTTP ${antwort.status}`)
  const daten = (await antwort.json()) as { result?: unknown; error?: string }[]
  return daten.map((eintrag) => {
    if (eintrag.error) throw new Error(`Redis: ${eintrag.error}`)
    return eintrag.result
  })
}

// Rückfall im Arbeitsspeicher: Schlüssel -> Zähler mit Ablaufzeit.
const zaehler = new Map<string, { wert: number; bis: number }>()

function aufraeumen(jetzt: number) {
  // Gelegentlich, damit die Map bei vielen Sitzungen nicht wächst.
  if (zaehler.size < 5000) return
  zaehler.forEach((eintrag, schluessel) => {
    if (eintrag.bis <= jetzt) zaehler.delete(schluessel)
  })
}

/**
 * Erhöht einen Zähler mit festem Zeitfenster und gibt den neuen Stand zurück.
 * Das Fenster beginnt mit dem ersten Treffer.
 */
export async function erhoeheZaehler(schluessel: string, fensterMs: number): Promise<number> {
  const zugang = restZugang()
  if (zugang) {
    try {
      const [stand] = await pipeline(zugang, [
        ['INCR', schluessel],
        ['PEXPIRE', schluessel, fensterMs, 'NX'],
      ])
      return Number(stand)
    } catch (fehler) {
      // Redis weg heißt nicht Assistent weg: dann zählt diese Instanz selbst.
      console.error('[assistent] Zähler-Speicher nicht erreichbar, Rückfall auf Arbeitsspeicher:', fehler)
    }
  }

  const jetzt = Date.now()
  aufraeumen(jetzt)
  const eintrag = zaehler.get(schluessel)
  if (!eintrag || eintrag.bis <= jetzt) {
    zaehler.set(schluessel, { wert: 1, bis: jetzt + fensterMs })
    return 1
  }
  eintrag.wert += 1
  return eintrag.wert
}

/**
 * Setzt einen Merker nur, wenn er noch nicht existiert. `true` heißt: dieser
 * Aufruf war der erste. Dient dazu, einen Alarm je Monat nur einmal zu senden.
 */
export async function setzeEinmal(schluessel: string, gueltigMs: number): Promise<boolean> {
  const zugang = restZugang()
  if (zugang) {
    try {
      const [ergebnis] = await pipeline(zugang, [
        ['SET', schluessel, '1', 'NX', 'PX', gueltigMs],
      ])
      return ergebnis === 'OK'
    } catch (fehler) {
      console.error('[assistent] Zähler-Speicher nicht erreichbar, Rückfall auf Arbeitsspeicher:', fehler)
    }
  }

  const jetzt = Date.now()
  const eintrag = zaehler.get(schluessel)
  if (eintrag && eintrag.bis > jetzt) return false
  zaehler.set(schluessel, { wert: 1, bis: jetzt + gueltigMs })
  return true
}
