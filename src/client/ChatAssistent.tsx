'use client'

import { DefaultChatTransport } from 'ai'
import { useChat } from '@ai-sdk/react'
import { track } from '@vercel/analytics'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ClientKonfig } from '../typen'
import { assistentAufPfad, beispielfragen } from './beispielfragen'

/**
 * Website-Assistent (Trello RSiNP4aZ, Karte 1 von 3).
 *
 * Antwortet aus dem veröffentlichten Seitentext, siehe
 * `src/lib/assistent-wissen.ts`. Die Komponente rendert nichts, solange der
 * Feature-Flag aus ist; gefragt wird er zur Laufzeit unter
 * `/api/assistent/status`, damit sich der Assistent ohne neues Deployment
 * abschalten lässt.
 */


/**
 * Zählpunkte für die Vorher-nachher-Messung (Karte s8Q4Lkw3): Vercel Analytics,
 * Custom Events. Messfehler dürfen den Chat nie stören.
 */
function zaehle(ereignis: string, daten: Record<string, string>) {
  try {
    // Mit Seite, ohne Nachrichtentext und ohne Personendaten.
    track(ereignis, { ...daten, seite: window.location.pathname })
  } catch {
    // Ohne Analytics (Blocker, lokal) einfach nichts zählen.
  }
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Sprechblase mit drei Punkten, Form nach Heroicons (MIT) chat-bubble-oval-left-ellipsis */}
      <path d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </svg>
  )
}

function FunkelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Funkeln, Form nach Heroicons (MIT) sparkles */}
      <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
    </svg>
  )
}

function PfeilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

const LEISTE_SCHLUESSEL = 'assistent-leiste-minimiert'

function leseMinimiert(): boolean {
  try {
    return window.localStorage.getItem(LEISTE_SCHLUESSEL) === '1'
  } catch {
    return false
  }
}

function merkeMinimiert(wert: boolean) {
  try {
    if (wert) window.localStorage.setItem(LEISTE_SCHLUESSEL, '1')
    else window.localStorage.removeItem(LEISTE_SCHLUESSEL)
  } catch {
    // Ohne Speicher gilt die Wahl nur für diesen Seitenaufruf.
  }
}

/**
 * Wechselnde Beispielfrage für die Leiste: tippt sich Buchstabe für Buchstabe
 * ein, steht kurz und wechselt dann. Mit prefers-reduced-motion nur Wechsel.
 * Läuft nur, solange die Leiste sichtbar ist.
 */
function useBeispielfrage(fragen: string[], laeuft: boolean) {
  const [index, setIndex] = useState(0)
  const [zeichen, setZeichen] = useState(0)
  const [ruhig, setRuhig] = useState(false)

  useEffect(() => {
    const abfrage = window.matchMedia('(prefers-reduced-motion: reduce)')
    setRuhig(abfrage.matches)
    const beiWechsel = () => setRuhig(abfrage.matches)
    abfrage.addEventListener('change', beiWechsel)
    return () => abfrage.removeEventListener('change', beiWechsel)
  }, [])

  // Neue Seite, neue Auswahl: von vorn.
  useEffect(() => {
    setIndex(0)
    setZeichen(0)
  }, [fragen])

  const frage = fragen[index % fragen.length] ?? ''

  useEffect(() => {
    if (!laeuft || fragen.length === 0) return
    if (ruhig) {
      const t = window.setTimeout(() => setIndex((i) => (i + 1) % fragen.length), 5000)
      return () => window.clearTimeout(t)
    }
    if (zeichen < frage.length) {
      const t = window.setTimeout(() => setZeichen((z) => z + 1), 40)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => {
      setZeichen(0)
      setIndex((i) => (i + 1) % fragen.length)
    }, 3200)
    return () => window.clearTimeout(t)
  }, [laeuft, ruhig, zeichen, frage, fragen.length])

  return { frage, sichtbar: ruhig ? frage : frage.slice(0, zeichen) }
}

function SchliessenIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/**
 * Kennung dieser Browser-Sitzung. Der Server legt damit zwei fertige
 * Gespräche derselben Sitzung auf dieselbe Lead-Karte (Karte gZETzejB).
 */
function sitzungsKennung(): string {
  const schluessel = 'assistent-sitzung'
  try {
    const vorhanden = window.sessionStorage.getItem(schluessel)
    if (vorhanden) return vorhanden
    const neu = crypto.randomUUID()
    window.sessionStorage.setItem(schluessel, neu)
    return neu
  } catch {
    // Ohne sessionStorage (privates Fenster, blockiert) gilt die Kennung für
    // diesen Seitenaufruf.
    return crypto.randomUUID()
  }
}

