# Tempo-Warner

Progressive Web App fürs Auto: zeigt das **Tempolimit der aktuellen Straße** als großes Schild, den **Straßennamen** und die **eigene Geschwindigkeit** – mit **Warnton**, wenn man zu schnell ist.

- Tempolimit und Straßenname aus OpenStreetMap (Overpass-API), inkl. Tempo-30-Zonen, innerorts/außerorts, Spielstraßen, „keine Begrenzung“ und Richtungs-Limits
- Geschwindigkeit per GPS (mit Fallback-Berechnung)
- Warnung einstellbar: ab Limit +0 / +3 / +5 / +7 / +10 km/h
- Warnton an/aus, Lautstärke, „Ton testen“
- Optional: fehlt das Limit in der Karte, innerorts 50 annehmen
- Bildschirm bleibt an (Wake Lock), Hoch- und Querformat, auf dem Homescreen installierbar
- Statistik in den Einstellungen: Überschreitungen innerorts/außerorts, davon im Bußgeldbereich (ab 21 km/h nach Messtoleranz), letzte 30 Ereignisse
- Demo-Modus zum Ausprobieren ohne Fahrt

## Nutzung
Über GitHub Pages öffnen, „Starten“ tippen, Standort erlauben.
Installieren: Android/Chrome → Menü → „App installieren“; iPhone/Safari → Teilen → „Zum Home-Bildschirm“.

**Hinweis:** Die Daten aus OpenStreetMap können fehlen oder veraltet sein (Baustellen, Wechselverkehrszeichen). Es gelten immer die Verkehrsschilder. Handy nur in der Halterung benutzen.

Kartendaten © OpenStreetMap-Mitwirkende (ODbL).
