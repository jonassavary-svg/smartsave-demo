(() => {
  const IPHONE_USER_AGENT = /(iphone|ipod)/i;

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
    const userPill = header.querySelector(".user-pill--account");
    const userInfo = header.querySelector(".user-pill--account .user-info");
    const chevron = header.querySelector(".user-pill--account .chevron");

    setImportant(header, "display", "grid");
    setImportant(header, "grid-template-columns", "auto minmax(0, 1fr) auto");
    setImportant(header, "align-items", "center");
    setImportant(header, "column-gap", "0.55rem");
    setImportant(header, "row-gap", "0");
    setImportant(header, "min-height", "56px");

    setImportant(brandBlock, "display", "flex");
    setImportant(brandBlock, "align-items", "center");
    setImportant(brandBlock, "min-width", "0");
    setImportant(brandBlock, "margin", "0");
    setImportant(brandBlock, "padding", "0");
    setImportant(brandBlock, "grid-area", "auto");
    setImportant(brandBlock, "grid-column", "1");
    setImportant(brandBlock, "grid-row", "1");
    setImportant(brandBlock, "order", "0");

    setImportant(logo, "display", "inline-flex");
    setImportant(logo, "align-items", "center");
    setImportant(logo, "gap", "0");

    setImportant(logoMark, "display", "inline-flex");
    setImportant(logoText, "display", "none");
    setImportant(logoSubtitle, "display", "none");

    setImportant(headerSearch, "display", "inline-flex");
    setImportant(headerSearch, "align-items", "center");
    setImportant(headerSearch, "min-width", "0");
    setImportant(headerSearch, "width", "100%");
    setImportant(headerSearch, "max-width", "none");
    setImportant(headerSearch, "grid-area", "auto");
    setImportant(headerSearch, "grid-column", "2");
    setImportant(headerSearch, "grid-row", "1");
    setImportant(headerSearch, "order", "0");

    setImportant(headerActions, "display", "inline-flex");
    setImportant(headerActions, "align-items", "center");
    setImportant(headerActions, "justify-content", "flex-end");
    setImportant(headerActions, "margin-left", "0");
    setImportant(headerActions, "min-width", "max-content");
    setImportant(headerActions, "grid-area", "auto");
    setImportant(headerActions, "grid-column", "3");
    setImportant(headerActions, "grid-row", "1");
    setImportant(headerActions, "order", "0");

    setImportant(userMenuWrapper, "display", "inline-flex");
    setImportant(hamburgerWrapper, "display", "none");

    setImportant(userPill, "padding", "0");
    setImportant(userPill, "border-radius", "999px");
    setImportant(userInfo, "display", "none");
    setImportant(chevron, "display", "none");
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
