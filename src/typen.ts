/**
 * Konfiguration des Website-Assistenten. Alles, was zwischen den Websites
 * abweicht, steht in diesen beiden Objekten. Alles andere ist gemeinsam und
 * wird mit dem Paket verbessert.
 *
 * Server und Browser bekommen getrennte Objekte: die Regeln und Kriterien
 * gehören nicht ins Browser-Bundle.
 */

import type { LeadAngaben } from './server/lead'

export type ServerKonfig = {
  /** Kennung für den Chatverlauf-Speicher (Feld `site` im n8n-Workflow). */
  site: string
  /** Produktionsdomain ohne Protokoll, z. B. `schoenegge.io`. */
  domain: string
  /** Name in Alarmtexten und Logs, z. B. `Website-Assistent schoenegge.io`. */
  name: string
  /** Tag im AI Gateway, über das der Kostendeckel die Monatssumme liest. */
  kostenTag: string
  /** Modell im AI Gateway und direkt bei Anthropic (lokal ohne Gateway). */
  modell?: { gateway: string; direkt: string }
  /** Lädt die Wissensbasis (llms-full.txt oder ein eigener Text). */
  ladeWissensbasis: () => Promise<string>
  prompt: PromptKonfig
  lead: LeadKonfig
  texte: {
    /** Antwort bei Rate-Limit, ein Satz plus Ausweg. */
    rateLimit: string
    /** Antwort, wenn das Modell ausfällt. */
    nichtErreichbar: string
  }
  /** Wird nach einer angelegten Lead-Karte aufgerufen (z. B. Ads-Conversion). */
  nachLead?: (angaben: LeadAngaben, koerper: Record<string, unknown>) => Promise<void>
}

export type PromptKonfig = {
  /** Erster Absatz: wer der Assistent ist und für wen er spricht. */
  identitaet: string
  /** Wofür die Wissensbasis die einzige Quelle ist, z. B. "uns, unsere Leistungen, ...". */
  quelleThemen: string
  /** Link für "frag uns direkt", z. B. Kontaktseite oder Terminbuchung. */
  kontaktLink: string
  /** Regel 1 der Verbote: wie mit Preisen umzugehen ist. */
  preise: string
  /** Satz für die Frage, wer oder was der Assistent ist. */
  transparenz: string
  /** Zusätzliche Regeln nur für diese Website (optional). */
  zusatzRegeln?: string
  /** Musterantworten (Frage, Gut, Schlecht) für diese Website (optional). */
  musterantworten?: string
  /** Satz nach "DEINE EIGENTLICHE AUFGABE". */
  aufgabe: string
  /** Zusätzliche Punkte für "SO FÜHRST DU DAS GESPRÄCH" (optional). */
  gespraechZusatz?: string
  /** Qualifizierung: wer passt, welche Angaben, wie absagen. */
  kriterien: string
  angaben: string
  absage: string
  /** Satz, der beim Seitenkontext ergänzt wird (optional). */
  seitenkontextZusatz?: string
}

export type LeadKonfig = {
  /** Präfix vor dem Kartentitel, z. B. `Fixseite: ` (optional). */
  titelPraefix?: string
  /** Erste Zeile der Kartenbeschreibung. */
  kopfzeile: (quelle: string, sprache: 'de' | 'en') => string
  /** Beispiel für das Feld titel_vorhaben, z. B. "Shopify-Shop mit Konfigurator". */
  vorhabenBeispiel: string
}

export type ClientKonfig = {
  /** Anzeigename, z. B. `schoenegge.io` oder `Fixseite`. */
  name: string
  begruessung: string
  untertitel: string
  /** Kurzer Satz unter dem Eingabefeld vor dem Speicherhinweis. */
  fusszeile: string
  /** Ausweg bei Fehlern. */
  fehlerKontakt: { text: string; linkText: string; href: string; extern?: boolean }
  /** Hosts, deren Links im Chat klickbar werden. */
  eigeneHosts: string[]
  /** Pfade ohne Assistent, z. B. Impressum und Datenschutz. */
  ausgenommen: string[]
  farben: Farben
  beispielfragen: Beispielfragen
  /** Browser-Ereignisse, die den Chat mit einem Text öffnen (z. B. Konfigurator). */
  oeffnenMitText?: string[]
}

export type Farben = {
  /** Akzentfarbe (Marke). */
  akzent: string
  /** Textfarbe auf der Akzentfarbe. */
  aufAkzent: string
  /** Rahmen der Leiste und der Anschlussfragen. */
  rahmen: string
  /** Etikett "Assistent" in der Leiste: Hintergrund und Text. */
  etikettHintergrund: string
  etikettText: string
  /** Senden-Knopf: Hintergrund, Text und Hover-Hintergrund, Hover-Text. */
  senden: string
  sendenText: string
  sendenHover: string
  sendenHoverText: string
}

export type Beispielfragen = {
  allgemein: string[]
  /** Pfad-Präfix auf Fragen; der längste passende Präfix gewinnt. */
  jeSeite: Record<string, string[]>
  /** Exakte Pfade, die vor den Präfixen gelten (z. B. eine Übersichtsseite). */
  exakt?: Record<string, string[]>
}
