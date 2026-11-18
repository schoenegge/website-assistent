import { anthropic } from '@ai-sdk/anthropic'
import { track } from '@vercel/analytics/server'
import {
  convertToModelMessages,
  isStepCount,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type UIMessage,
} from 'ai'
import { checkBotId } from 'botid/server'
import { NextResponse } from 'next/server'

import {
  ASSISTENT_MAX_ANTWORT_TOKENS,
  ASSISTENT_MAX_VERLAUF,
  assistentAktiv,
  modell,
} from './einstellungen'
import { konfig } from './konfig'
import { kostenTag } from './kosten'
import { IST_STAENDE, LEAD_TYPEN, uebergebeLead, type LeadAngaben } from './lead'
import { baueSystemPrompt, seitenkontext } from './prompt'
import { besucherIp, pruefeRatenlimit } from './ratenlimit'
import { speichereVerlauf } from './verlauf'

/**
 * Chat-Endpunkt des Website-Assistenten (Trello RSiNP4aZ, Karte 1 von 3).
 *
 * Serverseitig und streamend. Der Assistent antwortet ausschließlich aus
 * `public/llms-full.txt`, siehe `src/lib/assistent-wissen.ts`.
 *
 * Seit Karte 2 (gZETzejB) qualifiziert er Anfragen und legt passende über das
 * Werkzeug `lead_uebergeben` als Karte im Leads-Board an.
 *
 * Seit Karte 3 (WBFWBr3s) davor, in dieser Reihenfolge: Feature-Flag samt
 * monatlichem Kostendeckel, BotID, Rate-Limit je Sitzung und IP. Erst danach
 * wird der Anfragekörper gelesen und das Modell gerufen.
 */

/**
 * Pfad der Seite, auf der der Besucher gerade ist. Nur einfache Pfade, damit
 * darüber kein Text in den Prompt gelangt (Karte s8Q4Lkw3).
 */
function pruefePfad(wert: unknown): string | null {
  if (typeof wert !== 'string' || wert.length > 120) return null
  return /^\/[a-z0-9\-/]*$/.test(wert) ? wert : null
}

// Grenzen gegen versehentlich riesige Anfragen. Rate-Limit und Kostendeckel
// sitzen in assistent-ratenlimit.ts und assistent-kosten.ts (Karte 3).
const MAX_ZEICHEN_JE_NACHRICHT = 2000

/**
 * BotID (unsichtbare Prüfung, kein Rätsel für Besucher). Funktioniert nur auf
 * Vercel: die Prüfsignale kommen über Vercels Edge. Lokal (`next start`)
 * wird sie deshalb übersprungen. `ASSISTENT_BOTID=aus` schaltet sie im
 * Notfall ab, ohne Code-Änderung, falls echte Besucher abgewiesen werden.
 */
async function istBot(): Promise<boolean> {
  if (process.env.VERCEL !== '1') return false
  if (process.env.ASSISTENT_BOTID?.trim().toLowerCase() === 'aus') return false

  try {
    const pruefung = await checkBotId()
    return pruefung.isBot
  } catch (fehler) {
    // Fällt die Prüfung selbst aus, bleiben Rate-Limit und Kostendeckel als
    // Netz. Ein echter Besucher soll nicht an einem Ausfall von BotID scheitern.
    console.error('[assistent] BotID-Prüfung fehlgeschlagen:', fehler)
    return false
  }
}

type EingehendeNachricht = {
  id?: unknown
  role?: unknown
  parts?: unknown
}

/**
 * Nimmt nur an, was der Assistent auch verarbeiten soll: Text von Nutzer und
 * Assistent, gekürzt und in der Menge begrenzt. Alles andere fliegt raus,
 * statt ungeprüft ins Modell zu wandern.
 */
