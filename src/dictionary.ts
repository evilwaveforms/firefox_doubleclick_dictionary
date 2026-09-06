const REQUEST_TIMEOUT_MS = 10_000;
const SCHEMA_VERSION = 1;

type JsonRecord = Record<string, unknown>;

export interface DictionaryIndex {
  baseUrl: string;
  shardCount: number;
  languages: ReadonlySet<string>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  const url = stringValue(value);
  return url?.startsWith("https://") ? url : undefined;
}

function readMeanings(value: unknown): DictionaryMeaning[] {
  if (!Array.isArray(value)) return [];

  const meanings: DictionaryMeaning[] = [];
  for (const rawMeaning of value) {
    if (!isRecord(rawMeaning) || !Array.isArray(rawMeaning.definitions)) continue;

    const definitions: DictionaryDefinition[] = [];
    for (const rawDefinition of rawMeaning.definitions) {
      if (!isRecord(rawDefinition)) continue;
      const text = stringValue(rawDefinition.text);
      if (!text) continue;
      const example = stringValue(rawDefinition.example);
      definitions.push(example ? { text, example } : { text });
    }
    if (!definitions.length) continue;

    meanings.push({
      partOfSpeech: stringValue(rawMeaning.partOfSpeech) ?? "",
      definitions,
    });
  }
  return meanings;
}

function readEntry(value: unknown): DictionaryEntry | undefined {
  if (!isRecord(value)) return undefined;
  const word = stringValue(value.word);
  const meanings = readMeanings(value.meanings);
  if (!word || !meanings.length) return undefined;

  const phonetic = stringValue(value.phonetic);
  const audioUrl = httpsUrl(value.audioUrl);
  const sourceUrl = httpsUrl(value.sourceUrl);
  return {
    word,
    ...(phonetic ? { phonetic } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    meanings,
  };
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadDictionaryIndex(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<DictionaryIndex | undefined> {
  const response = await fetchJson(`${baseUrl}/metadata.json`, fetcher);
  if (!response.ok) return undefined;

  const metadata: unknown = await response.json();
  if (!isRecord(metadata) || metadata.schemaVersion !== SCHEMA_VERSION) return undefined;
  if (
    !Number.isInteger(metadata.shardCount) ||
    (metadata.shardCount as number) < 1 ||
    (metadata.shardCount as number) > 16_384 ||
    ((metadata.shardCount as number) & ((metadata.shardCount as number) - 1)) !== 0 ||
    !Array.isArray(metadata.languages) ||
    !metadata.languages.every((language) => typeof language === "string")
  ) {
    return undefined;
  }

  return {
    baseUrl,
    shardCount: metadata.shardCount as number,
    languages: new Set(metadata.languages as string[]),
  };
}

function lookupKey(word: string, language: string): string {
  const normalized = word.normalize("NFC").toLowerCase().replaceAll("’", "'");
  return `${language}:${normalized}`;
}

function shardIndex(key: string, shardCount: number): number {
  let hash = 2_166_136_261;
  for (const byte of new TextEncoder().encode(key)) {
    hash ^= byte;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash & (shardCount - 1);
}

export async function lookupDictionary(
  dictionary: DictionaryIndex,
  word: string,
  language: LanguageCode,
  fetcher: typeof fetch = fetch,
): Promise<LookupResult> {
  if (!dictionary.languages.has(language)) return { ok: false, error: "invalid_response" };

  const key = lookupKey(word, language);
  const shard = shardIndex(key, dictionary.shardCount).toString(16).padStart(4, "0");

  try {
    const response = await fetchJson(`${dictionary.baseUrl}/shards/${shard}.json`, fetcher);
    if (response.status === 404) return { ok: false, error: "not_found" };
    if (!response.ok) return { ok: false, error: "network" };

    const document: unknown = await response.json();
    if (!isRecord(document) || document.schemaVersion !== SCHEMA_VERSION || !isRecord(document.entries)) {
      return { ok: false, error: "invalid_response" };
    }
    const entry = readEntry(document.entries[key]);
    return entry ? { ok: true, entry } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "network" };
  }
}
