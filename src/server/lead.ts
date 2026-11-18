import { konfig } from './konfig'

/**
 * Lead-Übergabe des Website-Assistenten an Trello (Trello gZETzejB, Karte 2 von 3).
 *
 * Legt aus einem passenden Chat genau eine Karte in der Spalte "Neue Leads"
 * des Leads-Boards an. Nur ein ausdrücklicher Aufruf aus dem Chat erzeugt
 * eine Karte, ein abgebrochenes Gespräch erzeugt nichts.
 */

// Leads-Board und Spalte "Neue Leads", siehe Memory project-leads-pipeline-trello.
const LEADS_BOARD = '6a0e083acaec634b5599d79b'
const LISTE_NEUE_LEADS = '6a554a77c0ec80661d15b627'
const LABEL_GRENZFALL = '6ab63c65d480a244ad34ac0c'

const FELD_QUELLE = '6a554a9a8ad93734c4b72afa'
const QUELLE_CHAT = '6ab63c70f1437175bf3726b6'
const FELD_LEAD_TYP = '6a554aa90432bdbda674d418'
const FELD_BUDGET = '6a554aa944ece38ea09bcacb'
const FELD_ERSTKONTAKT = '6a554aa96857a4e4abd7f7c8'

export const LEAD_TYPEN = {
  'Shopify-Retainer': '6a554ab6e82789dfc28e848e',
  Migration: '6a554ab68bda07ebbfa51600',
  'WP-Projekt': '6a554ab68d08f9cc16a8d2e0',
  'SEO/GEO': '6ab63c71c559f81cb0bb3eaa',
  Automation: '6ab63c71bc18bf7b4bfa4bf0',
  Discovery: '6a554ab77bd3f4ef8ebcc98c',
} as const

export const IST_STAENDE = ['noch keine Website', 'Shopify', 'WordPress', 'Wix', 'andere'] as const

export type LeadAngaben = {
  einstufung: 'passt' | 'grenzfall'
  grenzfall_grund?: string
  name: string
  email: string
  firma_oder_domain: string
  anliegen: string
  titel_vorhaben: string
  ist_stand: (typeof IST_STAENDE)[number]
  ist_stand_detail?: string
  telefon?: string
  zeitrahmen?: string
  budget?: string
  art?: 'Projekt' | 'Betreuung' | 'offen'
  lead_typ?: keyof typeof LEAD_TYPEN
  zusammenfassung: string
  sprache: 'de' | 'en'
  gefunden_ueber?: string
}

export type LeadErgebnis =
  | { ergebnis: 'angelegt' }
  | { ergebnis: 'bereits_uebergeben' }
  | { ergebnis: 'angaben_fehlen'; hinweis: string }
  | { ergebnis: 'fehler' }

// Schutz innerhalb einer laufenden Serverinstanz: Sitzung -> Karte (oder null,
// solange sie gerade angelegt wird). Fängt zwei fast gleichzeitige Aufrufe ab.
// Über Instanzen hinweg entscheidet der Sitzungsmarker in der Kartenbeschreibung.
const sitzungsKarten = new Map<string, string | null>()

function zugang() {
  const key = process.env.TRELLO_API_KEY
  const token = process.env.TRELLO_TOKEN
  if (!key || !token) return null
  return { key, token }
}

