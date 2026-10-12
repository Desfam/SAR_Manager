# UI-Refactoring-Plan

## Zielbild

Die Oberfläche wird auf acht klar verlinkbare Hauptbereiche reduziert. Alle Seiten verwenden dieselben Layout-, Status- und Datenkomponenten. Texte werden zentral auf Deutsch gepflegt. Backend-Logik und API-Verträge bleiben unverändert.

## Ausgangslage

- `App.tsx` stellt nur `/` bereit; die eigentliche Navigation lebt als lokaler `activeTab`-State in `MainLayout.tsx`.
- `Sidebar.tsx` enthält 21 Einträge in sieben aufklappbaren Gruppen. Der eingeklappte Zustand wird nicht gespeichert und besitzt keine Tooltips.
- `MainLayout.tsx` lädt Hosts, Backend-Health, Agents und Alerts selbst. Mehrere Seiten laden dieselben Daten erneut und leiten daraus teilweise andere Zustände ab.
- `Header.tsx` zeigt statische Benachrichtigungen und einen festen Badge-Wert. Die Suche öffnet die Command Palette nicht direkt.
- Die Seiten enthalten eigene Header, Statistik-Karten, Filterleisten, Tabellen, Ladeanzeigen und Leerzustände. Fehler-, Leer- und Ladezustände sind häufig miteinander vermischt.
- Viele Produkttexte sind Englisch, einzelne Texte Deutsch und einige deutsche Texte verwenden Ersatzschreibweisen ohne Umlaute.
- `SystemMonitor.tsx` und `src/data/mockData.ts` enthalten Produktiv-Mockdaten. Die aktuell gerenderte Monitoring-Seite ist `SystemMonitorReal.tsx`.
- Der bereits entfernte Login-Ablauf ist der Ausgangsstand dieses Refactorings. Die App läuft lokal ohne Anmeldemaske.

## Wiederholt und unterschiedlich gebaute UI

### Seitenheader

Fast jede Seite baut einen eigenen `h1`-Block. Unterschiede bestehen bei Icon-Kacheln, Abständen, Beschreibung, Refresh-Position und Hauptaktion. Betroffen sind unter anderem Dashboard, Hosts, Inventory, Jobs, Alerts, Terminal, File Browser, Scripts, Tasks, Diagnostics, Port Forwarding, Docker, Proxmox, Monitoring, Vergleich, Topology, Agents, Security, Audit Logs, Users und Settings.

### Statistik-Karten

- Dashboard besitzt eine lokale `StatCard`.
- Inventory und Jobs verwenden `CardTitle` mit großen Zahlen.
- Docker, Port Forwarding, Tasks, Security, Agents und Comparison bauen jeweils eigene Kennzahlenkarten.
- Icons, Farben, Ausrichtung, Typografie und responsive Raster unterscheiden sich.

### Empty States

Connections, Dashboard, Diagnostics, Docker, File Browser, Inventory, Proxmox, Scripts, Security, Terminal, Topology, Agents und das Vulnerability-Widget besitzen eigene Leerzustände. Manche bestehen nur aus Text, andere nehmen große Flächen ein, einige bieten keine konkrete Aktion.

### Tabellen

Inventory, Jobs, Audit Logs, Proxmox, Agents und Users verwenden shadcn-Tabellen mit jeweils eigenen Such-, Filter-, Sortier- und Leerzustandsmustern. Kompakte Zeilenhöhe und Bedienlogik sind nicht einheitlich.

### Filterleisten

Connections, Inventory, Jobs, Audit Logs, Docker, Proxmox, Agents, Alerts und Monitoring bauen Suche, Selects und Tabs separat. Beschriftung, Reihenfolge, Breakpoints und Reset-Verhalten unterscheiden sich.

### Zustände

- Loading wird je nach Seite als Text, Spinner, leere Karte oder Skeleton dargestellt.
- API-Fehler werden teilweise nur als Toast behandelt; danach erscheint zusätzlich ein Leerzustand.
- Einige Seiten unterscheiden `error` und `empty` nicht dauerhaft im State.
- Health, Host-Zähler, Agent-Zähler und Alerts werden in mehreren Komponenten unabhängig geladen.

## Zielnavigation und URLs

| Hauptbereich | URL | Unteransichten |
| --- | --- | --- |
| Übersicht | `/` | Dashboard |
| Hosts | `/hosts` | `?view=cards`, `?view=table` |
| Terminal & Dateien | `/workspace/:tab` | `terminal`, `files` |
| Infrastruktur | `/infrastructure/:tab` | `docker`, `proxmox`, `topology` |
| Automatisierung | `/automation/:tab` | `scripts`, `tasks`, `jobs` |
| Monitoring | `/monitoring/:tab` | `systems`, `comparison`, `alerts` |
| Sicherheit | `/security/:tab` | `audit`, `logs`, `tunnels` |
| Verwaltung | `/administration/:tab` | `agents`, `users`, `settings` |

Alte Pfade und bisherige interne Ziele werden über Redirects beziehungsweise eine zentrale Legacy-Zuordnung auf die neuen URLs abgebildet.

## Gemeinsame Bausteine

- `PageHeader`: Titel, Beschreibung, primäre Aktion, optionale sekundäre Aktionen.
- `StatCard` und `StatGrid`: einheitliche Kennzahlen und responsive Anordnung.
- `EmptyState`: Icon, Titel, kurze Erklärung, konkrete Aktion; kompakte Variante.
- `FilterBar`: Suche, Statusfilter, weitere Filter und sekundäre Aktionen.
- `DataTable`: generische Spalten, Sortierung, kompakte Zeilen, integrierbarer Leerzustand.
- `AsyncState`: genau ein sichtbarer Zustand aus `loading`, `error`, `empty`, `success`.
- `SectionTabs`: einheitliche, routenbasierte Unterseiten-Navigation.
- `PageContainer`: begrenzte Inhaltsbreite und konsistente Seitenabstände.

