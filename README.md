# Wizard – Webapp

Das Kartenspiel Wizard im Browser: online mit Freunden oder gegen Computergegner.
Reines HTML/CSS/JavaScript, ohne Build-Schritt.

## Starten

- **Lokal testen:** `powershell -ExecutionPolicy Bypass -File serve.ps1 -Root .` und http://localhost:5173 öffnen
  (oder einfach `index.html` doppelklicken).
- **Online spielen:** Den Ordner auf einen statischen Webhoster legen (z. B. GitHub Pages), damit alle Mitspieler die
  Seite aufrufen können. Dann „Raum erstellen“ → Code oder Einladungslink teilen → Mitspieler treten bei → freie Plätze
  mit Bots auffüllen (3–6 Spieler) → „Spiel starten“.

## Online-Multiplayer

- Peer-to-Peer über WebRTC mit [PeerJS](https://peerjs.com). Der öffentliche PeerJS-Server vermittelt nur den
  Verbindungsaufbau, die Spieldaten laufen direkt zwischen den Browsern. Ein eigener Server ist nicht nötig.
- Der Browser des Hosts führt das Spiel. Jeder Mitspieler bekommt nur seine eigene Sicht (fremde Karten bleiben verborgen).
- Verliert ein Mitspieler die Verbindung (Heartbeat, ca. 15 s), übernimmt ein Bot. Mit gleichem Namen und Raumcode
  kann er jederzeit wieder einsteigen.
- Schließt der Host den Tab, endet das Spiel für alle.
- In seltenen restriktiven Netzwerken (manche Firmen-/Uni-Netze) kann die direkte Verbindung scheitern.

## Aufbau

- `js/engine.js` – Regeln, Spielzustand, Wertung, Sicht pro Spieler (ohne DOM)
- `js/ai.js` – Computergegner: Monte-Carlo-Suche über mögliche Kartenverteilungen (merkt sich gespielte Karten und Fehlfarben)
- `js/host.js` – Host-Controller: Plätze (lokal/online/Bot), Bots steuern, Zustand verteilen
- `js/net.js` – PeerJS-Verbindung für Host und Gäste, Heartbeat
- `js/ui.js` – Menü, Lobby, Spieltisch
- `css/style.css` – Layout, Karten, mobile Ansicht
- `serve.ps1` – Mini-Webserver für lokale Tests

## Regeln (kurz)

- 60 Karten: 4 Farben 1–13, 4 Zauberer, 4 Narren; Rundenzahl = 60 / Spielerzahl.
- Trumpf = nächste aufgedeckte Karte (Zauberer: Geber wählt; Narr/keine Karte: kein Trumpf).
- Farbe bedienen, Zauberer/Narr immer erlaubt. Erster Zauberer sticht alles.
- Treffer: 20 + 10 pro Stich, sonst −10 pro Stich Abweichung.
- Optional: Geber-Regel (Summe der Ansagen ≠ Anzahl Stiche).
