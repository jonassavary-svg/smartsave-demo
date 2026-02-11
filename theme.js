(() => {
  const STORAGE_KEY = "smartsave:theme";
  const DEFAULT_THEME = "yuh";
  const themeButtons = document.querySelectorAll("[data-theme-select]");

  const applyTheme = (theme) => {
    const nextTheme = theme || DEFAULT_THEME;
    document.documentElement.setAttribute("data-theme", nextTheme);
    themeButtons.forEach((button) => {
      const isActive = button.getAttribute("data-theme-select") === nextTheme;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  };

  const savedTheme = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  })();

  applyTheme(savedTheme || DEFAULT_THEME);

  themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.getAttribute("data-theme-select");
      if (!selected) return;
      applyTheme(selected);
      try {
        localStorage.setItem(STORAGE_KEY, selected);
      } catch (_error) {
        // ignore storage issues
      }
    });
  });
})();