async function trello(
  pfad: string,
  optionen: { methode?: string; parameter?: Record<string, string>; json?: unknown } = {},
) {
  const z = zugang()
  if (!z) throw new Error('TRELLO_API_KEY oder TRELLO_TOKEN fehlt')

  const url = new URL(`https://api.trello.com/1${pfad}`)
  url.searchParams.set('key', z.key)
  url.searchParams.set('token', z.token)

  const methode = optionen.methode ?? 'GET'
  if (methode === 'GET' && optionen.parameter) {
    Object.entries(optionen.parameter).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  let body: string | undefined
  const headers: Record<string, string> = {}

  if (optionen.json !== undefined) {
    body = JSON.stringify(optionen.json)
    headers['Content-Type'] = 'application/json'
  } else if (optionen.parameter && methode !== 'GET') {
    // Lange Beschreibungen gehören in den Body, im Query-String sprengen sie die URL.
    body = new URLSearchParams(optionen.parameter).toString()
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  const antwort = await fetch(url, {
    method: methode,
    headers,
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!antwort.ok) {
    throw new Error(`Trello ${methode} ${pfad}: HTTP ${antwort.status} ${await antwort.text()}`)
  }
  return antwort.json()
}

function sitzungsMarker(sitzung: string) {
  return `Chat-Sitzung: ${sitzung}`
}

async function karteDerSitzung(sitzung: string): Promise<string | null> {
  const karten = (await trello(`/boards/${LEADS_BOARD}/cards`, {
    parameter: { fields: 'desc', filter: 'all' },
  })) as { id: string; desc: string }[]
  const marker = sitzungsMarker(sitzung)
  return karten.find((karte) => karte.desc.includes(marker))?.id ?? null
}

/**
 * Nichts, was auf der Karte landet, darf erfunden sein. Kontaktdaten muss der
 * Besucher deshalb selbst geschrieben haben: taucht die E-Mail-Adresse (oder
 * die Telefonnummer) nicht wörtlich in seinen Nachrichten auf, wird nichts
 * angelegt und der Assistent fragt nach.
 */
function pruefeHerkunft(angaben: LeadAngaben, besucherText: string): string | null {
  const text = besucherText.toLowerCase()
  const nurZiffern = besucherText.replace(/\D/g, '')

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(angaben.email.trim())) {
    return 'Die E-Mail-Adresse ist nicht gültig. Frag noch einmal danach.'
  }
  if (!text.includes(angaben.email.trim().toLowerCase())) {
    return 'Die E-Mail-Adresse steht so nicht in den Nachrichten des Besuchers. Frag danach, statt sie zu ergänzen.'
  }
  const vorname = angaben.name.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (vorname.length === 0 || !text.includes(vorname)) {
    return 'Den Namen hat der Besucher so nicht geschrieben. Frag danach, statt ihn aus der E-Mail-Adresse abzuleiten.'
  }
  const telefon = angaben.telefon?.replace(/\D/g, '') ?? ''
  if (telefon.length > 0 && !nurZiffern.includes(telefon)) {
    return 'Die Telefonnummer steht so nicht in den Nachrichten des Besuchers. Lass sie weg oder frag danach.'
  }
  return null
}

function beschreibung(angaben: LeadAngaben, sitzung: string, verlauf: string, quelle: string) {
  const zeilen = [konfig().lead.kopfzeile(quelle, angaben.sprache), '']

  if (angaben.einstufung === 'grenzfall') {
    zeilen.push(`**Grenzfall:** ${angaben.grenzfall_grund ?? 'Einstufung unsicher'}. Oliver entscheidet.`, '')
  }

  zeilen.push(
    '## Zusammenfassung',
    '',
    angaben.zusammenfassung,
    '',
    '## Angaben',
    '',
    `- Name: ${angaben.name}`,
    `- Mail: ${angaben.email}`,
    `- Firma/Domain: ${angaben.firma_oder_domain}`,
    `- Anliegen: ${angaben.anliegen}`,
    `- Stand heute: ${angaben.ist_stand}${angaben.ist_stand_detail ? ` (${angaben.ist_stand_detail})` : ''}`,
    `- Telefon: ${angaben.telefon || 'nicht angegeben'}`,
    `- Zeitrahmen: ${angaben.zeitrahmen || 'nicht angegeben'}`,
    `- Budget: ${angaben.budget || 'nicht angegeben'}`,
    `- Projekt oder Betreuung: ${angaben.art || 'nicht angegeben'}`,
  )
  if (angaben.gefunden_ueber) zeilen.push(`- Gefunden über: ${angaben.gefunden_ueber}`)
  zeilen.push('')
  // Kommt die Anfrage aus einem Formular (z. B. Konfigurator), gibt es keinen Verlauf.
  if (verlauf.trim()) zeilen.push('## Gesprächsverlauf', '', verlauf, '')
  zeilen.push('---', sitzungsMarker(sitzung))

  // Trello begrenzt die Beschreibung auf 16.384 Zeichen.
  return zeilen.join('\n').slice(0, 16000)
}

function titel(angaben: LeadAngaben) {
  const firma = angaben.firma_oder_domain.trim()
  const vorhaben = angaben.titel_vorhaben.trim()
  return `${konfig().lead.titelPraefix ?? ''}${firma} / ${angaben.name.trim()}, ${vorhaben}`.slice(0, 200)
}

async function setzeListenfeld(karte: string, feld: string, option: string) {
  await trello(`/cards/${karte}/customField/${feld}/item`, {
    methode: 'PUT',
    json: { idValue: option },
  })
}

/**
 * Legt die Lead-Karte an. Gibt dem Modell ein knappes Ergebnis zurück, aus dem
 * es seine Antwort an den Besucher formuliert.
 */
export async function uebergebeLead(
  angaben: LeadAngaben,
  kontext: { sitzung: string; besucherText: string; verlauf: string; quelle?: string },
): Promise<LeadErgebnis> {
  const problem = pruefeHerkunft(angaben, kontext.besucherText)
  if (problem) return { ergebnis: 'angaben_fehlen', hinweis: problem }

  if (!zugang()) {
    console.error('[assistent] Lead-Übergabe nicht möglich: Trello-Zugang fehlt')
    return { ergebnis: 'fehler' }
  }

  if (sitzungsKarten.get(kontext.sitzung) === null) return { ergebnis: 'bereits_uebergeben' }
  const bekannt = sitzungsKarten.get(kontext.sitzung)
  sitzungsKarten.set(kontext.sitzung, bekannt ?? null)

  try {
    const vorhanden = bekannt ?? (await karteDerSitzung(kontext.sitzung))
    if (vorhanden) {
      // Zweites fertiges Gespräch derselben Sitzung: keine zweite Karte, der
      // neue Stand kommt als Kommentar auf die bestehende.
      await trello(`/cards/${vorhanden}/actions/comments`, {
        methode: 'POST',
        parameter: {
          text: `Weiteres Gespräch in derselben Chat-Sitzung:\n\n${angaben.zusammenfassung}`,
        },
      })
      sitzungsKarten.set(kontext.sitzung, vorhanden)
      return { ergebnis: 'bereits_uebergeben' }
    }

    const karte = (await trello('/cards', {
      methode: 'POST',
      parameter: {
        idList: LISTE_NEUE_LEADS,
        pos: 'top',
        name: titel(angaben),
        desc: beschreibung(angaben, kontext.sitzung, kontext.verlauf, kontext.quelle ?? 'chat'),
        ...(angaben.einstufung === 'grenzfall' ? { idLabels: LABEL_GRENZFALL } : {}),
      },
    })) as { id: string; shortUrl: string }
    sitzungsKarten.set(kontext.sitzung, karte.id)

    // Custom Fields einzeln und fehlertolerant: eine fehlende Feldoption darf
    // die bereits angelegte Karte nicht zu einem Fehler für den Besucher machen.
    const felder: Promise<unknown>[] = [
      setzeListenfeld(karte.id, FELD_QUELLE, QUELLE_CHAT),
      trello(`/cards/${karte.id}/customField/${FELD_ERSTKONTAKT}/item`, {
        methode: 'PUT',
        json: { value: { date: new Date().toISOString() } },
      }),
    ]
    if (angaben.lead_typ && LEAD_TYPEN[angaben.lead_typ]) {
      felder.push(setzeListenfeld(karte.id, FELD_LEAD_TYP, LEAD_TYPEN[angaben.lead_typ]))
    }
    if (angaben.budget) {
      felder.push(
        trello(`/cards/${karte.id}/customField/${FELD_BUDGET}/item`, {
          methode: 'PUT',
          json: { value: { text: angaben.budget } },
        }),
      )
    }
    const ergebnisse = await Promise.allSettled(felder)
    ergebnisse
      .filter((e): e is PromiseRejectedResult => e.status === 'rejected')
      .forEach((e) => console.error('[assistent] Custom Field nicht gesetzt:', e.reason))

    console.log(`[assistent] Lead angelegt: ${karte.shortUrl} (${angaben.einstufung})`)
    return { ergebnis: 'angelegt' }
  } catch (fehler) {
    if (sitzungsKarten.get(kontext.sitzung) === null) sitzungsKarten.delete(kontext.sitzung)
    console.error('[assistent] Lead-Übergabe fehlgeschlagen:', fehler)
    return { ergebnis: 'fehler' }
  }
}
