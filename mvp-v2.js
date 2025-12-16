const STORAGE_KEY_ACTIVE_USER = "smartsaveActiveUser";
const STORAGE_KEY_FORM = "smartsaveFormData";

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
  fixed: ["#0ea5e9", "#22c55e", "#2563eb"],
  variable: ["#f97316", "#c084fc", "#0284c7"],
  exceptional: ["#ec4899", "#fb7185", "#a855f7"],
};

const SPENDING_TYPE_LABELS = {
  fixed: "charges fixes",
  variable: "dépenses variables",
  exceptional: "dépenses exceptionnelles",
};

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
  const data = buildMvpData(formData);
  renderScore(data.score);
  renderSituation(data, formData);
  renderPlan(data);
  renderProjection(data);
  renderSpendingAnalysis(data);
  setupHeader(activeUser, formData);
  setupTabs();
  setupExpenseDetailsToggle();
  setupUserMenuInteractions();
  if (window.SmartSaveAi?.bootstrap) {
    window.SmartSaveAi.bootstrap({ data, formData });
  }
});

function buildMvpData(formData) {
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
    projectionEngine?.calculateProjection?.(projectionInput, { years: 10, keepHistory: true }) ||
    { current: { finalAccounts: { netWorth: 0 } }, smartSave: { finalAccounts: { netWorth: 0 } } };

  const monthlyIncome = computeMonthlyIncome(sanitized);
  const fixedMonthly = sumMonthly(sanitized.expenses?.fixed);
  const variableMonthly = sumMonthly(sanitized.expenses?.variable);
  const exceptionalMonthly =
    sumMonthly(sanitized.expenses?.exceptional) +
    sumMonthly(sanitized.expenses?.annualExtra || sanitized.exceptionalAnnual);
  const spendingTotals = {
    fixed: fixedMonthly,
    variable: variableMonthly,
    exceptional: exceptionalMonthly,
    total: fixedMonthly + variableMonthly + exceptionalMonthly,
  };
  const monthlyExpenses = computeMonthlyOutflow(sanitized);
  const liquidity = computeLiquidAssets(sanitized.assets || {});
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
    metrics: {
      monthlyNetIncome: monthlyIncome,
    },
    monthlyExpenses,
    liquidity,
    securityMonths,
    spendingTotals,
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
  circle.style.stroke = getScoreColor(normalized);
  const gauge = circle.closest(".score-gauge");
  if (gauge) {
    gauge.style.setProperty("--score-color", getScoreColor(normalized));
  }
}

