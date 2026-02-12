const STORAGE_KEY_ACTIVE_USER = "smartsaveActiveUser";
const STORAGE_KEY_FORM = "smartsaveFormData";
const SNAPSHOT_STORAGE_KEY = "smartsaveSnapshots";
const PROFILE_UPDATE_KEY = "smartsaveProfileUpdated";
const PROFILE_VERSION_KEY = "smartsaveProfileVersion";
const SYNC_URL_OVERRIDE_KEY = "smartsaveProfileSyncUrl";

const SYNC_ENABLED = true;
const SYNC_URL = "http://localhost:3000";
const SYNC_DEBOUNCE_MS = 2500;

const RATIO_THRESHOLDS = {
  fixed: { high: 0.55, medium: 0.4 },
  variable: { high: 0.35, medium: 0.25 },
  debt: { high: 0.2, medium: 0.1 },
};

const RATIO_LABELS = {
  fixed: {
    high: "Charges fixes lourdes",
    medium: "Charges fixes importantes",
    ok: "Charges fixes maîtrisées",
  },
  variable: {
    high: "Variables trop élevées",
    medium: "Variables en hausse",
    ok: "Variables confortables",
  },
  debt: {
    high: "Dettes lourdes",
    medium: "Dettes à surveiller",
    ok: "Dettes maîtrisées",
  },
};

const SPENDING_PIE_PALETTES = {
  fixed: ["#1F3A8A", "#3B82F6", "#93C5FD"],
  variable: ["#1F3A8A", "#3B82F6", "#93C5FD"],
  exceptional: ["#1F3A8A", "#3B82F6", "#93C5FD"],
};

const SPENDING_TYPE_LABELS = {
  fixed: "charges fixes",
  variable: "dépenses variables",
  exceptional: "dépenses exceptionnelles",
};

const markUserLoggedOut = () => {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_USER, "{}");
  } catch (_error) {
    // ignore storage issues
  }
};

const COACH_FALLBACK_MESSAGE = "Coach IA bientôt disponible.";
const COACH_UNAVAILABLE_MESSAGE = "Le coach IA est indisponible, réessaie.";

function buildCoachFallbackResult(snapshot) {
  const metrics = snapshot?.outputs?.keyMetrics || {};
  const spendingTotals = snapshot?.outputs?.spendingTotals || metrics.spendingTotals || {};
  const safetyMonths = Number(metrics.safetyMonths) || 0;
  const surplus = Number(metrics.surplus) || 0;
  const variable = Number(spendingTotals.variable) || 0;
  const fixed = Number(spendingTotals.fixed) || 0;
  const actions = [];

  if (safetyMonths < 3) {
    actions.push({
      title: "Sécurité à renforcer",
      description: "Ta réserve de sécurité est faible. Priorise le coussin avant les objectifs.",
    });
  } else {
    actions.push({
      title: "Sécurité stable",
      description: "Continue d'alimenter la sécurité pour rester serein.",
    });
  }

  if (variable > fixed) {
    actions.push({
      title: "Variables à lisser",
      description: "Tes dépenses variables dépassent les fixes. Réduis une catégorie pour libérer du surplus.",
    });
  } else {
    actions.push({
      title: "Variables maîtrisées",
      description: "Tes variables restent sous contrôle. Garde cette discipline.",
    });
  }

  if (surplus > 0) {
    actions.push({
      title: "Surplus à investir",
      description: "Tu dégages un surplus mensuel. Planifie son allocation SmartSave.",
    });
  }

  return {
    summary: COACH_FALLBACK_MESSAGE,
    actions: actions.slice(0, 5),
    warnings: [],
  };
}

async function requestAiCoach(snapshot, agentName = "coach") {
  const runtime = typeof window.getSmartSaveRuntime === "function"
    ? window.getSmartSaveRuntime()
    : {};
  const coachEnabled = runtime?.ai?.enabled !== false;
  const timeoutMs = Number(runtime?.ai?.timeoutMs) || 12000;
  const COACH_URL = "/api/coach";

  if (!snapshot || !coachEnabled) {
    return buildCoachFallbackResult(snapshot);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const payload = { event: "aiCoach", agentName, snapshot };
  try {
    console.log("[AI COACH] POST", COACH_URL, payload);
    const response = await fetch(COACH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    console.log("[AI COACH] status", response.status);
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
      console.log("[AI COACH] response (non-JSON)", rawText);
    }
    console.log("[AI COACH] response", data ?? rawText);
    if (!response.ok || data?.ok === false) {
      console.error("[AI COACH] error", response.status, rawText);
      return { summary: COACH_UNAVAILABLE_MESSAGE, actions: [], warnings: [] };
    }
    if (!data || typeof data !== "object") {
      return buildCoachFallbackResult(snapshot);
    }
    return {
      summary: String(data?.summary || data?.message || COACH_FALLBACK_MESSAGE),
      actions: Array.isArray(data?.actions) ? data.actions : [],
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    };
  } catch (error) {
    console.error("[AI COACH] error", error);
    return { summary: COACH_UNAVAILABLE_MESSAGE, actions: [], warnings: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveExpenseLabel(entry = {}) {
  const label =
    entry?.label ||
    entry?.name ||
    entry?.category ||
    entry?.type ||
    entry?.description ||
    "Autre";
  return String(label || "Autre").trim() || "Autre";
}

const PLAN_ACTIONS_STORAGE_KEY = "smartsavePlanActionsState";

function loadPlanActionsState() {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const stored = window.localStorage.getItem(PLAN_ACTIONS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    return {};
  }
}

function savePlanActionsState(state = {}) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(PLAN_ACTIONS_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    /* ignore */
  }
}

function handlePlanActionsChecklistChange(event) {
  const checkbox = event.target.closest(".plan-actions__checkbox");
  if (!checkbox) return;
  const item = checkbox.closest(".plan-actions__item");
  if (!item) return;
  const key = item.dataset.planActionKey;
  if (!key) return;
  const state = loadPlanActionsState();
  if (checkbox.checked) {
    item.classList.add("plan-actions__item--done");
    state[key] = true;
  } else {
    item.classList.remove("plan-actions__item--done");
    delete state[key];
  }
  savePlanActionsState(state);
}

function setupPlanActionsChecklist(container, entries = []) {
  if (!container) return;
  const state = loadPlanActionsState();
  container.innerHTML = entries
    .map((entry) => {
      const checked = Boolean(state[entry.key]);
      const title = entry.title || entry.label || "Action";
      const description = entry.description || entry.text || "";
      const amountValue = Number.isFinite(toNumber(entry.amount)) ? toNumber(entry.amount) : null;
      const amountText = amountValue != null ? formatCurrency(amountValue) : "";
      return `
        <li class="plan-actions__item${checked ? " plan-actions__item--done" : ""}" data-plan-action-key="${entry.key}">
          <label class="plan-actions__label actionRow">
            <input type="checkbox" class="plan-actions__checkbox actionCheck" ${checked ? "checked" : ""}>
            <span class="plan-actions__text actionMain">
              <span class="actionTop">
                <span class="actionTitle">${title}</span>
                ${amountText ? `<span class="actionAmount">${amountText}</span>` : ""}
              </span>
              ${description ? `<span class="actionDesc">${description}</span>` : ""}
            </span>
          </label>
        </li>
      `;
    })
    .join("");
  if (!container.dataset.actionsListener) {
    container.addEventListener("change", handlePlanActionsChecklistChange);
    container.dataset.actionsListener = "1";
  }
}

function toMonthlyEntryAmount(entry = {}) {
  return sumMonthly(entry ? [entry] : []);
}

function buildExpenseBreakdownMap(entries = []) {
  return ensureArray(entries).reduce((map, entry) => {
    const monthlyAmount = toMonthlyEntryAmount(entry);
    if (!monthlyAmount) return map;
    const label = resolveExpenseLabel(entry);
    map[label] = (map[label] || 0) + monthlyAmount;
    return map;
  }, {});
}

function buildRatioBadge(ratio, thresholds, labelSet) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return { text: "Données manquantes", state: "warning" };
  }
  if (ratio > thresholds.high) {
    return { text: labelSet.high, state: "critical" };
  }
  if (ratio > thresholds.medium) {
    return { text: labelSet.medium, state: "warning" };
  }
  return { text: labelSet.ok, state: "neutral" };
}

const EXCEPTIONAL_TYPE_LABELS = {
  vacances: "Vacances",
  cadeaux: "Cadeaux",
  sante: "Santé / Dentaire",
  reparation: "Frais de réparation",
  autre: "Autre",
};

document.addEventListener("DOMContentLoaded", () => {
  const activeUser = loadActiveUser();
  if (!activeUser) {
    showNoProfileMessage();
    return;
  }
  const formData = loadUserForm(activeUser.id);
  if (!formData) {
    showNoProfileMessage();
    return;
  }
  normalizeExceptionalExpenses(formData);
  hideNoProfileMessage();
  const snapshot = window.SmartSaveSnapshot?.buildSnapshot
    ? window.SmartSaveSnapshot.buildSnapshot(formData, { years: 20, userId: activeUser.id })
    : null;
  if (snapshot) {
    saveSnapshot(activeUser.id, snapshot);
    window.__SMARTSAVE_LAST_SNAPSHOT__ = snapshot;
  }
  const data = buildMvpData(formData, snapshot);
  renderScore(data.score);
  renderSituation(data, formData);
  renderRecapSmartSaveAllocation(data);
  renderPlan(data, formData);
  renderProjection(data);
  renderSpendingAnalysis(data);
  renderResilienceTab(data, formData);
  setupHeader(activeUser, formData);
  setupDebugPanel(snapshot);
  setupTabs();
  setupSituationSubtabs();
  setupExpenseDetailsToggle();
  setupUserMenuInteractions();
  setupAiCoach();
});

function buildMvpData(formData, snapshot) {
  let effectiveSnapshot = snapshot;
  if (!effectiveSnapshot && window.SmartSaveSnapshot?.buildSnapshot) {
    effectiveSnapshot = window.SmartSaveSnapshot.buildSnapshot(formData, { years: 20 });
  }

  if (effectiveSnapshot?.outputs) {
    const outputs = effectiveSnapshot.outputs || {};
    const keyMetrics = outputs.keyMetrics || {};
    const spendingTotals =
      outputs.spendingTotals ||
      keyMetrics.spendingTotals || {
        fixed: 0,
        variable: 0,
        exceptional: 0,
        total: 0,
      };

    return {
      score: outputs.score || { score: 0, level: "SmartSave", pillars: {} },
      allocation: outputs.allocation || { allocations: {}, reste: 0 },
      projection:
        outputs.projection ||
        { current: { finalAccounts: { netWorth: 0 } }, smartSave: { finalAccounts: { netWorth: 0 } } },
      spendingAnalysis: outputs.spendingAnalysis || null,
      taxProvision: outputs.taxSummary || null,
      metrics: {
        monthlyNetIncome: toNumber(keyMetrics.income),
      },
      monthlyExpenses: toNumber(keyMetrics.expenses),
      liquidity: toNumber(keyMetrics.liquidity),
      securityMonths: toNumber(keyMetrics.safetyMonths),
      spendingTotals,
      debtMonthly: toNumber(keyMetrics.debtMonthly),
    };
  }

  const sanitized = JSON.parse(JSON.stringify(formData || {}));
  const scoreEngine = window.FinancialScoreEngine;
  const allocationEngine = window.AllocationEngine;
  const projectionEngine = window.ProjectionEngine;

  const score = scoreEngine?.calculateScore
    ? scoreEngine.calculateScore(sanitized)
    : { score: 0, level: "SmartSave", pillars: {} };

  const allocation = allocationEngine?.calculateAllocation
    ? allocationEngine.calculateAllocation(sanitized)
    : { allocations: {}, reste: 0 };

  const projectionInput = prepareProjectionInput(sanitized);
  const projection =
    projectionEngine?.calculateProjection?.(projectionInput, { years: 20, keepHistory: true }) ||
    { current: { finalAccounts: { netWorth: 0 } }, smartSave: { finalAccounts: { netWorth: 0 } } };

  const monthlyIncome = computeMonthlyIncome(sanitized);
  const fixedMonthly = sumMonthly(sanitized.expenses?.fixed);
  const variableMonthly = sumMonthly(sanitized.expenses?.variable);
  const exceptionalMonthly =
    sumMonthly(sanitized.expenses?.exceptional) +
    sumMonthly(sanitized.expenses?.annualExtra || sanitized.exceptionalAnnual);
  const spendingTotalsFallback = {
    fixed: fixedMonthly,
    variable: variableMonthly,
    exceptional: exceptionalMonthly,
    total: fixedMonthly + variableMonthly + exceptionalMonthly,
  };
  const monthlyExpenses = computeMonthlyOutflow(sanitized);
  const liquidity = computeLiquidAssets(sanitized.assets || {});
  const debtMonthly = sumLoanPayments(sanitized);
  const securityMonths = monthlyExpenses > 0 ? liquidity / monthlyExpenses : 0;
  const fixedBreakdownMap = buildExpenseBreakdownMap(sanitized.expenses?.fixed);
  const variableBreakdownMap = buildExpenseBreakdownMap(sanitized.expenses?.variable);
  const exceptionalEntries = ensureArray(sanitized.expenses?.exceptional).concat(
    ensureArray(sanitized.expenses?.annualExtra || sanitized.exceptionalAnnual)
  );
  const exceptionalBreakdownMap = buildExpenseBreakdownMap(exceptionalEntries);
  const expenseBreakdownMap = { ...fixedBreakdownMap };
  Object.entries(variableBreakdownMap).forEach(([label, amount]) => {
    expenseBreakdownMap[label] = (expenseBreakdownMap[label] || 0) + amount;
  });
  Object.entries(exceptionalBreakdownMap).forEach(([label, amount]) => {
    expenseBreakdownMap[label] = (expenseBreakdownMap[label] || 0) + amount;
  });

  const spendingAnalysis =
    window.SpendingAnalysisEngine?.analyze?.({
      ...sanitized,
      incomeNetMonthly: monthlyIncome,
      fixedExpensesMonthly: fixedMonthly,
      variableExpensesMonthly: variableMonthly,
      exceptionalExpensesMonthly: exceptionalMonthly,
      currentSavings:
        sanitized.currentSavings ||
        sanitized.assets?.savings ||
        sanitized.assets?.currentAccount ||
        0,
      taxReserveMonthly:
        sanitized.taxReserveMonthly ||
        sanitized.taxReserve ||
        sanitized.expenses?.taxReserveMonthly ||
        0,
      expenseBreakdownMonthly: expenseBreakdownMap,
      fixedBreakdownMonthly: fixedBreakdownMap,
      variableBreakdownMonthly: variableBreakdownMap,
    }) || null;

  return {
    score,
    allocation,
    projection,
    spendingAnalysis,
    taxProvision: getTaxProvisionInfo(formData, allocation),
    metrics: {
      monthlyNetIncome: monthlyIncome,
    },
    monthlyExpenses,
    liquidity,
    securityMonths,
    spendingTotals: spendingTotalsFallback,
    debtMonthly,
  };
}

function buildExceptionalEntry(exceptional = {}) {
  const amount = toNumber(exceptional.amount);
  const type = exceptional.type;
  if (!amount || !type || type === "aucune") return null;
  const baseLabel = EXCEPTIONAL_TYPE_LABELS[type] || type;
  const label =
    type === "autre" ? exceptional.notes || baseLabel || "Dépense exceptionnelle" : baseLabel;
  return {
    label,
    amount,
    frequency: "annuel",
    notes: exceptional.notes,
  };
}

function gatherExceptionalAnnualEntries(formData = {}) {
  return ensureArray(formData.exceptionalAnnual || formData.expenses?.annualExtra);
}

function normalizeExceptionalExpenses(data = {}) {
  const entry = buildExceptionalEntry(data.exceptional);
  if (!entry) return;
  data.exceptionalAnnual = ensureArray(data.exceptionalAnnual || []).concat(entry);
  data.expenses = data.expenses || {};
  data.expenses.annualExtra = ensureArray(data.expenses.annualExtra || []).concat(entry);
}

function renderScore(scoreData) {
  const total = Number.isFinite(scoreData?.score) ? Math.round(scoreData.score) : 0;
  setText("[data-mvp-score-total]", total);
  setText("[data-mvp-score-level]", scoreData?.level || "SmartSave");
  updateScoreGauge(total);
  ["securite", "anticipation", "croissance"].forEach((pillar) => {
    const value = Math.round(clamp(toNumber(scoreData?.pillars?.[pillar]?.score) || 0, 0, 100));
    const node = document.querySelector(`[data-score-value="${pillar}"]`);
    if (node) node.textContent = `${value}/100`;
    const gauge = document.querySelector(`[data-score-gauge="${pillar}"]`);
    if (gauge) {
      gauge.style.width = `${value}%`;
      gauge.style.setProperty("--pillar-color", getScoreColor(value));
      gauge.style.background = getScoreColor(value);
    }
  });
}

function updateScoreGauge(value) {
  const circle = document.querySelector("[data-score-circle]");
  if (!circle) return;
  const radius = Number(circle.getAttribute("r")) || 70;
  const circumference = 2 * Math.PI * radius;
  const normalized = Math.min(Math.max(value, 0), 100);
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = circumference * (1 - normalized / 100);
  const gauge = circle.closest(".score-gauge");
  if (gauge) {
    const gradient = getScoreGradient(normalized);
    gauge.style.setProperty("--score-color", gradient.primary);
    gauge.style.setProperty("--score-color-accent", gradient.accent);
  }
}

function getScoreColor(value) {
  return "#1F3A8A";
}

function getScoreGradient(value) {
  return { primary: "#1F3A8A", accent: "#1F3A8A" };
}

function renderSituation(data, formData) {
  const income = Number.isFinite(data.metrics.monthlyNetIncome)
    ? data.metrics.monthlyNetIncome
    : 0;
  const fixed = sumMonthly(formData.expenses?.fixed);
  const variable = sumMonthly(formData.expenses?.variable);
  const exceptionalEntries = ensureArray(formData.expenses?.exceptional);
  const exceptionalAnnualEntries = gatherExceptionalAnnualEntries(formData);
  const exceptional =
    sumMonthly(exceptionalEntries) + sumMonthly(exceptionalAnnualEntries);
  const totalExpenses = fixed + variable + exceptional;
  const loans = getLoanEntries(formData);
  const debtPayments = loans.reduce(
    (sum, loan) => sum + (toNumber(loan.monthlyAmount) || toNumber(loan.monthly) || 0),
    0
  );
  const debtTotal = loans.reduce((sum, loan) => sum + Math.max(0, toNumber(loan.outstanding)), 0);
  const liquidity = computeLiquidAssets(formData.assets || {});

  setCurrency("[data-mvp-income]", income);
  setCurrency("[data-mvp-fixed]", fixed);
  setCurrency("[data-mvp-variable]", variable);
  setCurrency("[data-mvp-exceptional]", exceptional);
  setCurrency("[data-mvp-expenses]", totalExpenses);
  setCurrency("[data-mvp-debt]", debtPayments);
  setCurrency("[data-mvp-debt-total]", debtTotal);
  setCurrency("[data-mvp-liquidity]", liquidity);
  setText("[data-mvp-security-months]", (Number.isFinite(data.securityMonths) ? data.securityMonths.toFixed(1) : "0"));

  setCurrency("[data-balance-income]", income);
  setCurrency("[data-balance-expenses]", totalExpenses);
  setCurrency("[data-balance-debt]", debtPayments);
  setCurrency("[data-balance-liquidites]", liquidity);
  const netBalance = income - (totalExpenses + debtPayments);
  setCurrency("[data-balance-net]", netBalance);
  const recapRest = income - fixed;
  setCurrency("[data-recap-rest]", recapRest);
  renderRecapFixedExpensesChart(income, fixed);


  const assets = formData.assets || {};
  const accountValue = (keys) =>
    Number(
      keys
        .map((key) => toNumber(assets[key]))
        .find((value) => Number.isFinite(value) && value > 0) ?? 0
    );
  const assetBuckets = {
    current: ["currentAccount", "compteCourant", "checking", "paymentAccount"],
    savings: ["securitySavings", "savingsAccount", "emergencyFund", "savings", "epargne"],
    blocked: ["blocked", "securityBlocked", "blockedAccounts", "blockedAccount", "compteBloque"],
    tax: ["taxProvision", "impotsProvision", "provisionImpots", "impots", "taxesProvision"],
    third: ["pillar3a", "thirdPillarAmount", "thirdPillar", "pillar3", "pilier3a", "thirdPillarValue"],
    investments: ["investments", "investmentAccount", "portfolio", "portefeuille", "placements"],
  };
  const currentValue = accountValue(assetBuckets.current);
  const savingsValue = accountValue(assetBuckets.savings);
  const blockedValue = accountValue(assetBuckets.blocked);
  setCurrency("[data-account-current]", currentValue);
  setCurrency("[data-account-savings]", savingsValue);
  setCurrency("[data-account-blocked]", blockedValue);
  const taxInfo = data.taxProvision || getTaxProvisionInfo(formData, data.allocation);
  const taxValue = toNumber(taxInfo.currentProvision);
  setCurrency("[data-account-tax]", taxValue);
  renderTaxProvisionWidget(taxInfo);
  const thirdValue = accountValue(assetBuckets.third);
  const investmentsValue = accountValue(assetBuckets.investments);
  setCurrency("[data-account-third]", thirdValue);
  setCurrency("[data-account-investments]", investmentsValue);
  setCurrency("[data-account-security-total]", currentValue + savingsValue + blockedValue);
  setCurrency("[data-account-anticipation-total]", taxValue);
  setCurrency("[data-account-growth-total]", thirdValue + investmentsValue);

  const exceptionalAnnualDetails = exceptionalAnnualEntries
    .map(toMonthlyExceptionalEntry)
    .filter((entry) => toNumber(entry?.amount) > 0);
  const categories = {
    fixed: ensureArray(formData.expenses?.fixed),
    variable: ensureArray(formData.expenses?.variable),
    exceptional: ensureArray(formData.expenses?.exceptional).concat(exceptionalAnnualDetails),
  };
  const expenseBreakdown = {
    fixed,
    variable,
    exceptional,
  };
  const breakdownTotal = Object.values(expenseBreakdown).reduce((sum, value) => sum + value, 0) || 0;
  Object.entries(expenseBreakdown).forEach(([key, value]) => {
    const textNode = document.querySelector(`[data-expense-value="${key}"]`);
    if (textNode) {
      textNode.textContent = formatCurrency(value);
    }
    const fill = document.querySelector(`[data-expense-bar="${key}"] .expense-distribution__fill`);
    if (fill) {
      const percent = breakdownTotal > 0 ? Math.min(100, Math.round((value / breakdownTotal) * 100)) : 0;
      fill.style.width = `${percent}%`;
    }
  });

  renderExpenseDetails(categories, expenseBreakdown);
  const incomeEntries = buildIncomeBreakdownEntries(formData);
  renderIncomeDistribution(incomeEntries);
  data.spendingTotals = { fixed, variable, exceptional, total: totalExpenses };
}

function renderRecapFixedExpensesChart(income, fixed) {
  const fill = document.querySelector("[data-recap-fixed-bar-fill]");
  const note = document.querySelector("[data-recap-fixed-bar-note]");
  if (!fill && !note) return;
  const safeIncome = Math.max(0, toNumber(income));
  const safeFixed = Math.max(0, toNumber(fixed));
  const ratio = safeIncome > 0 ? safeFixed / safeIncome : 0;
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  if (fill) fill.style.width = `${percent}%`;
  if (note) note.textContent = `${percent}% du revenu net`;
}

function renderRecapSmartSaveAllocation(data = {}) {
  const donutNode = document.querySelector("[data-recap-allocation-donut]");
  const totalNode = document.querySelector("[data-recap-allocation-total]");
  const legendNode = document.querySelector("[data-recap-allocation-legend]");
  if (!donutNode || !totalNode || !legendNode) return;

  const allocations = data.allocation?.allocations || {};
  const shortTermAccount = data.allocation?.shortTermAccount || data.allocation?.debug?.shortTermAccount || {};
  const shortTermKey = String(shortTermAccount.key || "projetsCourtTerme").trim();
  const longTermKey = "projetsLongTerme";
  const labels = {
    securite: "Sécurité",
    projets: "Objectifs long terme",
    [longTermKey]: "Objectifs long terme",
    [shortTermKey]: shortTermAccount.label || `Compte ${shortTermAccount.name || "court terme"}`,
    impots: "Impôts",
    investissements: "Investissements",
    pilier3a: "3e pilier",
    dettes: "Dettes",
  };
  const palette = ["#1f3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#0f766e"];
  const entries = Object.entries(allocations)
    .map(([key, value]) => ({
      key,
      label: labels[key] || key,
      amount: Math.max(0, toNumber(value)),
    }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  totalNode.textContent = formatCurrency(total);
  if (!total) {
    donutNode.style.setProperty("--recap-allocation-gradient", "conic-gradient(#e2e8f0 0 100%)");
    legendNode.innerHTML = '<li><span><i class="recap-allocation__dot"></i>Aucune répartition ce mois</span><strong>—</strong></li>';
    return;
  }

  let cursor = 0;
  const gradients = entries.map((entry, index) => {
    const share = (entry.amount / total) * 100;
    const from = cursor;
    const to = cursor + share;
    cursor = to;
    const color = palette[index % palette.length];
    entry.color = color;
    return `${color} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
  });
  donutNode.style.setProperty("--recap-allocation-gradient", `conic-gradient(${gradients.join(", ")})`);
  legendNode.innerHTML = entries
    .map(
      (entry) => `
        <li>
          <span><i class="recap-allocation__dot" style="background:${entry.color}"></i>${entry.label}</span>
          <strong>${formatCurrency(entry.amount)}</strong>
        </li>
      `
    )
    .join("");
}

function renderTaxProvisionWidget(info = {}) {
  const widget = document.querySelector("[data-tax-provision-widget]");
  if (!widget) return;
  const totalNode = widget.querySelector("[data-tax-total]");
  const outstandingNode = widget.querySelector("[data-tax-outstanding]");
  const providedNode = widget.querySelector("[data-tax-provided]");
  const monthlyAmountNode = widget.querySelector("[data-tax-monthly-amount]");
  const monthlyDetailNode = widget.querySelector("[data-tax-monthly-detail]");
  const monthlyLabelNode = widget.querySelector("[data-tax-monthly-label]");
  const deadlineNode = widget.querySelector("[data-tax-deadline]");
  if (info.noTaxes) {
    if (totalNode) totalNode.textContent = formatCurrency(0);
    if (outstandingNode) outstandingNode.textContent = formatCurrency(0);
    if (providedNode) providedNode.textContent = formatCurrency(0);
    if (monthlyAmountNode) monthlyAmountNode.textContent = formatCurrency(0);
    if (monthlyLabelNode) monthlyLabelNode.textContent = "—";
    if (monthlyDetailNode) monthlyDetailNode.textContent = "Aucun impôt à provisionner.";
    if (deadlineNode) deadlineNode.textContent = "—";
    return;
  }
  const totalTax = Math.max(0, toNumber(info.totalTax));
  const currentProvision = Math.max(0, toNumber(info.currentProvision));
  const outstanding =
    Number.isFinite(info.outstanding) && info.outstanding >= 0
      ? info.outstanding
      : Number.isFinite(info.remaining) && info.remaining >= 0
      ? info.remaining
      : Math.max(0, totalTax - currentProvision);
  if (totalNode) {
    totalNode.textContent = formatCurrency(totalTax);
  }
  if (outstandingNode) {
    outstandingNode.textContent = formatCurrency(outstanding);
  }
  if (providedNode) {
    providedNode.textContent = formatCurrency(currentProvision);
  }
  if (!totalTax) {
    const fallback = "—";
    if (monthlyAmountNode) {
      monthlyAmountNode.textContent = formatCurrency(0);
    }
    if (monthlyLabelNode) {
      monthlyLabelNode.textContent = fallback;
    }
    if (monthlyDetailNode) {
      monthlyDetailNode.textContent = "Aucune estimation d'impôt pour cette année fiscale.";
    }
    return;
  }
  const deadline =
    (info.deadline && new Date(info.deadline) && !Number.isNaN(new Date(info.deadline).getTime())
      ? new Date(info.deadline)
      : nextTaxDeadlineDate()) || nextTaxDeadlineDate();
  const targetMonths = computeMonthsUntilDeadline(deadline);
  const monthlyAmount = Number.isFinite(info.monthlyAmount)
    ? Math.max(0, info.monthlyAmount)
    : null;
  const perMonthAmount =
    monthlyAmount != null
      ? monthlyAmount
      : targetMonths
      ? outstanding / targetMonths
      : outstanding;
  const formattedPerMonth = formatCurrency(perMonthAmount || 0);
  if (monthlyAmountNode) {
    monthlyAmountNode.textContent = formattedPerMonth;
  }
  if (monthlyLabelNode) {
    monthlyLabelNode.textContent = `${formattedPerMonth} / mois`;
  }
  if (monthlyDetailNode) {
    const deadlineMention = info.deadlineLabel ? ` jusqu'à ${info.deadlineLabel}` : "";
    monthlyDetailNode.textContent = `SmartSave recommande ${formattedPerMonth} par mois pour ta provision fiscale${deadlineMention}.`;
  }
  if (deadlineNode) {
    deadlineNode.textContent = info.deadlineLabel || formatTaxDeadline(info.deadline);
  }
}

function getTaxProvisionInfo(formData = {}, allocation = null) {
  const paysTaxesRaw = formData?.taxes?.paysTaxes ?? formData?.paysTaxes;
  if (!shouldPayTaxes(paysTaxesRaw)) {
    return {
      totalTax: 0,
      remaining: 0,
      monthlyNeed: 0,
      monthlyAmount: 0,
      monthsRemaining: 0,
      deadline: null,
      deadlineLabel: "",
      currentProvision: 0,
      progress: 100,
      outstanding: 0,
      noTaxes: true,
    };
  }
  const taxEngine = window.TaxEngine || window.SmartSaveTaxEngine;
  let taxData = null;
  if (taxEngine && typeof taxEngine.calculateAnnualTax === "function") {
    try {
      taxData = taxEngine.calculateAnnualTax(formData);
    } catch (_error) {
      taxData = null;
    }
  }
  const monthlyPlan = taxData?.monthlyProvision || {};
  const monthlyIncome = computeMonthlyIncome(formData);
  const fallbackAnnualIncome = monthlyIncome * 12;
  const rawTotalTax = Math.max(0, toNumber(taxData?.total));
  const totalTax = rawTotalTax || estimateAnnualTaxByBracket(fallbackAnnualIncome);
  const provisionedFromAssets = Math.max(
    toNumber(formData.assets?.taxProvision),
    toNumber(formData.taxes?.provision),
    toNumber(formData.taxes?.provisionImpots),
    toNumber(formData.taxes?.alreadySaved),
    toNumber(formData.taxes?.advancePayments),
    0
  );
  const advancePayments = Math.max(toNumber(monthlyPlan.advancePayments), provisionedFromAssets);
  const fallbackRemaining = Math.max(0, totalTax - advancePayments);
  const remaining = Math.max(0, toNumber(monthlyPlan.remaining) || fallbackRemaining);
  const deadline = monthlyPlan.deadline || nextTaxDeadlineDate();
  const computedMonthsBetween = monthsBetweenDates(new Date(), deadline);
  const monthsRemaining = Math.max(
    1,
    toNumber(monthlyPlan.remainingMonths),
    computedMonthsBetween
  );
  const monthlyNeed =
    toNumber(monthlyPlan.monthlyAmount) || (monthsRemaining ? remaining / monthsRemaining : remaining);
  const deadlineLabel = formatTaxDeadline(deadline);
  const currentProvision = Math.min(totalTax, advancePayments);
  const outstanding = Math.max(0, totalTax - currentProvision);
  const progress = totalTax ? Math.min(100, Math.max(0, Math.round(((totalTax - outstanding) / totalTax) * 100))) : 100;
  const allocatedMonthly = toNumber(allocation?.allocations?.impots);
  const monthlyAmount = Number.isFinite(allocatedMonthly) ? allocatedMonthly : monthlyNeed;
  return {
    totalTax,
    remaining,
    monthlyNeed,
    monthlyAmount,
    monthsRemaining,
    deadline,
    deadlineLabel,
    currentProvision,
    progress,
    outstanding,
  };
}

function shouldPayTaxes(value) {
  if (typeof value === "boolean") return value;
  if (value == null) return true;
  const normalized = value.toString().trim().toLowerCase();
  const falsy = ["non", "no", "false", "0"];
  return !falsy.includes(normalized);
}

function monthsUntilNextTaxDeadline(reference = new Date()) {
  const now = reference instanceof Date ? reference : new Date(reference);
  const deadline = nextTaxDeadlineDate(now);
  let months = (deadline.getFullYear() - now.getFullYear()) * 12 + (deadline.getMonth() - now.getMonth());
  if (deadline.getDate() >= now.getDate()) months += 1;
  return Math.max(1, months);
}

function nextTaxDeadlineDate(reference = new Date()) {
  const now = reference instanceof Date ? reference : new Date(reference);
  const deadline = new Date(now.getFullYear(), 2, 31);
  if (now > deadline) {
    deadline.setFullYear(deadline.getFullYear() + 1);
  }
  return deadline;
}

function formatTaxDeadline(deadline) {
  const target = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(target.getTime())) return null;
  return new Intl.DateTimeFormat("fr-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(target);
}

function estimateAnnualTaxByBracket(annualIncome) {
  const income = Number.isFinite(annualIncome) ? annualIncome : 0;
  if (income <= 0) return 0;
  if (income < 50000) return income * 0.08;
  if (income < 80000) return income * 0.11;
  if (income < 120000) return income * 0.14;
  return income * 0.17;
}

function monthsBetweenDates(start, end) {
  const from = start instanceof Date ? start : new Date(start);
  const to = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 1;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() >= from.getDate()) months += 1;
  return Math.max(1, months);
}

function computeMonthsUntilDeadline(deadline) {
  const now = new Date();
  const target =
    deadline instanceof Date ? deadline : deadline ? new Date(deadline) : nextTaxDeadlineDate(now);
  if (Number.isNaN(target.getTime())) {
    return 1;
  }
  const msPerMonth = 1000 * 60 * 60 * 24 * 30;
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return 1;
  return Math.max(1, Math.ceil(diff / msPerMonth));
}

const PLAN_SCALE_STEPS = 4;

function buildPlanScaleMarkup(maxValue, steps = PLAN_SCALE_STEPS) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return { markup: "", axisMax: 0 };
  }
  const axisMax = getNormalizedAxisValue(maxValue, steps) || maxValue;
  const ticks = [];
  for (let level = steps; level >= 0; level -= 1) {
    const value = Math.round(axisMax * (level / steps));
    ticks.push(`<span>${formatCurrency(value)}</span>`);
  }
  return {
    markup: ticks.join(""),
    axisMax,
  };
}

function getNormalizedAxisValue(value, steps) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const roughStep = value / Math.max(1, steps);
  const niceStep = niceNumber(roughStep);
  if (!niceStep) return 0;
  return niceStep * steps;
}

function niceNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const fraction = value / base;
  let niceFraction = 1;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * base;
}

function renderPlan(data, formData = {}, options = {}) {
  const planBarsNode = document.querySelector("[data-plan-bars]");
  const planLogicNode = document.querySelector("[data-plan-logic]");
  const planScaleNode = document.querySelector("[data-plan-scale]");
  const planIntroNode = document.querySelector("[data-plan-actions-intro]");
  const planDistributionNode = document.querySelector("[data-plan-distribution]");
  const planLabelsNode = document.querySelector("[data-plan-labels]");
  const overrideAllocations = options.allocationsOverride;
  const allocations = overrideAllocations || data.allocation?.allocations || {};
  const taxProvision = data.taxProvision || {};
  const taxTargetValue = Math.max(
    0,
    taxProvision.remaining || taxProvision.outstanding || taxProvision.totalTax || 0
  );
  const needsTaxProvision = taxTargetValue > 0;
  const targets = [
    { key: "compteCourant", label: "Compte courant" },
    { key: "securite", label: "Épargne" },
    { key: "investissements", label: "Investissements" },
    { key: "pilier3a", label: "3e pilier" },
  ];
  if (needsTaxProvision) {
    targets.splice(2, 0, { key: "impots", label: "Impôts & charges" });
  }
  const entries = targets
    .map((target) => ({
      ...target,
      amount: Math.max(0, toNumber(allocations[target.key])),
    }))
    .filter((entry) => entry.amount > 0);
  const maxAmount = entries.length ? Math.max(...entries.map((entry) => entry.amount)) : 0;
  const scaleData = buildPlanScaleMarkup(maxAmount);
  const chartReference = scaleData.axisMax || maxAmount;
  if (planBarsNode) {
    planBarsNode.innerHTML = entries.length
      ? entries
          .map((entry) => {
            const reference = chartReference || entry.amount;
            const ratio = reference ? Math.min(entry.amount / reference, 1) : 0;
            const height = reference ? Math.round(ratio * 100) : 0;
            const visualHeight = reference ? Math.max(4, Math.min(height, 100)) : 4;
            return `
              <article class="plan-chart__bar" data-plan-bar="${entry.key}">
                <div class="plan-chart__bar-value">${formatCurrency(entry.amount)}</div>
                <div class="plan-chart__fill" style="height:${visualHeight}%"></div>
              </article>
            `;
          })
          .join("")
      : '<p class="plan-chart__empty">SmartSave n’a pas encore défini de répartition.</p>';
  }
  if (planScaleNode) {
    if (entries.length && scaleData.markup) {
      planScaleNode.innerHTML = scaleData.markup;
      planScaleNode.classList.remove("plan-chart__scale--hidden");
    } else {
      planScaleNode.innerHTML = "";
      planScaleNode.classList.add("plan-chart__scale--hidden");
    }
  }
  if (planLabelsNode) {
    if (entries.length) {
      planLabelsNode.innerHTML = entries.map((entry) => `<span>${entry.label}</span>`).join("");
      planLabelsNode.classList.remove("plan-chart__labels--hidden");
    } else {
      planLabelsNode.innerHTML = "";
      planLabelsNode.classList.add("plan-chart__labels--hidden");
    }
  }

  const monthlyExpensesTotal = Math.max(
    0,
    (data.spendingTotals?.total || 0) || data.monthlyExpenses || 0
  );
  const fixedExpenses = Math.max(0, data.spendingTotals?.fixed || 0);
  const savingsTargetMin = monthlyExpensesTotal * 3;
  const savingsTargetMax = monthlyExpensesTotal * 6;
  const entryMap = entries.reduce((map, entry) => {
    map[entry.key] = entry;
    return map;
  }, {});
  const assets = formData?.assets || {};
  const resolveAssetSum = (keys = []) =>
    keys.reduce((sum, key) => sum + Math.max(0, toNumber(assets[key])), 0);
  const accountBalance = resolveAssetSum([
    "currentAccount",
    "compteCourant",
    "paymentAccount",
    "checking",
    "paymentBalance",
  ]);
  const savingsBalance = resolveAssetSum([
    "securitySavings",
    "securityBalance",
    "savingsAccount",
    "savings",
    "epargne",
  ]);
  const planDebug = data.allocation?.debug || {};
  const currentTarget = Math.max(0, planDebug.currentTarget || 0);
  const savingsTargets = planDebug.savingsTargets || {};
  const savingsLimit = Math.max(0, savingsTargets.targetAmount || 0);
  const distributionEntries = [];
  if (entryMap.compteCourant) {
    const fixedTargetText = fixedExpenses
      ? `${formatCurrency(fixedExpenses)} (1 x les dépenses fixes)`
      : "ton objectif de trésorerie quotidienne";
    distributionEntries.push({
      key: "compteCourant",
      title: "Compte courant",
      amount: entryMap.compteCourant.amount,
      description: `Atteindre ${fixedTargetText}.`,
    });
  }
  if (entryMap.securite) {
    const savingsTargetText = monthlyExpensesTotal
      ? `entre ${formatCurrency(savingsTargetMin)} et ${formatCurrency(
          savingsTargetMax
        )} (3 à 6 mois de dépenses)`
      : "l’objectif recommandé par SmartSave pour renforcer ton épargne";
    distributionEntries.push({
      key: "securite",
      title: "Épargne",
      amount: entryMap.securite.amount,
      description: `Atteindre ${savingsTargetText}.`,
    });
  }
  if (entryMap.impots) {
    const taxTargetText = taxTargetValue
      ? `${formatCurrency(taxTargetValue)} (provision fiscale estimée par SmartSave)`
      : "ta provision fiscale estimée par SmartSave";
    distributionEntries.push({
      key: "impots",
      title: "Impôts & charges",
      amount: entryMap.impots.amount,
      description: `Atteindre ${taxTargetText}.`,
    });
  }
  if (entryMap.investissements) {
    distributionEntries.push({
      key: "investissements",
      title: "Investissements",
      amount: entryMap.investissements.amount,
      description: "Faire fructifier le surplus sur le long terme.",
    });
  }
  if (entryMap.pilier3a) {
    distributionEntries.push({
      key: "pilier3a",
      title: "3e pilier",
      amount: entryMap.pilier3a.amount,
      description: "Optimiser la fiscalité et approcher le plafond annuel.",
    });
  }
  if (currentTarget > 0 && accountBalance > currentTarget) {
    const overflowAmount = accountBalance - currentTarget;
    const overflowDestination = entryMap.investissements
      ? "tes investissements"
      : entryMap.pilier3a
      ? "ton 3e pilier"
      : entryMap.securite
      ? "ton compte épargne"
      : "des placements plus rentables";
    distributionEntries.push({
      key: "overflow-compteCourant",
      title: "Optimiser compte courant",
      amount: overflowAmount,
      description: `Déplacer vers ${overflowDestination} pour éviter que l’argent dorme.`,
    });
  }
  if (savingsLimit > 0 && savingsBalance >= savingsLimit) {
    const savingsOverflow = Math.max(0, savingsBalance - savingsLimit);
    const nextDestination = entryMap.investissements
      ? "tes investissements"
      : entryMap.pilier3a
      ? "ton 3e pilier"
      : "tes objectifs long terme";
    const savingsMention =
      savingsOverflow > 0
        ? ` (${formatCurrency(savingsBalance)} contre ${formatCurrency(savingsLimit)})`
        : ` (${formatCurrency(savingsBalance)} atteint)`;
    const recommendation =
      savingsOverflow > 0
        ? `déplace ${formatCurrency(savingsOverflow)} `
        : "dirige tout surplus ";
    distributionEntries.push({
      key: "overflow-epargne",
      title: "Optimiser épargne",
      amount: savingsOverflow > 0 ? savingsOverflow : null,
      description: `Diriger le surplus vers ${nextDestination} pour mieux le faire fructifier.`,
    });
  }

  const totalAllocated = entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (planIntroNode) {
    planIntroNode.textContent = totalAllocated
      ? `Répartis tes ${formatCurrency(totalAllocated)} de surplus mensuel de la manière suivante :`
      : "SmartSave prépare ta répartition dès que tu auras renseigné suffisamment d'informations.";
  }
  if (planDistributionNode) {
    if (distributionEntries.length) {
      setupPlanActionsChecklist(planDistributionNode, distributionEntries);
      planDistributionNode.classList.remove("plan-actions__distribution--hidden");
    } else {
      planDistributionNode.innerHTML = "";
      planDistributionNode.classList.add("plan-actions__distribution--hidden");
    }
  }
  if (planLogicNode) {
    planLogicNode.textContent = totalAllocated
      ? `SmartSave répartit ${formatCurrency(totalAllocated)} ce mois afin de couvrir tes charges immédiates, alimenter tes objectifs et anticiper les échéances.`
      : "SmartSave prépare ta répartition dès que tu auras renseigné suffisamment d'informations.";
  }

}

