import { describe, expect, it } from "vitest";
import {
  buildStoryPrompt,
  STORY_MAP_RETROFIT_NOTICE,
} from "../src/story-prompt.js";

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
      /Placement-Gate-Fehler[\s\S]*Nennt trellis Kandidaten[\s\S]*create_node nicht erneut[\s\S]*nummerierte placement proposals[\s\S]*nenne gaps[\s\S]*warte auf neue User-Auswahl[\s\S]*Erst danach[\s\S]*gewählter activity und slice/,
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
