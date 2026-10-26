# Daniels Tech-Briefing (Alexa Flash Briefing)

Eigener Flash-Briefing-Skill für die „Tägliche Zusammenfassung" auf dem Echo.
Ein Skript baut täglich `docs/feed.json` im Alexa-Flash-Briefing-Format aus:

| Sektion | Quellen | Fenster |
|---|---|---|
| KI-News | The Decoder (DE), TechCrunch AI | 36 h |
| Tech-News | TechCrunch | 36 h |
| Techno und DJ-News | DJ Mag, Mixmag | 96 h |

Dubletten zwischen den Sektionen werden entfernt. Beatport und Resident Advisor
bieten keine nutzbaren Feeds (Stand 26.10.2026: 403 bzw. 404).

## Lokal ausführen

```
npm run generate      # schreibt docs/feed.json, Node >= 22
```

## Betrieb

- GitHub Action `.github/workflows/feed.yml` läuft täglich 04:30 UTC,
  generiert den Feed und committet `docs/feed.json`.
- GitHub Pages muss auf den Ordner `/docs` (Branch `main`) zeigen.
  Die öffentliche Feed-URL ist dann
  `https://<user>.github.io/alexa-tech-briefing/feed.json`.

## Einmalige Skill-Anlage (Alexa Developer Console)

1. https://developer.amazon.com/alexa/console/ask → mit dem Amazon-Konto
   anmelden, auf dem auch der Echo läuft (sonst taucht der Skill dort nie auf).
2. „Create Skill" → Name „Daniels Tech-Briefing" → Primary locale **German (DE)**
   → Modell **Flash Briefing** wählen.
3. Im Skill unter „Flash Briefing" einen Content-Feed anlegen:
   - Preamble: „Hier ist Daniels Tech-Briefing."
   - Update-Frequenz: Daily
   - Genre: Technology
   - Content type: **Text**
   - Feed-URL: die Pages-URL von oben
4. Speichern. **Keine Zertifizierung/Veröffentlichung nötig** — im Dev-Modus ist
   der Skill auf dem eigenen Konto sofort aktiv.
5. Alexa-App → Einstellungen → Nachrichten/Tägliche Zusammenfassung:
   „Daniels Tech-Briefing" erscheint als Quelle → aktivieren und an die
   gewünschte Stelle sortieren.

## Format-Referenz

Alexa erwartet ein JSON-Array mit bis zu 5 Items:
`uid`, `updateDate` (`yyyy-MM-dd'T'HH:mm:ss.S'Z'`), `titleText`,
`mainText` (max. 4500 Zeichen, wird per TTS vorgelesen), `redirectionUrl`.