function normalisiereNachrichten(roh: unknown, grenze: number): UIMessage[] | null {
  if (!Array.isArray(roh) || roh.length === 0) return null

  const nachrichten: UIMessage[] = []

  for (const eintrag of roh.slice(-grenze) as EingehendeNachricht[]) {
    if (!eintrag || (eintrag.role !== 'user' && eintrag.role !== 'assistant')) {
      continue
    }

    const teile = Array.isArray(eintrag.parts) ? eintrag.parts : []
    const text = teile
      .filter(
        (teil): teil is { type: 'text'; text: string } =>
          typeof teil === 'object' &&
          teil !== null &&
          (teil as { type?: unknown }).type === 'text' &&
          typeof (teil as { text?: unknown }).text === 'string',
      )
      .map((teil) => teil.text)
      .join('\n')
      .trim()
      .slice(0, MAX_ZEICHEN_JE_NACHRICHT)

    if (text.length === 0) continue

    nachrichten.push({
      id: typeof eintrag.id === 'string' ? eintrag.id : `${nachrichten.length}`,
      role: eintrag.role,
      parts: [{ type: 'text', text }],
    })
  }

  const letzte = nachrichten[nachrichten.length - 1]
  if (!letzte || letzte.role !== 'user') return null

  return nachrichten
}

function textVon(nachricht: UIMessage) {
  return nachricht.parts.map((teil) => (teil.type === 'text' ? teil.text : '')).join('')
}

// Sitzungskennung aus dem Browser (sessionStorage). Sie dient nur dazu, zwei
// fertige Gespräche derselben Sitzung auf eine Lead-Karte zu legen.
function pruefeSitzung(roh: unknown): string | null {
  return typeof roh === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(roh) ? roh : null
}

// Für den Gesprächsverlauf auf der Lead-Karte, mehr braucht dort niemand.
const MAX_NACHRICHTEN_KARTE = 40

const leadSchema = () => jsonSchema<LeadAngaben>({
  type: 'object',
  additionalProperties: false,
  required: [
    'einstufung',
    'name',
    'email',
    'firma_oder_domain',
    'anliegen',
    'titel_vorhaben',
    'ist_stand',
    'zusammenfassung',
    'sprache',
  ],
  properties: {
    einstufung: {
      type: 'string',
      enum: ['passt', 'grenzfall'],
      description: 'passt oder grenzfall. Eindeutig unpassende Anfragen werden nie übergeben.',
    },
    grenzfall_grund: {
      type: 'string',
      description: 'Nur bei grenzfall: warum unsicher, ein halber Satz.',
    },
    name: { type: 'string', description: 'Name, wie der Besucher ihn geschrieben hat.' },
    email: { type: 'string', description: 'E-Mail-Adresse, wörtlich vom Besucher.' },
    firma_oder_domain: {
      type: 'string',
      description: 'Die Domain, wenn der Besucher eine genannt hat, sonst der Firmenname. Nur eins von beiden.',
    },
    anliegen: { type: 'string', description: 'Das Anliegen in einem Satz.' },
    titel_vorhaben: {
      type: 'string',
      description:
        `Das Vorhaben in drei bis sechs deutschen Wörtern für den Kartentitel, z. B. "${konfig().lead.vorhabenBeispiel}". Immer Deutsch, auch bei englischen Gesprächen.`,
    },
    ist_stand: { type: 'string', enum: [...IST_STAENDE] },
    ist_stand_detail: {
      type: 'string',
      description: 'Nur bei "andere" oder wenn der Besucher mehr dazu gesagt hat.',
    },
    telefon: { type: 'string' },
    zeitrahmen: { type: 'string' },
    budget: { type: 'string', description: 'Nur, wenn der Besucher selbst einen Rahmen genannt hat.' },
    art: { type: 'string', enum: ['Projekt', 'Betreuung', 'offen'] },
    lead_typ: {
      type: 'string',
      enum: Object.keys(LEAD_TYPEN),
      description:
        'Shopify-Retainer (laufende Shop-Betreuung), Migration (Plattformwechsel), WP-Projekt, SEO/GEO, Automation, Discovery (noch unklar). Weglassen, wenn nichts eindeutig passt.',
    },
    zusammenfassung: {
      type: 'string',
      description:
        'Zwei bis vier Sätze auf Deutsch für Oliver: was will der Besucher, was ist der Stand, was ist offen. Nur Gesagtes.',
    },
    sprache: { type: 'string', enum: ['de', 'en'], description: 'Sprache des Gesprächs.' },
    gefunden_ueber: {
      type: 'string',
      description: 'Wie der Besucher auf uns aufmerksam geworden ist, nur wenn er es selbst gesagt hat (z. B. Google, Empfehlung, Instagram).',
    },
  },
})

