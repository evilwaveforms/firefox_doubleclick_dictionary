type LanguageCode = string;

interface DictionaryDefinition {
  text: string;
  example?: string;
}

interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
}

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  sourceUrl?: string;
  meanings: DictionaryMeaning[];
}

type LookupResult =
  | { ok: true; entry: DictionaryEntry }
  | { ok: false; error: "not_found" | "network" | "invalid_response" };

interface LookupMessage {
  type: "lookup";
  word: string;
  language: LanguageCode;
}

declare const browser: {
  runtime: {
    getURL(path: string): string;
    onMessage: {
      addListener(
        listener: (message: unknown) => Promise<LookupResult> | undefined,
      ): void;
    };
    sendMessage(message: LookupMessage): Promise<LookupResult>;
  };
};
