export interface StoryPromptOptions {
  featureIdea: string;
  hasStoryMap: boolean;
  mentionRetrofit: boolean;
}

export const STORY_MAP_RETROFIT_NOTICE =
  "Hinweis: Bei zehn oder mehr Stories kann eine story map nachgerüstet werden.";

const ACTIVITY_APPROVAL = `Jede im Flow via create_node kind=activity neu erstellte oder via update_node bearbeitete activity unmittelbar danach mit get_node lesen und via approve mit zurückgegebenem content_hash approven. Erst danach darf set_map_position oder create_node mit activity und slice diese activity als placement verwenden.`;

const PLACEMENT_GATE_RECOVERY = `Placement-Gate-Fehler: Wird set_map_position oder create_node mit placement wegen benannter unapproved oder stale activity abgelehnt, lies genau diese activity mit get_node, approve sie mit aktueller content_hash und wiederhole denselben fehlgeschlagenen placement-Aufruf genau einmal. Bei erneutem Fehler stoppen; nie blind wiederholen. Nennt trellis andere Kandidaten, rufe create_node nicht erneut auf. Forme Kandidaten in neue nummerierte placement proposals um, nenne gaps und warte auf neue User-Auswahl. Erst danach darfst du create_node kind=story mit gewählter activity und slice aufrufen.`;

export function buildStoryPrompt(options: StoryPromptOptions): string {
  const feature = `Feature-Idee (wortgetreu):\n${options.featureIdea}`;
  if (options.hasStoryMap) {
    return `Geführter Trellis-Feature-Dialog für bestehende story map.
${feature}

Rufe zuerst get_overview auf. Erstelle noch nichts. Leite aus user activities, slices und gaps höchstens drei nummerierte placement proposals ab. Jede Option nennt activity, slice und erkennbare gaps. Ist Feature-Idee groß, enthält mindestens eine Option eine Aufteilung in genau zwei Stories mit activity und slice je Story.

Bitte User um Auswahl einer Nummer oder Korrektur. Vor ausdrücklicher Auswahl kein create_node. ${ACTIVITY_APPROVAL} Erstelle danach ausschließlich gewählte Story oder gewählte zwei Stories via create_node kind=story; übergib jeweils gewählte activity und slice. Ergänze bestätigte Given/When/Then-Kriterien via add_acceptance_criterion.

${PLACEMENT_GATE_RECOVERY}`;
  }

  const retrofit = options.mentionRetrofit ? `\n\n${STORY_MAP_RETROFIT_NOTICE}` : "";
  return `Geführter Trellis-Feature-Dialog ohne story map.
${feature}

Schlage Titel, kurze Beschreibung und 3–4 Given/When/Then-Akzeptanzkriterien vor. Bitte um Korrektur oder ausdrückliche Bestätigung. Vor Bestätigung kein create_node. Erstelle danach genau bestätigte Story via create_node kind=story und ergänze Kriterien via add_acceptance_criterion.${retrofit}`;
}
