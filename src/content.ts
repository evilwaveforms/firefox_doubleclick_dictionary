const DEFAULT_LANGUAGE: SupportedLanguage = "en";
const SUPPORTED_LANGUAGES = new Set<SupportedLanguage>(["en", "fi", "sv", "de", "fr", "es"]);
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  fi: "Finnish",
  sv: "Swedish",
  de: "German",
  fr: "French",
  es: "Spanish",
};
const WORD_PATTERN = /^(?:\p{L}\p{M}*)+(?:[\u2019'-](?:\p{L}\p{M}*)+)*$/u;
const MAX_WORD_LENGTH = 64;
const MIN_DETECTION_TEXT_LENGTH = 40;
const MAX_DETECTION_TEXT_LENGTH = 1_000;
const MAX_DETECTION_TEXT_NODES = 64;
const VIEWPORT_MARGIN = 8;
const POPUP_GAP = 8;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
const COLOR_SCHEME = window.matchMedia("(prefers-color-scheme: dark)");

let popup: HTMLElement | undefined;
let activeRequest = 0;
let anchorRange: Range | undefined;
let positionRequest: number | undefined;
let selectedTheme: Theme = "system";
let languagePreference: LanguagePreference = "auto";

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "auto" ||
    typeof value === "string" && supportedLanguage(value) === value;
}

function resolvedTheme(): "light" | "dark" {
  if (selectedTheme !== "system") return selectedTheme;
  return COLOR_SCHEME.matches ? "dark" : "light";
}

function applyTheme(): void {
  if (popup) popup.dataset.theme = resolvedTheme();
}

browser.storage.local.get(["theme", "language"])
  .then(({ theme, language }) => {
    if (isTheme(theme)) selectedTheme = theme;
    if (isLanguagePreference(language)) languagePreference = language;
    applyTheme();
  })
  .catch(() => undefined);

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (isTheme(changes.theme?.newValue)) {
    selectedTheme = changes.theme.newValue;
    applyTheme();
  }
  if (isLanguagePreference(changes.language?.newValue)) {
    languagePreference = changes.language.newValue;
  }
});

COLOR_SCHEME.addEventListener("change", () => {
  if (selectedTheme === "system") applyTheme();
});

function selectedWord(): { word: string; range: Range } | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return undefined;

  const word = selection.toString().trim();
  if (!word || word.length > MAX_WORD_LENGTH || !WORD_PATTERN.test(word)) return undefined;

  const range = selection.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return undefined;
  return { word, range };
}

