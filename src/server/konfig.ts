import type { ServerKonfig } from '../typen'

/**
 * Die Konfiguration der Website, gesetzt von `erstelleAssistent()`. Je
 * Serverprozess läuft genau eine Website, deshalb reicht ein Modulwert.
 */
let aktuell: ServerKonfig | null = null

export function setzeKonfig(konfig: ServerKonfig) {
  aktuell = konfig
}

export function konfig(): ServerKonfig {
  if (!aktuell) {
    throw new Error('[assistent] Keine Konfiguration gesetzt. erstelleAssistent() zuerst aufrufen.')
  }
  return aktuell
}

export const STANDARD_MODELL = {
  gateway: 'anthropic/claude-sonnet-5.5',
  direkt: 'claude-sonnet-5-5',
}
