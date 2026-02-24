(() => {
  const IPHONE_USER_AGENT = /(iphone|ipod)/i;
  const ACTIVE_USER_KEY = "smartsaveActiveUser";
  const FORM_KEY = "smartsaveFormData";

  const setImportant = (node, prop, value) => {
    if (!node) return;
    node.style.setProperty(prop, value, "important");
  };

  const detectMode = () => {
    const isIphone = IPHONE_USER_AGENT.test(navigator.userAgent || "");
    return isIphone ? "mobile" : "desktop";
  };

  const applyModeFlags = (mode) => {
    const root = document.documentElement;
    const body = document.body;

    root.dataset.deviceMode = mode;
    root.classList.toggle("device-mobile", mode === "mobile");
    root.classList.toggle("device-desktop", mode === "desktop");

    if (body) {
      body.dataset.deviceMode = mode;
      body.classList.toggle("device-mobile", mode === "mobile");
      body.classList.toggle("device-desktop", mode === "desktop");
    }

    if (window.__smartsaveDeviceMode !== mode) {
      window.__smartsaveDeviceMode = mode;
      window.dispatchEvent(new CustomEvent("smartsave:device-mode-change", { detail: { mode } }));
    }
  };

  const applyDesktopHeader = (header) => {
    const brandBlock = header.querySelector(".brand-block");
    const logo = header.querySelector(".logo");
    const logoText = header.querySelector(".logo-text");
    const logoMark = header.querySelector(".logo-mark");
    const logoSubtitle = header.querySelector(".logo-subtitle");
    const headerSearch = header.querySelector(".header-search");
    const userMenuWrapper = header.querySelector(".user-menu-wrapper");
    const headerActions = header.querySelector(".header-actions");
    const hamburgerWrapper = header.querySelector(".hamburger-wrapper");
    const menuButton = header.querySelector(".menu-button");
    const mobileTitle = header.querySelector(".mobile-header-title");
    const mobileSpacer = header.querySelector(".mobile-header-spacer");
    const mobileBack = header.querySelector(".mobile-header-back");
    const menu = header.querySelector(".hamburger-menu");

    setImportant(header, "display", "flex");
    setImportant(header, "align-items", "center");
    setImportant(header, "justify-content", "space-between");
    setImportant(header, "flex-wrap", "nowrap");
    setImportant(header, "min-height", "56px");
    setImportant(header, "position", "relative");
    setImportant(header, "padding-left", "12px");
    setImportant(header, "padding-right", "12px");

    setImportant(brandBlock, "display", "flex");
    setImportant(brandBlock, "align-items", "center");
    setImportant(brandBlock, "position", "absolute");
    setImportant(brandBlock, "left", "12px");
    setImportant(brandBlock, "top", "50%");
    setImportant(brandBlock, "transform", "translateY(-50%)");
    setImportant(brandBlock, "right", "70px");
    setImportant(brandBlock, "justify-content", "flex-start");
    setImportant(brandBlock, "flex", "0 1 auto");
    setImportant(brandBlock, "min-width", "0");
    setImportant(brandBlock, "margin", "0");
    setImportant(brandBlock, "padding", "0");

    setImportant(logo, "display", "inline-flex");
    setImportant(logo, "align-items", "center");
    setImportant(logo, "gap", "0");
    setImportant(logo, "justify-content", "flex-start");
    setImportant(logo, "max-width", "100%");

    setImportant(logoMark, "display", "none");
    setImportant(logoText, "display", "inline-block");
    setImportant(logoSubtitle, "display", "none");
    setImportant(headerSearch, "display", "none");
    setImportant(userMenuWrapper, "display", "none");

    setImportant(headerActions, "display", "inline-flex");
    setImportant(headerActions, "align-items", "center");
    setImportant(headerActions, "justify-content", "flex-end");
    setImportant(headerActions, "position", "absolute");
    setImportant(headerActions, "right", "12px");
    setImportant(headerActions, "top", "50%");
    setImportant(headerActions, "transform", "translateY(-50%)");
    setImportant(headerActions, "margin-left", "0");
    setImportant(headerActions, "flex", "0 0 auto");

    setImportant(hamburgerWrapper, "display", "block");
    setImportant(menuButton, "position", "static");
    setImportant(menuButton, "left", "auto");
    setImportant(menuButton, "right", "auto");
    setImportant(menuButton, "top", "auto");
    setImportant(menuButton, "transform", "none");

    if (mobileTitle) mobileTitle.remove();
    if (mobileSpacer) mobileSpacer.remove();
    if (mobileBack) mobileBack.remove();

    if (menu && menu.dataset.originalMenu) {
      menu.innerHTML = menu.dataset.originalMenu;
      delete menu.dataset.originalMenu;
    }
  };

  const getUserDisplayName = () => {
    try {
      const active = JSON.parse(localStorage.getItem(ACTIVE_USER_KEY) || "{}");
      const userId = active?.id || null;
      const fallbackName = String(active?.name || active?.fullName || "").trim();
      if (!userId) return fallbackName || "Mon compte";

      const formByUser = JSON.parse(localStorage.getItem(FORM_KEY) || "{}");
      const form = formByUser?.[userId] || formByUser?.__default || {};
      const first =
        form?.personal?.firstName ||
        form?.personal?.prenom ||
        form?.firstName ||
        form?.prenom ||
        active?.firstName ||
        "";
      const last =
        form?.personal?.lastName ||
        form?.personal?.nom ||
        form?.lastName ||
        form?.nom ||
        active?.lastName ||
        "";
      const full = `${String(first || "").trim()} ${String(last || "").trim()}`.trim();
      return full || fallbackName || "Mon compte";
    } catch (_error) {
      return "Mon compte";
    }
  };

  const resolveMobileHeaderTitle = () => {
    const formatMonthYear = (value = new Date()) => {
      const date = value instanceof Date ? value : new Date(value);
      const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
      return label.charAt(0).toUpperCase() + label.slice(1);
    };
    const map = {
      score: "Objectifs",
      future: "Répartition",
      depenses: "Mon Mois",
      actions: "Mon Mois",
    };
    const pageKey = document.body?.dataset?.page || "";
    if (pageKey === "home") {
      return `Mon Mois - ${formatMonthYear()}`;
    }
    if (pageKey === "budget") {
      return `Ton budget - ${formatMonthYear()}`;
    }
    if (pageKey === "smartsave") {
      return `Répartition - ${formatMonthYear()}`;
    }
    if (pageKey === "plan") {
      return `Ton plan - ${formatMonthYear()}`;
    }
    if (map[pageKey]) return map[pageKey];

    const pageTitleNode = document.querySelector("main .page-title h1");
    if (pageTitleNode) return String(pageTitleNode.textContent || "").trim() || "SmartSave";

    const rawTitle = String(document.title || "").trim();
    if (!rawTitle) return "SmartSave";
    return rawTitle.replace(/^SmartSave\s*[–-]\s*/i, "").trim() || "SmartSave";
  };

  const configureMobileHamburgerMenu = (menu) => {
    if (!menu) return;
    if (!menu.dataset.originalMenu) {
      menu.dataset.originalMenu = menu.innerHTML;
    }
    const userName = getUserDisplayName();
    menu.innerHTML = `
      <div class="hamburger-user" role="presentation">${userName}</div>
      <a class="hamburger-link" role="menuitem" href="mes-depenses.html">Mois précédents</a>
      <a class="hamburger-link hamburger-link--danger" role="menuitem" href="index.html?logout=1">Déconnexion</a>
    `;
  };

  const setupGlobalLogoutLinks = () => {
    if (document.documentElement.dataset.logoutLinksBound === "1") return;
    document.documentElement.dataset.logoutLinksBound = "1";
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a.hamburger-link--danger, a.user-menu-link--danger");
      if (!link) return;
      const href = String(link.getAttribute("href") || "");
      if (!href.includes("index.html")) return;
      try {
        localStorage.setItem("smartsaveActiveUser", "{}");
      } catch (_error) {
        // ignore storage issues
      }
      if (!href.includes("logout=1")) {
        link.setAttribute("href", "index.html?logout=1");
      }
    });
  };

  const applyMobileHeader = (header) => {
    const brandBlock = header.querySelector(".brand-block");
    const logo = header.querySelector(".logo");
    const logoText = header.querySelector(".logo-text");
    const logoMark = header.querySelector(".logo-mark");
    const logoSubtitle = header.querySelector(".logo-subtitle");
    const headerSearch = header.querySelector(".header-search");
    const userMenuWrapper = header.querySelector(".user-menu-wrapper");
    const headerActions = header.querySelector(".header-actions");
    const hamburgerWrapper = header.querySelector(".hamburger-wrapper");
    const menuButton = header.querySelector(".menu-button");
    const menu = header.querySelector(".hamburger-menu");

    setImportant(header, "display", "grid");
    setImportant(header, "grid-template-columns", "44px minmax(0, 1fr) 44px");
    setImportant(header, "align-items", "center");
    setImportant(header, "column-gap", "0");
    setImportant(header, "row-gap", "0");
    setImportant(header, "min-height", "calc(44px + env(safe-area-inset-top, 0px))");
    setImportant(header, "border-bottom", "1px solid rgba(60, 60, 67, 0.22)");
    setImportant(header, "background", "var(--ios-chrome-bg, #f9f9fb)");
    setImportant(header, "padding-left", "8px");
    setImportant(header, "padding-right", "8px");
    setImportant(header, "padding-top", "env(safe-area-inset-top, 0px)");
    setImportant(header, "padding-bottom", "0");
    setImportant(header, "position", "relative");
    setImportant(header, "z-index", "50");

    let spacer = header.querySelector(".mobile-header-spacer");
    if (spacer) spacer.remove();

    setImportant(brandBlock, "display", "none");

    setImportant(logo, "display", "none");
    setImportant(logoMark, "display", "none");
    setImportant(logoText, "display", "none");
    setImportant(logoSubtitle, "display", "none");

    setImportant(headerSearch, "display", "none");

    setImportant(headerActions, "display", "inline-flex");
    setImportant(headerActions, "align-items", "center");
    setImportant(headerActions, "justify-content", "flex-end");
    setImportant(headerActions, "margin-left", "0");
    setImportant(headerActions, "min-width", "max-content");
    setImportant(headerActions, "grid-area", "auto");
    setImportant(headerActions, "grid-column", "3");
    setImportant(headerActions, "grid-row", "1");
    setImportant(headerActions, "order", "0");
    setImportant(headerActions, "position", "static");
    setImportant(headerActions, "transform", "none");

    setImportant(userMenuWrapper, "display", "none");
    setImportant(hamburgerWrapper, "display", "inline-flex");
    setImportant(menuButton, "width", "30px");
    setImportant(menuButton, "height", "30px");
    setImportant(menuButton, "padding", "0");
    setImportant(menuButton, "border-radius", "8px");
    setImportant(menuButton, "display", "inline-flex");
    setImportant(menuButton, "align-items", "center");
    setImportant(menuButton, "justify-content", "center");
    setImportant(menuButton, "color", "rgba(60, 60, 67, 0.85)");

    let backNode = header.querySelector(".mobile-header-back");
    if (!backNode) {
      backNode = document.createElement("div");
      backNode.className = "mobile-header-back";
      backNode.setAttribute("aria-hidden", "true");
      backNode.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M15.5 5.5 9 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />' +
        "</svg>";
      header.appendChild(backNode);
    }
    setImportant(backNode, "grid-column", "1");
    setImportant(backNode, "grid-row", "1");
    setImportant(backNode, "justify-self", "start");
    setImportant(backNode, "align-self", "center");

    let titleNode = header.querySelector(".mobile-header-title");
    if (!titleNode) {
      titleNode = document.createElement("div");
      titleNode.className = "mobile-header-title";
      header.appendChild(titleNode);
    }
    titleNode.textContent = resolveMobileHeaderTitle();
    setImportant(titleNode, "grid-column", "2");
    setImportant(titleNode, "grid-row", "1");
    setImportant(titleNode, "text-align", "center");
    setImportant(titleNode, "align-self", "center");

    configureMobileHamburgerMenu(menu);
  };

  const applyHeaderLayout = (mode) => {
    const header = document.querySelector(".dashboard-header.app-header");
    if (!header) return;
    if (mode === "desktop") {
      applyDesktopHeader(header);
    } else {
      applyMobileHeader(header);
    }
  };

  const applyNavLayout = (mode) => {
    const bottomNav = document.querySelector(".bottom-nav");
    if (bottomNav) {
      setImportant(bottomNav, "display", mode === "mobile" ? "grid" : "none");
    }
  };

  const applyLayout = () => {
    const mode = detectMode();
    applyModeFlags(mode);
    applyHeaderLayout(mode);
    applyNavLayout(mode);
    setupGlobalLogoutLinks();
  };

  const scheduleApply = (() => {
    let frame = null;
    return () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        applyLayout();
      });
    };
  })();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyLayout, { once: true });
  } else {
    applyLayout();
  }

  window.addEventListener("resize", scheduleApply, { passive: true });
  window.addEventListener("orientationchange", scheduleApply, { passive: true });
})();