function isEditableTarget(event: MouseEvent): boolean {
  const target = event.composedPath()[0];
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

function rangeElement(range: Range): Element | undefined {
  return range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement ?? undefined;
}

function supportedLanguage(language: string | null | undefined): SupportedLanguage | undefined {
  if (!language) return undefined;
  const baseLanguage = language.trim().toLowerCase().split(/[-_]/, 1)[0];
  return SUPPORTED_LANGUAGES.has(baseLanguage as SupportedLanguage)
    ? baseLanguage as SupportedLanguage
    : undefined;
}

function collectDetectionSide(
  walker: TreeWalker,
  initial: string,
  beforeSelection: boolean,
  limit: number,
): string {
  let text = beforeSelection ? initial.slice(-limit) : initial.slice(0, limit);
  for (let count = 0; text.length < limit && count < MAX_DETECTION_TEXT_NODES; count += 1) {
    const node = beforeSelection ? walker.previousNode() : walker.nextNode();
    if (!(node instanceof Text)) break;
    const remaining = limit - text.length;
    text = beforeSelection
      ? node.data.slice(-remaining) + text
      : text + node.data.slice(0, remaining);
  }
  return text;
}

function detectionText(range: Range): string | undefined {
  if (!(range.startContainer instanceof Text) || range.endContainer !== range.startContainer) {
    return undefined;
  }

  const element = rangeElement(range);
  const container = element?.closest(
    "p, li, dd, dt, blockquote, figcaption, caption, td, th, h1, h2, h3, h4, h5, h6",
  ) ?? element?.parentElement ?? element;
  if (!container) return undefined;

  const selectedNode = range.startContainer;
  const selected = selectedNode.data.slice(range.startOffset, range.endOffset);
  const sideLength = Math.floor((MAX_DETECTION_TEXT_LENGTH - selected.length) / 2);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  walker.currentNode = selectedNode;
  const before = collectDetectionSide(
    walker,
    selectedNode.data.slice(0, range.startOffset),
    true,
    sideLength,
  );
  walker.currentNode = selectedNode;
  const after = collectDetectionSide(
    walker,
    selectedNode.data.slice(range.endOffset),
    false,
    sideLength,
  );
  const text = `${before}${selected}${after}`.replace(/\s+/g, " ").trim();
  return text && text.length >= MIN_DETECTION_TEXT_LENGTH ? text : undefined;
}

async function lookupLanguage(range: Range): Promise<SupportedLanguage> {
  if (languagePreference !== "auto") return languagePreference;

  const declaredLanguage = supportedLanguage(rangeElement(range)?.closest("[lang]")?.getAttribute("lang"));
  if (declaredLanguage) return declaredLanguage;

  const text = detectionText(range);
  if (!text) return DEFAULT_LANGUAGE;

  try {
    const result = await browser.i18n.detectLanguage(text);
    if (!result.isReliable) return DEFAULT_LANGUAGE;
    return supportedLanguage(result.languages[0]?.language) ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function appendLookupText(element: HTMLElement, text: string, language: SupportedLanguage): void {
  for (const part of WORD_SEGMENTER.segment(text)) {
    if (!part.isWordLike || !WORD_PATTERN.test(part.segment) || part.segment.length > MAX_WORD_LENGTH) {
      element.append(document.createTextNode(part.segment));
      continue;
    }

    const word = createElement("span", "dd-lookup-word", part.segment);
    word.dataset.word = part.segment;
    word.dataset.language = language;
    element.append(word);
  }
}

function closePopup(): void {
  activeRequest += 1;
  popup?.remove();
  popup = undefined;
  anchorRange = undefined;
}

function positionPopup(): void {
  positionRequest = undefined;
  if (!popup || !anchorRange) return;

  const anchorRect = anchorRange.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const maxLeft = window.innerWidth - popupRect.width - VIEWPORT_MARGIN;
  const left = Math.min(Math.max(anchorRect.left, VIEWPORT_MARGIN), Math.max(maxLeft, VIEWPORT_MARGIN));
  const below = anchorRect.bottom + POPUP_GAP;
  const top = below + popupRect.height <= window.innerHeight - VIEWPORT_MARGIN
    ? below
    : Math.max(VIEWPORT_MARGIN, anchorRect.top - popupRect.height - POPUP_GAP);

  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
  popup.classList.add("dd-visible");
}

function schedulePopupPosition(): void {
  if (positionRequest !== undefined) return;
  positionRequest = requestAnimationFrame(positionPopup);
}

function createHeader(word: string, phonetic?: string, language?: SupportedLanguage): HTMLElement {
  const header = createElement("header", "dd-header");
  const title = createElement("div", "dd-title");
  const wordLine = createElement("div", "dd-word-line");
  wordLine.append(createElement("strong", "dd-word", word));
  if (language && language !== DEFAULT_LANGUAGE) {
    wordLine.append(createElement("span", "dd-language", LANGUAGE_NAMES[language]));
  }
  title.append(wordLine);
  if (phonetic) title.append(createElement("span", "dd-phonetic", phonetic));

  const close = createElement("button", "dd-close", "×");
  close.type = "button";
  close.title = "Close";
  close.setAttribute("aria-label", "Close definition");
  close.addEventListener("click", closePopup);
  header.append(title, close);
  return header;
}

function renderLoading(word: string, range?: Range): number {
  activeRequest += 1;
  const requestId = activeRequest;
  if (range) anchorRange = range;

  if (!popup) {
    popup = createElement("aside", "dd-popup");
    applyTheme();
    popup.setAttribute("role", "dialog");
    popup.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const word = target.closest(".dd-lookup-word");
      if (!(word instanceof HTMLElement) || !popup?.contains(word) || !word.dataset.word) return;
      const language = supportedLanguage(word.dataset.language);
      if (!language) return;
      void requestLookup(word.dataset.word, undefined, language);
    });
    document.documentElement.append(popup);
  } else {
    popup.style.minHeight = `${Math.ceil(popup.getBoundingClientRect().height)}px`;
  }

  popup.setAttribute("aria-label", `Definition of ${word}`);
  popup.replaceChildren(createHeader(word), createElement("div", "dd-loading", "Looking up definition…"));
  popup.scrollTop = 0;
  schedulePopupPosition();
  return requestId;
}

function renderEntry(entry: DictionaryEntry, language: SupportedLanguage): void {
  if (!popup) return;
  popup.style.minHeight = "";
  popup.setAttribute("aria-label", `${LANGUAGE_NAMES[language]} dictionary entry for ${entry.word}`);
  popup.replaceChildren();
  popup.append(createHeader(entry.word, entry.phonetic, language));

  const body = createElement("div", "dd-body");
  for (const meaning of entry.meanings) {
    const section = createElement("section", "dd-meaning");
    if (meaning.partOfSpeech) {
      section.append(createElement("div", "dd-part-of-speech", meaning.partOfSpeech));
    }
    const list = createElement("ol", "dd-definitions");
    for (const definition of meaning.definitions) {
      const item = createElement("li", "dd-definition");
      appendLookupText(item, definition.text, DEFAULT_LANGUAGE);
      if (definition.example) {
        const example = createElement("div", "dd-example");
        appendLookupText(example, `“${definition.example}”`, language);
        item.append(example);
      }
      list.append(item);
    }
    section.append(list);
    body.append(section);
  }
  popup.append(body);

  if (entry.sourceUrl) {
    const source = createElement("a", "dd-source", "Wiktionary");
    source.href = entry.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.title = "Definitions from Wiktionary, modified for this extension (CC BY-SA 4.0)";
    source.setAttribute("aria-label", source.title);
    popup.append(source);
  }

  schedulePopupPosition();
}

function renderError(
  error: LookupResult & { ok: false },
  word: string,
  language: SupportedLanguage,
): void {
  if (!popup) return;
  popup.style.minHeight = "";
  const existingHeader = popup.querySelector(".dd-header");
  const message = error.error === "not_found"
    ? `No ${LANGUAGE_NAMES[language]} dictionary entry found for “${word}”.`
    : "The definition couldn't be loaded. Try again.";
  popup.replaceChildren();
  if (existingHeader) popup.append(existingHeader);
  popup.append(createElement("div", "dd-error", message));
  schedulePopupPosition();
}

async function requestLookup(
  word: string,
  range?: Range,
  requestedLanguage: SupportedLanguage = DEFAULT_LANGUAGE,
): Promise<void> {
  const requestId = renderLoading(word, range);
  const language = range ? await lookupLanguage(range) : requestedLanguage;
  if (requestId !== activeRequest || !popup) return;

  try {
    const result = await browser.runtime.sendMessage({ type: "lookup", word, language });
    if (requestId !== activeRequest || !popup) return;
    if (result.ok) renderEntry(result.entry, language);
    else renderError(result, word, language);
  } catch {
    if (requestId === activeRequest && popup) {
      renderError({ ok: false, error: "network" }, word, language);
    }
  }
}

document.addEventListener("dblclick", (event) => {
  if ((popup && event.composedPath().includes(popup)) || isEditableTarget(event)) return;
  const selected = selectedWord();
  if (!selected) {
    closePopup();
    return;
  }

  void requestLookup(selected.word, selected.range);
});

document.addEventListener("pointerdown", (event) => {
  if (popup && !popup.contains(event.target as Node)) closePopup();
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopup();
});

window.addEventListener("scroll", (event) => {
  if (!popup || !anchorRange) return;
  if (event.target instanceof Node && popup?.contains(event.target)) return;
  schedulePopupPosition();
}, { passive: true, capture: true });
window.addEventListener("resize", closePopup, { passive: true });