function renderSpendingAnalysis(data) {
  const analysis = data?.spendingAnalysis;
  const panel = document.querySelector("[data-spending-analysis-panel]");
  if (!panel) return;
  panel.dataset.state = analysis ? "filled" : "empty";
  const metrics = analysis?.metrics || {};
  const totalsFallback = data.spendingTotals || {};
  const fillText = (selector, text) => {
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = text;
    });
  };
  const breakdownEntries = {
    fixed: analysis?.breakdown?.fixed || [],
    variable: analysis?.breakdown?.variable || [],
    exceptional:
      analysis?.breakdown?.categories?.filter((entry) => /exceptionnel/i.test(entry?.label || "")) || [],
  };
  const metricKeys = {
    fixed: "fixedExpensesMonthly",
    variable: "variableExpensesMonthly",
    exceptional: "exceptionalExpensesMonthly",
  };
  const resolveValue = (key) => {
    const metricValue = Number.isFinite(metrics[metricKeys[key]]) ? metrics[metricKeys[key]] : null;
    const fallbackValue = Number.isFinite(totalsFallback[key]) ? totalsFallback[key] : null;
    return Math.max(0, metricValue ?? fallbackValue ?? 0);
  };
  const categories = [
    { key: "fixed", label: "Fixes", value: resolveValue("fixed") },
    { key: "variable", label: "Variables", value: resolveValue("variable") },
    { key: "exceptional", label: "Exceptionnelles", value: resolveValue("exceptional") },
  ];
  const total = Number.isFinite(totalsFallback.total)
    ? totalsFallback.total
    : categories.reduce((sum, cat) => sum + cat.value, 0);
  categories.forEach((cat) => {
    const amountNode = document.querySelector(`[data-analysis-amount="${cat.key}"]`);
    const shareNode = document.querySelector(`[data-analysis-share="${cat.key}"]`);
    const barNode = document.querySelector(`[data-analysis-bar="${cat.key}"]`);
    const share = total > 0 ? Math.round((cat.value / total) * 100) : 0;
    if (amountNode) amountNode.textContent = formatCurrency(cat.value);
    if (shareNode) shareNode.textContent = `${share}%`;
    if (barNode) barNode.style.width = `${share}%`;
  });
  fillText("[data-spending-total]", formatCurrency(total));
  const fixedRatio = Number.isFinite(metrics.fixedRatio) ? metrics.fixedRatio : 0;
  const variableRatio = Number.isFinite(metrics.variableRatio) ? metrics.variableRatio : 0;
  const exceptionalRatio = Number.isFinite(metrics.exceptionalRatio) ? metrics.exceptionalRatio : 0;
  const exceptionalAmount = Number.isFinite(metrics.exceptionalExpensesMonthly)
    ? metrics.exceptionalExpensesMonthly
    : 0;
  const topCategory = analysis?.breakdown?.largestCategory;
  const concentrationPercent =
    topCategory && total > 0 ? Math.round((topCategory.value / total) * 100) : 0;
  const fixedSentence =
    fixedRatio > 0.55
      ? `Les charges fixes dépassent ${formatPercentage(fixedRatio)} du revenu.`
      : `Tes charges fixes représentent ${formatPercentage(fixedRatio)} du revenu et restent maîtrisées.`;
  const variableSentence =
    variableRatio > 0.35
      ? `Les dépenses variables sont élevées (${formatPercentage(variableRatio)} du revenu).`
      : `Les dépenses variables sont bien maîtrisées (${formatPercentage(variableRatio)} du revenu).`;
  const concentrationSentence =
    concentrationPercent > 0
      ? `${topCategory.label} concentre ${concentrationPercent}% de tes dépenses.`
      : "";
  const exceptionalSentence = exceptionalAmount
    ? `Les dépenses exceptionnelles représentent ${formatPercentage(exceptionalRatio)} du revenu.`
    : "Aucune dépense exceptionnelle récurrente n’a été identifiée.";
  const analysisText = [fixedSentence, variableSentence, concentrationSentence || exceptionalSentence]
    .filter(Boolean)
    .join(" ");
  fillText("[data-analysis-insights-text]", analysisText);
  const variableCategory = categories.find((cat) => cat.key === "variable");
  const variableAmount = variableCategory?.value || 0;
  const leverText =
    variableRatio > 0.35 && variableAmount > 0
      ? `Une réduction de 10% des dépenses variables pourrait libérer environ ${formatCurrency(
          Math.round(variableAmount * 0.1)
        )} par mois.`
      : "Tes dépenses sont bien équilibrées. Un suivi mensuel permet de conserver cet équilibre.";
  fillText("[data-analysis-levers-text]", leverText);
  const typeEntries = {
    fixed: prepareCategoryEntries(breakdownEntries.fixed),
    variable: prepareCategoryEntries(breakdownEntries.variable),
    exceptional: prepareCategoryEntries(breakdownEntries.exceptional),
  };
  Object.entries(typeEntries).forEach(([key, entries]) => {
    const legendEntries = renderTypePie(key, entries, SPENDING_PIE_PALETTES[key]);
    const typeTotal = categories.find((cat) => cat.key === key)?.value || 0;
    renderCategoryList(key, entries, typeTotal, legendEntries);
  });
  setupCategoryToggleHandlers();
}

function setupAiCoach() {
  const button = document.querySelector("[data-ai-coach]");
  const output = document.querySelector("[data-ai-coach-output]");
  if (!button || !output) return;

  button.addEventListener("click", async () => {
    button.disabled = true;
    output.textContent = "Analyse…";
    const activeUser = loadActiveUser();
    const snapshot =
      window.__SMARTSAVE_LAST_SNAPSHOT__ || (activeUser ? loadSnapshot(activeUser.id) : null);

    let result;
    try {
      result = await requestAiCoach(snapshot);
    } catch (_error) {
      result = buildCoachFallbackResult(snapshot);
    }
    output.innerHTML = "";

    const summary = document.createElement("p");
    summary.textContent = result.summary || COACH_FALLBACK_MESSAGE;
    output.appendChild(summary);

    if (Array.isArray(result.actions) && result.actions.length) {
      const list = document.createElement("ul");
      result.actions.slice(0, 5).forEach((action) => {
        const item = document.createElement("li");
        const title = action?.title ? `${action.title} — ` : "";
        item.textContent = `${title}${action?.description || ""}`.trim();
        list.appendChild(item);
      });
      output.appendChild(list);
    }

    if (Array.isArray(result.warnings) && result.warnings.length) {
      const warn = document.createElement("p");
      warn.textContent = result.warnings.join(" · ");
      output.appendChild(warn);
    }

    button.disabled = false;
  });
}

function setupDebugPanel(snapshot) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("debug") !== "1") return;
  if (window.SMARTSAVE_RUNTIME) {
    window.SMARTSAVE_RUNTIME.debug = window.SMARTSAVE_RUNTIME.debug || {};
    window.SMARTSAVE_RUNTIME.debug.enabled = true;
  }
  if (!snapshot) return;

  const panel = document.createElement("div");
  panel.className = "card";
  panel.style.margin = "1.5rem auto";
  panel.style.maxWidth = "960px";
  panel.style.padding = "1rem 1.2rem";
  panel.style.border = "1px dashed rgba(15, 23, 42, 0.25)";
  panel.style.background = "rgba(255, 255, 255, 0.9)";

  const meta = snapshot.meta || {};
  const calcMeta = snapshot.calcMeta || {};
  const metrics = snapshot.outputs?.keyMetrics || {};
  const projectionSummary = snapshot.outputs?.projectionSummary || {};
  const aiPayload = {
    event: "aiCoach",
    agentName: "coach",
    snapshot: {
      meta: {
        monthKey: meta.monthKey,
        userId: meta.userId,
        createdAtISO: meta.createdAtISO,
      },
      calcMeta: {
        snapshotVersion: calcMeta.snapshotVersion,
      },
      outputs: {
        keyMetrics: {
          income: metrics.income,
          expenses: metrics.expenses,
          surplus: metrics.surplus,
          liquidity: metrics.liquidity,
          safetyMonths: metrics.safetyMonths,
        },
        projectionSummary,
      },
    },
  };

  panel.innerHTML = `
    <h3 style="margin-bottom:0.5rem;">Debug Snapshot</h3>
    <p style="margin:0.15rem 0;">Month: ${meta.monthKey || "—"}</p>
    <p style="margin:0.15rem 0;">Created: ${meta.createdAtISO || "—"}</p>
    <p style="margin:0.15rem 0;">Snapshot version: ${calcMeta.snapshotVersion || "—"}</p>
    <p style="margin:0.15rem 0;">Projection gain: ${formatCurrency(projectionSummary.gain || 0)}</p>
    <div style="margin-top:0.75rem;">
      <strong>Key metrics</strong>
      <ul style="margin:0.35rem 0 0 1.2rem;">
        <li>Income: ${formatCurrency(metrics.income || 0)}</li>
        <li>Expenses: ${formatCurrency(metrics.expenses || 0)}</li>
        <li>Surplus: ${formatCurrency(metrics.surplus || 0)}</li>
        <li>Liquidity: ${formatCurrency(metrics.liquidity || 0)}</li>
        <li>Safety months: ${Number.isFinite(metrics.safetyMonths) ? metrics.safetyMonths.toFixed(1) : "0"}</li>
      </ul>
    </div>
    <div style="margin-top:0.75rem;">
      <strong>AI payload (debug)</strong>
      <pre style="white-space:pre-wrap; margin-top:0.35rem;">${JSON.stringify(aiPayload, null, 2)}</pre>
    </div>
  `;

  const main = document.querySelector("main") || document.body;
  main.appendChild(panel);
}

function prepareCategoryEntries(entries = []) {
  return ensureArray(entries)
    .map(normalizeCategoryEntry)
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function normalizeCategoryEntry(entry = {}) {
  const label =
    entry?.label ||
    entry?.name ||
    entry?.description ||
    entry?.category ||
    entry?.type ||
    "Autre";
  const amount = toNumber(entry?.amount ?? entry?.value ?? entry?.montant ?? entry?.expense);
  return { label, amount };
}

function renderTypePie(key, entries = [], palette = []) {
  const chart = document.querySelector(`[data-analysis-pie-chart="${key}"]`);
  const emptyNode = document.querySelector(`[data-analysis-pie-empty="${key}"]`);
  if (!chart) return [];
  if (!entries.length) {
    chart.style.background = "";
    chart.classList.remove("is-filled");
    chart.removeAttribute("role");
    if (emptyNode) emptyNode.hidden = false;
    return [];
  }
  const { gradient, legend } = buildPieVisual(entries, palette);
  if (emptyNode) emptyNode.hidden = true;
  chart.style.background = gradient || "";
  chart.classList.add("is-filled");
  chart.setAttribute("role", "img");
  chart.setAttribute(
    "aria-label",
    `Répartition des ${SPENDING_TYPE_LABELS[key] || key}`
  );
  return legend;
}

const CATEGORY_PREVIEW_LIMIT = 3;

function renderCategoryList(key, entries = [], totalAmount = 0, legendEntries = []) {
  const listNode = document.querySelector(`[data-analysis-category-list="${key}"]`);
  const toggle = document.querySelector(`[data-analysis-category-toggle="${key}"]`);
  if (!listNode) return;
  const normalized =
    Array.isArray(entries) && entries.every((item) => Number.isFinite(item?.amount))
      ? entries
      : prepareCategoryEntries(entries);
  if (!normalized.length) {
    const message =
      totalAmount > 0
        ? "Les dépenses sont renseignées globalement sans détail par catégorie."
        : "Aucune dépense renseignée";
    listNode.innerHTML = `<li class="analysis-panel__category-item analysis-panel__category-item-empty">${message}</li>`;
    listNode.classList.remove("is-expanded");
    if (toggle) {
      toggle.hidden = true;
      toggle.dataset.expanded = "false";
    }
    return;
  }
  const normalizedWithColor = normalized.map((item, index) => ({
    ...item,
    color: legendEntries?.[index]?.color,
  }));
  const renderItem = (item, isExtra = false) => `
    <li class="analysis-panel__category-item${isExtra ? " analysis-panel__category-item--extra" : ""}">
      <span class="analysis-panel__category-meta">
        ${item.color ? `<span class="analysis-panel__category-color" style="background:${item.color}"></span>` : ""}
        <span>${item.label}</span>
      </span>
      <strong>${formatCurrency(item.amount)}</strong>
    </li>`;
  const primary = normalizedWithColor.slice(0, CATEGORY_PREVIEW_LIMIT);
  const extra = normalizedWithColor.slice(CATEGORY_PREVIEW_LIMIT);
  listNode.innerHTML =
    primary.map((item) => renderItem(item)).join("") +
    extra.map((item) => renderItem(item, true)).join("");
  listNode.classList.remove("is-expanded");
  if (toggle) {
    if (extra.length) {
      toggle.hidden = false;
      toggle.textContent = "Voir +";
      toggle.dataset.expanded = "false";
    } else {
      toggle.hidden = true;
      toggle.dataset.expanded = "false";
    }
  }
}

function setupCategoryToggleHandlers() {
  document.querySelectorAll("[data-analysis-category-toggle]").forEach((button) => {
    const key = button.dataset.analysisCategoryToggle;
    if (!key) return;
    const list = document.querySelector(`[data-analysis-category-list="${key}"]`);
    if (!list) return;
    if (button._spendingAnalysisToggleHandler) {
      button.removeEventListener("click", button._spendingAnalysisToggleHandler);
    }
    const handler = () => {
      const expanded = list.classList.toggle("is-expanded");
      button.textContent = expanded ? "Voir -" : "Voir +";
      button.dataset.expanded = expanded ? "true" : "false";
    };
    button._spendingAnalysisToggleHandler = handler;
    button.addEventListener("click", handler);
  });
}

function renderResilienceTab(data, formData = {}) {
  const panel = document.querySelector("[data-tab-panel='resilience']");
  if (!panel) return;
  const state = ensureResilienceState(panel);
  state.data = data;
  state.formData = formData;
  if (!state.bound) {
    bindResilienceInteractions(state);
    state.bound = true;
    panel.dataset.resilienceBound = "1";
  }
  updateResilienceSnapshot(state);
  renderResilienceEventsList(state);
  runResilienceScenario(state);
  renderScenarioImpact(data, formData, panel);
}

function ensureResilienceState(panel) {
  if (panel._resilienceState) return panel._resilienceState;
  const nodes = {
    statusCard: panel.querySelector("[data-resilience-diagnosis]"),
    statusNode: panel.querySelector("[data-resilience-status]"),
    statusTitleNode: panel.querySelector("[data-resilience-status-title]"),
    statusCopyNode: panel.querySelector("[data-resilience-status-copy]"),
    incomeNode: panel.querySelector("[data-resilience-income]"),
    fixedNode: panel.querySelector("[data-resilience-fixed]"),
    variableNode: panel.querySelector("[data-resilience-variable]"),
    taxNode: panel.querySelector("[data-resilience-tax]"),
    debtNode: panel.querySelector("[data-resilience-debt]"),
    liquidityNode: panel.querySelector("[data-resilience-liquidity]"),
    runwayNode: panel.querySelector("[data-resilience-runway]"),
    capacityNode: panel.querySelector("[data-resilience-shock-capacity]"),
    assumptionIncomeNode: panel.querySelector("[data-resilience-assumption-income]"),
    assumptionSpendingNode: panel.querySelector("[data-resilience-assumption-spending]"),
    assumptionHorizonNode: panel.querySelector("[data-resilience-assumption-horizon]"),
    assumptionTaxNode: panel.querySelector("[data-resilience-assumption-tax]"),
    incomeSlider: panel.querySelector("[data-resilience-income-slider]"),
    fixedSlider: panel.querySelector("[data-resilience-fixed-slider]"),
    variableSlider: panel.querySelector("[data-resilience-variable-slider]"),
    incomeLabel: panel.querySelector("[data-resilience-income-label]"),
    fixedLabel: panel.querySelector("[data-resilience-fixed-label]"),
    variableLabel: panel.querySelector("[data-resilience-variable-label]"),
    incomeAmountNode: panel.querySelector("[data-resilience-income-amount]"),
    fixedAmountNode: panel.querySelector("[data-resilience-fixed-amount]"),
    variableAmountNode: panel.querySelector("[data-resilience-variable-amount]"),
    horizonButtons: Array.from(panel.querySelectorAll("[data-resilience-horizon-button]")),
    taxModeInputs: Array.from(panel.querySelectorAll("[data-resilience-tax-mode]")),
    taxMonthlyToggle: panel.querySelector("[data-resilience-tax-monthly]"),
    taxMonthSelect: panel.querySelector("[data-resilience-tax-month]"),
    taxSettings: panel.querySelector("[data-resilience-tax-settings]"),
    taxRuleNode: panel.querySelector("[data-resilience-tax-rule]"),
    eventsList: panel.querySelector("[data-resilience-events-list]"),
    addEventButton: panel.querySelector("[data-resilience-event-add]"),
    summaryNode: panel.querySelector("[data-resilience-scenario-summary]"),
    kpiRunwayNode: panel.querySelector("[data-resilience-kpi-runway]"),
    kpiDeltaNode: panel.querySelector("[data-resilience-kpi-delta]"),
    kpiSecurityNode: panel.querySelector("[data-resilience-kpi-security-months]"),
    kpiShortfallNode: panel.querySelector("[data-resilience-kpi-shortfall]"),
    cashInitialNode: panel.querySelector("[data-resilience-cash-initial]"),
    monthlySurplusNode: panel.querySelector("[data-resilience-monthly-surplus]"),
    shortfallMonthNode: panel.querySelector("[data-resilience-shortfall-month]"),
    missingAmountNode: panel.querySelector("[data-resilience-missing-amount]"),
    projectionBody: panel.querySelector("[data-resilience-projection-body]"),
    projectionToggle: panel.querySelector("[data-resilience-projection-toggle]"),
    endBalanceNode: panel.querySelector("[data-resilience-end-balance]"),
    shortfallNode: panel.querySelector("[data-resilience-shortfall]"),
    baselinePath: panel.querySelector("[data-resilience-baseline-path]"),
    scenarioPath: panel.querySelector("[data-resilience-scenario-path]"),
    zeroLine: panel.querySelector("[data-resilience-zero-line]"),
    shortfallMarker: panel.querySelector("[data-resilience-shortfall-marker]"),
    axisGroup: panel.querySelector("[data-resilience-axis]"),
    actionsList: panel.querySelector("[data-resilience-actions]"),
    verdictNode: panel.querySelector("[data-resilience-scenario-verdict]"),
    verdictDetailNode: panel.querySelector("[data-resilience-scenario-verdict-detail]"),
    advancedToggle: panel.querySelector("[data-resilience-advanced-toggle]"),
    advancedPanel: panel.querySelector("[data-resilience-advanced-panel]"),
    debugNode: panel.querySelector("[data-resilience-debug]"),
    debugOutput: panel.querySelector("[data-resilience-debug-output]"),
  };
  const state = {
    nodes,
    scenarioState: {
      incomeShockPct: -0.2,
      fixedShockPct: 0.1,
      variableShockPct: 0.15,
      horizon: 6,
      taxMode: "prudent",
      taxPaymentMode: "monthly",
      taxPaymentMonth: 3,
      events: [],
    },
    bound: false,
    data: null,
    formData: null,
    baseline: null,
    lastResult: null,
    nextEventId: 1,
    projectionExpanded: false,
    projectionBaseline: null,
  };
  setResilienceHorizon(state, 6);
  panel._resilienceState = state;
  return state;
}

function bindResilienceInteractions(state) {
  const { nodes, scenarioState } = state;
  const trigger = () => {
    updateResilienceSnapshot(state);
    runResilienceScenario(state);
  };
  nodes.incomeSlider?.addEventListener("input", () => {
    scenarioState.incomeShockPct = clamp((Number(nodes.incomeSlider.value) || 0) / 100, -1, 0.5);
    trigger();
  });
  nodes.fixedSlider?.addEventListener("input", () => {
    scenarioState.fixedShockPct = clamp((Number(nodes.fixedSlider.value) || 0) / 100, -0.3, 0.7);
    trigger();
  });
  nodes.variableSlider?.addEventListener("input", () => {
    scenarioState.variableShockPct = clamp((Number(nodes.variableSlider.value) || 0) / 100, -0.5, 0.8);
    trigger();
  });
  nodes.horizonButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setResilienceHorizon(state, Number(button.dataset.horizon) || scenarioState.horizon);
      state.projectionExpanded = false;
      trigger();
    });
  });
  nodes.taxModeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) scenarioState.taxMode = input.value;
      updateResilienceTaxDisplay(state);
      trigger();
    });
  });
  nodes.taxMonthlyToggle?.addEventListener("change", () => {
    scenarioState.taxPaymentMode = nodes.taxMonthlyToggle.checked ? "monthly" : "lump";
    updateResilienceTaxDisplay(state);
    trigger();
  });
  nodes.taxMonthSelect?.addEventListener("change", () => {
    scenarioState.taxPaymentMonth = Math.max(1, Number(nodes.taxMonthSelect.value) || 1);
    updateResilienceTaxDisplay(state);
    trigger();
  });
  nodes.addEventButton?.addEventListener("click", () => {
    addResilienceEvent(state);
    trigger();
  });
  if (nodes.eventsList && !nodes.eventsList.dataset.eventsBound) {
    nodes.eventsList.addEventListener("input", (event) => {
      handleResilienceEventInput(state, event);
      trigger();
    });
    nodes.eventsList.addEventListener("click", (event) => {
      handleResilienceEventClick(state, event);
      trigger();
    });
    nodes.eventsList.dataset.eventsBound = "1";
  }
  if (nodes.advancedToggle && nodes.advancedPanel) {
    nodes.advancedToggle.addEventListener("click", () => {
      const isOpen = nodes.advancedPanel.hidden;
      nodes.advancedPanel.hidden = !isOpen;
      nodes.advancedToggle.setAttribute("aria-expanded", String(isOpen));
      nodes.advancedToggle.textContent = isOpen
        ? "Réduire la simulation avancée"
        : "🔧 Personnaliser le scénario";
    });
  }
  nodes.projectionToggle?.addEventListener("click", () => {
    state.projectionExpanded = !state.projectionExpanded;
    if (state.lastResult) {
      updateScenarioProjection(state, state.lastResult);
    }
  });
  updateResilienceTaxDisplay(state);
}

