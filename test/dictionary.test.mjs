import test from "node:test";
import assert from "node:assert/strict";
import { loadDictionaryIndex, lookupDictionary } from "../dist/dictionary.js";

const metadata = {
  schemaVersion: 2,
  languages: ["en"],
  shardCount: 8192,
};

const entry = {
  word: "hello",
  phonetic: "/həˈləʊ/",
  sourceUrl: "https://en.wiktionary.org/wiki/hello",
  meanings: [{
    partOfSpeech: "interjection",
    definitions: [{ text: "A greeting.", example: "Hello there." }],
  }],
};

test("loads the dictionary index", async () => {
  const index = await loadDictionaryIndex("https://dictionary.example/v2", async (url) => {
    assert.equal(url, "https://dictionary.example/v2/metadata.json");
    return Response.json(metadata);
  });
  assert.equal(index?.baseUrl, "https://dictionary.example/v2");
  assert.equal(index?.shardCount, 8192);
  assert.deepEqual([...index?.languages ?? []], ["en"]);
});

test("looks up a word in its hashed shard", async () => {
  const index = {
    baseUrl: "https://dictionary.example/v2",
    shardCount: 8192,
    languages: new Set(["en"]),
  };
  const result = await lookupDictionary(index, "Hello", "en", async (url) => {
    assert.equal(url, "https://dictionary.example/v2/shards/0268.json");
    return Response.json({ schemaVersion: 2, entries: { "en:hello": [entry] } });
  });
  assert.deepEqual(result, { ok: true, entry });
});

test("returns not_found when a sparse shard does not exist", async () => {
  const index = {
    baseUrl: "https://dictionary.example",
    shardCount: 8192,
    languages: new Set(["en"]),
  };
  const result = await lookupDictionary(index, "notaword", "en", async () => {
    return new Response(null, { status: 404 });
  });
  assert.deepEqual(result, { ok: false, error: "not_found" });
});

test("rejects a language absent from metadata without a shard request", async () => {
  let called = false;
  const index = {
    baseUrl: "https://dictionary.example",
    shardCount: 8192,
    languages: new Set(["en"]),
  };
  const result = await lookupDictionary(index, "hello", "fi", async () => {
    called = true;
    return new Response();
  });
  assert.deepEqual(result, { ok: false, error: "invalid_response" });
  assert.equal(called, false);
});

test("handles malformed successful shard responses", async () => {
  const index = {
    baseUrl: "https://dictionary.example",
    shardCount: 8192,
    languages: new Set(["en"]),
  };
  const result = await lookupDictionary(index, "hello", "en", async () => {
    return Response.json({ unexpected: true });
  });
  assert.deepEqual(result, { ok: false, error: "invalid_response" });
});

test("selects exact case variants before the lowercase fallback", async () => {
  const index = {
    baseUrl: "https://dictionary.example",
    shardCount: 8192,
    languages: new Set(["en"]),
  };
  const lower = { ...entry, word: "polish", sourceUrl: "https://en.wiktionary.org/wiki/polish" };
  const upper = { ...entry, word: "Polish", sourceUrl: "https://en.wiktionary.org/wiki/Polish" };
  const fetcher = async () => Response.json({
    schemaVersion: 2,
    entries: { "en:polish": [upper, lower] },
  });

  assert.deepEqual(await lookupDictionary(index, "Polish", "en", fetcher), { ok: true, entry: upper });
  assert.deepEqual(await lookupDictionary(index, "polish", "en", fetcher), { ok: true, entry: lower });
  assert.deepEqual(await lookupDictionary(index, "POLISH", "en", fetcher), { ok: true, entry: lower });
});

test("prefers a common lowercase entry over a capitalized name-only entry", async () => {
  const index = {
    baseUrl: "https://dictionary.example",
    shardCount: 8192,
    languages: new Set(["en"]),
  };
  const common = {
    ...entry,
    word: "deep",
    meanings: [{
      partOfSpeech: "adj",
      definitions: [{ text: "Extending far down from a point of reference." }],
    }],
  };
  const surname = {
    ...entry,
    word: "Deep",
    meanings: [{ partOfSpeech: "name", definitions: [{ text: "A surname." }] }],
  };
  const result = await lookupDictionary(index, "Deep", "en", async () => {
    return Response.json({ schemaVersion: 2, entries: { "en:deep": [common, surname] } });
  });

  assert.deepEqual(result, { ok: true, entry: common });
});
