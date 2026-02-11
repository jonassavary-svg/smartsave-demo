(function () {
  const DEFAULT_RUNTIME = {
    ai: { enabled: true, coachWebhookUrl: "", timeoutMs: 12000 },
    automations: { enabled: true, monthClosedWebhookUrl: "", profileSyncWebhookUrl: "" },
    debug: { enabled: false }
  };

  // Initialise ou merge si déjà présent
  const existing = (window.SMARTSAVE_RUNTIME && typeof window.SMARTSAVE_RUNTIME === "object")
    ? window.SMARTSAVE_RUNTIME
    : {};

  window.SMARTSAVE_RUNTIME = {
    ai: {
      ...DEFAULT_RUNTIME.ai,
      ...(existing.ai || {}),
      coachWebhookUrl: "https://jonasavary.app.n8n.cloud/webhook/smartsave-ai-coach"
    },
    automations: { ...DEFAULT_RUNTIME.automations, ...(existing.automations || {}) },
    debug: { ...DEFAULT_RUNTIME.debug, ...(existing.debug || {}) }
  };

  // Force une fonction (si écrasée)
  window.getSmartSaveRuntime = function () {
    return window.SMARTSAVE_RUNTIME || DEFAULT_RUNTIME;
  };

  window.SmartSaveRuntime = window.getSmartSaveRuntime;

  console.log("runtimeConfig loaded", window.SMARTSAVE_RUNTIME);
})();
