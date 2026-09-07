export {};

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const themeFieldset = document.querySelector("[data-theme-settings]");
const languageSelect = document.querySelector<HTMLSelectElement>("#language");

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "auto" || value === "en" || value === "fi" || value === "sv" ||
    value === "de" || value === "fr" || value === "es";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === "system"
    ? colorScheme.matches ? "dark" : "light"
    : theme;
  const input = document.querySelector<HTMLInputElement>(`input[value="${theme}"]`);
  if (input) input.checked = true;
}

browser.storage.local.get(["theme", "language"])
  .then(({ theme, language }) => {
    applyTheme(isTheme(theme) ? theme : "system");
    if (languageSelect) languageSelect.value = isLanguagePreference(language) ? language : "auto";
  })
  .catch(() => {
    applyTheme("system");
    if (languageSelect) languageSelect.value = "auto";
  });

themeFieldset?.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !isTheme(input.value)) return;
  applyTheme(input.value);
  void browser.storage.local.set({ theme: input.value });
});

languageSelect?.addEventListener("change", () => {
  if (!isLanguagePreference(languageSelect.value)) return;
  void browser.storage.local.set({ language: languageSelect.value });
});

colorScheme.addEventListener("change", () => {
  const selected = document.querySelector<HTMLInputElement>('input[name="theme"]:checked');
  if (selected?.value === "system") applyTheme("system");
});
