export {};

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const form = document.querySelector("fieldset");

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === "system"
    ? colorScheme.matches ? "dark" : "light"
    : theme;
  const input = document.querySelector<HTMLInputElement>(`input[value="${theme}"]`);
  if (input) input.checked = true;
}

browser.storage.local.get("theme")
  .then(({ theme }) => applyTheme(isTheme(theme) ? theme : "system"))
  .catch(() => applyTheme("system"));

form?.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !isTheme(input.value)) return;
  applyTheme(input.value);
  void browser.storage.local.set({ theme: input.value });
});

colorScheme.addEventListener("change", () => {
  const selected = document.querySelector<HTMLInputElement>('input[name="theme"]:checked');
  if (selected?.value === "system") applyTheme("system");
});
