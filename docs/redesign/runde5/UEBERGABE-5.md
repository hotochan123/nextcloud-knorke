# Knorke Redesign, Runde 5: Admin-Seite und Logo

Stand 02.11.2026. Runden 1–4 sind gebaut (Leisten, Icons, Notizen, Formen, Verbinder, Frames, Swimlanes, Tabellen, Mindmaps). Diese Runde ändert nichts an ihnen. Sie kommt vor das erste Release im Nextcloud App Store (0.4.0); der Store zeigt das Logo.

Die Person ist keine Designerin und keine Entwicklerin. Sie entscheidet, indem sie auf Varianten zeigt. Zeig **Varianten nebeneinander**, jede mit einem Kürzel (A1, A2 … für die Admin-Seite, L1, L2 … für das Logo), immer mit **A0 / L0 = heute** daneben, und sag in einfachen Worten, worin sie sich unterscheiden.

Ergebnis: `runde5.html` (alle Varianten, Links wie `#A1`, `#L3`) und `runde5.md` (Empfehlung mit Werten), gebaut aus `src5/`. Keine Ressourcen aus dem Netz. Symbole aus `quellen/` (Phosphor, Lucide, Tabler) dürfen benutzt werden.

## Teil A: Admin-Seite

Heute: `screenshots/heute/20-admin-settings.png` (Nextcloud-Verwaltung → Knorke, 1440 × 900, deutsch). Vier Bereiche stehen als vier schmale Spalten nebeneinander, ohne Gewichtung; lange Textfelder sind abgeschnitten, drei „Speichern“-Knöpfe, leere Bereiche („Keine offenen Vorschläge“) nehmen gleich viel Platz wie volle.

Die Bereiche und ihre Felder (alle bleiben, nichts kommt dazu, nur Aussehen und Anordnung):

1. **KI:** Erklärsatz; Hinweis, wenn kein KI-Anbieter eingerichtet ist; Haken „KI in Knorke erlauben“; Zahl „KI-Aufträge pro Konto und Tag“; „Hinweis vor der ersten Nutzung“: Standardtext (mehrzeilig), Texte je Sprache (Sprache wählen, „Sprache hinzufügen“), Link (Adresse); Speichern.
2. **Datenschutzhinweis (für Gäste):** Erklärsatz; Standardtext (mehrzeilig); Adresse der Datenschutzerklärung; Texte je Sprache; Speichern.
3. **Vorlagen:** Erklärsatz; „Vorschläge“ (Liste von Konten vorgeschlagener Vorlagen, je mit Übernehmen/Ablehnen) oder „Keine offenen Vorschläge“; „Übernommene Vorlagen“ (Liste, je mit Entfernen) oder „Noch keine …“.
4. **Formbibliotheken:** gleich aufgebaut wie Vorlagen.

Fester Rahmen:
- Die Seite ist eine Nextcloud-Einstellungsseite (Nextcloud-Vue-Komponenten: NcSettingsSection, NcCheckboxRadioSwitch, NcTextField, NcButton, NcSelect). Links die Nextcloud-Navigation, oben die Nextcloud-Leiste; nur die Inhaltsfläche rechts gehört Knorke.
- Farben über Nextcloud-Variablen (`tokens.css` Teil 1), Akzent nie fest; muss im hellen und im dunklen Nextcloud-Thema gehen.
- Breite: 1440 und 1024 Desktop, dazu 390 Telefon.

Varianten: **A0 heute**; **A1** eine Spalte, je Bereich eine Karte mit Symbol, Überschrift, einem Satz Erklärung; **A2** Reiter oben; **A3** dein Vorschlag (z. B. Bereiche einklappbar, ein gemeinsamer Speichern-Knopf, Vorschläge mit Zähler). Zeig je: leerer Zustand (keine Vorschläge) und voller Zustand (2 Vorschläge, 3 übernommene), Text je Sprache mit Deutsch und Englisch, ein Fehler „Gib eine Adresse ein, die mit http:// oder https:// beginnt.“

## Teil L: Logo

Heute: `logo-heute/app.svg` (weiß), `app-dark.svg`, `app-neutral.svg` (grau), `board-card.svg`. Eine Notiz mit abgeschnittener Ecke unten rechts und Eselsohr, 20 × 20, eine Fläche. Das Logo erscheint im Nextcloud-App-Menü oben (weiß auf der Hauptfarbe, ca. 20 px), in den Einstellungen, in Suche, Benachrichtigungen, Board-Auswahl, Team-Ressourcen, in der Board-Liste und im App Store (weiß auf Blau).

Fester Rahmen:
- **Einfarbige Silhouette**, wie Nextcloud es für App-Symbole will: eine Farbe, keine Verläufe, keine Linien unter 1,5 px bei 20 px. `app.svg` weiß, `app-dark.svg` dunkel, `app-neutral.svg` grau, alles dieselbe Form.
- Muss bei 16, 20 und 32 px erkennbar sein und neben anderen Nextcloud-Symbolen (Dateien, Deck, Kalender, Whiteboard) eigenständig wirken, nicht wie Nextclouds Whiteboard oder Deck.
- Zusätzlich darf es eine **bunte Fassung** geben (Palette aus `tokens.css` Teil 2), z. B. für die leere Board-Liste und die GitHub-Seite; sie ist optional.

Varianten: **L0 heute**; **L1–L3** Notiz-Motiv aufgefrischt (z. B. zwei überlappende Notizen, Notiz mit Verbinder-Pfeil, Eselsohr wie Notiz N4 aus Runde 3, rundere Ecken); **L4–L6** neues Motiv (z. B. ein „K“ aus Notizen, Knoten mit Linien, Board mit Frame-Reiter); **L7** dein Vorschlag. Zeig jede Variante: groß (128 px) auf Weiß, 20 px weiß auf der Nextcloud-Hauptfarbe #00679e in einer nachgebauten App-Leiste neben 4 Nachbarsymbolen, 16 px grau in einer Liste, auf dunklem Thema, und als App-Store-Kachel.
