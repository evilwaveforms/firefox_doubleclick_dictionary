const LANGUAGE: LanguageCode = "en";
const WORD_PATTERN = /^\p{L}+(?:[\u2019'-]\p{L}+)*$/u;
const MAX_WORD_LENGTH = 64;
const VIEWPORT_MARGIN = 8;
const POPUP_GAP = 8;

let popup: HTMLElement | undefined;
let activeRequest = 0;
let anchorRect: DOMRect | undefined;

function selectedWord(): { word: string; rect: DOMRect } | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return undefined;

  const word = selection.toString().trim();
  if (!word || word.length > MAX_WORD_LENGTH || !WORD_PATTERN.test(word)) return undefined;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return undefined;
  return { word, rect };
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

function closePopup(): void {
  activeRequest += 1;
  popup?.remove();
  popup = undefined;
  anchorRect = undefined;
}

function positionPopup(): void {
  if (!popup || !anchorRect) return;

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

function renderLoading(word: string, rect: DOMRect): number {
  closePopup();
  const requestId = activeRequest;
  anchorRect = rect;
  popup = createElement("aside", "dd-popup");
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", `Definition of ${word}`);

  const header = createElement("header", "dd-header");
  header.append(createElement("strong", "dd-word", word));
  const close = createElement("button", "dd-close", "×");
  close.type = "button";
  close.title = "Close";
  close.setAttribute("aria-label", "Close definition");
  close.addEventListener("click", closePopup);
  header.append(close);
  popup.append(header, createElement("div", "dd-loading", "Looking up definition…"));
  document.documentElement.append(popup);
  requestAnimationFrame(positionPopup);
  return requestId;
}

function renderEntry(entry: DictionaryEntry): void {
  if (!popup) return;
  popup.replaceChildren();

  const header = createElement("header", "dd-header");
  const title = createElement("div", "dd-title");
  const wordLine = createElement("div", "dd-word-line");
  wordLine.append(createElement("strong", "dd-word", entry.word));
  title.append(wordLine);
  if (entry.phonetic) title.append(createElement("span", "dd-phonetic", entry.phonetic));

  const close = createElement("button", "dd-close", "×");
  close.type = "button";
  close.title = "Close";
  close.setAttribute("aria-label", "Close definition");
  close.addEventListener("click", closePopup);
  header.append(title, close);
  popup.append(header);

  const body = createElement("div", "dd-body");
  for (const meaning of entry.meanings) {
    const section = createElement("section", "dd-meaning");
    if (meaning.partOfSpeech) {
      section.append(createElement("div", "dd-part-of-speech", meaning.partOfSpeech));
    }
    const list = createElement("ol", "dd-definitions");
    for (const definition of meaning.definitions) {
      const item = createElement("li", "dd-definition");
      item.append(document.createTextNode(definition.text));
      if (definition.example) item.append(createElement("div", "dd-example", `“${definition.example}”`));
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

  requestAnimationFrame(positionPopup);
}

function renderError(error: LookupResult & { ok: false }, word: string): void {
  if (!popup) return;
  const existingHeader = popup.querySelector(".dd-header");
  const message = error.error === "not_found"
    ? `No English definition found for “${word}”.`
    : "The definition couldn't be loaded. Try again.";
  popup.replaceChildren();
  if (existingHeader) popup.append(existingHeader);
  popup.append(createElement("div", "dd-error", message));
  requestAnimationFrame(positionPopup);
}

document.addEventListener("dblclick", (event) => {
  if (popup?.contains(event.target as Node) || isEditableTarget(event)) return;
  const selected = selectedWord();
  if (!selected) {
    closePopup();
    return;
  }

  const requestId = renderLoading(selected.word, selected.rect);
  browser.runtime.sendMessage({ type: "lookup", word: selected.word, language: LANGUAGE })
    .then((result) => {
      if (requestId !== activeRequest || !popup) return;
      if (result.ok) renderEntry(result.entry);
      else renderError(result, selected.word);
    })
    .catch(() => {
      if (requestId === activeRequest && popup) {
        renderError({ ok: false, error: "network" }, selected.word);
      }
    });
});

document.addEventListener("pointerdown", (event) => {
  if (popup && !popup.contains(event.target as Node)) closePopup();
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopup();
});

window.addEventListener("scroll", (event) => {
  if (event.target instanceof Node && popup?.contains(event.target)) return;
  closePopup();
}, { passive: true, capture: true });
window.addEventListener("resize", closePopup, { passive: true });
