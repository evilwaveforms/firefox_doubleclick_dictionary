import test from "node:test";
import assert from "node:assert/strict";
import { loadDictionaryIndex, lookupDictionary } from "../dist/dictionary.js";

const metadata = {
  schemaVersion: 1,
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
  const index = await loadDictionaryIndex("https://dictionary.example", async (url) => {
    assert.equal(url, "https://dictionary.example/metadata.json");
    return Response.json(metadata);
  });
  assert.equal(index?.baseUrl, "https://dictionary.example");
  assert.equal(index?.shardCount, 8192);
  assert.deepEqual([...index?.languages ?? []], ["en"]);
});

test("looks up a word in its hashed shard", async () => {
  const index = {
    baseUrl: "https://dictionary.example",
    shardCount: 8192,
    languages: new Set(["en"]),
  };
  const result = await lookupDictionary(index, "Hello", "en", async (url) => {
    assert.equal(url, "https://dictionary.example/shards/0268.json");
    return Response.json({ schemaVersion: 1, entries: { "en:hello": entry } });
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
