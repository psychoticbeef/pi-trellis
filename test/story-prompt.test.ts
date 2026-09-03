import { describe, expect, it } from "vitest";
import {
  buildStoryPrompt,
  STORY_MAP_RETROFIT_NOTICE,
} from "../src/story-prompt.js";

function mappedPrompt(): string {
  return buildStoryPrompt({
    featureIdea: "Suche",
    hasStoryMap: true,
    mentionRetrofit: false,
  });
}

describe("UT-47 Story-Prompt-Varianten und Mutations-Gates", () => {
  it("UT-47 bewahrt Feature-Idee und fordert höchstens drei vollständige placement proposals", () => {
    const featureIdea = "  Export für Händler mit CSV & PDF  ";
    const prompt = buildStoryPrompt({
      featureIdea,
      hasStoryMap: true,
      mentionRetrofit: false,
    });

    expect(prompt).toContain(`Feature-Idee (wortgetreu):\n${featureIdea}`);
    for (const fragment of [
      "höchstens drei nummerierte placement proposals",
      "activity, slice und erkennbare gaps",
      "Aufteilung in genau zwei Stories",
      "activity und slice je Story",
      "Vor ausdrücklicher Auswahl kein create_node",
      "ausschließlich gewählte Story",
      "gewählte activity und slice",
    ]) expect(prompt).toContain(fragment);
  });

  it("UT-47 verbietet bei Placement-Gate-Kandidaten Blind-Retry bis zur Auswahl", () => {
    const prompt = buildStoryPrompt({
      featureIdea: "Suche",
      hasStoryMap: true,
      mentionRetrofit: false,
    });

    expect(prompt).toMatch(
      /Placement-Gate-Fehler[\s\S]*Nennt trellis andere Kandidaten[\s\S]*create_node nicht erneut[\s\S]*nummerierte placement proposals[\s\S]*nenne gaps[\s\S]*warte auf neue User-Auswahl[\s\S]*Erst danach[\s\S]*gewählter activity und slice/,
    );
  });

  it("UT-47 erzeugt ohne story map bestätigten Fluss und optional genau einen Nachrüstungssatz", () => {
    const plain = buildStoryPrompt({
      featureIdea: "Suche",
      hasStoryMap: false,
      mentionRetrofit: false,
    });
    const retrofit = buildStoryPrompt({
      featureIdea: "Suche",
      hasStoryMap: false,
      mentionRetrofit: true,
    });

    expect(plain).toContain("Geführter Trellis-Feature-Dialog ohne story map");
    expect(plain).toMatch(/Given\/When\/Then[\s\S]*ausdrückliche Bestätigung[\s\S]*Vor Bestätigung kein create_node/);
    expect(plain).not.toContain(STORY_MAP_RETROFIT_NOTICE);
    expect(retrofit.match(new RegExp(STORY_MAP_RETROFIT_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")))
      .toHaveLength(1);
  });
});

describe("UT-50 Story-Prompt für Activity-Mutation, Approval und Recovery", () => {
  it("UT-50 approvt neue oder bearbeitete activity vor placement", () => {
    expect(mappedPrompt()).toMatch(
      /create_node kind=activity[\s\S]*update_node[\s\S]*get_node[\s\S]*approve mit zurückgegebenem content_hash[\s\S]*Erst danach[\s\S]*set_map_position[\s\S]*create_node mit activity und slice/,
    );
  });

  it("UT-50 repariert nur benannte unapproved oder stale activity und retried einmal", () => {
    expect(mappedPrompt()).toMatch(
      /Placement-Gate-Fehler[\s\S]*benannter unapproved oder stale activity[\s\S]*genau diese activity mit get_node[\s\S]*approve sie mit aktueller content_hash[\s\S]*placement-Aufruf genau einmal[\s\S]*Bei erneutem Fehler stoppen; nie blind wiederholen/,
    );
  });
});