/**
 * Prüft, ob eine URL auf die eigene Website zeigt. Nur solche werden klickbar.
 * Der Assistent soll ausschließlich eigene Seiten nennen; taucht trotzdem eine
 * fremde Adresse im Antworttext auf, bleibt sie sichtbarer Text statt Link.
 * Sonst würde ein erfolgreicher Injektionsversuch einen anklickbaren Link auf
 * der Seite der Agentur erzeugen.
 */
function istEigeneSeite(url: string, hosts: string[]): boolean {
  try {
    const { hostname } = new URL(url)
    return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

/**
 * Macht aus nackten URLs im Antworttext klickbare Links. Der Assistent nennt
 * Seiten der eigenen Website als Beleg, die sollen anklickbar sein.
 */
function mitLinks(text: string, hosts: string[]) {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((teil, index) => {
    // Satzzeichen am Ende gehören zum Satz, nicht zur Adresse.
    const url = teil.replace(/[.,;:]+$/, '')

    if (!/^https?:\/\//.test(teil) || !istEigeneSeite(url, hosts)) {
      return <span key={index}>{teil}</span>
    }

    return (
      <span key={index}>
        <a
          href={url}
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-[var(--a-akzent)]"
        >
          {url}
        </a>
        {teil.slice(url.length)}
      </span>
    )
  })
}

/**
 * Die Route liefert bei Rate-Limit (429) einen eigenen Satz als JSON. Den
 * zeigen wir, alles andere bleibt beim allgemeinen Hinweis.
 */
function fehlerHinweis(fehler: Error): string {
  try {
    const daten = JSON.parse(fehler.message) as { fehler?: unknown }
    if (typeof daten.fehler === 'string' && daten.fehler.includes('viele Nachrichten')) {
      return 'Das waren gerade sehr viele Nachrichten auf einmal. Warte bitte einen Moment.'
    }
  } catch {
    // Kein JSON, allgemeiner Hinweis.
  }
  return 'Das hat gerade nicht geklappt.'
}

type Eigenschaften = {
  konfig: ClientKonfig
  /** Zusätzliche Felder im Anfragekörper, z. B. eine Klick-ID aus Anzeigen. */
  zusatzKoerper?: () => Record<string, unknown>
}

export function ChatAssistent({ konfig, zusatzKoerper }: Eigenschaften) {
  const pfad = usePathname()
  const [aktiv, setAktiv] = useState(false)
  const [offen, setOffen] = useState(false)
  const [eingabe, setEingabe] = useState('')
  const [minimiert, setMinimiert] = useState(false)
  // Beispielfrage, mit der der Chat geöffnet wurde: Platzhalter im Chat und
  // Text, der beim Absenden ohne eigene Eingabe gestellt wird.
  const [vorschlag, setVorschlag] = useState<string | null>(null)
  // Beim Lesen (nach unten scrollen) tritt die Leiste zurück, beim Hochscrollen
  // und am Seitenende kommt sie wieder (Lesertest 18.11.2026: sie verdeckte Text).
  const [weggescrollt, setWeggescrollt] = useState(false)

  useEffect(() => {
    let zuletzt = window.scrollY
    function beiScroll() {
      const y = window.scrollY
      const amEnde = window.innerHeight + y >= document.documentElement.scrollHeight - 80
      if (amEnde || y < 120) setWeggescrollt(false)
      else if (y > zuletzt + 8) setWeggescrollt(true)
      else if (y < zuletzt - 8) setWeggescrollt(false)
      zuletzt = y
    }
    window.addEventListener('scroll', beiScroll, { passive: true })
    return () => window.removeEventListener('scroll', beiScroll)
  }, [])
  const fragen = useMemo(() => beispielfragen(konfig.beispielfragen, pfad), [konfig, pfad])
  const { frage: aktuelleFrage, sichtbar: sichtbareFrage } = useBeispielfrage(
    fragen,
    aktiv && !offen && !minimiert && !weggescrollt,
  )
  const eingabeFeld = useRef<HTMLInputElement>(null)
  const verlaufEnde = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/assistent',
        // Der Pfad sagt dem Assistenten, welche Seite der Besucher gerade liest
        // (Fragen wie „Fass diesen Artikel zusammen“). Die Route prüft ihn.
        body: () => ({
          ...(zusatzKoerper?.() ?? {}),
          sitzung: sitzungsKennung(),
          pfad: window.location.pathname,
        }),
      }),
    [zusatzKoerper],
  )
  const { messages, sendMessage, status, error } = useChat({ transport })

  // Der Flag entscheidet zur Laufzeit, ob der Assistent überhaupt erscheint.
  useEffect(() => {
    let abgebrochen = false

    fetch('/api/assistent/status', { cache: 'no-store' })
      .then((antwort) => (antwort.ok ? antwort.json() : { aktiv: false }))
      .then((stand) => {
        if (!abgebrochen) setAktiv(Boolean(stand?.aktiv))
      })
      .catch(() => {
        // Kein Statuswissen heißt: nicht anzeigen. Die Seite bleibt heil.
        if (!abgebrochen) setAktiv(false)
      })

    return () => {
      abgebrochen = true
    }
  }, [])

  useEffect(() => {
    setMinimiert(leseMinimiert())
  }, [])

  useEffect(() => {
    if (offen) eingabeFeld.current?.focus()
  }, [offen])

  // Andere Teile der Website (z. B. ein Konfigurator) können den Chat mit einem
  // Text öffnen: window.dispatchEvent(new CustomEvent('<name>', { detail: text })).
  useEffect(() => {
    const namen = konfig.oeffnenMitText ?? []
    if (namen.length === 0) return
    function beiAnfrage(ereignis: Event) {
      const text = (ereignis as CustomEvent<string>).detail
      if (typeof text !== 'string' || text.trim().length === 0) return
      setOffen(true)
      zaehle('chat_geoeffnet', { quelle: ereignis.type })
      zaehle('chat_nachricht', { quelle: ereignis.type })
      sendMessage({ text: text.trim().slice(0, 1900) })
    }
    namen.forEach((name) => window.addEventListener(name, beiAnfrage))
    return () => namen.forEach((name) => window.removeEventListener(name, beiAnfrage))
  }, [konfig, sendMessage])

  useEffect(() => {
    verlaufEnde.current?.scrollIntoView({ block: 'end' })
  }, [messages, status])

  useEffect(() => {
    if (!offen) return

    function beiTaste(ereignis: KeyboardEvent) {
      if (ereignis.key === 'Escape') setOffen(false)
    }

    window.addEventListener('keydown', beiTaste)
    return () => window.removeEventListener('keydown', beiTaste)
  }, [offen])

  if (!aktiv || !assistentAufPfad(konfig.ausgenommen, pfad)) return null

  const laeuft = status === 'submitted' || status === 'streaming'

  // Läuft gerade die Lead-Übergabe, sieht der Besucher sonst nur Stille.
  const letzte = messages[messages.length - 1]
  const gibtWeiter =
    letzte?.role === 'assistant' &&
    letzte.parts.some(
      (teil) =>
        teil.type === 'tool-lead_uebergeben' &&
        (teil as { state?: string }).state !== 'output-available',
    )

  function absenden(ereignis: React.FormEvent) {
    ereignis.preventDefault()

    const text = eingabe.trim() || (messages.length === 0 && vorschlag ? vorschlag : '')
    if (text.length === 0 || laeuft) return

    setEingabe('')
    setVorschlag(null)
    zaehle('chat_nachricht', { quelle: messages.length === 0 && !eingabe.trim() ? 'vorschlag' : 'eingabe' })
    void sendMessage({ text })
  }

  // Leiste: öffnet den Chat mit der gerade sichtbaren Frage als Vorschlag.
  function ausLeisteOeffnen() {
    setVorschlag(messages.length === 0 ? aktuelleFrage : null)
    setOffen(true)
    zaehle('chat_geoeffnet', { quelle: 'leiste' })
  }

  // Pfeil in der Leiste: stellt die gerade sichtbare Frage direkt.
  function leisteAbsenden() {
    setOffen(true)
    setVorschlag(null)
    if (!laeuft && aktuelleFrage) {
      zaehle('chat_geoeffnet', { quelle: 'beispielfrage' })
      zaehle('chat_nachricht', { quelle: 'beispielfrage' })
      void sendMessage({ text: aktuelleFrage })
    }
  }

  function leisteMinimieren() {
    setMinimiert(true)
    merkeMinimiert(true)
  }

  // Anschlussfragen unter der letzten Antwort: die getesteten Beispielfragen
  // dieser Seite, die noch nicht gestellt wurden (Karte s8Q4Lkw3, Punkt 4).
  const gestellt = new Set(
    messages
      .filter((n) => n.role === 'user')
      .map((n) =>
        n.parts
          .filter((teil) => teil.type === 'text')
          .map((teil) => (teil as { text: string }).text.trim())
          .join(''),
      ),
  )
  // Nur solange das Gespräch aus Beispielfragen besteht. Hat der Besucher
  // selbst etwas geschrieben, passen feste Fragen nicht mehr zum Gespräch
  // (Oliver 18.11.2026: nach einer Preisfrage standen dort Shop-Fragen).
  const bekannteFragen = new Set([
    ...konfig.beispielfragen.allgemein,
    ...Object.values(konfig.beispielfragen.jeSeite).flat(),
    ...Object.values(konfig.beispielfragen.exakt ?? {}).flat(),
  ])
  const nurBeispielfragen = [...gestellt].every((f) => bekannteFragen.has(f))
  // Beim ersten Öffnen bis zu drei Einstiegsfragen unter der Begrüßung, danach
  // zwei Anschlussfragen unter jeder Antwort (Oliver 18.11.2026).
  const einstieg = messages.length === 0 && !laeuft
  const anschluss = einstieg
    ? fragen.filter((f) => f !== vorschlag).slice(0, 3)
    : !laeuft && !error && letzte?.role === 'assistant' && nurBeispielfragen
      ? fragen.filter((f) => !gestellt.has(f)).slice(0, 2)
      : []

  function anschlussStellen(frage: string) {
    if (laeuft) return
    setVorschlag(null)
    zaehle('chat_nachricht', { quelle: einstieg ? 'einstiegsfrage' : 'anschlussfrage' })
    void sendMessage({ text: frage })
  }

  const zeigeLeiste = !offen && !minimiert

  return (
    <div
      className="fixed bottom-4 right-4 z-50 print:hidden sm:bottom-6 sm:right-6"
      style={farbVariablen(konfig)}
    >
      {zeigeLeiste && (
        <div
          aria-hidden={weggescrollt || undefined}
          className={clsx(
            'assistent-leiste fixed bottom-4 left-1/2 z-50 flex w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-1 rounded-2xl border border-[var(--a-rahmen)] bg-white p-1.5 shadow-xl transition duration-300 motion-reduce:transition-none sm:bottom-6',
            weggescrollt && 'pointer-events-none translate-y-[160%] opacity-0',
          )}
        >
          <button
            type="button"
            onClick={ausLeisteOeffnen}
            aria-label="Assistent öffnen und eine Frage stellen"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--a-akzent)]"
          >
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--a-etikett-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--a-etikett-text)]">
              <FunkelIcon className="h-3.5 w-3.5" />
              {/* Mobil nur das Symbol, sonst passen die Beispielfragen nicht in zwei Zeilen (11.11.2026) */}
              <span className="max-sm:hidden">Assistent</span>
            </span>
            <span aria-hidden="true" className="line-clamp-2 h-10 min-w-0 flex-1 whitespace-normal text-sm leading-5 text-neutral-500 max-sm:text-[13px]">
              {sichtbareFrage}
              <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-neutral-400 motion-reduce:hidden" />
            </span>
          </button>
          <button
            type="button"
            onClick={leisteAbsenden}
            aria-label="Beispielfrage an den Assistenten senden"
            className="shrink-0 rounded-xl bg-neutral-950 p-2 text-white transition hover:bg-[var(--a-akzent)] hover:text-[var(--a-auf-akzent)] focus-visible:ring-2 focus-visible:ring-[var(--a-akzent)] focus-visible:ring-offset-2"
          >
            <PfeilIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={leisteMinimieren}
            aria-label="Assistenten-Leiste ausblenden"
            className="shrink-0 rounded-xl p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-[var(--a-akzent)]"
          >
            <SchliessenIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {offen && (
        <div
          className="fixed bottom-4 left-1/2 z-50 flex h-[32rem] max-h-[calc(100vh-2rem)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col sm:bottom-6 overflow-hidden rounded-3xl border-[5px] border-white bg-white shadow-2xl ring-1 ring-neutral-950/15"
          role="dialog"
          aria-label={`Assistent von ${konfig.name}`}
        >
          <div className="flex items-center justify-between gap-4 bg-neutral-950 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-white">
                Dein KI-Assistent von {konfig.name}
              </p>
              <p className="text-xs text-neutral-400">
                {konfig.untertitel}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setOffen(false)}
                aria-label="Assistent minimieren, das Gespräch bleibt erhalten"
                title="Minimieren"
                className="rounded-full p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setOffen(false)}
                aria-label="Assistent schließen"
                title="Schließen"
                className="rounded-full p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
              >
                <SchliessenIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
            <p className="rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
              {konfig.begruessung}
            </p>

            {messages.map((nachricht) => {
              const text = nachricht.parts
                .filter((teil) => teil.type === 'text')
                .map((teil) => (teil as { text: string }).text)
                .join('')

              if (text.length === 0) return null

              return (
                <div
                  key={nachricht.id}
                  className={clsx(
                    'flex',
                    nachricht.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <p
                    className={clsx(
                      'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm',
                      nachricht.role === 'user'
                        ? 'bg-neutral-950 text-white'
                        : 'bg-neutral-100 text-neutral-800',
                    )}
                  >
                    {mitLinks(text, konfig.eigeneHosts)}
                  </p>
                </div>
              )
            })}

            {status === 'submitted' && (
              <p className="text-sm text-neutral-500">Der Assistent liest nach ...</p>
            )}

            {status === 'streaming' && gibtWeiter && (
              <p className="text-sm text-neutral-500">Ich gebe deine Anfrage weiter ...</p>
            )}

            {error && (
              <p className="rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
                {fehlerHinweis(error)} {konfig.fehlerKontakt.text}{' '}
                <a
                  href={konfig.fehlerKontakt.href}
                  {...(konfig.fehlerKontakt.extern ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="underline underline-offset-2"
                >
                  {konfig.fehlerKontakt.linkText}
                </a>
                .
              </p>
            )}

            {anschluss.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2" aria-label={einstieg ? 'Mögliche Fragen zum Einstieg' : 'Mögliche Anschlussfragen'}>
                {anschluss.map((frage) => (
                  <button
                    key={frage}
                    type="button"
                    onClick={() => anschlussStellen(frage)}
                    className="rounded-full border border-[var(--a-rahmen)] bg-white px-3 py-1.5 text-left text-xs text-neutral-800 transition hover:bg-[var(--a-etikett-bg)] focus-visible:ring-2 focus-visible:ring-[var(--a-akzent)]"
                  >
                    {frage}
                  </button>
                ))}
              </div>
            )}

            <div ref={verlaufEnde} />
          </div>

          <form
            onSubmit={absenden}
            className="border-t border-neutral-200 px-5 py-4"
          >
            <div className="flex items-center gap-2">
              <label htmlFor="assistent-eingabe" className="sr-only">
                Frage an den Assistenten
              </label>
              <input
                id="assistent-eingabe"
                ref={eingabeFeld}
                value={eingabe}
                onChange={(ereignis) => setEingabe(ereignis.target.value)}
                placeholder={
                  messages.length === 0 ? vorschlag ?? 'Was möchtest du wissen?' : 'Deine Antwort …'
                }
                maxLength={2000}
                autoComplete="off"
                className="w-full rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-950 outline-none focus:border-neutral-400"
              />
              <button
                type="submit"
                disabled={laeuft || (eingabe.trim().length === 0 && !(messages.length === 0 && vorschlag))}
                className="rounded-full bg-[var(--a-senden)] px-4 py-2 text-sm font-semibold text-[var(--a-senden-text)] transition hover:bg-[var(--a-senden-hover)] hover:text-[var(--a-senden-hover-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Senden
              </button>
            </div>
            <p className="text-center text-[11px] leading-4 text-neutral-400" style={{ marginTop: '0.75rem' }}>
              {konfig.fusszeile}{' '}
              Wir speichern Gespräche 12 Monate, Mail-Adressen und Nummern entfernt.{' '}
              <a href="/datenschutz" target="_blank" rel="noopener" className="underline underline-offset-2">
                Datenschutz
              </a>
            </p>
          </form>
        </div>
      )}

      {minimiert && !offen && (
      <button
        type="button"
        onClick={() => {
          if (!offen) zaehle('chat_geoeffnet', { quelle: 'symbol' })
          setOffen((zustand) => !zustand)
        }}
        aria-expanded={offen}
        aria-label={offen ? 'Assistent schließen' : 'Assistent öffnen'}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-950 text-white shadow-lg transition hover:bg-[var(--a-akzent)] hover:text-[var(--a-auf-akzent)] focus-visible:ring-2 focus-visible:ring-[var(--a-akzent)] focus-visible:ring-offset-2"
      >
        {offen ? (
          <SchliessenIcon className="h-6 w-6" />
        ) : (
          <ChatIcon className="h-6 w-6" />
        )}
      </button>
      )}
    </div>
  )
}

function farbVariablen(konfig: ClientKonfig): React.CSSProperties {
  const f = konfig.farben
  return {
    '--a-akzent': f.akzent,
    '--a-auf-akzent': f.aufAkzent,
    '--a-rahmen': f.rahmen,
    '--a-etikett-bg': f.etikettHintergrund,
    '--a-etikett-text': f.etikettText,
    '--a-senden': f.senden,
    '--a-senden-text': f.sendenText,
    '--a-senden-hover': f.sendenHover,
    '--a-senden-hover-text': f.sendenHoverText,
  } as React.CSSProperties
}
