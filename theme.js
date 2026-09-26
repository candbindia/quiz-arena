/* =========================================================
   QUIZ ARENA — THEME LOADER
   Reads config.js and applies the logo, name and colours
   to whatever page includes this file.
   ========================================================= */
function applyTheme() {
  const C = window.QUIZ_CONFIG;
  const root = document.documentElement.style;

  // 1. Colours → CSS variables (style.css uses these)
  root.setProperty("--cb-amber", C.theme.amber);
  root.setProperty("--cb-grey",  C.theme.grey);
  root.setProperty("--cb-dark",  C.theme.dark);
  root.setProperty("--cb-white", C.theme.white);
  root.setProperty("--cb-bg",    C.theme.bg);
  C.theme.optionColors.forEach((color, i) => root.setProperty("--opt" + i, color));

  // 2. Logo and names → any element marked with data-... attributes
  document.querySelectorAll("[data-logo]").forEach(img => {
    img.src = C.org.logoUrl;
    img.alt = C.org.name + " logo";
  });
  document.querySelectorAll("[data-org-name]").forEach(el => el.textContent = C.org.name);
  document.querySelectorAll("[data-app-name]").forEach(el => el.textContent = C.org.appName);

  // 3. Browser tab title
  document.title = C.org.appName + " · " + C.org.name;
}

applyTheme();
