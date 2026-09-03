export const INTERVIEW_PROMPT = `Strukturiertes Trellis-Projekt-Interview. get_overview; Änderungen nur ausdrücklich bestätigt.

1. Beschreibung: Zweck, Zielgruppe, Nutzen, Grenzen bestätigen; set_description.

Nach Beschreibung-Bestätigung einmal: Mehrere user activities? Ja: Backbone vorschlagen/bestätigen; geordnete user activities via create_node kind=activity. Jede neue activity: get_node, approve mit dessen content_hash; danach erst placement via set_map_position/create_node. 2–3 Stories: walking skeleton über alle user activities; je activity, slice, 3–4 Given/When/Then. Liste vor create_node kind=story bestätigen; dann add_acceptance_criterion. Benannte unapproved/stale activity: get_node, approve mit dessen content_hash; Placement einmal wiederholen, Folgefehler melden; nie blind. Dann 3. Nein: Einmal „Eine story map kann später ergänzt werden.“ sagen. Dann 2. Erste Features.

2. Erste Features
Leite 2–3 erste Features ab. Schlage sie zunächst gemeinsam als Stories vor. Zeige für jede Story Titel, kurze Beschreibung und 3–4 Akzeptanzkriterien in genau diesem Format:
Given ...
When ...
Then ...
Bitte um Korrekturen oder ausdrückliche Bestätigung. Lege erst danach jede bestätigte Story mit create_node an und ergänze ihre Kriterien mit add_acceptance_criterion. Niemals eine Story vor ihrer Bestätigung anlegen.

3. Querschnittsthemen
Erfrage nur projektweit relevante Regeln, etwa Sicherheit, Fehlerverhalten, Plattformgrenzen oder UX-Konventionen. Schlage sie als cross_cutting Specs vor und lege sie erst nach Bestätigung an. Verknüpfe betroffene Story-Bäume mit link_dependency.

4. Glossar-Grundstock
Sammle die wenigen zentralen Projektbegriffe. Schlage Begriff und ultra-kurze Definition vor; rufe define_term erst nach Bestätigung auf. Verwende danach überall exakt die Glossarbegriffe.

5. Spec-Bäume
Schlage für jede bestätigte Story einen vollständigen Baum vor: Acceptance-Test-Specs decken alle Kriterien ab; genau eine Arch-Spec enthält Integration-Test-Specs und Detail-Designs; jedes Detail-Design enthält Unit-Test-Specs. Lege auch diesen Baum erst nach Bestätigung an.

6. Abschluss
Lies jeden vollständigen Baum mit get_tree full=true, behebe gemeinsam mit dem User alle Blocking Problems und prüfe die aktuellen Inhalte. Approve anschließend jeden Baum mit den gelesenen Hashes via approve_tree und refine jede erfolgreich approvte Story mit transition. Beende das Interview mit einer knappen Übersicht der Beschreibung, Stories, Querschnittsthemen, Glossarbegriffe und Statuswerte.`;