function setResilienceHorizon(state, months) {
  const nodes = state.nodes;
  const normalized = Number(months) || 0;
  const horizon = normalized > 0 ? normalized : state.scenarioState.horizon || 6;
  state.scenarioState.horizon = horizon;
  nodes.horizonButtons.forEach((button) => {
    const buttonValue = Number(button.dataset.horizon) || 0;
    button.classList.toggle("is-active", buttonValue === horizon);
  });
}

function updateResilienceSnapshot(state) {
  const { nodes, data, formData, scenarioState } = state;
  const baseline = deriveResilienceBaseline(data, formData, scenarioState);
  state.baseline = baseline;
  if (nodes.incomeNode) nodes.incomeNode.textContent = formatCurrency(baseline.incomeMonthly);
  if (nodes.fixedNode) nodes.fixedNode.textContent = formatCurrency(baseline.spendingFixed);
  if (nodes.variableNode) nodes.variableNode.textContent = formatCurrency(baseline.spendingVariable);
  if (nodes.taxNode) nodes.taxNode.textContent = formatCurrency(baseline.taxMonthly);
  if (nodes.debtNode) nodes.debtNode.textContent = formatCurrency(baseline.debtMonthly);
  if (nodes.liquidityNode) nodes.liquidityNode.textContent = formatCurrency(baseline.cashUsable);
  if (nodes.runwayNode) nodes.runwayNode.textContent = formatRunwayValue(baseline.runway);
  if (nodes.capacityNode) {
    const capacityPct = resolveShockCapacityPct(baseline);
    nodes.capacityNode.textContent = `${Math.round(capacityPct * 100)}%`;
  }
  const essentialOutflow = baseline.spendingFixed + baseline.taxMonthly + baseline.debtMonthly;
  const runwayValue = essentialOutflow
    ? baseline.cashUsable / Math.max(1, essentialOutflow)
    : baseline.cashUsable
    ? Infinity
    : 0;
  const deltaMonthly =
    baseline.incomeMonthly -
    (baseline.spendingFixed + baseline.spendingVariable + baseline.taxMonthly + baseline.debtMonthly);
  const securityBalance = resolveSecurityBalance(formData?.assets || {}, data?.allocation || {});
  const securityMonths =
    baseline.spendingFixed > 0 ? securityBalance / baseline.spendingFixed : null;
  if (nodes.kpiRunwayNode) {
    nodes.kpiRunwayNode.textContent = formatRunwayValue(runwayValue);
  }
  if (nodes.kpiDeltaNode) {
    nodes.kpiDeltaNode.textContent = formatSignedCurrency(deltaMonthly);
  }
  if (nodes.kpiSecurityNode) {
    nodes.kpiSecurityNode.textContent = Number.isFinite(securityMonths)
      ? `${securityMonths.toFixed(1)} mois`
      : "—";
  }
  updateResilienceAssumptions(state);
  updateScenarioAmounts(state);
  updateResilienceTaxDisplay(state);
  renderResilienceActions(state);
}

function deriveResilienceBaseline(data = {}, formData = {}, scenarioState = {}) {
  const spendingTotals = data.spendingTotals || {};
  const incomeMonthly = Number.isFinite(data.metrics?.monthlyNetIncome)
    ? data.metrics.monthlyNetIncome
    : 0;
  const spendingFixed = Math.max(0, spendingTotals.fixed ?? 0);
  const spendingVariable = Math.max(0, spendingTotals.variable ?? 0);
  const taxMonthly = Math.max(
    0,
    data.taxProvision?.monthlyAmount ?? data.taxProvision?.monthlyNeed ?? 0
  );
  const taxTotal = Math.max(
    0,
    toNumber(
      data.taxProvision?.totalTax ??
        data.taxProvision?.remaining ??
        data.taxProvision?.outstanding ??
        0
    )
  );
  const taxProvision = Math.max(
    0,
    toNumber(data.taxProvision?.currentProvision ?? formData?.assets?.taxProvision ?? 0)
  );
  const debtMonthly = Math.max(0, data.debtMonthly || 0);
  const cashCore = computeCashAssets(formData?.assets || {});
  const cashUsable = cashCore + (scenarioState.taxMode === "cashflow" ? taxProvision : 0);
  const monthlyCoreOutflow =
    spendingFixed +
    debtMonthly +
    (scenarioState.taxMode === "cashflow" && scenarioState.taxPaymentMode === "monthly"
      ? taxMonthly
      : 0);
  const runway = monthlyCoreOutflow
    ? cashUsable / Math.max(1, monthlyCoreOutflow)
    : cashUsable
    ? Infinity
    : 0;
  const capacity = Math.max(0, cashUsable - spendingFixed);
  return {
    incomeMonthly,
    spendingFixed,
    spendingVariable,
    taxMonthly,
    taxTotal,
    taxProvision,
    debtMonthly,
    cashUsable,
    cashCore,
    monthlyCoreOutflow,
    runway,
    capacity,
  };
}

function getMonthsLabel(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} mois` : "—";
}

function formatRunwayValue(value) {
  if (!Number.isFinite(value)) return "∞";
  return getMonthsLabel(value);
}

function runResilienceScenario(state) {
  if (!state.baseline) return;
  const projectionResult = simulateResilienceProjection(state);
  state.lastResult = projectionResult.scenario;
  state.projectionBaseline = projectionResult.baseline;
  updateScenarioLabels(state);
  updateScenarioSummary(state, state.lastResult);
  updateScenarioProjection(state, state.lastResult);
  updateScenarioStats(state, state.lastResult);
  updateResilienceDiagnosis(state, state.lastResult);
  updateResilienceDebug(state, state.lastResult);
  renderResilienceChart(state, state.lastResult);
}

function renderScenarioImpact(data, formData, panel) {
  const host = panel || document.querySelector("[data-tab-panel='resilience']");
  if (!host) return;
  const state = ensureImpactState(host);
  state.data = data;
  state.formData = formData;
  if (!state.bound) {
    bindImpactInteractions(state);
    state.bound = true;
  }
  updateImpactProjection(state);
}

function ensureImpactState(panel) {
  if (panel._impactState) return panel._impactState;
  const nodes = {
    variableSlider: panel.querySelector("[data-impact-variable-slider]"),
    fixedSlider: panel.querySelector("[data-impact-fixed-slider]"),
    incomeSlider: panel.querySelector("[data-impact-income-slider]"),
    variableLabel: panel.querySelector("[data-impact-variable-label]"),
    fixedLabel: panel.querySelector("[data-impact-fixed-label]"),
    incomeLabel: panel.querySelector("[data-impact-income-label]"),
    presetButtons: Array.from(panel.querySelectorAll("[data-impact-preset]")),
    baselineNode: panel.querySelector("[data-impact-baseline]"),
    scenarioNode: panel.querySelector("[data-impact-scenario]"),
    deltaNode: panel.querySelector("[data-impact-delta]"),
    noteNode: panel.querySelector("[data-impact-note]"),
    baselinePath: panel.querySelector("[data-impact-baseline-path]"),
    scenarioPath: panel.querySelector("[data-impact-scenario-path]"),
    axisGroup: panel.querySelector("[data-impact-axis]"),
  };
  const state = {
    nodes,
    scenarioState: {
      variableReductionPct: 0,
      fixedReductionPct: 0,
      incomeIncreasePct: 0,
    },
    bound: false,
    data: null,
    formData: null,
    scenarioProjection: null,
  };
  panel._impactState = state;
  return state;
}

function bindImpactInteractions(state) {
  const { nodes, scenarioState } = state;
  const trigger = () => updateImpactProjection(state);
  nodes.variableSlider?.addEventListener("input", () => {
    scenarioState.variableReductionPct = clamp(
      (Number(nodes.variableSlider.value) || 0) / 100,
      0,
      0.3
    );
    updateImpactLabels(state);
    trigger();
  });
  nodes.fixedSlider?.addEventListener("input", () => {
    scenarioState.fixedReductionPct = clamp(
      (Number(nodes.fixedSlider.value) || 0) / 100,
      0,
      0.15
    );
    updateImpactLabels(state);
    trigger();
  });
  nodes.incomeSlider?.addEventListener("input", () => {
    scenarioState.incomeIncreasePct = clamp(
      (Number(nodes.incomeSlider.value) || 0) / 100,
      0,
      0.2
    );
    updateImpactLabels(state);
    trigger();
  });
  nodes.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyImpactPreset(state, button.dataset.impactPreset);
      trigger();
    });
  });
  updateImpactLabels(state);
}

function applyImpactPreset(state, preset) {
  const { nodes, scenarioState } = state;
  if (preset === "light") {
    scenarioState.variableReductionPct = 0.1;
    scenarioState.fixedReductionPct = 0.05;
    scenarioState.incomeIncreasePct = 0;
  } else if (preset === "strong") {
    scenarioState.variableReductionPct = 0.2;
    scenarioState.fixedReductionPct = 0.1;
    scenarioState.incomeIncreasePct = 0.05;
  } else if (preset === "income") {
    scenarioState.variableReductionPct = 0;
    scenarioState.fixedReductionPct = 0;
    scenarioState.incomeIncreasePct = 0.1;
  }
  if (nodes.variableSlider) {
    nodes.variableSlider.value = Math.round(scenarioState.variableReductionPct * 100);
  }
  if (nodes.fixedSlider) {
    nodes.fixedSlider.value = Math.round(scenarioState.fixedReductionPct * 100);
  }
  if (nodes.incomeSlider) {
    nodes.incomeSlider.value = Math.round(scenarioState.incomeIncreasePct * 100);
  }
  updateImpactLabels(state);
}

function updateImpactLabels(state) {
  const { nodes, scenarioState } = state;
  if (nodes.variableLabel) {
    nodes.variableLabel.textContent = `${Math.round(scenarioState.variableReductionPct * 100)}%`;
  }
  if (nodes.fixedLabel) {
    nodes.fixedLabel.textContent = `${Math.round(scenarioState.fixedReductionPct * 100)}%`;
  }
  if (nodes.incomeLabel) {
    nodes.incomeLabel.textContent = `${Math.round(scenarioState.incomeIncreasePct * 100)}%`;
  }
}

function updateImpactProjection(state) {
  const { data, formData, scenarioState, nodes } = state;
  const projectionEngine = window.ProjectionEngine;
  if (!projectionEngine?.calculateProjection || !formData) return;
  const baselineProjection =
    data?.projection ||
    projectionEngine.calculateProjection(prepareProjectionInput(formData), {
      years: 20,
      keepHistory: true,
    });
  const scenarioProjection = computeScenarioProjection(formData, scenarioState);
  state.scenarioProjection = scenarioProjection;

  const baselineValue = toNumber(baselineProjection?.smartSave?.netWorth);
  const scenarioValue = toNumber(scenarioProjection?.smartSave?.netWorth);
  const delta = scenarioValue - baselineValue;

  if (nodes.baselineNode) nodes.baselineNode.textContent = formatCurrency(baselineValue);
  if (nodes.scenarioNode) nodes.scenarioNode.textContent = formatCurrency(scenarioValue);
  if (nodes.deltaNode) nodes.deltaNode.textContent = formatSignedCurrency(delta);
  if (nodes.noteNode) {
    nodes.noteNode.textContent =
      delta >= 0
        ? `Tu gagnes ${formatCurrency(delta)} en 20 ans.`
        : `Tu perds ${formatCurrency(Math.abs(delta))} en 20 ans.`;
  }

  const baselineSeries = buildProjectionSeries(baselineProjection?.smartSave?.history);
  const scenarioSeries = buildProjectionSeries(scenarioProjection?.smartSave?.history);
  renderImpactChart(baselineSeries, scenarioSeries, nodes);
}

function applyScenarioToFormData(formData = {}, scenario = {}) {
  const clone = JSON.parse(JSON.stringify(formData || {}));
  const variableFactor = 1 - (scenario.variableReductionPct || 0);
  const fixedFactor = 1 - (scenario.fixedReductionPct || 0);
  const incomeFactor = 1 + (scenario.incomeIncreasePct || 0);
  const updateAmount = (entry, factor) => {
    if (!entry) return;
    if (entry.amount != null) entry.amount = toNumber(entry.amount) * factor;
    if (entry.montant != null) entry.montant = toNumber(entry.montant) * factor;
  };
  const expenses = clone.expenses || {};
  ensureArray(expenses.variable).forEach((entry) => updateAmount(entry, variableFactor));
  ensureArray(expenses.fixed).forEach((entry) => updateAmount(entry, fixedFactor));
  const incomes = clone.incomes || {};
  ensureArray(incomes.entries).forEach((entry) => updateAmount(entry, incomeFactor));
  clone.expenses = expenses;
  clone.incomes = incomes;
  return clone;
}

function computeScenarioProjection(formData = {}, scenario = {}) {
  const projectionEngine = window.ProjectionEngine;
  if (!projectionEngine?.calculateProjection) return null;
  const scenarioForm = applyScenarioToFormData(formData, scenario);
  const projectionInput = prepareProjectionInput(scenarioForm);
  return projectionEngine.calculateProjection(projectionInput, { years: 20, keepHistory: true });
}

function renderImpactChart(baselineSeries = [], scenarioSeries = [], nodes = {}) {
  if (!nodes.baselinePath || !nodes.scenarioPath || !nodes.axisGroup) return;
  const svgWidth = 540;
  const svgHeight = 340;
  const margin = { left: 70, right: 24, top: 32, bottom: 86 };
  const chartWidth = svgWidth - margin.left - margin.right;
  const chartHeight = svgHeight - margin.top - margin.bottom;
  const steps = Math.max(baselineSeries.length, scenarioSeries.length, 2);
  const normalizedBaseline = normalizeProjectionSeries(baselineSeries, steps);
  const normalizedScenario = normalizeProjectionSeries(scenarioSeries, steps);
  const rawMaxValue = Math.max(
    ...normalizedBaseline.map((item) => Math.max(item.netWorth, 0)),
    ...normalizedScenario.map((item) => Math.max(item.netWorth, 0)),
    0
  );
  const maxValue = rawMaxValue || 1;

  const plotPoints = (series) =>
    series.map((point, index) => {
      const ratio = maxValue ? point.netWorth / maxValue : 0;
      const rawX = steps === 1 ? chartWidth / 2 : (index / (steps - 1)) * chartWidth;
      const x = margin.left + rawX;
      const y = margin.top + (chartHeight - ratio * chartHeight);
      return { x, y };
    });

  const buildSmoothPath = (points = []) => {
    if (!points.length) return "";
    const segments = points.map((point) => ({ x: point.x, y: point.y }));
    let path = `M ${segments[0].x.toFixed(1)} ${segments[0].y.toFixed(1)}`;
    if (segments.length === 1) return path;
    for (let i = 0; i < segments.length - 1; i++) {
      const p0 = segments[i - 1] || segments[i];
      const p1 = segments[i];
      const p2 = segments[i + 1];
      const p3 = segments[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(
        1
      )} ${p2.y.toFixed(1)}`;
    }
    return path;
  };

  const baselinePoints = plotPoints(normalizedBaseline);
  const scenarioPoints = plotPoints(normalizedScenario);
  nodes.baselinePath.setAttribute("d", buildSmoothPath(baselinePoints));
  nodes.scenarioPath.setAttribute("d", buildSmoothPath(scenarioPoints));

  const axisTicks = 5;
  const yTicks = Array.from({ length: axisTicks }, (_, index) => {
    const ratio = axisTicks === 1 ? 0 : index / (axisTicks - 1);
    const value = Math.max(rawMaxValue * (1 - ratio), 0);
    const y = margin.top + ratio * chartHeight;
    return { value, y };
  });
  const desiredXTicks = 5;
  const lastIndex = Math.max(steps - 1, 1);
  const xTickIndexes = new Set();
  for (let i = 0; i < desiredXTicks; i += 1) {
    const target = (i / (desiredXTicks - 1)) * lastIndex;
    const index = Math.min(Math.max(Math.round(target), 0), steps - 1);
    xTickIndexes.add(index);
  }
  const xTicks = Array.from(xTickIndexes)
    .sort((a, b) => a - b)
    .map((index) => {
      const point = normalizedBaseline[index] || normalizedScenario[index];
      const rawX = steps === 1 ? chartWidth / 2 : (index / lastIndex) * chartWidth;
      const x = margin.left + rawX;
      return { label: formatProjectionLabel(point?.date), x };
    });

  const yTickMarkup = yTicks
    .map(({ value, y }) => {
      const yPos = y.toFixed(1);
      return `
          <g>
            <line class="projection-chart__axis-tick" x1="${margin.left - 6}" x2="${margin.left}" y1="${yPos}" y2="${yPos}"></line>
            <text class="projection-chart__axis-label projection-chart__axis-label--y" x="${margin.left - 10}" y="${yPos}">${formatCurrency(
        value
      )}</text>
          </g>
        `;
    })
    .join("");

  const xLabelY = margin.top + chartHeight + 24;
  const xTickMarkup = xTicks
    .map(({ x, label }) => {
      const xPos = x.toFixed(1);
      return `
          <g>
            <line class="projection-chart__axis-tick" x1="${xPos}" x2="${xPos}" y1="${margin.top + chartHeight}" y2="${
        margin.top + chartHeight + 6
      }"></line>
            <text class="projection-chart__axis-label projection-chart__axis-label--x" x="${xPos}" y="${xLabelY}">${label}</text>
          </g>
        `;
    })
    .join("");

  const xAxisTitleY = margin.top + chartHeight + 60;
  nodes.axisGroup.innerHTML = `
      <line class="projection-chart__axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}"></line>
      <line class="projection-chart__axis-line" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}"></line>
      ${yTickMarkup}
      ${xTickMarkup}
      <text class="projection-chart__axis-title projection-chart__axis-title--x" x="${Math.round(
        margin.left + chartWidth / 2
      )}" y="${xAxisTitleY}">Années</text>
    `;
}

