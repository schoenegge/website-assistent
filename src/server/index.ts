import type { ServerKonfig } from '../typen'
import { assistentAktiv } from './einstellungen'
import { setzeKonfig } from './konfig'
import { uebergebeLead } from './lead'
import { baueSystemPrompt } from './prompt'
import { besucherIp, pruefeRatenlimit } from './ratenlimit'
import { assistentPost, assistentStatus } from './route'
import { erhoeheZaehler, setzeEinmal } from './speicher'

export type { ServerKonfig, PromptKonfig, LeadKonfig } from '../typen'
export type { LeadAngaben, LeadErgebnis } from './lead'
export { IST_STAENDE, LEAD_TYPEN } from './lead'

/**
 * Einstieg für den Server: einmal je Website mit ihrer Konfiguration
 * aufrufen, am besten in einer eigenen Datei (z. B. `src/lib/assistent.ts`),
 * und die Routen von dort bedienen:
 *
 *   // src/app/api/assistent/route.ts
 *   import { assistent } from '@/lib/assistent'
 *   export const runtime = 'nodejs'
 *   export const dynamic = 'force-dynamic'
 *   export const maxDuration = 30
 *   export const POST = assistent.POST
 */
export function erstelleAssistent(konfig: ServerKonfig) {
  setzeKonfig(konfig)

  return {
    /** Chat-Endpunkt (`/api/assistent`). */
    POST: (request: Request) => assistentPost(request),
    /** Status-Endpunkt (`/api/assistent/status`). */
    GET_STATUS: () => assistentStatus(),
    /** Ist der Assistent an (Schalter und Kostendeckel)? */
    aktiv: assistentAktiv,
    /** Lead-Karte anlegen, auch aus Formularen (Quelle angeben). */
    uebergebeLead,
    /** Rate-Limit und Zähler, auch für andere Routen der Website nutzbar. */
    pruefeRatenlimit,
    besucherIp,
    erhoeheZaehler,
    setzeEinmal,
    /** Für Prüfläufe: der vollständige System-Prompt. */
    baueSystemPrompt,
  }
}