function getScoreColor(value) {
  if (value < 35) return "#ef4444";
  if (value < 55) return "#f97316";
  if (value < 75) return "#facc15";
  return "#22c55e";
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

function renderPlan(data) {
  const planBarsNode = document.querySelector("[data-plan-bars]");
  const planLogicNode = document.querySelector("[data-plan-logic]");
  const planActionsNode = document.querySelector("[data-mvp-plan-actions]");
  const allocations = data.allocation?.allocations || {};
  const targets = [
    { key: "compteCourant", label: "Compte courant" },
    { key: "securite", label: "Coussins de sécurité" },
    { key: "impots", label: "Impôts & charges" },
    { key: "investissements", label: "Investissements" },
    { key: "projets", label: "Projets & loisirs" },
    { key: "pilier3a", label: "Pilier 3a" },
    { key: "dettes", label: "Remboursement dettes" },
  ];
  const entries = targets
    .map((target) => ({
      ...target,
      amount: Math.max(0, toNumber(allocations[target.key])),
    }))
    .filter((entry) => entry.amount > 0);
  const maxAmount = entries.length ? Math.max(...entries.map((entry) => entry.amount)) : 0;
  if (planBarsNode) {
    planBarsNode.innerHTML = entries.length
      ? entries
          .map((entry) => {
            const height = maxAmount
              ? Math.max(5, Math.round((entry.amount / maxAmount) * 100))
              : 5;
            return `
              <article class="plan-chart__bar" data-plan-bar="${entry.key}">
                <div class="plan-chart__fill" style="height:${height}%">
                  <span>${formatCurrency(entry.amount)}</span>
                </div>
                <span class="plan-chart__label">${entry.label}</span>
              </article>
            `;
          })
          .join("")
      : '<p class="plan-chart__empty">SmartSave n’a pas encore défini de répartition.</p>';
  }

  const totalAllocated = entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (planLogicNode) {
    planLogicNode.textContent = totalAllocated
      ? `SmartSave répartit ${formatCurrency(totalAllocated)} ce mois afin de couvrir tes charges immédiates, alimenter tes objectifs et anticiper les échéances.`
      : "SmartSave prépare ta répartition dès que tu auras renseigné suffisamment d'informations.";
  }

  if (planActionsNode) {
    const actionRules = [
      {
        key: "compteCourant",
        create: (amount) => `Garde ${formatCurrency(amount)} sur le compte courant pour couvrir les dépenses journalières.`,
      },
      {
        key: "securite",
        create: (amount) =>
          `Verse ${formatCurrency(amount)} vers ton coussin de sécurité pour maintenir la couverture sur les imprévus.`,
      },
      {
        key: "impots",
        create: (amount) => `Provisionne ${formatCurrency(amount)} pour les impôts et charges qui arrivent.`,
      },
      {
        key: "investissements",
        create: (amount) =>
          `Investis ${formatCurrency(amount)} dans les enveloppes prévues pour tes placements longue durée.`,
      },
      {
        key: "projets",
        create: (amount) => `Alloue ${formatCurrency(amount)} à tes projets ou loisirs prioritaires.`,
      },
      {
        key: "pilier3a",
        create: (amount) => `Alimente ton pilier 3a avec ${formatCurrency(amount)} pour optimiser ta retraite.`,
      },
      {
        key: "dettes",
        create: (amount) =>
          `Affecte ${formatCurrency(amount)} aux remboursements prioritaires pour réduire tes charges futures.`,
      },
    ];
    const actionLines = actionRules
      .map((rule) => {
        const amount = Math.max(0, toNumber(allocations[rule.key]));
        if (!amount) return null;
        return rule.create(amount);
      })
      .filter(Boolean);
    const rest = toNumber(data.allocation?.reste);
    if (rest > 0) {
      actionLines.push(`Garde ${formatCurrency(rest)} de marge (reste) pour saisir les opportunités ou couvrir les variations imprévues.`);
    }
    planActionsNode.innerHTML = actionLines.length
      ? actionLines.map((line) => `<li>${line}</li>`).join("")
      : "<li>Aucune action recommandée pour le moment.</li>";
    planActionsNode.dataset.defaultActions = planActionsNode.innerHTML;
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

function prepareCategoryEntries(entries = []) {
  return ensureArray(entries)
    .map(normalizeCategoryEntry)
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
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
}

function renderProjectionChart(currentSeries, smartSeries) {
  const chartWidth = 420;
  const chartHeight = 220;
  const currentPath = document.querySelector("[data-projection-current-path]");
  const smartPath = document.querySelector("[data-projection-smart-path]");
  const axisNode = document.querySelector("[data-projection-xlabels]");
  const yAxisNode = document.querySelector("[data-projection-ylabels]");
  const calloutsNode = document.querySelector("[data-projection-callouts]");
  const chartNode = document.querySelector(".projection-chart");
  const svgNode = document.querySelector("[data-projection-svg]");
  const tooltipNode = document.querySelector("[data-projection-tooltip]");

  const steps = Math.max(currentSeries.length, smartSeries.length, 2);
  const normalizedCurrent = normalizeProjectionSeries(currentSeries, steps);
  const normalizedSmart = normalizeProjectionSeries(smartSeries, steps);
  const maxValue = Math.max(
    ...normalizedCurrent.map((item) => item.netWorth),
    ...normalizedSmart.map((item) => item.netWorth),
    1
  );
  const minValue = Math.min(
    ...normalizedCurrent.map((item) => item.netWorth),
    ...normalizedSmart.map((item) => item.netWorth),
    0
  );
  const axisValues = [maxValue, (maxValue + minValue) / 2, minValue];

  const plotPoints = (series) =>
    series.map((point, index) => {
      const ratio = maxValue ? point.netWorth / maxValue : 0;
      const x = steps === 1 ? chartWidth / 2 : (index / (steps - 1)) * chartWidth;
      const y = chartHeight - ratio * chartHeight;
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

  const currentPoints = plotPoints(normalizedCurrent);
  const smartPoints = plotPoints(normalizedSmart);

  if (currentPath) {
    currentPath.setAttribute("d", buildSmoothPath(currentPoints));
  }
  if (smartPath) {
    smartPath.setAttribute("d", buildSmoothPath(smartPoints));
  }

  if (axisNode) {
    const firstDate =
      normalizedCurrent[0]?.date ||
      normalizedSmart[0]?.date ||
      new Date().toISOString();
    const lastDate =
      normalizedCurrent[steps - 1]?.date ||
      normalizedSmart[steps - 1]?.date ||
      new Date().toISOString();
    const middleDate =
      normalizedCurrent[Math.floor(steps / 2)]?.date ||
      normalizedSmart[Math.floor(steps / 2)]?.date ||
      null;
    axisNode.innerHTML = `
      <span>${formatProjectionLabel(firstDate)}</span>
      ${middleDate ? `<span>${formatProjectionLabel(middleDate)}</span>` : ""}
      <span>${formatProjectionLabel(lastDate)}</span>
    `;
  }

  if (yAxisNode) {
    yAxisNode.innerHTML = axisValues
      .map((value, index) => {
        const label =
          index === 0
            ? "Maximum"
            : index === 1
            ? "Milieu"
            : minValue === 0
            ? "Base"
            : "Minimum";
        return `<span><strong>${label}</strong>${formatCurrency(Math.max(0, value))}</span>`;
      })
      .join("");
  }

  if (calloutsNode) {
    const currentLast = normalizedCurrent[steps - 1]?.netWorth || 0;
    const smartLast = normalizedSmart[steps - 1]?.netWorth || 0;
    const delta = smartLast - currentLast;
    calloutsNode.innerHTML = `
      <span class="projection-chart__callout projection-chart__callout--current">
        Trajectoire actuelle : ${formatCurrency(currentLast)}
      </span>
      <span class="projection-chart__callout projection-chart__callout--smart">
        Plan SmartSave : ${formatCurrency(smartLast)}
      </span>
      <span class="projection-chart__callout projection-chart__callout--delta">
        Écart : ${formatSignedCurrency(delta)}
      </span>
    `;
  }

  const tooltipPoints = normalizedCurrent.map((point, index) => {
    const mirror = normalizedSmart[index] || {};
    return {
      index,
      date: point.date || mirror.date || new Date(),
      current: point.netWorth || 0,
      smart: mirror.netWorth || 0,
    };
  });

  const lineSeries = [
    {
      key: "current",
      label: "Trajectoire actuelle",
      points: currentPoints,
      values: normalizedCurrent,
    },
    {
      key: "smart",
      label: "Plan SmartSave",
      points: smartPoints,
      values: normalizedSmart,
    },
  ];

  const setupTooltipInteractions = () => {
    if (!svgNode || !tooltipNode || !chartNode || !tooltipPoints.length) return;
    if (svgNode._projectionTooltipCleanup) {
      svgNode._projectionTooltipCleanup();
    }

    const updateTooltip = (event) => {
      const pointerX = event.touches?.[0]?.clientX ?? event.clientX;
      if (pointerX == null) return;
      const svgRect = svgNode.getBoundingClientRect();
      const relativeX = Math.max(0, Math.min(svgRect.width, pointerX - svgRect.left));
      const ratio = svgRect.width ? relativeX / svgRect.width : 0;
      const index = Math.min(steps - 1, Math.max(0, Math.round(ratio * (steps - 1))));
      const targetDate = tooltipPoints[index]?.date || new Date();
      let closest = null;
      const threshold = 22;
      const relativeY = Math.max(0, Math.min(svgRect.height, (event.touches?.[0]?.clientY ?? event.clientY) - svgRect.top));
      lineSeries.forEach((series) => {
        const point = series.points[index];
        if (!point) return;
        const scaledX = (point.x / chartWidth) * svgRect.width;
        const scaledY = (point.y / chartHeight) * svgRect.height;
        const deltaX = scaledX - relativeX;
        const deltaY = scaledY - relativeY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (distance <= threshold && (closest == null || distance < closest.distance)) {
          closest = {
            distance,
            series,
            pointX: scaledX,
            pointY: scaledY,
            value: series.values[index]?.netWorth || 0,
          };
        }
      });
      if (!closest) {
        tooltipNode.hidden = true;
        return;
      }

      const left = Math.min(svgRect.width - 22, Math.max(10, closest.pointX));
      const top = Math.max(12, closest.pointY - 42);
      tooltipNode.style.left = `${left}px`;
      tooltipNode.style.top = `${top}px`;
      tooltipNode.innerHTML = `
        <strong>${closest.series.label}</strong>
        <span>${formatCurrency(closest.value)}</span>
        <small>${formatProjectionLabel(targetDate)}</small>
      `;
      tooltipNode.hidden = false;
    };

    const hideTooltip = () => {
      tooltipNode.hidden = true;
    };

    svgNode.addEventListener("mousemove", updateTooltip);
    svgNode.addEventListener("touchmove", updateTooltip, { passive: true });
    svgNode.addEventListener("mouseleave", hideTooltip);
    svgNode.addEventListener("touchend", hideTooltip);

    svgNode._projectionTooltipCleanup = () => {
      svgNode.removeEventListener("mousemove", updateTooltip);
      svgNode.removeEventListener("touchmove", updateTooltip);
      svgNode.removeEventListener("mouseleave", hideTooltip);
      svgNode.removeEventListener("touchend", hideTooltip);
      delete svgNode._projectionTooltipCleanup;
    };
  };

  setupTooltipInteractions();
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

function formatProjectionLabel(value) {
  if (!value) return "…";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "…";
  return new Intl.DateTimeFormat("fr-CH", {
    month: "short",
    year: "2-digit",
  }).format(date);
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
  const pill = document.querySelector(".user-pill");
  if (avatar) {
    avatar.textContent = initials;
  }
  if (userName) {
    userName.textContent = "Mon Compte";
  }
  if (pill) {
    pill.setAttribute("aria-label", "Ouvrir Mon Compte");
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
      // Placeholder until a backend logout flow exists.
      alert("Tu es maintenant déconnecté.");
    }
  };

  pill.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  });

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
  const entries = incomes
    .map((income, index) => {
      const monthly = getIncomeMonthlyAmount(income);
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
  const palette = ["#22c55e", "#0ea5e9", "#f97316", "#c084fc"];
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

function getIncomeMonthlyAmount(entry = {}) {
  const amount = toNumber(entry?.amount || entry?.montant);
  if (!amount) return 0;
  const type = String(entry?.amountType || "net").toLowerCase();
  const status = String(entry?.employmentStatus || "").toLowerCase();
  const coefficient =
    type === "brut" ? (status.includes("indep") ? 0.75 : 0.86) : 1;
  const hasThirteenth =
    entry?.thirteenth === true || entry?.thirteenth === "oui";
  const netMonthly = amount * coefficient;
  return hasThirteenth ? (netMonthly * 13) / 12 : netMonthly;
}

function getUserDisplayName(activeUser = {}, formData = {}) {
  const personal = formData.personal || {};
  const explicit =
    activeUser.displayName ||
    activeUser.fullName ||
    activeUser.name ||
    personal.fullName ||
    personal.displayName;
  if (explicit) return explicit;
  const fallbackParts = [personal.firstName, personal.lastName].filter(Boolean);
  if (fallbackParts.length) return fallbackParts.join(" ");
  return activeUser.id || "Profil";
}

function getPersonalInitials(personal = {}) {
  const first = String(personal.firstName || "").trim();
  const last = String(personal.lastName || "").trim();
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
  const raw = localStorage.getItem(STORAGE_KEY_FORM);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const data = parsed?.[userId] || parsed?.__default;
    if (!data) return null;
    return JSON.parse(JSON.stringify(data));
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
  incomes.forEach((income = {}) => {
    const amount = toNumber(income.amount);
    if (!amount) return;
    const type = String(income.amountType || "net").toLowerCase();
    const status = String(income.employmentStatus || "").toLowerCase();
    const coefficient =
      type === "brut" ? (status.includes("indep") ? 0.75 : 0.86) : 1;
    const hasThirteenth = income.thirteenth === true || income.thirteenth === "oui";
    const netMonthly = amount * coefficient;
    total += hasThirteenth ? (netMonthly * 13) / 12 : netMonthly;
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

function getLoanEntries(formData = {}) {
  if (Array.isArray(formData.credits?.loans)) {
    return formData.credits.loans;
  }
  return ensureArray(formData.loans);
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
    securite: "Sécurité",
    impots: "Impôts",
    investissements: "Investissements",
    projets: "Projets",
    pilier3a: "3e pilier",
    bloque: "Épargne bloquée",
    compteCourant: "Compte courant",
  };
  return labels[key] || key;
}

function renderExpenseDetails(categories, breakdown) {
  const palette = ["#38bdf8", "#22c55e", "#f97316", "#c084fc", "#f43f5e"];
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
    const color = palette[index % palette.length] || "#0ea5e9";
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
      const color = palette[index % palette.length] || "#0ea5e9";
      return `${color} ${start}% ${end}%`;
    })
    .filter(Boolean);
  return segments.length ? `conic-gradient(${segments.join(", ")})` : "rgba(15, 23, 42, 0.08)";
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
