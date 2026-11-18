# @schoenegge/website-assistent

KI-Assistent für die Websites von schoenegge.io: offene Chat-Leiste mit Beispielfragen je Seite, Chatfenster, Antwortregeln, Lead-Übergabe an Trello, Kostendeckel, Rate-Limit, BotID und Chatverlauf-Speicher. **Eine Quelle für alle Websites**: Wird hier etwas verbessert, bekommen es alle Websites mit einem Versionssprung.

Im Einsatz auf schoenegge.io und fixseite.de.

## Einbinden

```jsonc
// package.json
"@schoenegge/website-assistent": "github:schoenegge/website-assistent#v1.0.0"
```

```js
// next.config.mjs
transpilePackages: ['@schoenegge/website-assistent'],
```

```css
/* Tailwind 4: Klassen aus dem Paket finden */
@source '../../node_modules/@schoenegge/website-assistent/src';
```

Je Website zwei Konfigurationsdateien:

- `src/lib/assistent.ts` (Server): `export const assistent = erstelleAssistent({ ... })` mit Domain, Kosten-Tag, Wissensbasis, Prompt-Bausteinen (Identität, Preise, Kriterien, Musterantworten), Lead-Kopfzeile und Texten.
- `src/lib/assistent-anzeige.ts` (Browser): `ClientKonfig` mit Name, Begrüßung, Farben, Beispielfragen.

Routen und Komponente sind dann Einzeiler:

```ts
// src/app/api/assistent/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const POST = assistent.POST

// src/app/api/assistent/status/route.ts
export const GET = assistent.GET_STATUS
```

```tsx
// src/components/ChatAssistent.tsx ('use client')
<ChatAssistent konfig={ASSISTENT_ANZEIGE} />
```

## Umgebungsvariablen (je Vercel-Projekt)

`ASSISTENT_AKTIV` (oder Edge Config `assistent_aktiv`), `ASSISTENT_KOSTEN_DECKEL_USD`, `ASSISTENT_KOSTEN_ALARM_USD`, `ASSISTENT_ALARM_WEBHOOK_URL`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, `CHATLOG_URL`, `CHATLOG_SECRET`, optional `KV_REST_API_URL`/`KV_REST_API_TOKEN` (Upstash) und `ASSISTENT_BOTID=aus` als Notschalter. Keine Werte in dieses Repo.

## Verbessern und ausrollen

1. Änderung hier, `npm run typecheck`.
2. Vor dem Release auf beiden Websites lokal die Beispielfragen echt stellen (Antworten ohne Preise, ohne erfundene Zahlen).
3. Version in `package.json` und `CHANGELOG.md` hochzählen, Tag `vX.Y.Z` pushen.
4. In beiden Websites `npm install github:schoenegge/website-assistent#vX.Y.Z` ausführen (nur die Versionszeile ändern reicht nicht, npm hält sonst den alten Stand), prüfen, dass `node_modules/@schoenegge/website-assistent/package.json` die neue Version zeigt, bauen, `package.json` und `package-lock.json` committen, live.
5. Nach dem Deploy im Vercel-Build-Log prüfen, dass das Paket geändert wurde (`changed … packages`), nicht `up to date`. Ohne Sperrdatei im Repo stellt Vercel den alten Stand aus dem Build-Cache wieder her (18.11.2026).

Was gemeinsam ist (Regeln, Leiste, Übergabe), gehört hierher. Was nur eine Website betrifft (Kriterien, Beispielfragen, Texte, Farben), gehört in deren Konfiguration.