/**
 * Regelfall ist das Vercel AI Gateway: ein Endpunkt vor mehreren Modellen,
 * kein Anbieter-Key im Code. Ohne Gateway-Zugang (lokale Entwicklung) geht es
 * direkt gegen Anthropic, damit sich der Assistent auch ohne Gateway testen
 * lässt. In Produktion greift immer der erste Zweig.
 */
function waehleModell(): LanguageModel {
  const gatewayVorhanden =
    Boolean(process.env.AI_GATEWAY_API_KEY) || Boolean(process.env.VERCEL_OIDC_TOKEN)

  const { gateway, direkt } = modell()
  if (gatewayVorhanden) return gateway
  if (process.env.ANTHROPIC_API_KEY) return anthropic(direkt)

  return gateway
}

export async function assistentPost(request: Request) {
  const flag = await assistentAktiv()
  if (!flag.aktiv) {
    return NextResponse.json(
      { fehler: 'Der Assistent ist derzeit abgeschaltet.', quelle: flag.quelle },
      { status: 503 },
    )
  }

  if (await istBot()) {
    return NextResponse.json({ fehler: 'Anfrage abgelehnt.' }, { status: 403 })
  }

  let koerper: unknown
  try {
    koerper = await request.json()
  } catch {
    koerper = null
  }
  const sitzung = pruefeSitzung((koerper as { sitzung?: unknown } | null)?.sitzung)
  const seite = pruefePfad((koerper as { pfad?: unknown } | null)?.pfad)

  // Gezählt wird jede Anfrage, auch eine kaputte, damit eine Flut ungültiger
  // Anfragen nicht am Limit vorbeiläuft.
  const limit = await pruefeRatenlimit(sitzung, besucherIp(request))
  if (!limit.erlaubt) {
    console.warn(`[assistent] Rate-Limit greift (${limit.fenster})`)
    return NextResponse.json(
      {
        fehler: konfig().texte.rateLimit,
      },
      { status: 429, headers: { 'Retry-After': String(limit.wiederInSekunden) } },
    )
  }

  if (koerper === null) {
    return NextResponse.json({ fehler: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const roheNachrichten = (koerper as { messages?: unknown } | null)?.messages
  const nachrichten = normalisiereNachrichten(roheNachrichten, ASSISTENT_MAX_VERLAUF)
  const gesamterVerlauf = normalisiereNachrichten(roheNachrichten, MAX_NACHRICHTEN_KARTE) ?? []

  if (!nachrichten) {
    return NextResponse.json({ fehler: 'Keine verwertbare Nachricht.' }, { status: 400 })
  }

  try {
    const systemPrompt = await baueSystemPrompt()

    // Das Werkzeug gibt es nur mit Sitzungskennung, sonst ließe sich die
    // Doppelkarten-Sperre umgehen.
    // Für die Speicherung des Verlaufs (assistent-verlauf.ts): wurde in dieser Anfrage eine Karte angelegt?
    let leadUebergeben = false
    const werkzeuge = sitzung
      ? {
          lead_uebergeben: tool({
            description:
              'Gibt eine passende oder grenzwertige Anfrage als Lead an Oliver weiter (Trello-Karte). Nur aufrufen, nachdem der Besucher der Weitergabe ausdrücklich zugestimmt hat und alle Pflichtangaben von ihm selbst stammen.',
            inputSchema: leadSchema(),
            execute: async (angaben) => {
              const ergebnis = await uebergebeLead(angaben, {
                sitzung,
                besucherText: gesamterVerlauf
                  .filter((n) => n.role === 'user')
                  .map(textVon)
                  .join('\n'),
                verlauf: gesamterVerlauf
                  .map((n) => `**${n.role === 'user' ? 'Besucher' : 'Assistent'}:** ${textVon(n)}`)
                  .join('\n\n'),
              })
              // Gezählt wird nur eine wirklich angelegte Karte (Karte s8Q4Lkw3).
              // Messfehler dürfen die Antwort nie stören.
              if (ergebnis.ergebnis === 'angelegt') {
                leadUebergeben = true
                await track('chat_lead', { einstufung: angaben.einstufung }).catch(() => {})
                const nachLead = konfig().nachLead
                if (nachLead) {
                  await nachLead(angaben, koerper as Record<string, unknown>).catch((fehler) =>
                    console.error('[assistent] nachLead fehlgeschlagen:', fehler),
                  )
                }
              }
              return ergebnis
            },
          }),
        }
      : undefined

    const ergebnis = streamText({
      model: waehleModell(),
      // Der System-Prompt wandert bewusst als eigene Nachricht in den Verlauf:
      // nur so sitzt die Cache-Marke hinter der Wissensbasis und vor der Frage.
      // Am Ende des Prompts gesetzt, würde sie jede Anfrage neu schreiben
      // statt lesen, gemessen am 08.09.2026: 72.500 Tokens Cache-Schreibvorgang
      // je Frage, null Cache-Treffer.
      messages: [
        {
          role: 'system',
          content: systemPrompt,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        // Nach der Cache-Marke, damit der Seitenkontext den Cache nicht bricht.
        ...(seite
          ? [
              {
                role: 'system' as const,
                content: seitenkontext(seite),
              },
            ]
          : []),
        ...(await convertToModelMessages(nachrichten)),
      ],
      allowSystemInMessages: true,
      tools: werkzeuge,
      // Ein Schritt für den Werkzeugaufruf, einer für die Antwort danach.
      stopWhen: isStepCount(3),
      maxOutputTokens: ASSISTENT_MAX_ANTWORT_TOKENS,
      providerOptions: {
        anthropic: {
          thinking: { type: 'adaptive', display: 'omitted' },
          effort: 'low',
        },
        // Das Tag ordnet die Kosten im AI Gateway dem Assistenten zu. Der
        // Kostendeckel (assistent-kosten.ts) liest genau diese Summe.
        // zeroDataRetention: nur Anbieter mit Null-Aufbewahrung (Anthropic
        // gehört dazu), kostenfrei je Anfrage im Pro-Tarif. Grundlage für den
        // Satz in der Datenschutzerklärung (Oliver, 28.09.2026).
        gateway: { tags: [kostenTag()], zeroDataRetention: true },
      },
      onError: ({ error }) => {
        console.error('[assistent] Modellaufruf fehlgeschlagen:', error)
      },
      // Kostentransparenz im Log. Der Deckel selbst rechnet mit den Zahlen
      // des Gateways, nicht mit diesen.
      onFinish: async ({ usage, text }) => {
        const details = usage.inputTokenDetails
        console.log(
          `[assistent] Tokens: ${usage.inputTokens ?? '?'} ein (davon ${details?.cacheReadTokens ?? 0} aus dem Cache, ${details?.cacheWriteTokens ?? 0} in den Cache geschrieben), ${usage.outputTokens ?? '?'} aus`,
        )
        // Verlauf speichern (geschwärzt, 12 Monate), nur wenn CHATLOG_URL/CHATLOG_SECRET gesetzt sind.
        await speichereVerlauf({
          site: konfig().site,
          sitzung,
          seite,
          nachrichten: gesamterVerlauf,
          antwort: text,
          lead: leadUebergeben,
        })
      },
    })

    return ergebnis.toUIMessageStreamResponse({
      onError: () => konfig().texte.nichtErreichbar,
    })
  } catch (fehler) {
    console.error('[assistent] Anfrage konnte nicht gestartet werden:', fehler)
    return NextResponse.json(
      { fehler: 'Der Assistent ist gerade nicht erreichbar.' },
      { status: 502 },
    )
  }
}

/** Für die Status-Route: soll der Browser den Assistenten zeigen? */
export async function assistentStatus() {
  const flag = await assistentAktiv()
  return NextResponse.json(
    { aktiv: flag.aktiv, quelle: flag.quelle },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
