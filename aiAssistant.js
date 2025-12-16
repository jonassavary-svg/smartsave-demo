 (function () {
   const CACHE_KEY = "smartsave-ai:insights";
   const CACHE_TTL = 1000 * 60 * 60 * 6; // 6h
   const MAX_PAYLOAD_LENGTH = 60 * 1024;
   const STATUS_DEFAULT = "Analyse IA indisponible.";

   const statusNode = document.querySelector("[data-ia-status]");
   const contentNode = document.querySelector("[data-ia-content]");
   const cacheBadgeNode = document.querySelector("[data-ia-cache-badge]");
   const refreshButton = document.querySelector("[data-ia-refresh]");
   const planActionsNode = document.querySelector("[data-mvp-plan-actions]");

   let hasStarted = false;
   let lastContext = {};
   let lastPayloadHash = "";

   refreshButton?.addEventListener("click", async () => {
     await refreshAnalysis();
   });

   async function bootstrap(context = {}) {
     lastContext = context;
     if (hasStarted) return;
     hasStarted = true;
     await runAnalysis(context);
   }

   async function refreshAnalysis() {
     localStorage.removeItem(CACHE_KEY);
     hasStarted = false;
     setCacheBadge("");
     setStatus("Actualisation de l’analyse…", "info");
     await bootstrap(lastContext);
   }

   async function runAnalysis(context = {}) {
     if (!statusNode) return;
     const payload = buildPayload(context.data, context.formData);
     const payloadHash = await hashPayload(payload);
     lastPayloadHash = payloadHash;
     const cached = loadCache(payloadHash);
     if (cached) {
       applyResponse(cached.response);
       setStatus("Analyse IA (cache local)", "success");
       setCacheBadge("Cache local (6h)");
       return;
     }
     setCacheBadge("");
     setStatus("Analyse en cours…", "info");

     const keyHex = window.SMARTSAVE_AI_PAYLOAD_KEY;
     if (!keyHex) {
       const fallback = buildDeterministicResponse(payload);
       applyResponse(fallback);
       setStatus("Analyse automatique (clé manquante)", "warning");
       setCacheBadge("Analyse automatique (fallback)");
       return;
     }

     let encrypted;
     try {
       encrypted = await encryptPayload(payload, keyHex);
     } catch (error) {
       const fallback = buildDeterministicResponse(payload);
       applyResponse(fallback);
       setStatus("Chiffrement impossible. Résultat déterministe affiché.", "error");
       setCacheBadge("Analyse automatique (fallback)");
       return;
     }

     try {
       const response = await fetch("/api/ai/insights", {
         method: "POST",
         headers: { "Content-Type": "application/json", Accept: "application/json" },
         credentials: "same-origin",
         body: JSON.stringify(encrypted),
       });
       const body = await response.json();
       const aiResponse = body?.data;
       if (!isValidResponse(aiResponse)) {
         throw new Error("Réponse IA invalide");
       }
       saveCache(payloadHash, aiResponse);
       applyResponse(aiResponse);
       if (body?.fallback) {
         setStatus("Analyse automatique (fallback)", "warning");
         setCacheBadge("Analyse automatique (fallback)");
       } else if (body?.cached) {
         setStatus("Analyse IA (cache backend)", "success");
         setCacheBadge("Cache backend");
       } else {
         setStatus("Analyse IA prête", "success");
         setCacheBadge("Analyse live");
       }
     } catch (error) {
       const fallback = buildDeterministicResponse(payload);
       applyResponse(fallback);
       setStatus(`IA indisponible (${error.message}).`, "error");
       setCacheBadge("Analyse automatique (fallback)");
     }
   }

   function setStatus(text, level = "info") {
     if (!statusNode) return;
     statusNode.textContent = text || STATUS_DEFAULT;
     statusNode.dataset.state = level;
     if (contentNode) {
       contentNode.hidden = false;
     }
   }

   function setCacheBadge(text) {
     if (!cacheBadgeNode) return;
     if (!text) {
       cacheBadgeNode.hidden = true;
       cacheBadgeNode.textContent = "";
       cacheBadgeNode.dataset.source = "";
       return;
     }
     cacheBadgeNode.hidden = false;
     cacheBadgeNode.textContent = text;
     cacheBadgeNode.dataset.source = text.toLowerCase().replace(/\s+/g, "-");
   }

   function applyResponse(response = {}) {
     const { spendingAnalysis, keyWeakness, priorityLever, smartSaveNarrative, projectionMotivation, warnings } =
       response;

     updateText("[data-ia-spending-text]", spendingAnalysis);
     updateText("[data-ia-key-weakness]", keyWeakness);
     updateText("[data-ia-priority-lever]", priorityLever);
     updateText("[data-ia-projection-motivation]", projectionMotivation);
     updateList("[data-ia-smart-narrative]", smartSaveNarrative, "La narration SmartSave arrive dès que l’IA répond.");
     updateList("[data-ia-warnings]", warnings, "Aucun avertissement pour l’instant.");
     if (priorityLever || (smartSaveNarrative || []).length) {
       injectAiPlanActions(response);
     }
   }

   function updateText(selector, value) {
     const node = document.querySelector(selector);
     if (!node) return;
     node.textContent = value || "";
     node.hidden = !value;
   }

   function updateList(selector, values = [], emptyText) {
     const node = document.querySelector(selector);
     if (!node) return;
     const items = Array.isArray(values) ? values.filter(Boolean) : [];
     if (!items.length) {
       node.innerHTML = emptyText ? `<li>${emptyText}</li>` : "";
       node.hidden = !emptyText;
       return;
     }
     node.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
     node.hidden = false;
   }

   function injectAiPlanActions(response = {}) {
     if (!planActionsNode) return;
     const base = planActionsNode.dataset.defaultActions || planActionsNode.innerHTML;
     const additions = [];
     if (response.priorityLever) {
       additions.push(`<li class="ai-actions__priority">${response.priorityLever}</li>`);
     }
     const narrative = Array.isArray(response.smartSaveNarrative) ? response.smartSaveNarrative : [];
     narrative.forEach((item) => {
       additions.push(`<li class="ai-actions__narrative">${item}</li>`);
     });
     if (!additions.length) return;
     planActionsNode.innerHTML = `${base}${additions.join("")}`;
   }

   function buildPayload(data = {}, formData = {}) {
     const sanitizedInputs = cleanInputs(formData);
     const score = {
       global: Math.round(data.score?.score || 0),
       security: Math.round(data.score?.pillars?.securite?.score || 0),
       anticipation: Math.round(data.score?.pillars?.anticipation?.score || 0),
       growth: Math.round(data.score?.pillars?.croissance?.score || 0),
     };
     const analysis = data.spendingAnalysis || {};
     const totals = data.spendingTotals || {};
     const alloc = data.allocation || {};
     const metrics = analysis.metrics || {};
     const spendingFlags = (analysis.flags || []).map((flag) => flag?.id || flag).filter(Boolean);
     const expenditureCategories = analysis.breakdown?.categories || [];
     const topCategories = expenditureCategories
       .slice()
       .sort((a, b) => (b.amount || 0) - (a.amount || 0))
       .slice(0, 4)
       .map((entry) => entry?.label)
       .filter(Boolean);

     const projectionHistory =
       Array.isArray(data.projection?.smartSave?.history)
         ? data.projection.smartSave.history
         : Array.isArray(data.projection?.current?.history)
         ? data.projection.current.history
         : [];
     const startSnapshot = projectionHistory[0]?.accounts || null;
     const endSnapshot = projectionHistory[projectionHistory.length - 1]?.accounts || null;
     const netWorthStart = sumAccounts(startSnapshot);
     const netWorthEnd =
       Number.isFinite(data.projection?.smartSave?.netWorth) ? data.projection.smartSave.netWorth : sumAccounts(endSnapshot);

     const projectionPoints = projectionHistory
       .slice(-3)
       .map((entry) => ({
         label: entry?.label || entry?.month || entry?.date || null,
         netWorth: sumAccounts(entry?.accounts),
         date: entry?.month || entry?.date || null,
       }))
       .filter((entry) => entry.netWorth || entry.date);

     const objective =
       formData.personal?.objective ||
       formData.personal?.profilObjectif ||
       formData.currentPlan?.objective ||
       "Sécurité";
     const incomeStability =
       formData.personal?.incomeStability || formData.personal?.incomeStatus || "Stable";

     const summary = {
       totals: {
         totalMonthly: totals.total || 0,
         fixed: totals.fixed || 0,
         variable: totals.variable || 0,
         exceptional: totals.exceptional || 0,
       },
       ratios: {
         fixed: metrics.fixedRatio || 0,
         variable: metrics.variableRatio || 0,
         debt: metrics.debtRatio || 0,
       },
       flags: spendingFlags,
       topCategories,
       suggestedActions:
         (analysis.suggestedActions || []).map((action) => action?.title).filter(Boolean),
       metrics: {
         totalExpenses: metrics.totalExpensesMonthly,
         savingsCapacity: metrics.monthlySavingsCapacity,
         safetyMonths: Number.isFinite(data.securityMonths) ? data.securityMonths : metrics.safetyMonths || 0,
         monthlyIncome: data.metrics?.monthlyNetIncome || metrics.incomeNetMonthly || 0,
       },
       projection: {
         months: projectionHistory.length || 12,
         netWorthStart,
         netWorthEnd,
         securityMonthsEnd: Number.isFinite(data.securityMonths) ? data.securityMonths : 0,
         points: projectionPoints,
       },
       missingData: buildMissingDataList(formData, totals, metrics, netWorthStart, netWorthEnd),
       dataQualityWarnings: (analysis.dataQualityWarnings || []).map((warning) => warning.message),
     };

     const spendingBreakdown = {
       categories: analysis.breakdown?.categories || [],
       fixed: analysis.breakdown?.fixed || [],
       variable: analysis.breakdown?.variable || [],
       largestCategory: analysis.breakdown?.largestCategory || null,
       largestFixedCategory: analysis.breakdown?.largestFixedCategory || null,
       largestVariableCategory: analysis.breakdown?.largestVariableCategory || null,
     };

     const allocationDetails = {
       ...alloc,
       raw: data.allocation || null,
     };

     const projectionDetails = {
       current: data.projection?.current || null,
       smartSave: data.projection?.smartSave || null,
       history: projectionPoints,
     };

     const spending = {
       totalMonthly: totals.total || 0,
       fixed: totals.fixed || 0,
       variable: totals.variable || 0,
       exceptional: totals.exceptional || 0,
       ratios: {
         fixed: metrics.fixedRatio || 0,
         variable: metrics.variableRatio || 0,
         debt: metrics.debtRatio || 0,
       },
       flags: spendingFlags,
       topCategories,
       suggestedActions:
         (analysis.suggestedActions || []).map((action) => action?.title).filter(Boolean),
       breakdown: spendingBreakdown,
     };

     const payload = {
       score,
       spending,
       allocation: {
         currentAccount: alloc.allocations?.compteCourant || 0,
         securitySavings: alloc.allocations?.securite || 0,
         investments: alloc.allocations?.investissements || 0,
         taxReserve: alloc.allocations?.impots || 0,
       },
       allocationDetails,
       projection: {
         months: projectionHistory.length || 12,
         netWorthStart,
         netWorthEnd,
         securityMonthsEnd: Number.isFinite(data.securityMonths) ? data.securityMonths : 0,
       },
       projectionDetails,
       context: {
         feature: "Analyse IA",
         promptIntent: "analyse-ia",
         objective,
         incomeStability,
       },
       summary,
       userInputs: sanitizedInputs,
       metadata: {
         generatedAt: new Date().toISOString(),
         payloadLength: 0,
         truncated: false,
       },
     };

     let serialized = JSON.stringify(payload);
     if (serialized.length > MAX_PAYLOAD_LENGTH) {
       payload.userInputs = pickEssentialUserInputs(sanitizedInputs);
       payload.summary.sizeWarning =
         "Certaines données brutes ont été abrégées pour limiter la taille du payload ; les ratios essentiels restent disponibles.";
       payload.metadata.truncated = true;
       serialized = JSON.stringify(payload);
     }
     payload.metadata.payloadLength = serialized.length;
     return payload;
   }

   function buildMissingDataList(formData = {}, totals = {}, metrics = {}, startNet = 0, endNet = 0) {
     const missing = [];
     const hasObjective =
       Boolean(formData.personal?.objective) ||
       Boolean(formData.personal?.profilObjectif) ||
       Boolean(formData.currentPlan?.objective);
     if (!hasObjective) {
       missing.push("objectif non défini");
     }
     const hasIncomeStability = Boolean(formData.personal?.incomeStability) || Boolean(formData.personal?.incomeStatus);
     if (!hasIncomeStability) {
       missing.push("stabilité des revenus inconnue");
     }
     if (!totals.total) {
       missing.push("dépenses mensuelles totales absentes");
     }
     if (!Number.isFinite(metrics.monthlySavingsCapacity)) {
       missing.push("capacité d’épargne mensuelle indéterminée");
     }
     if (!startNet) {
       missing.push("patrimoine initial manquant");
     }
     if (!endNet) {
       missing.push("patrimoine projeté manquant");
     }
     return missing;
   }

   function cleanInputs(formData = {}) {
     try {
       const cloned = JSON.parse(JSON.stringify(formData || {}));
       return pruneEmpty(cloned) || {};
     } catch {
       return {};
     }
   }

   function pruneEmpty(value) {
     if (Array.isArray(value)) {
       const filtered = value
         .map(pruneEmpty)
         .filter((candidate) => candidate !== undefined && candidate !== null && !(typeof candidate === "string" && !candidate));
       return filtered.length ? filtered : undefined;
     }
     if (value && typeof value === "object") {
       const entries = Object.entries(value).reduce((acc, [key, val]) => {
         const cleaned = pruneEmpty(val);
         if (cleaned !== undefined) {
           acc[key] = cleaned;
         }
         return acc;
       }, {});
       return Object.keys(entries).length ? entries : undefined;
     }
     if (value === "" || value === null || value === undefined) {
       return undefined;
     }
     if (typeof value === "string" && !value.trim()) {
       return undefined;
     }
     return value;
   }

   function pickEssentialUserInputs(inputs = {}) {
     const keys = [
       "personal",
       "spouse",
       "incomes",
       "expenses",
       "exceptionalAnnual",
       "credits",
       "loans",
       "assets",
       "investments",
       "taxes",
       "goals",
       "currentPlan",
       "projection",
     ];
     return keys.reduce((acc, key) => {
       if (inputs[key]) {
         acc[key] = inputs[key];
       }
       return acc;
     }, {});
   }

   function sumAccounts(accounts = {}) {
     if (!accounts) return 0;
     return (
       Number(accounts.current || accounts.currentAccount || 0) +
       Number(accounts.savings || 0) +
       Number(accounts.blocked || 0) +
       Number(accounts.pillar3 || 0) +
       Number(accounts.investments || 0)
     );
   }

   function loadCache(hash) {
     try {
       const raw = localStorage.getItem(CACHE_KEY);
       if (!raw) return null;
       const parsed = JSON.parse(raw);
       if (parsed.payloadHash !== hash) return null;
       if (Date.now() - parsed.timestamp > CACHE_TTL) {
         localStorage.removeItem(CACHE_KEY);
         return null;
       }
       return parsed;
     } catch {
       return null;
     }
   }

   function saveCache(hash, response) {
     try {
       localStorage.setItem(
         CACHE_KEY,
         JSON.stringify({ payloadHash: hash, timestamp: Date.now(), response })
       );
     } catch {
       // ignore
     }
   }

   async function hashPayload(payload) {
     const stringified = JSON.stringify(payload);
     if (window.crypto?.subtle?.digest) {
       const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(stringified));
       return Array.from(new Uint8Array(digest))
         .map((byte) => byte.toString(16).padStart(2, "0"))
         .join("");
     }
     if (typeof TextEncoder !== "undefined") {
       const encoded = new TextEncoder().encode(stringified);
       return arrayBufferToBase64(encoded);
     }
     return btoa(stringified);
   }

   function isValidResponse(response = {}) {
     if (typeof response !== "object" || response === null) return false;
     const hasStrings =
       typeof response.spendingAnalysis === "string" &&
       typeof response.keyWeakness === "string" &&
       typeof response.priorityLever === "string" &&
       typeof response.projectionMotivation === "string";
     const narrativeValid =
       Array.isArray(response.smartSaveNarrative) && response.smartSaveNarrative.every((item) => typeof item === "string");
     const warningsValid =
       Array.isArray(response.warnings) && response.warnings.every((item) => typeof item === "string");
     return hasStrings && narrativeValid && warningsValid;
   }

   function buildDeterministicResponse(payload = {}) {
     const spending = payload.spending || {};
     const score = payload.score || {};
     const allocation = payload.allocation || {};
     const flags = spending.flags || [];
     const securityFlag = flags.includes("safety-critical") || flags.includes("safety-low");
     const missingData = payload.summary?.missingData || [];
     const warningMessages = [
       ...flags.map((flag) => `Surveillance : ${flag}`),
       ...missingData.map((item) => `Donnée manquante : ${item}`),
     ];
     return {
       spendingAnalysis: securityFlag
         ? "La priorité reste la sécurité : consolider le coussin et surveiller les flags liés aux dépenses."
         : "Le bilan reste stable et SmartSave recommande de confirmer cette trajectoire.",
       keyWeakness: securityFlag
         ? `Sécurité fragile (${score.security || 0}/100) : sauvegarde au moins 3 mois de dépenses.`
         : "Aucune faiblesse majeure ne se démarque, garde le cap.",
       priorityLever: securityFlag
         ? "Construis un coussin de sécurité couvrant trois mois de dépenses."
         : "Maintiens la répartition SmartSave et surveille les variables.",
       smartSaveNarrative: [
         `Le compte courant conserve ${formatCurrency(allocation.currentAccount)}.`,
         `La réserve de sécurité affiche ${formatCurrency(allocation.securitySavings)}.`,
         `Les impôts sont provisionnés à ${formatCurrency(allocation.taxReserve)}.`,
       ],
       projectionMotivation:
         payload.projection?.netWorthStart && payload.projection?.netWorthEnd
           ? `La projection passe de ${formatCurrency(payload.projection.netWorthStart)} à ${formatCurrency(
               payload.projection.netWorthEnd
             )}.`
           : "La projection suit la trajectoire SmartSave actuelle.",
       warnings: warningMessages,
     };
   }

   function formatCurrency(value = 0) {
     const number = Number.isFinite(value) ? value : Number(value) || 0;
     return new Intl.NumberFormat("fr-CH", {
       style: "currency",
       currency: "CHF",
       maximumFractionDigits: 0,
     }).format(number);
   }

   function hexToBytes(hex = "") {
     const normalized = hex.replace(/[^0-9a-f]/gi, "");
     const length = normalized.length / 2;
     const bytes = new Uint8Array(length);
     for (let i = 0; i < length; i += 1) {
       bytes[i] = parseInt(normalized.substr(i * 2, 2), 16);
     }
     return bytes;
   }

   function arrayBufferToBase64(buffer) {
     let binary = "";
     const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
     const len = bytes.byteLength;
     for (let i = 0; i < len; i += 1) {
       binary += String.fromCharCode(bytes[i]);
     }
     return window.btoa(binary);
   }

   async function encryptPayload(payload, keyHex) {
     const keyBytes = hexToBytes(keyHex);
     if (keyBytes.length !== 32) {
       throw new Error("Clé AES invalide (doit faire 32 octets).");
     }
     if (!window.crypto?.subtle) {
       throw new Error("Web Crypto indisponible dans ce navigateur.");
     }
     const iv = window.crypto.getRandomValues(new Uint8Array(12));
     const cryptoKey = await window.crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
     const encoded = new TextEncoder().encode(JSON.stringify(payload));
     const cipherBuffer = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
     const cipherBytes = new Uint8Array(cipherBuffer);
     const tagLength = 16;
     const ciphertext = cipherBytes.slice(0, cipherBytes.length - tagLength);
     const tag = cipherBytes.slice(cipherBytes.length - tagLength);
     return {
       ciphertext: arrayBufferToBase64(ciphertext),
       nonce: arrayBufferToBase64(iv),
       tag: arrayBufferToBase64(tag),
     };
   }

   window.SmartSaveAi = {
     bootstrap,
     refresh: refreshAnalysis,
   };
 })();