function simulateCashflow(baseline, scenario = {}) {
  const incomePct = Number.isFinite(scenario.incomeShockPct) ? scenario.incomeShockPct : 0;
  const fixedPct = Number.isFinite(scenario.fixedShockPct) ? scenario.fixedShockPct : 0;
  const variablePct = Number.isFinite(scenario.variableShockPct) ? scenario.variableShockPct : 0;
  const horizon = Number(scenario.horizon) || 6;
  const monthlyIncome = baseline.incomeMonthly * Math.max(0, 1 + incomePct);
  const monthlyFixed = baseline.spendingFixed * Math.max(0, 1 + fixedPct);
  const monthlyVariable = baseline.spendingVariable * Math.max(0, 1 + variablePct);
  const monthlyTax =
    scenario.taxMode === "cashflow" && scenario.taxPaymentMode === "monthly"
      ? baseline.taxMonthly
      : 0;
  const monthlyOutflowBase =
    monthlyFixed + monthlyVariable + baseline.debtMonthly + monthlyTax;
  const monthlySurplus = monthlyIncome - monthlyOutflowBase;
  const records = [];
  let cash = Math.max(0, baseline.cashUsable || 0);
  let minCash = cash;
  let minMonth = null;
  let firstShortfallMonth = null;
  for (let month = 1; month <= horizon; month += 1) {
    const eventsTotal = resolveMonthlyEventsTotal(
      scenario,
      baseline,
      month
    );
    const monthlyOutflow = monthlyOutflowBase + eventsTotal;
    cash += monthlyIncome - monthlyOutflow;
    records.push({
      month,
      income: monthlyIncome,
      outflow: monthlyOutflow,
      eventsTotal,
      cashEnd: cash,
    });
    if (firstShortfallMonth == null && cash < 0) {
      firstShortfallMonth = month;
    }
    if (cash < minCash) {
      minCash = cash;
      minMonth = month;
    }
  }
  return {
    records,
    endBalance: cash,
    shortfallMonth: firstShortfallMonth,
    missingAmount: minCash < 0 ? Math.abs(minCash) : 0,
    initialCash: baseline.cashUsable || 0,
    monthlyIncome,
    monthlyOutflowBase,
    monthlySurplus,
    horizon,
  };
}

function updateScenarioLabels(state) {
  const { nodes, scenarioState } = state;
  if (nodes.incomeSlider) {
    nodes.incomeSlider.value = (scenarioState.incomeShockPct * 100).toFixed(0);
  }
  if (nodes.fixedSlider) {
    nodes.fixedSlider.value = (scenarioState.fixedShockPct * 100).toFixed(0);
  }
  if (nodes.variableSlider) {
    nodes.variableSlider.value = (scenarioState.variableShockPct * 100).toFixed(0);
  }
  if (nodes.incomeLabel) {
    nodes.incomeLabel.textContent = formatSignedPercentLabel(scenarioState.incomeShockPct * 100);
  }
  if (nodes.fixedLabel) {
    nodes.fixedLabel.textContent = formatSignedPercentLabel(scenarioState.fixedShockPct * 100);
  }
  if (nodes.variableLabel) {
    nodes.variableLabel.textContent = formatSignedPercentLabel(scenarioState.variableShockPct * 100);
  }
}

function updateScenarioAmounts(state) {
  const { nodes, scenarioState, baseline } = state;
  if (!baseline) return;
  const incomeSim = baseline.incomeMonthly * (1 + scenarioState.incomeShockPct);
  const fixedSim = baseline.spendingFixed * (1 + scenarioState.fixedShockPct);
  const variableSim = baseline.spendingVariable * (1 + scenarioState.variableShockPct);
  if (nodes.incomeAmountNode) {
    nodes.incomeAmountNode.textContent = `${formatCurrency(baseline.incomeMonthly)} → ${formatCurrency(
      incomeSim
    )}`;
  }
  if (nodes.fixedAmountNode) {
    nodes.fixedAmountNode.textContent = `${formatCurrency(baseline.spendingFixed)} → ${formatCurrency(
      fixedSim
    )}`;
  }
  if (nodes.variableAmountNode) {
    nodes.variableAmountNode.textContent = `${formatCurrency(
      baseline.spendingVariable
    )} → ${formatCurrency(variableSim)}`;
  }
}

function updateResilienceTaxDisplay(state) {
  const { nodes, scenarioState, baseline } = state;
  if (!nodes.taxSettings || !nodes.taxRuleNode) return;
  const isCashflow = scenarioState.taxMode === "cashflow";
  nodes.taxSettings.hidden = !isCashflow;
  if (!isCashflow) {
    nodes.taxRuleNode.textContent =
      "Mode prudent : la provision impôts est exclue du cash disponible.";
    return;
  }
  const taxTotal = Math.max(0, toNumber(baseline?.taxTotal));
  const taxMonthly = Math.max(0, toNumber(baseline?.taxMonthly));
  if (scenarioState.taxPaymentMode === "monthly") {
    nodes.taxRuleNode.textContent = `Mode cashflow : impôts mensualisés (${formatCurrency(
      taxMonthly
    )}/mois).`;
  } else {
    const monthLabel = getMonthLabel(scenarioState.taxPaymentMonth);
    nodes.taxRuleNode.textContent = `Mode cashflow : paiement de ${formatCurrency(
      taxTotal
    )} en ${monthLabel}.`;
  }
}

function addResilienceEvent(state) {
  const event = {
    id: state.nextEventId++,
    name: "Événement",
    amount: 0,
    monthIndex: 12,
    recurring: false,
  };
  state.scenarioState.events.push(event);
  renderResilienceEventsList(state);
}

function handleResilienceEventInput(state, event) {
  const row = event.target.closest("[data-event-id]");
  if (!row) return;
  const id = Number(row.dataset.eventId);
  const item = state.scenarioState.events.find((entry) => entry.id === id);
  if (!item) return;
  if (event.target.matches("[data-event-name]")) {
    item.name = event.target.value;
  } else if (event.target.matches("[data-event-amount]")) {
    item.amount = Math.max(0, toNumber(event.target.value));
  } else if (event.target.matches("[data-event-month]")) {
    item.monthIndex = Math.max(1, Math.min(12, Number(event.target.value) || 1));
  } else if (event.target.matches("[data-event-recurring]")) {
    item.recurring = Boolean(event.target.checked);
  }
}

function handleResilienceEventClick(state, event) {
  const button = event.target.closest("[data-event-remove]");
  if (!button) return;
  const row = button.closest("[data-event-id]");
  if (!row) return;
  const id = Number(row.dataset.eventId);
  state.scenarioState.events = state.scenarioState.events.filter((entry) => entry.id !== id);
  renderResilienceEventsList(state);
}

function renderResilienceEventsList(state) {
  const list = state.nodes.eventsList;
  if (!list) return;
  const events = state.scenarioState.events || [];
  if (!events.length) {
    list.innerHTML = '<p class="resilience-scenario__amount">Aucun événement ajouté.</p>';
    return;
  }
  list.innerHTML = events
    .map((entry) => {
      return `
        <div class="resilience-scenario__event-row" data-event-id="${entry.id}">
          <input type="text" data-event-name value="${entry.name || ""}" aria-label="Nom de l'événement" />
          <input type="number" data-event-amount min="0" step="10" value="${entry.amount || 0}" aria-label="Montant" />
          <select data-event-month aria-label="Mois">
            ${buildMonthOptions(entry.monthIndex)}
          </select>
          <label class="resilience-scenario__tax-option">
            <input type="checkbox" data-event-recurring ${entry.recurring ? "checked" : ""} />
            Annuel
          </label>
          <button type="button" class="resilience-scenario__event-remove" data-event-remove>Supprimer</button>
        </div>
      `;
    })
    .join("");
}