## Daten- und Zustandsstrategie

- Ein gemeinsamer `useAppStatus`-Hook liefert Backend-Health, Hosts, Online/Offline-Zähler, Agents und aktive Alerts.
- Sidebar, Header und Dashboard verwenden dieselbe Query beziehungsweise denselben Context.
- Datenansichten modellieren Fehler explizit und zeigen bei Fehlern niemals gleichzeitig einen Empty State.
- Boolesche JSX-Ausdrücke mit numerischen Werten werden vermieden (`count > 0 && ...` statt `count && ...`).
- Produktiv-Mockdaten werden aus gerenderten Pfaden entfernt.

## Designsystem

- Flächentokens für Hintergrund, Karte, erhöhte Karte und dezente Rahmen.
- Blau/Teal als Akzentfarbe für aktive Navigation und die einzelne Hauptaktion einer Ansicht.
- Semantische Statusfarben immer zusammen mit Text oder Icon.
- 12 px Kartenradius, 8 px Control-Radius sowie Abstände auf Basis von 4/8/12/16/24 px.
- Maximal zwei Schriftgewichte in der regulären UI.
- Inhaltsbreite wird für breite Monitore begrenzt; Tablet-Navigation klappt automatisch ein.
- Alle Icon-Buttons erhalten zugängliche Namen und sichtbare Fokuszustände.

## Umsetzungsschritte

### 1. Analyse und Plan

- [x] Routing, Layout, Navigation, Seiten, Services, UI-Primitives und bestehende Tests erfasst.
- [x] Doppelte Komponenten und inkonsistente Zustände dokumentiert.
- [x] Zielrouten und gemeinsame Bausteine festgelegt.

### 2. Tokens und Basiskomponenten

- [ ] Design-Tokens und `PageContainer` vereinheitlichen.
- [ ] `PageHeader`, `StatCard`, `StatGrid`, `EmptyState`, `FilterBar`, `DataTable`, `AsyncState` und `SectionTabs` bauen.
- [ ] Komponententests für Header, StatCard, EmptyState und AsyncState ergänzen.

### 3. Router und Navigation

- [ ] Echte React-Router-Routen mit Deep Links umsetzen.
- [ ] Acht Hauptbereiche und routenbasierte Tabs einführen.
- [ ] Alte Ziele auf neue URLs umleiten.

### 4. Sidebar, Header und gemeinsamer Status

- [ ] Sidebar reduzieren, Collapse speichern, Tooltips und responsive Verhalten ergänzen.
- [ ] Command Palette über Suche und Strg/Cmd+K anbinden.
- [ ] Echte Alert-Anzahl verwenden und leeren Badge ausblenden.
- [ ] Gemeinsame Health- und Host-Datenquelle verwenden.

### 5. Dashboard und Hosts

- [ ] Dashboard-Raster und kompakte Hostliste überarbeiten.
- [ ] Hosts-Kartenansicht und Inventory-Tabellenansicht zusammenführen.
- [ ] Host-Schnellaktionen und korrekte vier Zustände ergänzen.

### 6. Arbeitsbereich, Infrastruktur und Automatisierung

- [ ] Terminal und Dateien zusammenführen und File-Browser-Fehlerzustand korrigieren.
- [ ] Docker, Proxmox und Topology als Infrastruktur-Tabs integrieren.
- [ ] Scripts, Tasks und Jobs als Automatisierungs-Tabs integrieren.
- [ ] Geforderte Terminal-, Script-, Kanban-, Diagnostics- und Tunnel-Details umsetzen.

### 7. Monitoring, Sicherheit und Verwaltung

- [ ] Monitoring, Comparison und Alerts konsolidieren.
- [ ] Security, Audit Logs und Port Forwarding konsolidieren.
- [ ] Agents, Users und Settings konsolidieren.

### 8. Texte

- [ ] `src/i18n/de.ts` als zentrale Textquelle einführen.
- [ ] Sichtbare UI vollständig auf korrektes Deutsch umstellen.
- [ ] Fachbegriffe Terminal, Docker, Agent, Proxmox und Script beibehalten.

### 9. Abschlussprüfung

- [ ] Numerische Conditional-Rendering-Bugs projektweit beseitigen.
- [ ] Ansichten bei 1280, 1920, 2560 px und Tablet prüfen.
- [ ] Fokusführung, Kontrast und zugängliche Namen prüfen.
- [ ] Lint, Build und Tests vollständig ausführen.

## Bewusst nicht im Scope

- Backend-Logik, Datenbankschema und API-Verträge.
- Deployment als Systemdienst oder Änderungen an Proxmox/Docker-Infrastruktur.
- Neue Produktfunktionen, die keine vorhandene API besitzen.
- Eine zusätzliche UI-Bibliothek oder neue Abhängigkeiten ohne zwingenden Bedarf.

## Offene Entscheidungen

Aktuell sind keine Produktentscheidungen blockierend. Bei fehlender Backend-Funktion wird die UI die Funktion ausblenden oder einen klaren Hinweis anzeigen, statt Verhalten zu simulieren.

## Abschlussstand

Dieser Abschnitt wird nach jedem Umsetzungsschritt aktualisiert. Noch offen sind die Schritte 2 bis 9.
