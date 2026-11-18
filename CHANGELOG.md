# Änderungen

## 1.0.1 (18.11.2026)

- Anschlussfragen nur, solange das Gespräch aus Beispielfragen besteht. Schreibt der Besucher selbst, erscheinen keine festen Fragen mehr (passten nach eigenen Fragen nicht zum Gespräch).

## 1.0.0 (18.11.2026)

Erste Fassung als gemeinsames Paket, zusammengeführt aus schoenegge.io und fixseite.de:

- Offene Chat-Leiste mit Beispielfragen je Seite, weicht beim Lesen aus, zwei Anschlussfragen unter jeder Antwort
- Seitenkontext: der Assistent weiß, auf welcher Seite der Besucher ist
- Modell Claude Sonnet 5.5 (je Website überschreibbar)
- Gemeinsame Antwortregeln: erst Inhalt, Fachbegriffe erklären, keine Pauschalzusagen, keine Improvisation ohne Quelle, Musterantworten je Website
- Lead-Übergabe an Trello (Chat und Formulare, z. B. Konfigurator), Zähler chat_geoeffnet/chat_nachricht/chat_lead
- Kostendeckel über das AI Gateway, Rate-Limit, BotID, Chatverlauf geschwärzt an n8n (12 Monate)