function buildMonthOptions(selected) {
  const month = Math.max(1, Math.min(12, Number(selected) || 1));
  return Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    const label = getMonthLabel(value);
    return `<option value="${value}" ${value === month ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function getMonthLabel(value) {
  const labels = [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
  ];
  const index = Math.max(0, Math.min(11, Number(value) - 1));
  return labels[index] || "Mois";
}

function getMonthLabelFromOffset(startDate, offset) {
  const base = startDate instanceof Date ? startDate : new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return getMonthLabel(target.getMonth() + 1);
}

function formatHorizonLabel(months) {
  const total = Number(months) || 0;
  if (total >= 12 && total % 12 === 0) {
    const years = total / 12;
    return `${years} an${years > 1 ? "s" : ""}`;
  }
  return `${Math.max(1, total)} mois`;
}

function resolveMonthlyEventsTotal(scenario = {}, baseline = {}, month = 1) {
  let total = 0;
  const events = Array.isArray(scenario.events) ? scenario.events : [];
  events.forEach((event) => {
    const amount = Math.max(0, toNumber(event?.amount));
    if (!amount) return;
    const monthIndex = Math.max(1, Math.min(12, Number(event?.monthIndex) || 1));
    if (event?.recurring) {
      if ((month - monthIndex) % 12 === 0) total += amount;
    } else if (month === monthIndex) {
      total += amount;
    }
  });
  if (scenario.taxMode === "cashflow" && scenario.taxPaymentMode === "lump") {
    const taxMonth = Math.max(1, Math.min(12, Number(scenario.taxPaymentMonth) || 3));
    const taxTotal = Math.max(0, toNumber(baseline.taxTotal));
    if (taxTotal > 0 && (month - taxMonth) % 12 === 0) {
      total += taxTotal;
    }
  }
  return total;
}

function updateScenarioSummary(state, result) {
  const { nodes, scenarioState } = state;
  if (!nodes.summaryNode) return;
  const monthLabel = result.shortfallMonth
    ? getMonthLabelFromOffset(new Date(), result.shortfallMonth - 1)
    : null;
  const horizonLabel = formatHorizonLabel(scenarioState.horizon);
  const text = result.shortfallMonth
    ? `Cash négatif dès ${monthLabel} sur ${horizonLabel}.`
    : `Cash toujours positif sur ${horizonLabel}.`;
  nodes.summaryNode.textContent = text;
}

function updateResilienceDiagnosis(state, result) {
  const { nodes, baseline, scenarioState } = state;
  if (!baseline) return;
  const monthlyOutflow =
    baseline.spendingFixed +
    baseline.spendingVariable +
    baseline.taxMonthly +
    baseline.debtMonthly;
  const monthlySurplus = baseline.incomeMonthly - monthlyOutflow;
  const status = resolveResilienceStatus(baseline, monthlySurplus);
  if (nodes.statusNode) nodes.statusNode.textContent = status.label;
  if (nodes.statusTitleNode) nodes.statusTitleNode.textContent = status.label;
  if (nodes.statusCard) nodes.statusCard.dataset.resilienceStatusLevel = status.level;
  const horizonLabel = formatHorizonLabel(scenarioState.horizon);
  const stableMonths = result?.shortfallMonth ? Math.max(0, result.shortfallMonth - 1) : null;
  const copy = result?.shortfallMonth
    ? `En cas de choc réaliste, ta situation reste stable pendant ${stableMonths} mois.`
    : `En cas de choc réaliste, ta situation reste stable pendant ${horizonLabel}.`;
  if (nodes.statusCopyNode) nodes.statusCopyNode.textContent = copy;
  updateResilienceVerdict(state, result);
}

function updateResilienceAssumptions(state) {
  const { nodes, scenarioState, baseline } = state;
  if (!baseline) return;
  if (nodes.assumptionIncomeNode) {
    nodes.assumptionIncomeNode.textContent = formatSignedPercentLabel(
      scenarioState.incomeShockPct * 100
    );
  }
  if (nodes.assumptionSpendingNode) {
    const totalSpending = baseline.spendingFixed + baseline.spendingVariable;
    const weighted =
      totalSpending > 0
        ? (baseline.spendingFixed * scenarioState.fixedShockPct +
            baseline.spendingVariable * scenarioState.variableShockPct) /
          totalSpending
        : 0;
    nodes.assumptionSpendingNode.textContent = formatSignedPercentLabel(weighted * 100);
  }
  if (nodes.assumptionHorizonNode) {
    nodes.assumptionHorizonNode.textContent = formatHorizonLabel(scenarioState.horizon);
  }
  if (nodes.assumptionTaxNode) {
    nodes.assumptionTaxNode.textContent = "SmartSave";
  }
}

function updateResilienceVerdict(state, result) {
  const { nodes } = state;
  if (!nodes.verdictNode || !nodes.verdictDetailNode) return;
  if (result.shortfallMonth) {
    nodes.verdictNode.textContent = `Risque au mois ${result.shortfallMonth}`;
    nodes.verdictDetailNode.textContent = `Manque estimé ${formatCurrency(
      result.missingAmount || 0
    )}.`;
  } else {
    nodes.verdictNode.textContent = "OK";
    nodes.verdictDetailNode.textContent = "Aucun manque de liquidités estimé.";
  }
}

function resolveResilienceStatus(baseline, monthlySurplus) {
  const runway = Number(baseline?.runway) || 0;
  if (runway < 3 || monthlySurplus < 0) {
    return { level: "fragile", label: "Fragile" };
  }
  if (runway < 6) {
    return { level: "watch", label: "À surveiller" };
  }
  return { level: "solid", label: "Solide" };
}

function resolveShockCapacityPct(baseline) {
  if (!baseline?.incomeMonthly) return 0;
  const monthlyOutflow =
    baseline.spendingFixed +
    baseline.spendingVariable +
    baseline.taxMonthly +
    baseline.debtMonthly;
  const buffer = baseline.incomeMonthly - monthlyOutflow;
  if (!Number.isFinite(buffer)) return 0;
  return Math.max(0, Math.min(1, buffer / baseline.incomeMonthly));
}

function updateResilienceDebug(state, result) {
  const { nodes } = state;
  if (!nodes.debugNode || !nodes.debugOutput) return;
  const debugEnabled = localStorage.getItem("smartsaveDebug") === "1";
  nodes.debugNode.hidden = !debugEnabled;
  if (!debugEnabled) return;
  const records = result?.records || [];
  const total0 = records[0]?.cashEnd ?? null;
  const total1 = records[1]?.cashEnd ?? null;
  const delta1 = Number.isFinite(records[1]?.delta) ? records[1].delta : null;
  const payload = {
    horizon: result?.horizon ?? null,
    total0,
    total1,
    delta1,
    shortfallMonth: result?.shortfallMonth ?? null,
  };
  nodes.debugOutput.textContent = JSON.stringify(payload, null, 2);
}

function updateScenarioProjection(state, result) {
  const body = state.nodes.projectionBody;
  if (!body) return;
  if (!result.records.length) {
    body.innerHTML = '<tr><td colspan="4">Aucune projection disponible.</td></tr>';
    return;
  }
  const useAnnual = result.records.length > 12;
  const table = body.closest("table");
  const headers = table ? Array.from(table.querySelectorAll("th")) : [];
  if (headers.length >= 4) {
    headers[0].textContent = useAnnual ? "Année" : "Mois";
    headers[1].textContent = useAnnual ? "Cash fin d'année" : "Cash fin de mois";
    headers[2].textContent = useAnnual ? "Delta annuel" : "Delta du mois";
    headers[3].textContent = useAnnual ? "Événements (année)" : "Événements";
  }
  const maxRows = 10;
  const expanded = Boolean(state.projectionExpanded);
  const toggle = state.nodes.projectionToggle;
  if (useAnnual) {
    const yearCount = Math.ceil(result.records.length / 12);
    const shortfallYear = result.shortfallMonth
      ? Math.ceil(result.shortfallMonth / 12)
      : null;
    const rows = Array.from({ length: yearCount }, (_, index) => {
      const year = index + 1;
      const start = index * 12;
      const slice = result.records.slice(start, start + 12);
      if (!slice.length) return "";
      const cashEnd = slice[slice.length - 1].cashEnd;
      const delta = slice.reduce(
        (sum, entry) =>
          sum + (Number.isFinite(entry.delta) ? entry.delta : entry.income - entry.outflow),
        0
      );
      const eventsTotal = slice.reduce((sum, entry) => sum + (entry.eventsTotal || 0), 0);
      const isShortfall = shortfallYear === year;
      const badge = isShortfall
        ? ' <span class="resilience-scenario__shortfall-badge">⚠️ Rupture de cash ici</span>'
        : "";
      return `
        <tr${isShortfall ? ' class="is-shortfall"' : ""}>
          <td>Année ${year}${badge}</td>
          <td>${formatCurrency(cashEnd)}</td>
          <td>${formatSignedCurrency(delta)}</td>
          <td>${formatCurrency(eventsTotal)}</td>
        </tr>
      `;
    }).filter(Boolean);
    const visibleRows = expanded ? rows : rows.slice(0, maxRows);
    body.innerHTML = visibleRows.join("");
    if (toggle) {
      if (rows.length > maxRows) {
        toggle.hidden = false;
        toggle.textContent = expanded ? "Voir -" : "Voir +";
      } else {
        toggle.hidden = true;
      }
    }
    return;
  }

  const startDate = new Date();
  const rows = result.records
    .map((entry) => {
      const isShortfall = entry.month === result.shortfallMonth;
      const monthLabel = getMonthLabelFromOffset(startDate, entry.month - 1);
      const badge = isShortfall
        ? ' <span class="resilience-scenario__shortfall-badge">⚠️ Rupture de cash ici</span>'
        : "";
      const delta = Number.isFinite(entry.delta) ? entry.delta : entry.income - entry.outflow;
      return `
        <tr${isShortfall ? ' class="is-shortfall"' : ""}>
          <td>${monthLabel}${badge}</td>
          <td>${formatCurrency(entry.cashEnd)}</td>
          <td>${formatSignedCurrency(delta)}</td>
          <td>${formatCurrency(entry.eventsTotal)}</td>
        </tr>
      `;
    })
    .filter(Boolean);
  const visibleRows = expanded ? rows : rows.slice(0, maxRows);
  body.innerHTML = visibleRows.join("");
  if (toggle) {
    if (rows.length > maxRows) {
      toggle.hidden = false;
      toggle.textContent = expanded ? "Voir -" : "Voir +";
    } else {
      toggle.hidden = true;
    }
  }
}

function updateScenarioStats(state, result) {
  const { nodes } = state;
  if (nodes.cashInitialNode) {
    nodes.cashInitialNode.textContent = formatCurrency(result.initialCash);
  }
  if (nodes.endBalanceNode) {
    nodes.endBalanceNode.textContent = formatCurrency(result.endBalance);
  }
  if (nodes.monthlySurplusNode) {
    nodes.monthlySurplusNode.textContent = formatSignedCurrency(result.monthlySurplus);
  }
  if (nodes.shortfallMonthNode || nodes.missingAmountNode) {
    if (nodes.shortfallMonthNode) {
      nodes.shortfallMonthNode.textContent = result.shortfallMonth
        ? getMonthLabelFromOffset(new Date(), result.shortfallMonth - 1)
        : "—";
    }
    if (nodes.missingAmountNode) {
      nodes.missingAmountNode.textContent = formatCurrency(result.missingAmount || 0);
    }
  }
  if (nodes.shortfallNode) {
    const shortfallLabel = result.shortfallMonth
      ? getMonthLabelFromOffset(new Date(), result.shortfallMonth - 1)
      : null;
    nodes.shortfallNode.textContent = result.shortfallMonth
      ? `Cash négatif dès ${shortfallLabel} (manque de liquidités) : manque estimé ${formatCurrency(
          result.missingAmount
        )}.`
      : "Pas de manque de liquidités sur l’horizon simulé.";
  }
  if (nodes.kpiShortfallNode) {
    nodes.kpiShortfallNode.textContent = result.shortfallMonth
      ? `Mois ${result.shortfallMonth}`
      : "Aucun";
  }
}

function renderResilienceChart(state, scenarioResult) {
  const { nodes } = state;
  if (!nodes.baselinePath || !nodes.scenarioPath || !nodes.axisGroup) return;
  if (!scenarioResult) return;

  const baselineSeries = state.projectionBaseline?.records || [];
  const scenarioSeries = scenarioResult.records || [];

  const svgWidth = 540;
  const svgHeight = 340;
  const margin = { left: 70, right: 24, top: 32, bottom: 86 };
  const chartWidth = svgWidth - margin.left - margin.right;
  const chartHeight = svgHeight - margin.top - margin.bottom;
  const steps = Math.max(baselineSeries.length, scenarioSeries.length, 2);

  const normalizeSeries = (series) => {
    if (!series.length) {
      return Array.from({ length: steps }, (_, index) => ({
        month: index + 1,
        cashEnd: 0,
      }));
    }
    const normalized = [...series];
    const last = normalized[normalized.length - 1];
    while (normalized.length < steps) {
      normalized.push({ ...last });
    }
    return normalized;
  };

  const normalizedBaseline = normalizeSeries(baselineSeries);
  const normalizedScenario = normalizeSeries(scenarioSeries);
  const values = normalizedBaseline
    .map((entry) => entry.cashEnd || 0)
    .concat(normalizedScenario.map((entry) => entry.cashEnd || 0))
    .concat([0]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  const plotPoints = (series) =>
    series.map((point, index) => {
      const value = Number.isFinite(point.cashEnd) ? point.cashEnd : 0;
      const ratio = (maxValue - value) / range;
      const rawX = steps === 1 ? chartWidth / 2 : (index / (steps - 1)) * chartWidth;
      const x = margin.left + rawX;
      const y = margin.top + ratio * chartHeight;
      return { x, y, value, month: point.month || index + 1 };
    });

  const buildSmoothPath = (points = []) => {
    if (!points.length) return "";
    const segments = points.map((point) => ({ x: point.x, y: point.y }));
    let path = `M ${segments[0].x.toFixed(1)} ${segments[0].y.toFixed(1)}`;
    if (segments.length === 1) return path;
    for (let i = 0; i < segments.length - 1; i++) {
      const p0 = segments[i - 1] || segments[i];
      const p1 = segments[i];
      const p2 = segments[i + 1];
      const p3 = segments[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(
        1
      )} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return path;
  };

  const baselinePoints = plotPoints(normalizedBaseline);
  const scenarioPoints = plotPoints(normalizedScenario);
  nodes.baselinePath.setAttribute("d", buildSmoothPath(baselinePoints));
  nodes.scenarioPath.setAttribute("d", buildSmoothPath(scenarioPoints));

  if (nodes.zeroLine) {
    if (minValue <= 0 && maxValue >= 0) {
      const zeroRatio = (maxValue - 0) / range;
      const yZero = margin.top + zeroRatio * chartHeight;
      nodes.zeroLine.style.display = "";
      nodes.zeroLine.setAttribute("x1", margin.left);
      nodes.zeroLine.setAttribute("x2", margin.left + chartWidth);
      nodes.zeroLine.setAttribute("y1", yZero.toFixed(1));
      nodes.zeroLine.setAttribute("y2", yZero.toFixed(1));
    } else {
      nodes.zeroLine.style.display = "none";
    }
  }

  if (nodes.shortfallMarker) {
    if (scenarioResult.shortfallMonth) {
      const markerPoint = scenarioPoints[scenarioResult.shortfallMonth - 1];
      if (markerPoint) {
        nodes.shortfallMarker.style.display = "";
        nodes.shortfallMarker.setAttribute("cx", markerPoint.x.toFixed(1));
        nodes.shortfallMarker.setAttribute("cy", markerPoint.y.toFixed(1));
      }
    } else {
      nodes.shortfallMarker.style.display = "none";
    }
  }

  const axisTicks = 5;
  const yTicks = Array.from({ length: axisTicks }, (_, index) => {
    const ratio = axisTicks === 1 ? 0 : index / (axisTicks - 1);
    const value = maxValue - ratio * range;
    const y = margin.top + ratio * chartHeight;
    return { value, y };
  });
  const desiredXTicks = 5;
  const lastIndex = Math.max(steps - 1, 1);
  const xTickIndexes = new Set();
  for (let i = 0; i < desiredXTicks; i += 1) {
    const target = (i / (desiredXTicks - 1)) * lastIndex;
    const index = Math.min(Math.max(Math.round(target), 0), steps - 1);
    xTickIndexes.add(index);
  }
  const startDate = new Date();
  const xTicks = Array.from(xTickIndexes)
    .sort((a, b) => a - b)
    .map((index) => {
      const rawX = steps === 1 ? chartWidth / 2 : (index / lastIndex) * chartWidth;
      const x = margin.left + rawX;
      return { label: getMonthLabelFromOffset(startDate, index), x };
    });

  const yTickMarkup = yTicks
    .map(({ value, y }) => {
      const yPos = y.toFixed(1);
      return `
          <g>
            <line class="projection-chart__axis-tick" x1="${margin.left - 6}" x2="${margin.left}" y1="${yPos}" y2="${yPos}"></line>
            <text class="projection-chart__axis-label projection-chart__axis-label--y" x="${margin.left - 10}" y="${yPos}">${formatCurrency(
        value
      )}</text>
          </g>
        `;
    })
    .join("");

  const xLabelY = margin.top + chartHeight + 24;
  const xTickMarkup = xTicks
    .map(({ x, label }) => {
      const xPos = x.toFixed(1);
      return `
          <g>
            <line class="projection-chart__axis-tick" x1="${xPos}" x2="${xPos}" y1="${margin.top + chartHeight}" y2="${
        margin.top + chartHeight + 6
      }"></line>
            <text class="projection-chart__axis-label projection-chart__axis-label--x" x="${xPos}" y="${xLabelY}">${label}</text>
          </g>
        `;
    })
    .join("");

  const xAxisTitleY = margin.top + chartHeight + 60;
  nodes.axisGroup.innerHTML = `
      <line class="projection-chart__axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}"></line>
      <line class="projection-chart__axis-line" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}"></line>
      ${yTickMarkup}
      ${xTickMarkup}
      <text class="projection-chart__axis-title projection-chart__axis-title--x" x="${Math.round(
        margin.left + chartWidth / 2
      )}" y="${xAxisTitleY}">Mois</text>
    `;
}

function simulateResilienceProjection(state) {
  const { formData, scenarioState } = state;
  const projectionEngine = window.ProjectionEngine;
  if (!projectionEngine?.calculateProjection || !formData) {
    const fallback = simulateCashflow(state.baseline, scenarioState);
    return { baseline: fallback, scenario: fallback };
  }
  const months = Math.max(1, Number(scenarioState.horizon) || 6);
  const baselineForm = prepareProjectionInput(formData);
  const scenarioForm = prepareProjectionInput(
    applyResilienceScenarioToFormData(formData, scenarioState)
  );
  const baselineProjection = projectionEngine.calculateProjection(baselineForm, {
    months,
    keepHistory: true,
  });
  const scenarioProjection = projectionEngine.calculateProjection(scenarioForm, {
    months,
    keepHistory: true,
  });

  const initialCash = resolveLiquidFromAssets(formData.assets || {});
  const baselineRecords = buildResilienceProjectionRecords(
    baselineProjection?.smartSave?.history,
    scenarioState,
    months,
    initialCash
  );
  const scenarioRecords = buildResilienceProjectionRecords(
    scenarioProjection?.smartSave?.history,
    scenarioState,
    months,
    initialCash
  );

  const result = buildResilienceProjectionResult(scenarioRecords, initialCash, months);
  const baselineResult = buildResilienceProjectionResult(baselineRecords, initialCash, months);
  return { baseline: baselineResult, scenario: result };
}

function applyResilienceScenarioToFormData(formData = {}, scenario = {}) {
  const clone = JSON.parse(JSON.stringify(formData || {}));
  const incomeFactor = Math.max(0, 1 + (scenario.incomeShockPct || 0));
  const fixedFactor = Math.max(0, 1 + (scenario.fixedShockPct || 0));
  const variableFactor = Math.max(0, 1 + (scenario.variableShockPct || 0));
  const updateAmount = (entry, factor) => {
    if (!entry) return;
    if (entry.amount != null) entry.amount = toNumber(entry.amount) * factor;
    if (entry.montant != null) entry.montant = toNumber(entry.montant) * factor;
  };
  const incomes = clone.incomes || {};
  ensureArray(incomes.entries).forEach((entry) => updateAmount(entry, incomeFactor));
  const expenses = clone.expenses || {};
  ensureArray(expenses.fixed).forEach((entry) => updateAmount(entry, fixedFactor));
  ensureArray(expenses.variable).forEach((entry) => updateAmount(entry, variableFactor));
  clone.incomes = incomes;
  clone.expenses = expenses;
  return clone;
}

function buildResilienceProjectionRecords(history = [], scenario = {}, months, initialCash) {
  const records = Array.isArray(history)
    ? history.map((entry, index) => {
      const cashEnd = resolveLiquidFromAccounts(entry?.accounts || {}, scenario);
        return { month: index + 1, cashEnd, eventsTotal: 0 };
      })
    : [];
  while (records.length < months) {
    const last = records[records.length - 1] || { cashEnd: 0 };
    records.push({ month: records.length + 1, cashEnd: last.cashEnd, eventsTotal: 0 });
  }
  let previous = Number.isFinite(initialCash) ? initialCash : 0;
  records.forEach((record) => {
    record.delta = record.cashEnd - previous;
    previous = record.cashEnd;
  });
  return records;
}

function buildResilienceProjectionResult(records, initialCash, months) {
  const trimmed = records.slice(0, months);
  const endBalance = trimmed.length ? trimmed[trimmed.length - 1].cashEnd : initialCash;
  let shortfallMonth = null;
  let minCash = initialCash;
  trimmed.forEach((record) => {
    if (shortfallMonth == null && record.cashEnd < 0) {
      shortfallMonth = record.month;
    }
    if (record.cashEnd < minCash) minCash = record.cashEnd;
  });
  const totalDelta = trimmed.reduce((sum, entry) => sum + (entry.delta || 0), 0);
  const monthlySurplus = trimmed.length ? totalDelta / trimmed.length : 0;
  return {
    records: trimmed,
    endBalance,
    shortfallMonth,
    missingAmount: minCash < 0 ? Math.abs(minCash) : 0,
    initialCash,
    monthlySurplus,
    horizon: months,
  };
}

function resolveLiquidFromAssets(assets = {}) {
  return (
    computeLiquidAssets(assets) +
    toNumber(assets.blocked) +
    toNumber(assets.pillar3) +
    toNumber(assets.investments)
  );
}

function resolveLiquidFromAccounts(accounts = {}) {
  return (
    toNumber(accounts.current) +
    toNumber(accounts.savings) +
    toNumber(accounts.taxes) +
    toNumber(accounts.blocked) +
    toNumber(accounts.pillar3) +
    toNumber(accounts.investments)
  );
}

function renderResilienceActions(state) {
  const items = buildResilienceActions(state.baseline);
  populateList(state.nodes.actionsList, items, "Les recommandations apparaissent après chargement des données.");
}

function buildResilienceActions(baseline) {
  if (!baseline) return ["Renseigne tes données pour obtenir des recommandations."];
  const runwayLabel = baseline.runway;
  if (runwayLabel < 3) {
    return [
      "Réduis les dépenses variables (~20%) pour libérer du cash mensuel.",
      `Protège tes charges fixes (${formatCurrency(baseline.spendingFixed)}) et ton impôt (${formatCurrency(
        baseline.taxMonthly
      )}).`,
      `Construis un buffer de 3 mois de charges fixes (${formatCurrency(baseline.spendingFixed * 3)}).`,
    ];
  }
  return [
    "Alimente ton compte sécurité et vises 6 mois de charges fixes.",
    `Réinvestis le surplus vers tes objectifs long terme ou 3e pilier tout en surveillant la provision impôts (${formatCurrency(
      baseline.taxMonthly
    )}).`,
    "Anticipe les échéances exceptionnelles et garde ton runway supérieur à 3 mois.",
  ];
}

function populateList(node, items = [], fallback = "Aucun élément disponible.") {
  if (!node) return;
  if (items.length) {
    node.innerHTML = items.map((text) => `<li>${text}</li>`).join("");
    return;
  }
  node.innerHTML = `<li>${fallback}</li>`;
}

function formatSignedPercentLabel(value) {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return "0%";
}

function runResilienceDebugTests() {
  const cases = [
    {
      name: "stabilité positive",
      baseline: {
        incomeMonthly: 8667,
        spendingFixed: 1000,
        spendingVariable: 900,
        taxMonthly: 0,
        taxTotal: 0,
        debtMonthly: 0,
        cashUsable: 0,
      },
      scenario: {
        incomeShockPct: 0,
        fixedShockPct: 0.1,
        variableShockPct: 0,
        horizon: 3,
        taxMode: "prudent",
        taxPaymentMode: "monthly",
        events: [],
      },
      expectShortfall: false,
    },
    {
      name: "shortfall immédiat",
      baseline: {
        incomeMonthly: 0,
        spendingFixed: 2000,
        spendingVariable: 0,
        taxMonthly: 0,
        taxTotal: 0,
        debtMonthly: 0,
        cashUsable: 1000,
      },
      scenario: {
        incomeShockPct: 0,
        fixedShockPct: 0,
        variableShockPct: 0,
        horizon: 3,
        taxMode: "prudent",
        taxPaymentMode: "monthly",
        events: [],
      },
      expectShortfall: true,
      expectedMonth: 1,
    },
    {
      name: "charges lourdes",
      baseline: {
        incomeMonthly: 5000,
        spendingFixed: 2500,
        spendingVariable: 1500,
        taxMonthly: 300,
        taxTotal: 0,
        debtMonthly: 0,
        cashUsable: 2000,
      },
      scenario: {
        incomeShockPct: 0,
        fixedShockPct: 0,
        variableShockPct: 0,
        horizon: 6,
        taxMode: "cashflow",
        taxPaymentMode: "monthly",
        events: [],
      },
      expectShortfall: false,
    },
    {
      name: "stress réaliste",
      baseline: {
        incomeMonthly: 3000,
        spendingFixed: 1800,
        spendingVariable: 900,
        taxMonthly: 200,
        taxTotal: 2000,
        debtMonthly: 200,
        cashUsable: 1000,
      },
      scenario: {
        incomeShockPct: -0.2,
        fixedShockPct: 0.1,
        variableShockPct: 0.15,
        horizon: 6,
        taxMode: "cashflow",
        taxPaymentMode: "lump",
        taxPaymentMonth: 3,
        events: [
          { name: "Noël", amount: 800, monthIndex: 12, recurring: false },
        ],
      },
      expectShortfall: true,
    },
  ];
  cases.forEach((test) => {
    const result = simulateCashflow(test.baseline, test.scenario);
    const hasShortfall = result.shortfallMonth != null;
    const meetsShortfall = test.expectShortfall
      ? test.expectedMonth != null
        ? result.shortfallMonth === test.expectedMonth
        : hasShortfall
      : !hasShortfall;
    console.assert(meetsShortfall, `Résilience test "${test.name}" inattendu.`);
  });
}

runResilienceDebugTests();

function renderProjection(data) {
  const currentTotal = data.projection?.current?.netWorth || 0;
  const smartTotal = data.projection?.smartSave?.netWorth || 0;
  const delta = data.projection?.deltaNetWorth || 0;
  setCurrency("[data-projection-current-total]", currentTotal);
  setCurrency("[data-projection-smart-total]", smartTotal);
  setText("[data-projection-difference]", formatSignedCurrency(delta));

  const currentHistory = buildProjectionSeries(data.projection?.current?.history);
  const smartHistory = buildProjectionSeries(data.projection?.smartSave?.history);
  renderProjectionChart(currentHistory, smartHistory);

  const smart = data.projection?.smartSave?.finalAccounts;
  const current = data.projection?.current?.finalAccounts;
  setCurrency("[data-mvp-projection-smart]", smart?.netWorth || 0);
  setCurrency("[data-mvp-projection-current]", current?.netWorth || 0);
  setText("[data-mvp-projection-delta]", formatSignedCurrency(delta));
  setCurrency("[data-mvp-projection-savings]", data.securityMonths || 0);
  setCurrency("[data-mvp-projection-investments]", data.liquidity || 0);
  const smartInterest = data.projection?.smartSave?.interestEarned || {};
  const totalInterest = Object.values(smartInterest).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0
  );
  const gainValueNode = document.querySelector("[data-projection-gain-value]");
  if (gainValueNode) {
    gainValueNode.textContent = formatSignedCurrency(totalInterest);
  }
  const gainCopyNode = document.querySelector("[data-projection-gain-copy]");
  if (gainCopyNode) {
    gainCopyNode.innerHTML = `La répartition SmartSave vous permettra de générer <strong>${formatSignedCurrency(
      totalInterest
    )}</strong> en plus de vos revenus, tout en gardant votre niveau de vie actuel.`;
  }
  setCurrency("[data-projection-final-amount]", smartTotal);
  setCurrency("[data-projection-final-note]", smartTotal);
}

function renderProjectionChart(currentSeries, smartSeries) {
  const svgWidth = 540;
  const svgHeight = 340;
  const margin = { left: 70, right: 24, top: 32, bottom: 86 };
  const chartWidth = svgWidth - margin.left - margin.right;
  const chartHeight = svgHeight - margin.top - margin.bottom;
  const smartArea = document.querySelector("[data-projection-smart-area]");
  const smartPath = document.querySelector("[data-projection-smart-path]");
  const axisGroup = document.querySelector("[data-projection-axis]");

  const steps = Math.max(smartSeries.length, currentSeries.length, 2);
  const normalizedSmart = normalizeProjectionSeries(smartSeries, steps);
  const normalizedCurrent = normalizeProjectionSeries(currentSeries, steps);
  const rawMaxValue = Math.max(
    ...normalizedSmart.map((item) => Math.max(item.netWorth, 0)),
    ...normalizedCurrent.map((item) => Math.max(item.netWorth, 0)),
    0
  );
  const axisTicks = 5;
  const safeMax = rawMaxValue > 0 ? rawMaxValue : 1;
  const roughStep = safeMax / (axisTicks - 1);
  const step =
    rawMaxValue > 0 ? Math.max(50000, Math.ceil(roughStep / 50000) * 50000) : 1;
  const maxValue = rawMaxValue > 0 ? step * (axisTicks - 1) : 1;

  const plotPoints = (series) =>
    series.map((point, index) => {
      const ratio = maxValue ? point.netWorth / maxValue : 0;
      const rawX = steps === 1 ? chartWidth / 2 : (index / (steps - 1)) * chartWidth;
      const x = margin.left + rawX;
      const y = margin.top + (chartHeight - ratio * chartHeight);
      return { x, y };
    });

  const buildSmoothPath = (points = []) => {
    if (!points.length) return "";
    const segments = points.map((point) => ({ x: point.x, y: point.y }));
    let path = `M ${segments[0].x.toFixed(1)} ${segments[0].y.toFixed(1)}`;
    if (segments.length === 1) return path;
    for (let i = 0; i < segments.length - 1; i++) {
      const p0 = segments[i - 1] || segments[i];
      const p1 = segments[i];
      const p2 = segments[i + 1];
      const p3 = segments[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return path;
  };

  const buildAreaPath = (points = [], line = "") => {
    if (!points.length || !line) return "";
    const startX = points[0].x.toFixed(1);
    const startY = points[0].y.toFixed(1);
    const endX = points[points.length - 1].x.toFixed(1);
    const baseY = (margin.top + chartHeight).toFixed(1);
    const startToken = `M ${startX} ${startY}`;
    const prefixed = line.replace(
      startToken,
      `M ${startX} ${baseY} L ${startX} ${startY}`
    );
    return `${prefixed} L ${endX} ${baseY} Z`;
  };

  const smartPoints = plotPoints(normalizedSmart);
  const currentPoints = plotPoints(normalizedCurrent);
  const smartLinePath = buildSmoothPath(smartPoints);
  const smartAreaPath = buildAreaPath(smartPoints, smartLinePath);
  const currentLinePath = buildSmoothPath(currentPoints);
  const currentPath = document.querySelector("[data-projection-current-path]");

  if (smartPath) {
    smartPath.setAttribute("d", smartLinePath);
  }
  if (smartArea) {
    smartArea.setAttribute("d", smartAreaPath);
  }
  if (currentPath) {
    currentPath.setAttribute("d", currentLinePath);
  }

  if (axisGroup) {
    const yTicks = Array.from({ length: axisTicks }, (_, index) => {
      const ratio = axisTicks === 1 ? 0 : index / (axisTicks - 1);
      const value = Math.max(maxValue * (1 - ratio), 0);
      const y = margin.top + ratio * chartHeight;
      return {
        value,
        y,
      };
    });
    const desiredXTicks = 5;
    const lastIndex = Math.max(steps - 1, 1);
    const xTickIndexes = new Set();
    for (let i = 0; i < desiredXTicks; i += 1) {
      const target = (i / (desiredXTicks - 1)) * lastIndex;
      const index = Math.min(Math.max(Math.round(target), 0), steps - 1);
      xTickIndexes.add(index);
    }
    const xTicks = Array.from(xTickIndexes)
      .sort((a, b) => a - b)
      .map((index) => {
        const point = normalizedSmart[index];
        const rawX = steps === 1 ? chartWidth / 2 : (index / lastIndex) * chartWidth;
        const x = margin.left + rawX;
        return {
          label: formatProjectionLabel(point?.date),
          x,
        };
      });

    const yTickMarkup = yTicks
      .map(({ value, y }) => {
        const yPos = y.toFixed(1);
        return `
          <g>
            <line class="projection-chart__axis-tick" x1="${margin.left - 6}" x2="${margin.left}" y1="${yPos}" y2="${yPos}"></line>
            <text class="projection-chart__axis-label projection-chart__axis-label--y" x="${margin.left - 10}" y="${yPos}">${formatProjectionAxisValue(
          value
        )}</text>
          </g>
        `;
      })
      .join("");

    const xLabelY = margin.top + chartHeight + 24;
    const xTickMarkup = xTicks
      .map(({ x, label }) => {
        const xPos = x.toFixed(1);
        return `
          <g>
            <line class="projection-chart__axis-tick" x1="${xPos}" x2="${xPos}" y1="${margin.top + chartHeight}" y2="${
          margin.top + chartHeight + 6
        }"></line>
            <text class="projection-chart__axis-label projection-chart__axis-label--x" x="${xPos}" y="${xLabelY}">${label}</text>
          </g>
        `;
      })
      .join("");

    const xAxisTitleY = margin.top + chartHeight + 60;
    axisGroup.innerHTML = `
      <line class="projection-chart__axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}"></line>
      <line class="projection-chart__axis-line" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}"></line>
      ${yTickMarkup}
      ${xTickMarkup}
      <text class="projection-chart__axis-title projection-chart__axis-title--x" x="${Math.round(
      margin.left + chartWidth / 2
    )}" y="${xAxisTitleY}">Années</text>
    `;
  }
}

function buildProjectionSeries(history = []) {
  if (!Array.isArray(history) || !history.length) return [];
  return history
    .map((entry) => {
      const accounts = entry?.accounts || {};
      const netWorth = sumAccountsSnapshot(accounts);
      return {
        date: entry?.date ? new Date(entry.date) : null,
        netWorth,
      };
    })
    .filter((entry) => Number.isFinite(entry.netWorth));
}

function normalizeProjectionSeries(series, targetLength) {
  if (!series.length) {
    return Array.from({ length: targetLength }, () => ({ netWorth: 0, date: null }));
  }
  const normalized = [...series];
  const last = normalized[normalized.length - 1];
  while (normalized.length < targetLength) {
    normalized.push({ ...last });
  }
  return normalized;
}

function sumAccountsSnapshot(accounts = {}) {
  return (
    toNumber(accounts.current) +
    toNumber(accounts.savings) +
    toNumber(accounts.blocked) +
    toNumber(accounts.pillar3) +
    toNumber(accounts.investments)
  );
}

function formatProjectionAxisValue(value) {
  const numeric = Number.isFinite(value) ? value : toNumber(value);
  return new Intl.NumberFormat("fr-CH", {
    maximumFractionDigits: 0,
  }).format(Math.max(numeric, 0));
}

function formatProjectionLabel(value) {
  if (!value) return "…";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "…";
  const year = date.getFullYear() % 100;
  return `'${String(year).padStart(2, "0")}`;
}

