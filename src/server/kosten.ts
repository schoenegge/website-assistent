import { createGateway } from 'ai'

import { setzeEinmal } from './speicher'
import { konfig } from './konfig'

/**
 * Monatlicher Kostendeckel des Website-Assistenten (Trello WBFWBr3s, Karte 3 von 3).
 *
 * Quelle der Wahrheit für die Ausgaben ist das Vercel AI Gateway selbst: jede
 * Anfrage des Assistenten trägt das Tag `KOSTEN_TAG`, und der Spend-Report des
 * Gateways summiert, was unter diesem Tag im laufenden Monat (UTC) angefallen
 * ist. Dadurch braucht der Deckel keine eigene Datenbank und zählt dasselbe,
 * was auf der Rechnung steht.
 *
 * Zwei Schwellen, beide als Umgebungsvariable in US-Dollar (das Gateway
 * rechnet in USD):
 *
 * - `ASSISTENT_KOSTEN_ALARM_USD`: ab hier geht einmal im Monat ein Alarm raus,
 *   der Assistent läuft weiter.
 * - `ASSISTENT_KOSTEN_DECKEL_USD`: ab hier schaltet sich der Assistent über
 *   den Feature-Flag ab (siehe `assistentAktiv()` in `assistent-config.ts`)
 *   und bleibt bis zum Monatsersten aus, oder bis jemand den Deckel anhebt.
 *
 * Die Werte legt Oliver fest, im Code steht bewusst keine Zahl. Ohne Deckel
 * bleibt der Assistent in Produktion aus.
 *
 * Der Stand wird je Serverinstanz höchstens alle `PRUEF_ABSTAND_MS` neu
 * abgefragt. Bis zur nächsten Abfrage kann der Deckel also um die Kosten
 * weniger Minuten überschritten werden; das Rate-Limit begrenzt, wie viel das
 * sein kann. Als harte zweite Linie gehört zusätzlich ein Projekt-Budget im
 * AI Gateway dazu (Dashboard, AI Gateway, Budgets), das lehnt Anfragen ab,
 * sobald es erreicht ist.
 */

export function kostenTag() {
  return konfig().kostenTag
}

// Eigener Gateway-Client nur für den Spend-Report. Next.js 14 legt GET-Abrufe
// sonst im Data Cache ab, und der Deckel sähe für immer den ersten Stand: am
// 28.09.2026 lokal so passiert, der Report blieb auf 0 USD stehen, obwohl
// schon 0,24 USD angefallen waren. `no-store` erzwingt jede Abfrage frisch.
const gatewayOhneCache = createGateway({
  fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
})

const PRUEF_ABSTAND_MS = 2 * 60 * 1000
const FEHLER_ABSTAND_MS = 60 * 1000
// Ein Stand, der älter ist, gilt nicht mehr als bekannt.
const HOECHSTALTER_MS = 60 * 60 * 1000

function betrag(name: string): number | null {
  const roh = process.env[name]
  if (!roh || roh.trim() === '') return null
  const wert = Number(roh.replace(',', '.'))
  return Number.isFinite(wert) && wert > 0 ? wert : null
}

export function kostenSchwellen() {
  return {
    alarm: betrag('ASSISTENT_KOSTEN_ALARM_USD'),
    deckel: betrag('ASSISTENT_KOSTEN_DECKEL_USD'),
  }
}

function monatUtc(jetzt = new Date()) {
  const jahr = jetzt.getUTCFullYear()
  const monat = String(jetzt.getUTCMonth() + 1).padStart(2, '0')
  const tag = String(jetzt.getUTCDate()).padStart(2, '0')
  return { schluessel: `${jahr}-${monat}`, start: `${jahr}-${monat}-01`, heute: `${jahr}-${monat}-${tag}` }
}

type Stand = { usd: number; monat: string; zeit: number }

let letzterStand: Stand | null = null
let naechstePruefung = 0
let laufendeAbfrage: Promise<void> | null = null

