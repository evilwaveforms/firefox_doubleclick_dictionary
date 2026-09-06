const LANGUAGE: LanguageCode = "en";
const WORD_PATTERN = /^\p{L}+(?:[\u2019'-]\p{L}+)*$/u;
const MAX_WORD_LENGTH = 64;
const VIEWPORT_MARGIN = 8;
const POPUP_GAP = 8;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

let popup: HTMLElement | undefined;
let activeRequest = 0;
let anchorRange: Range | undefined;
let positionRequest: number | undefined;

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

function appendLookupText(element: HTMLElement, text: string): void {
  for (const part of WORD_SEGMENTER.segment(text)) {
    if (!part.isWordLike || !WORD_PATTERN.test(part.segment) || part.segment.length > MAX_WORD_LENGTH) {
      element.append(document.createTextNode(part.segment));
      continue;
    }

    const word = createElement("span", "dd-lookup-word", part.segment);
    word.dataset.word = part.segment;
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

function createHeader(word: string, phonetic?: string): HTMLElement {
  const header = createElement("header", "dd-header");
  const title = createElement("div", "dd-title");
  const wordLine = createElement("div", "dd-word-line");
  wordLine.append(createElement("strong", "dd-word", word));
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
    popup.setAttribute("role", "dialog");
    popup.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const word = target.closest(".dd-lookup-word");
      if (!(word instanceof HTMLElement) || !popup?.contains(word) || !word.dataset.word) return;
      requestLookup(word.dataset.word);
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

function renderEntry(entry: DictionaryEntry): void {
  if (!popup) return;
  popup.style.minHeight = "";
  popup.replaceChildren();
  popup.append(createHeader(entry.word, entry.phonetic));

  const body = createElement("div", "dd-body");
  for (const meaning of entry.meanings) {
    const section = createElement("section", "dd-meaning");
    if (meaning.partOfSpeech) {
      section.append(createElement("div", "dd-part-of-speech", meaning.partOfSpeech));
    }
    const list = createElement("ol", "dd-definitions");
    for (const definition of meaning.definitions) {
      const item = createElement("li", "dd-definition");
      appendLookupText(item, definition.text);
      if (definition.example) {
        const example = createElement("div", "dd-example");
        appendLookupText(example, `“${definition.example}”`);
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

function renderError(error: LookupResult & { ok: false }, word: string): void {
  if (!popup) return;
  popup.style.minHeight = "";
  const existingHeader = popup.querySelector(".dd-header");
  const message = error.error === "not_found"
    ? `No English definition found for “${word}”.`
    : "The definition couldn't be loaded. Try again.";
  popup.replaceChildren();
  if (existingHeader) popup.append(existingHeader);
  popup.append(createElement("div", "dd-error", message));
  schedulePopupPosition();
}

function requestLookup(word: string, range?: Range): void {
  const requestId = renderLoading(word, range);
  browser.runtime.sendMessage({ type: "lookup", word, language: LANGUAGE })
    .then((result) => {
      if (requestId !== activeRequest || !popup) return;
      if (result.ok) renderEntry(result.entry);
      else renderError(result, word);
    })
    .catch(() => {
      if (requestId === activeRequest && popup) {
        renderError({ ok: false, error: "network" }, word);
      }
    });
}

document.addEventListener("dblclick", (event) => {
  if ((popup && event.composedPath().includes(popup)) || isEditableTarget(event)) return;
  const selected = selectedWord();
  if (!selected) {
    closePopup();
    return;
  }

  requestLookup(selected.word, selected.range);
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