function setupTabs() {
  const toggles = document.querySelectorAll(".pillars-tab-toggle");
  toggles.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.tabTarget;
      toggles.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tabTarget === target));
      document.querySelectorAll(".pillars-tab-panel").forEach((panel) => panel.classList.remove("is-active"));
      document.querySelector(`[data-tab-panel="${target}"]`)?.classList.add("is-active");
    });
  });
}

function setupSituationSubtabs() {
  const toggles = document.querySelectorAll(".situation-subtab-toggle");
  const panels = document.querySelectorAll(".situation-subtab-panel");
  if (!toggles.length || !panels.length) return;
  toggles.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.situationTabTarget;
      toggles.forEach((toggle) => toggle.classList.toggle("is-active", toggle === button));
      panels.forEach((panel) =>
        panel.classList.toggle("is-active", panel.dataset.situationPanel === target)
      );
    });
  });
}

function setupHeader(activeUser, formData) {
  const personal = formData.personal || {};
  const displayName = getUserDisplayName(activeUser, formData);
  const initials =
    getPersonalInitials(personal) ||
    getNameInitials(displayName) ||
    getNameInitials(activeUser?.name) ||
    getNameInitials(activeUser?.fullName) ||
    getNameInitials(activeUser?.id) ||
    "SS";

  const avatar = document.querySelector(".user-avatar");
  const userName = document.querySelector(".user-name");
  const userEmail = document.querySelector(".user-email");
  const menuName = document.querySelector("[data-user-name]");
  const menuEmail = document.querySelector("[data-user-email]");
  const pill = document.querySelector(".user-pill");
  if (avatar && !avatar.querySelector("svg")) {
    avatar.textContent = initials;
  }
  if (userName) {
    userName.textContent = displayName;
  }
  if (userEmail) {
    const email =
      personal.email ||
      personal.mail ||
      personal.emailAddress ||
      personal.contactEmail ||
      "";
    if (email) {
      userEmail.textContent = email;
    }
  }
  if (menuName) {
    menuName.textContent = displayName;
  }
  if (menuEmail) {
    const email =
      personal.email ||
      personal.mail ||
      personal.emailAddress ||
      personal.contactEmail ||
      "";
    menuEmail.textContent = email || "—";
  }
  if (pill) {
    pill.setAttribute("aria-label", "Ouvrir le profil");
  }
}

function setupUserMenuInteractions() {
  const pill = document.querySelector(".user-pill");
  const menu = document.querySelector(".user-menu");
  if (!pill || !menu) return;

  let isOpen = false;

  const updateMenuState = (open) => {
    isOpen = open;
    menu.classList.toggle("active", open);
    pill.setAttribute("aria-expanded", String(open));
  };

  const closeMenu = () => {
    if (isOpen) updateMenuState(false);
  };

  const toggleMenu = () => {
    updateMenuState(!isOpen);
  };

  const handleAction = (action) => {
    if (action === "edit") {
      window.location.href = "profil.html";
    } else if (action === "logout") {
      markUserLoggedOut();
      localStorage.removeItem("smartsavePendingName");
      window.location.href = "index.html";
    }
  };

  pill.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  });

  pill.addEventListener("touchstart", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  }, { passive: false });

  menu.addEventListener("click", (event) => {
    const target = event.target.closest("[data-user-action]");
    if (!target) return;
    const action = target.dataset.userAction;
    if (!action) return;
    handleAction(action);
    closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!isOpen) return;
    if (!menu.contains(event.target) && !pill.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) {
      closeMenu();
      pill.focus();
    }
  });
}

function setupExpenseDetailsToggle() {
  document.querySelectorAll("[data-details-toggle]").forEach((toggle) => {
    const panel = document.querySelector(`[data-details-panel="${toggle.dataset.detailsToggle}"]`);
    if (!panel) return;
    const openLabel = toggle.textContent.trim() || "Voir le détail";
    const closeLabel = toggle.dataset.detailsCloseLabel || "Masquer le détail";
    toggle.setAttribute("aria-expanded", "false");
    let visible = false;
    const updateText = () => {
      toggle.textContent = visible ? closeLabel : openLabel;
      toggle.setAttribute("aria-expanded", String(visible));
      panel.setAttribute("data-visible", String(visible));
    };
    updateText();
    toggle.addEventListener("click", () => {
      visible = !visible;
      updateText();
    });
  });
}

function buildIncomeBreakdownEntries(formData = {}) {
  const incomes = ensureArray(formData.incomes?.entries);
  const now = new Date();
  const entries = incomes
    .filter((income) => {
      const sourceType = String(income?.sourceType || "").toLowerCase();
      const autoKind = String(income?.autoApplyKind || "").toLowerCase();
      return sourceType !== "transaction" && autoKind !== "income";
    })
    .map((income, index) => {
      const monthly = getIncomeMonthlyAmount(income, { refDate: now, realistic13th: true });
      if (!monthly) return null;
      const label =
        income?.label ||
        income?.name ||
        income?.source ||
        `Revenu ${index + 1}`;
      return { label, amount: monthly };
    })
    .filter(Boolean);
  const spouseAmount =
    toNumber(formData.incomes?.spouseNetIncome) ||
    toNumber(formData.incomes?.spouseIncome) ||
    toNumber(formData.spouseIncome);
  if (spouseAmount > 0) {
    const spouseNameParts = [
      formData.spouse?.firstName,
      formData.spouse?.lastName,
      formData.personal?.spouseFirstName,
      formData.personal?.spouseLastName,
    ]
      .filter(Boolean)
      .map((part) => part.trim())
      .filter(Boolean);
    const spouseLabel = spouseNameParts.join(" ");
    entries.push({
      label: spouseLabel ? `Conjoint·e ${spouseLabel}` : "Conjoint·e",
      amount: spouseAmount,
    });
  }
  return entries;
}

function renderIncomeDistribution(entries = []) {
  const pie = document.querySelector("[data-income-pie]");
  const legend = document.querySelector("[data-income-breakdown]");
  const palette = ["#1F3A8A", "#3B82F6", "#93C5FD", "#3B82F6"];
  if (pie) {
    pie.style.setProperty("--pie-gradient", buildPieGradient(entries, palette));
    pie.setAttribute("role", "img");
    if (entries.length) {
      const summary = entries
        .map((entry) => `${entry.label} ${formatCurrency(entry.amount)}`)
        .join(", ");
      pie.setAttribute("aria-label", `Répartition des revenus : ${summary}`);
    } else {
      pie.setAttribute("aria-label", "Répartition des revenus indisponible");
    }
  }
  if (legend) {
    legend.innerHTML = entries.length
      ? entries
          .map(
            (entry) =>
              `<li><span>${entry.label}</span><strong>${formatCurrency(entry.amount)}</strong></li>`
          )
          .join("")
      : "<li>Aucun revenu renseigné</li>";
  }
}

function getIncomeMonthlyAmount(entry = {}, options = {}) {
  const amount = toNumber(entry?.amount || entry?.montant);
  if (!amount) return 0;
  const type = String(entry?.amountType || "net").toLowerCase();
  const status = String(entry?.employmentStatus || "").toLowerCase();
  const coefficient =
    type === "brut" ? (status.includes("indep") ? 0.75 : 0.86) : 1;
  const hasThirteenth =
    entry?.thirteenth === true || entry?.thirteenth === "oui";
  const netMonthly = amount * coefficient;
  if (!hasThirteenth) return netMonthly;

  const realistic13th = options.realistic13th !== false;
  if (!realistic13th) return (netMonthly * 13) / 12;

  const rawMonth =
    entry?.thirteenthMonth ??
    entry?.thirteenthSalaryMonth ??
    entry?.salary13Month ??
    entry?.month13 ??
    12;
  const monthNumber = Math.max(1, Math.min(12, Number(rawMonth) || 12));
  const refDate = options.refDate instanceof Date ? options.refDate : new Date();
  const isBonusMonth = refDate.getMonth() + 1 === monthNumber;
  return netMonthly + (isBonusMonth ? netMonthly : 0);
}

function getUserDisplayName(activeUser = {}, formData = {}) {
  const personal = formData.personal || {};
  const explicit =
    personal.fullName ||
    personal.displayName ||
    activeUser.displayName ||
    activeUser.fullName ||
    activeUser.name;
  if (explicit) return explicit;
  const fallbackParts = [
    personal.firstName || personal.prenom,
    personal.lastName || personal.nom,
  ].filter(Boolean);
  if (fallbackParts.length) return fallbackParts.join(" ");
  return "Profil";
}

function getPersonalInitials(personal = {}) {
  const first = String(personal.firstName || personal.prenom || "").trim();
  const last = String(personal.lastName || personal.nom || "").trim();
  if (first && last) {
    return `${first[0]}${last[0]}`.toUpperCase();
  }
  if (first) return first[0].toUpperCase();
  if (last) return last[0].toUpperCase();
  return "";
}

function getNameInitials(name = "") {
  const cleaned = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0][0].toUpperCase();
  return (cleaned[0][0] + cleaned[cleaned.length - 1][0]).toUpperCase();
}

function showNoProfileMessage() {
  const target = document.querySelector("[data-mvp-no-profile]");
  if (!target) return;
  target.hidden = false;
}

function hideNoProfileMessage() {
  const target = document.querySelector("[data-mvp-no-profile]");
  if (!target) return;
  target.hidden = true;
}

function readFormStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FORM);
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
}

function writeFormStore(data) {
  try {
    localStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(data || {}));
  } catch (_error) {
    // ignore storage errors
  }
}

function bumpProfileVersion() {
  try {
    localStorage.setItem(PROFILE_VERSION_KEY, String(Date.now()));
  } catch (_error) {
    // ignore
  }
}

let syncTimeout = null;
let pendingSyncPayload = null;

function pushToGoogleSheet(profileId, smartsaveFormData) {
  const target = resolveProfileSyncTarget();
  if (!SYNC_ENABLED || !profileId || !target) return;
  const payload = buildSyncProfilePayload(profileId, smartsaveFormData);
  console.log("[sync] push profile", { target, profileId: payload.profileId });
  fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        console.warn("[sync] non-2xx response", {
          status: response.status,
          statusText: response.statusText,
          body: raw,
        });
      }
    })
    .catch((error) => {
      console.warn("[sync] failed to push profile to Google Sheets", error);
    });
}

function computeSmartSaveLimitsForSync(formData = {}) {
  const limits = {
    currentAccountLimit: 0,
    savingsAccountLimit: 0,
    savingsAccountHardLimit: 0,
    taxProvisionLimit: 0,
    taxProvisionMonthlyNeed: 0,
    calculatedAt: new Date().toISOString(),
  };
  try {
    const source = JSON.parse(JSON.stringify(formData || {}));
    const allocationEngine = window.AllocationEngine;
    if (allocationEngine && typeof allocationEngine.calculateAllocation === "function") {
      const allocation = allocationEngine.calculateAllocation(source);
      const debug = allocation?.debug || {};
      limits.currentAccountLimit = Math.max(0, toNumber(debug.currentTarget));
      limits.savingsAccountLimit = Math.max(0, toNumber(debug?.savingsTargets?.targetAmount));
      limits.savingsAccountHardLimit = Math.max(0, toNumber(debug?.savingsTargets?.hardStopAmount));
    }
    const taxEngine = window.TaxEngine || window.SmartSaveTaxEngine;
    if (taxEngine && typeof taxEngine.calculateAnnualTax === "function") {
      const taxData = taxEngine.calculateAnnualTax(source) || {};
      const monthlyProvision = taxData?.monthlyProvision || {};
      limits.taxProvisionLimit = Math.max(
        0,
        toNumber(monthlyProvision.remaining != null ? monthlyProvision.remaining : taxData.total)
      );
      limits.taxProvisionMonthlyNeed = Math.max(0, toNumber(monthlyProvision.monthlyAmount));
    }
  } catch (_error) {
    // keep safe defaults if engines are unavailable
  }
  return limits;
}

function buildSyncProfilePayload(profileId, smartsaveFormData) {
  const payload = JSON.parse(JSON.stringify(smartsaveFormData || {}));
  const stableProfileId = String(payload.profileId || profileId || "").trim();
  const personal = payload.personal && typeof payload.personal === "object" ? payload.personal : {};
  const firstName = String(personal.firstName || personal.prenom || "").trim();
  const lastName = String(personal.lastName || personal.nom || "").trim();
  payload.profileId = stableProfileId;
  payload.id = stableProfileId;
  payload.personal = {
    ...personal,
    firstName,
    lastName,
    prenom: firstName,
    nom: lastName,
  };
  if (!payload.updatedAt) {
    payload.updatedAt = new Date().toISOString();
  }
  const limits = computeSmartSaveLimitsForSync(payload);
  payload.smartSaveLimits = limits;
  payload.smartSaveCurrentLimit = limits.currentAccountLimit;
  payload.smartSaveSavingsLimit = limits.savingsAccountLimit;
  payload.smartSaveSavingsHardLimit = limits.savingsAccountHardLimit;
  payload.smartSaveTaxLimit = limits.taxProvisionLimit;
  payload.smartSaveTaxMonthlyNeed = limits.taxProvisionMonthlyNeed;
  return payload;
}