async function frageGatewayAb() {
  const monat = monatUtc()
  try {
    const bericht = await gatewayOhneCache.getSpendReport({
      startDate: monat.start,
      endDate: monat.heute,
      groupBy: 'tag',
      tags: [kostenTag()],
    })
    const usd = bericht.results.reduce((summe, zeile) => summe + (zeile.totalCost ?? 0), 0)
    letzterStand = { usd, monat: monat.schluessel, zeit: Date.now() }
    naechstePruefung = Date.now() + PRUEF_ABSTAND_MS
  } catch (fehler) {
    console.error('[assistent] Kostenstand aus dem AI Gateway nicht lesbar:', fehler)
    naechstePruefung = Date.now() + FEHLER_ABSTAND_MS
    await alarmiere(
      `kosten-unlesbar:${monat.heute}`,
      24 * 60 * 60 * 1000,
      `${konfig().name}: Kostenstand aus dem AI Gateway nicht lesbar. In Produktion bleibt der Assistent aus, solange kein Stand vorliegt.`,
    )
  }
}

/**
 * Aktueller Monatsstand in USD, `null`, wenn keiner vorliegt. Fragt nur ab,
 * wenn der letzte Stand veraltet ist; parallele Aufrufe teilen sich eine
 * Abfrage.
 */
async function monatsStand(): Promise<number | null> {
  const monat = monatUtc().schluessel
  if (Date.now() >= naechstePruefung || letzterStand?.monat !== monat) {
    laufendeAbfrage ??= frageGatewayAb().finally(() => {
      laufendeAbfrage = null
    })
    await laufendeAbfrage
  }
  if (!letzterStand || letzterStand.monat !== monat) return null
  if (Date.now() - letzterStand.zeit > HOECHSTALTER_MS) return null
  return letzterStand.usd
}

/**
 * Schickt einen Alarm an `ASSISTENT_ALARM_WEBHOOK_URL`, höchstens einmal je
 * Schlüssel und Gültigkeitsdauer. Das Format `{ text }` versteht ein
 * Slack-Incoming-Webhook direkt, ein n8n-Webhook nimmt es ebenso an.
 */
export async function alarmiere(schluessel: string, gueltigMs: number, text: string) {
  const ziel = process.env.ASSISTENT_ALARM_WEBHOOK_URL
  if (!ziel) {
    console.warn(`[assistent] ALARM (kein Webhook gesetzt): ${text}`)
    return
  }
  if (!(await setzeEinmal(`assistent:alarm:${schluessel}`, gueltigMs))) return

  const umgebung = process.env.VERCEL_ENV ?? 'lokal'
  try {
    const antwort = await fetch(ziel, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${text} (Umgebung: ${umgebung})` }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    if (!antwort.ok) console.error(`[assistent] Alarm-Webhook antwortet ${antwort.status}`)
  } catch (fehler) {
    console.error('[assistent] Alarm-Webhook nicht erreichbar:', fehler)
  }
}

function usd(wert: number) {
  return `${wert.toFixed(2)} USD`
}

export type KostenLage =
  | { lage: 'ok'; usd: number | null }
  | { lage: 'kein-deckel' }
  | { lage: 'unbekannt' }
  | { lage: 'deckel-erreicht'; usd: number; deckel: number }

/**
 * Prüft den Monatsstand gegen die Schwellen und löst dabei die Alarme aus.
 * Gibt zurück, ob der Assistent laufen darf; die Entscheidung trifft
 * `assistentAktiv()`.
 */
export async function pruefeKosten(): Promise<KostenLage> {
  const { alarm, deckel } = kostenSchwellen()
  if (deckel === null) return { lage: 'kein-deckel' }

  const stand = await monatsStand()
  if (stand === null) return { lage: 'unbekannt' }

  const monat = monatUtc().schluessel
  const bisMonatsende = 32 * 24 * 60 * 60 * 1000

  if (stand >= deckel) {
    await alarmiere(
      `deckel:${monat}`,
      bisMonatsende,
      `${konfig().name} abgeschaltet: Monatskosten ${usd(stand)} haben den Deckel von ${usd(deckel)} erreicht. Er bleibt bis zum Monatsersten (UTC) aus, oder bis ASSISTENT_KOSTEN_DECKEL_USD angehoben wird.`,
    )
    return { lage: 'deckel-erreicht', usd: stand, deckel }
  }

  if (alarm !== null && stand >= alarm) {
    await alarmiere(
      `alarm:${monat}`,
      bisMonatsende,
      `${konfig().name}: Monatskosten ${usd(stand)} über der Alarmschwelle von ${usd(alarm)}. Deckel liegt bei ${usd(deckel)}, danach schaltet er sich ab.`,
    )
  }

  return { lage: 'ok', usd: stand }
}
