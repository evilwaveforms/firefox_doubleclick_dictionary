import { loadDictionaryIndex, lookupDictionary } from "./dictionary.js";

const MAX_WORD_LENGTH = 64;
const CACHE_LIMIT = 128;
const cache = new Map<string, LookupResult>();
const pending = new Map<string, Promise<LookupResult>>();
const dictionary = loadConfiguration()
  .then((configuration) => loadDictionaryIndex(configuration.baseUrl))
  .catch(() => undefined);

async function loadConfiguration(): Promise<{ baseUrl: string }> {
  const response = await fetch(browser.runtime.getURL("dictionary-config.json"));
  if (!response.ok) throw new Error("could not load dictionary configuration");
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("invalid dictionary configuration");
  const baseUrl = (value as { baseUrl?: unknown }).baseUrl;
  if (typeof baseUrl !== "string") throw new Error("invalid dictionary base URL");
  return { baseUrl };
}

function isLookupMessage(message: unknown): message is LookupMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<LookupMessage>;
  return (
    candidate.type === "lookup" &&
    typeof candidate.word === "string" &&
    candidate.word.length > 0 &&
    candidate.word.length <= MAX_WORD_LENGTH &&
    typeof candidate.language === "string" &&
    /^[a-z]{2,3}$/.test(candidate.language)
  );
}

function cachedResult(key: string): LookupResult | undefined {
  const result = cache.get(key);
  if (!result) return undefined;
  cache.delete(key);
  cache.set(key, result);
  return result;
}

async function lookup(message: LookupMessage): Promise<LookupResult> {
  const word = message.word;
  const key = `${message.language}:${word}`;
  const cached = cachedResult(key);
  if (cached) return cached;

  const existing = pending.get(key);
  if (existing) return existing;

  const request = dictionary.then((index) => {
    if (!index) return { ok: false, error: "network" } as LookupResult;
    return lookupDictionary(index, word, message.language);
  }).then((result) => {
    if (result.ok || result.error === "not_found") {
      cache.set(key, result);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    return result;
  }).finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

browser.runtime.onMessage.addListener((message) => {
  if (!isLookupMessage(message)) return undefined;
  return lookup(message);
});