function resolveProfileSyncTarget() {
  const runtime = typeof window.getSmartSaveRuntime === "function"
    ? window.getSmartSaveRuntime()
    : {};
  const runtimeUrl = String(runtime?.automations?.profileSyncWebhookUrl || "").trim();
  const overrideUrl = String(localStorage.getItem(SYNC_URL_OVERRIDE_KEY) || "").trim();
  const preferred = runtimeUrl || overrideUrl;
  if (preferred) return preferred;
  const fallback = String(SYNC_URL || "").trim();
  if (!fallback) return "";
  return /\/sync$/i.test(fallback) ? fallback : `${fallback.replace(/\/+$/, "")}/sync`;
}

function scheduleProfileSync(profileId, formData) {
  if (!SYNC_ENABLED || !profileId) return;
  pendingSyncPayload = {
    profileId,
    smartsaveFormData: JSON.parse(JSON.stringify(formData || {})),
  };
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(() => {
    const payload = pendingSyncPayload;
    pendingSyncPayload = null;
    syncTimeout = null;
    if (payload) {
      pushToGoogleSheet(payload.profileId, payload.smartsaveFormData);
    }
  }, SYNC_DEBOUNCE_MS);
}

function notifyProfileChange() {
  const timestamp = Date.now();
  try {
    localStorage.setItem(PROFILE_UPDATE_KEY, String(timestamp));
  } catch (_error) {
    // ignore
  }
  bumpProfileVersion();
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("smartsaveProfileUpdated", { detail: timestamp }));
  }
}

function updateProfileData(userId, updater) {
  if (!userId || typeof updater !== "function") return null;
  const store = readFormStore();
  const base = store[userId] || store.__default || {};
  const next = JSON.parse(JSON.stringify(base || {}));
  updater(next);
  if (!next.profileId) {
    next.profileId = userId;
  }
  next.id = next.profileId;
  next.updatedAt = new Date().toISOString();
  next.personal = next.personal && typeof next.personal === "object" ? next.personal : {};
  const firstName = String(next.personal.firstName || next.personal.prenom || "").trim();
  const lastName = String(next.personal.lastName || next.personal.nom || "").trim();
  if (firstName) {
    next.personal.firstName = firstName;
    next.personal.prenom = firstName;
  }
  if (lastName) {
    next.personal.lastName = lastName;
    next.personal.nom = lastName;
  }
  store[userId] = next;
  writeFormStore(store);
  notifyProfileChange();
  scheduleProfileSync(next.profileId || userId, next);
  return next;
}

const ACCOUNT_PRIMARY_ASSET = {
  current: "currentAccount",
  security: "savingsAccount",
  tax: "taxProvision",
  investments: "investments",
  pillar3a: "pillar3a",
};

const ACCOUNT_ASSET_ALIASES = {
  current: ["currentAccount", "compteCourant", "checking", "paymentAccount", "paymentBalance", "current"],
  security: [
    "securitySavings",
    "securityBalance",
    "savingsAccount",
    "savings",
    "epargne",
    "security",
  ],
  tax: ["taxProvision", "impotsProvision", "provisionImpots", "impots", "taxesProvision", "tax"],
  investments: ["investments", "investmentAccount", "portfolio", "portefeuille", "placements"],
  pillar3a: ["pillar3a", "pilier3a", "thirdPillarAmount", "thirdPillar", "pillar3", "thirdPillarValue"],
};

function resolveAccountAssetKeys(accountKey) {
  const normalizedKey = String(accountKey || "").trim();
  if (!normalizedKey) return [];
  const aliases = ACCOUNT_ASSET_ALIASES[normalizedKey];
  if (Array.isArray(aliases) && aliases.length) return aliases;
  const primary = ACCOUNT_PRIMARY_ASSET[normalizedKey] || normalizedKey;
  return [primary];
}

function adjustProfileAsset(formData, accountKey, delta) {
  if (!formData) return;
  formData.assets = formData.assets || {};
  const normalized = Number.isFinite(delta) ? delta : toNumber(delta);
  if (!normalized) return;

  const keys = resolveAccountAssetKeys(accountKey);
  if (!keys.length) return;
  const primaryKey = ACCOUNT_PRIMARY_ASSET[accountKey] || keys[0];

  if (normalized > 0) {
    const current = toNumber(formData.assets[primaryKey]);
    formData.assets[primaryKey] = current + normalized;
    return;
  }

  let remaining = Math.abs(normalized);
  keys.forEach((key) => {
    if (!remaining) return;
    const current = Math.max(0, toNumber(formData.assets[key]));
    if (!current) return;
    const used = Math.min(current, remaining);
    formData.assets[key] = current - used;
    remaining -= used;
  });

  if (remaining > 0) {
    const current = toNumber(formData.assets[primaryKey]);
    formData.assets[primaryKey] = current - remaining;
  }
}

function normalizeString(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function upsertProfileIncomeFromTransaction(entry, profile, amount) {
  if (!profile || !entry || !amount) return;
  profile.incomes = profile.incomes && typeof profile.incomes === "object" ? profile.incomes : {};
  const entries = Array.isArray(profile.incomes.entries)
    ? profile.incomes.entries
    : profile.incomes.entries
    ? [profile.incomes.entries]
    : [];
  const rawLabel = String(entry.category || entry.note || "Revenu ajouté").trim();
  const label = rawLabel || "Revenu ajouté";
  const normalizedLabel = normalizeString(label).toLowerCase();
  const existing = entries.find((income) => {
    const candidate = String(
      income?.label || income?.source || income?.sourceType || ""
    ).trim();
    return normalizeString(candidate).toLowerCase() === normalizedLabel;
  });
  if (existing) {
    existing.amount = toNumber(existing.amount) + amount;
    if (!existing.amountType) existing.amountType = "net";
    if (!existing.frequency) existing.frequency = "mensuel";
    if (!existing.source) existing.source = label;
    if (!existing.label) existing.label = label;
    if (!existing.sourceType) existing.sourceType = "transaction";
  } else {
    entries.push({
      sourceType: "transaction",
      source: label,
      label,
      amount,
      amountType: "net",
      frequency: "mensuel",
    });
  }
  profile.incomes.entries = entries;
}

function applyTransactionToProfile(entry, profile) {
  if (!entry || !profile) return;
  const amount = Math.max(0, toNumber(entry.amount));
  if (!amount) return;
  if (entry.type === "income") {
    adjustProfileAsset(profile, entry.account || "current", amount);
    // Keep form income baseline stable: auto-generated monthly apply entries
    // must not mutate recurring income settings.
    const isAutoGeneratedMonthlyIncome =
      Boolean(entry.autoGenerated) || Boolean(entry.autoApplyMonthId) || entry.autoApplyKind === "income";
    if (!isAutoGeneratedMonthlyIncome) {
      upsertProfileIncomeFromTransaction(entry, profile, amount);
    }
  } else if (entry.type === "expense") {
    adjustProfileAsset(profile, entry.account || "current", -amount);
  } else if (entry.type === "transfer") {
    const from = entry.from || "current";
    const to = entry.to || from;
    if (from) adjustProfileAsset(profile, from, -amount);
    if (to) adjustProfileAsset(profile, to, amount);
  }
}

function syncTransactionToProfile(entry, forcedUserId) {
  const userId = forcedUserId || loadActiveUser()?.id;
  if (!userId || !entry) return null;
  return updateProfileData(userId, (profile) => {
    applyTransactionToProfile(entry, profile);
  });
}

if (typeof window !== "undefined") {
  window.syncTransactionToProfile = syncTransactionToProfile;
  window.updateProfileData = updateProfileData;
}

function loadActiveUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_USER);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function loadUserForm(userId) {
  if (!userId) return null;
  const store = readFormStore();
  const data = store[userId] || store.__default;
  if (!data) return null;
  return JSON.parse(JSON.stringify(data));
}

function saveSnapshot(activeUserId, snapshot) {
  if (!activeUserId || !snapshot) return;
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    const payload = raw ? JSON.parse(raw) : {};
    payload[activeUserId] = snapshot;
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // ignore storage issues
  }
}

function loadSnapshot(activeUserId) {
  if (!activeUserId) return null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload?.[activeUserId] || null;
  } catch (_error) {
    return null;
  }
}

function prepareProjectionInput(formData = {}) {
  const clone = JSON.parse(JSON.stringify(formData || {}));
  clone.incomes = clone.incomes || {};
  if (!Array.isArray(clone.incomes.entries)) {
    clone.incomes.entries = clone.incomes.entries ? [clone.incomes.entries] : [];
  }
  clone.expenses = clone.expenses || {};
  ["fixed", "variable", "exceptional"].forEach((key) => {
    clone.expenses[key] = ensureArray(clone.expenses[key]);
  });
  const annualExtra = clone.exceptionalAnnual || clone.expenses?.annualExtra;
  clone.exceptionalAnnual = ensureArray(annualExtra);
  clone.credits = clone.credits || {};
  const loansSource = Array.isArray(clone.credits.loans) ? clone.credits.loans : clone.loans;
  clone.loans = ensureArray(loansSource);
  clone.credits.loans = clone.loans;
  clone.assets = clone.assets || {};
  const resolveAssetValue = (...values) =>
    values.find((value) => Number.isFinite(toNumber(value)) && toNumber(value) !== 0);
  if (!Number.isFinite(toNumber(clone.assets.current)) || toNumber(clone.assets.current) === 0) {
    const fallback = resolveAssetValue(
      clone.assets.currentAccount,
      clone.assets.paymentAccount,
      clone.assets.paymentBalance,
      clone.assets.checking
    );
    if (fallback != null) clone.assets.current = fallback;
  }
  if (!Number.isFinite(toNumber(clone.assets.savings)) || toNumber(clone.assets.savings) === 0) {
    const fallback = resolveAssetValue(
      clone.assets.savingsAccount,
      clone.assets.securitySavings,
      clone.assets.savingsSecurity,
      clone.assets.emergencyFund
    );
    if (fallback != null) clone.assets.savings = fallback;
  }
  if (!Number.isFinite(toNumber(clone.assets.blocked)) || toNumber(clone.assets.blocked) === 0) {
    const fallback = resolveAssetValue(clone.assets.blockedAccount, clone.assets.compteBloque);
    if (fallback != null) clone.assets.blocked = fallback;
  }
  clone.investments = clone.investments || {};
  const plan = clone.currentPlan || clone.manualContributions || {};
  clone.currentPlan = plan;
  clone.manualContributions = plan;
  clone.rates = clone.rates || {};
  return clone;
}

function determineSecurityTarget(formData = {}) {
  const stability = String(formData.personal?.incomeStability || "").toLowerCase();
  return stability === "stable" ? 5 : stability === "variable" ? 6 : 5;
}

function computeMonthlyIncome(formData = {}) {
  const incomes = Array.isArray(formData.incomes?.entries)
    ? formData.incomes.entries
    : formData.incomes?.entries
    ? [formData.incomes.entries]
    : [];
  let total = 0;
  const now = new Date();
  incomes.forEach((income = {}) => {
    const sourceType = String(income?.sourceType || "").toLowerCase();
    const autoKind = String(income?.autoApplyKind || "").toLowerCase();
    if (sourceType === "transaction" || autoKind === "income") return;
    total += Math.max(
      0,
      toNumber(getIncomeMonthlyAmount(income, { refDate: now, realistic13th: true }))
    );
  });
  const spouseIncome =
    toNumber(formData.incomes?.spouseNetIncome) ||
    toNumber(formData.incomes?.spouseIncome) ||
    toNumber(formData.spouseIncome);
  if (spouseIncome > 0) total += spouseIncome;
  return total;
}

function computeMonthlyOutflow(formData = {}) {
  const expenses = formData.expenses || {};
  const exceptionalAnnual = ensureArray(formData.exceptionalAnnual || expenses.annualExtra);
  const loans = getLoanEntries(formData);
  const monthly =
    sumMonthly(expenses.fixed) +
    sumMonthly(expenses.variable) +
    sumMonthly(expenses.exceptional) +
    sumMonthly(exceptionalAnnual);
  const debts = loans.reduce((sum, loan) => {
    const payment =
      toNumber(loan.monthlyAmount) ||
      toNumber(loan.monthly) ||
      toNumber(loan.mensualite);
    return sum + payment;
  }, 0);
  return monthly + debts;
}

function computeLiquidAssets(assets = {}) {
  return (
    toNumber(assets.currentAccount) +
    toNumber(assets.paymentAccount) +
    toNumber(assets.checking) +
    toNumber(assets.securitySavings) +
    toNumber(assets.savingsAccount) +
    toNumber(assets.savingsSecurity) +
    toNumber(assets.emergencyFund) +
    toNumber(assets.taxProvision)
  );
}

function computeCashAssets(assets = {}) {
  return (
    toNumber(assets.currentAccount) +
    toNumber(assets.paymentAccount) +
    toNumber(assets.checking) +
    toNumber(assets.securitySavings) +
    toNumber(assets.savingsAccount) +
    toNumber(assets.savingsSecurity) +
    toNumber(assets.emergencyFund)
  );
}

function resolveSecurityBalance(assets = {}, allocation = {}) {
  const keys = [
    "securitySavings",
    "securityBalance",
    "emergencyFund",
    "savingsSecurity",
    "savingsAccount",
    "savings",
    "epargne",
  ];
  const value =
    keys
      .map((key) => toNumber(assets[key]))
      .find((amount) => Number.isFinite(amount) && amount > 0) ?? 0;
  if (value > 0) return value;
  return Math.max(0, toNumber(allocation?.allocations?.securite));
}

function getLoanEntries(formData = {}) {
  if (Array.isArray(formData.credits?.loans)) {
    return formData.credits.loans;
  }
  return ensureArray(formData.loans);
}

function sumLoanPayments(formData = {}) {
  return getLoanEntries(formData).reduce((sum, loan) => {
    const payment =
      toNumber(loan.monthlyAmount) ||
      toNumber(loan.monthly) ||
      toNumber(loan.mensualite) ||
      0;
    return sum + payment;
  }, 0);
}


function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function sumMonthly(items) {
  const list = ensureArray(items);
  return list.reduce((sum, item) => {
    const amount = toNumber(item?.amount || item?.montant);
    if (!amount) return sum;
    const freq = String(item?.frequency || item?.frequence || "mensuel").toLowerCase();
    if (freq.startsWith("annu")) return sum + amount / 12;
    if (freq.startsWith("trim")) return sum + amount / 3;
    if (freq.startsWith("hebdo")) return sum + (amount * 52) / 12;
    return sum + amount;
  }, 0);
}

function toMonthlyExceptionalEntry(entry = {}) {
  if (!entry) return entry;
  const frequency = String(entry.frequency || entry.frequence || "annuel").toLowerCase();
  if (!frequency.startsWith("annu")) return entry;
  const monthlyAmount = sumMonthly([{ ...entry, frequency }]);
  return {
    ...entry,
    amount: monthlyAmount,
    frequency: "mensuel",
  };
}

function formatCurrency(value) {
  const numeric = Number.isFinite(value) ? value : toNumber(value);
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatSignedCurrency(value) {
  const numeric = Number.isFinite(value) ? value : toNumber(value);
  const base = formatCurrency(Math.abs(numeric));
  if (numeric > 0) return `+${base}`;
  if (numeric < 0) return `-${base}`;
  return base;
}

function formatSavingsCapacity(value) {
  if (value < 0) {
    return `Déficit ${formatCurrency(Math.abs(value))}`;
  }
  return formatCurrency(value);
}

function formatPercentage(value) {
  const numeric = Number.isFinite(value) ? value : toNumber(value);
  return `${Math.round(numeric * 100)}%`;
}

function setCurrency(selector, value) {
  setText(selector, formatCurrency(value));
}

function setText(selector, text) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = text;
}

function formatAllocationLabel(key) {
  const labels = {
    securite: "Compte épargne",
    impots: "Provision impôts",
    investissements: "Investissements",
    projets: "Compte long terme",
    projetsLongTerme: "Compte long terme",
    projetsCourtTerme: "Compte court terme",
    pilier3a: "3e pilier",
    bloque: "Épargne bloquée",
    compteCourant: "Compte courant",
  };
  return labels[key] || key;
}

function renderExpenseDetails(categories, breakdown) {
  const palette = ["#1F3A8A", "#3B82F6", "#93C5FD", "#3B82F6", "#93C5FD"];
  const categoryLabels = {
    fixed: "dépenses fixes",
    variable: "dépenses variables",
    exceptional: "dépenses exceptionnelles",
  };
  Object.entries(categories).forEach(([key, entries]) => {
    const listNode = document.querySelector(`[data-expense-list="${key}"]`);
    const monthlyTotal = sumMonthly(entries);
    if (listNode) {
      const listItems = entries
        .map((entry, index) => {
          const amount = toNumber(entry?.amount || entry?.montant);
          if (!amount) return null;
          const label =
            entry?.label || entry?.name || entry?.description || `Dépense ${index + 1}`;
          return `<li><span>${label}</span><strong>${formatCurrency(amount)}</strong></li>`;
        })
        .filter(Boolean);
      listNode.innerHTML = listItems.length
        ? listItems.join("")
        : "<li>Aucune dépense renseignée</li>";
    }

    const textNodes = document.querySelectorAll(`[data-expense-value="${key}"]`);
    textNodes.forEach((node) => {
      node.textContent = formatCurrency(breakdown[key] ?? monthlyTotal);
    });

    const pie = document.querySelector(`[data-expense-pie="${key}"]`);
    if (pie) {
      pie.setAttribute("role", "img");
      pie.setAttribute(
        "aria-label",
        entries.length
          ? `Répartition des ${categoryLabels[key] || key}`
          : `Aucune dépense enregistrée pour les ${categoryLabels[key] || key}`
      );
      pie.style.setProperty("--pie-gradient", buildPieGradient(entries, palette));
    }
  });
}

function buildPieVisual(entries, palette = []) {
  const normalized = prepareCategoryEntries(entries);
  const total = normalized.reduce((sum, item) => sum + item.amount, 0);
  if (!total) return { gradient: "", legend: [] };
  let cursor = 0;
  const segments = [];
  const legend = [];
  normalized.forEach((entry, index) => {
    const amount = entry.amount;
    if (!amount) return;
    const percent = (amount / total) * 100;
    const start = cursor;
    const end = cursor + percent;
    cursor = end;
    const color = palette[index % palette.length] || "#3B82F6";
    segments.push(`${color} ${start}% ${end}%`);
    legend.push({
      label: entry.label,
      color,
      amount,
    });
  });
  return {
    gradient: segments.length ? `conic-gradient(${segments.join(", ")})` : "",
    legend,
  };
}

function buildPieGradient(entries, palette = []) {
  const total = sumMonthly(entries);
  if (!total) return "rgba(15, 23, 42, 0.08)";
  let cursor = 0;
  const segments = entries
    .map((entry, index) => {
      const amount = toNumber(entry?.amount || entry?.montant);
      if (!amount) return null;
      const percent = (amount / total) * 100;
      const start = cursor;
      const end = cursor + percent;
      cursor = end;
      const color = palette[index % palette.length] || "#3B82F6";
      return `${color} ${start}% ${end}%`;
    })
    .filter(Boolean);
  return segments.length ? `conic-gradient(${segments.join(", ")})` : "#E5E7EB";
}

function clamp(value, min, max) {
  const numeric = Number.isFinite(value) ? value : toNumber(value);
  if (!Number.isFinite(numeric)) return 0;
  if (min != null && numeric < min) return min;
  if (max != null && numeric > max) return max;
  return numeric;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/[\s'_,]/g, "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
