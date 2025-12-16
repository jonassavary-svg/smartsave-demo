(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SpendingAnalysisEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const SEVERITY_ORDER = {
    critical: 3,
    high: 2,
    medium: 1,
    low: 0,
  };

  function toNumber(value) {
    if (value == null || value === "") return 0;
    const parsed = typeof value === "number" ? value : Number(String(value).replace(/\s|CHF|,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function ensureArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }

  function sumMonthly(entries = []) {
    return ensureArray(entries).reduce((sum, entry) => {
      const amount = toNumber(entry?.amount || entry?.montant);
      if (!amount) return sum;
      const frequency = String(entry?.frequency || entry?.frequence || "mensuel").toLowerCase();
      if (frequency.startsWith("annu")) return sum + amount / 12;
      if (frequency.startsWith("trim")) return sum + amount / 3;
      if (frequency.startsWith("hebdo")) return sum + (amount * 52) / 12;
      return sum + amount;
    }, 0);
  }

  function computeMonthlyIncome(entries = []) {
    return ensureArray(entries).reduce((sum, entry = {}) => {
      const netAmount = toNumber(entry.amount || entry.montant);
      if (!netAmount) return sum;
      const type = String(entry.amountType || "net").toLowerCase();
      const status = String(entry.employmentStatus || "").toLowerCase();
      const coefficient = type === "brut" ? (status.includes("indep") ? 0.75 : 0.86) : 1;
      const hasThirteenth = entry?.thirteenth === true || entry?.thirteenth === "oui";
      const monthly = netAmount * coefficient;
      const normalized = hasThirteenth ? (monthly * 13) / 12 : monthly;
      return sum + normalized;
    }, 0);
  }

  function resolveTaxReserve(userData = {}) {
    if (userData.taxReserveMonthly) return toNumber(userData.taxReserveMonthly);
    if (userData.taxReserveAnnual) return toNumber(userData.taxReserveAnnual) / 12;
    if (userData.taxReserve) return toNumber(userData.taxReserve);
    return 0;
  }

  function buildExpenseCategories(breakdown = {}) {
    const entries = Object.entries(breakdown)
      .map(([label, amount]) => ({ label, amount: toNumber(amount) }))
      .filter((entry) => entry.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const top = entries.slice(0, 5);
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    return { entries, total, top };
  }

  function buildFlags(metrics, thresholds = {}) {
    const flags = [];
    const { monthlySavingsCapacity, safetyMonths, fixedRatio, variableRatio, debtRatio, taxRatio } = metrics;

    const pushFlag = (flag) => {
      flags.push(flag);
    };

    if (monthlySavingsCapacity < 0) {
      pushFlag({
        id: "budget-negative",
        severity: "critical",
        title: "Budget négatif",
        description: `Tes dépenses dépassent tes revenus de ${formatAmount(Math.abs(monthlySavingsCapacity))}.`,
        metric: "monthlySavingsCapacity",
        value: monthlySavingsCapacity,
        threshold: 0,
      });
    }

    if (safetyMonths < 1) {
      pushFlag({
        id: "safety-critical",
        severity: "critical",
        title: "Sécurité très faible",
        description: "Tu n'as pas assez d'épargne pour couvrir un mois complet.",
        metric: "safetyMonths",
        value: safetyMonths,
        threshold: 1,
      });
    } else if (safetyMonths < 3) {
      pushFlag({
        id: "safety-low",
        severity: "high",
        title: "Sécurité fragile",
        description: "Tu es proche de la limite des 3 mois de sécurité.",
        metric: "safetyMonths",
        value: safetyMonths,
        threshold: 3,
      });
    }

    const fixedHigh = thresholds.fixedHigh ?? 0.55;
    const fixedMedium = thresholds.fixedMedium ?? 0.4;
    if (fixedRatio > fixedHigh) {
      pushFlag({
        id: "fixed-too-high",
        severity: "high",
        title: "Dépenses fixes lourdes",
        description: "Tes charges fixes dépassent 55% de ton revenu net mensuel.",
        metric: "fixedRatio",
        value: fixedRatio,
        threshold: 0.55,
      });
    } else if (fixedRatio > fixedMedium) {
      pushFlag({
        id: "fixed-med",
        severity: "medium",
        title: "Charges fixes importantes",
        description: "Tes dépenses fixes représentent plus de 40% de ton revenu.",
        metric: "fixedRatio",
        value: fixedRatio,
        threshold: 0.4,
      });
    }

    const variableHigh = thresholds.variableHigh ?? 0.35;
    const variableMedium = thresholds.variableMedium ?? 0.25;
    if (variableRatio > variableHigh) {
      pushFlag({
        id: "variable-too-high",
        severity: "high",
        title: "Variables élevées",
        description: "Tes dépenses variables dépassent 35% de ton revenu net.",
        metric: "variableRatio",
        value: variableRatio,
        threshold: 0.35,
      });
    } else if (variableRatio > variableMedium) {
      pushFlag({
        id: "variable-med",
        severity: "medium",
        title: "Variables en hausse",
        description: "Les dépenses variables représentent plus d'un quart de ton revenu.",
        metric: "variableRatio",
        value: variableRatio,
        threshold: 0.25,
      });
    }

    const debtHigh = thresholds.debtHigh ?? 0.2;
    const debtMedium = thresholds.debtMedium ?? 0.1;
    if (debtRatio > debtHigh) {
      pushFlag({
        id: "debt-too-high",
        severity: "high",
        title: "Dettes importantes",
        description: "Tu verses plus de 20% de ton revenu au remboursement des dettes.",
        metric: "debtRatio",
        value: debtRatio,
        threshold: 0.2,
      });
    } else if (debtRatio > debtMedium) {
      pushFlag({
        id: "debt-med",
        severity: "medium",
        title: "Dettes à surveiller",
        description: "Les remboursements représentent plus de 10% de tes revenus.",
        metric: "debtRatio",
        value: debtRatio,
        threshold: 0.1,
      });
    }

    const taxMedium = thresholds.taxMedium ?? 0.15;
    if (taxRatio > taxMedium) {
      pushFlag({
        id: "tax-heavy",
        severity: "medium",
        title: "Impôts lourds",
        description: "Les provisions fiscales dépassent 15% de ton revenu net.",
        metric: "taxRatio",
        value: taxRatio,
        threshold: 0.15,
      });
    }

    return flags;
  }

  function formatAmount(value) {
    return new Intl.NumberFormat("fr-CH", {
      style: "currency",
      currency: "CHF",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatPercentage(value) {
    return `${Math.round(value * 100)}%`;
  }

  function pickTopIssues(flags) {
    if (!flags?.length) return [];
    const sorted = [...flags].sort((a, b) => {
      if (a.id === "budget-negative") return -1;
      if (b.id === "budget-negative") return 1;
      return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    });
    return sorted.slice(0, 2);
  }

  function buildSuggestedActions(metrics, impacts, flags, taxPresent) {
    const actions = [];
    if (metrics.monthlySavingsCapacity < 0) {
      actions.push({
        id: "restore-balance",
        title: "Ramener le budget à l’équilibre",
        detail: `Réduis ou décale ${formatAmount(Math.abs(
          metrics.monthlySavingsCapacity
        ))} de dépenses pour limiter le déficit.`,
      });
    }

    if (metrics.safetyMonths < 3) {
      actions.push({
        id: "build-safety",
        title: "Atteindre 3 mois de sécurité",
        detail: `Il manque ${formatAmount(
          impacts.needForSafety3MonthsCHF
        )} pour atteindre 3 mois d’épargne.`,
      });
    }

    if (metrics.variableRatio > 0.35) {
      actions.push({
        id: "trim-variables-priority",
        title: "Réduire rapidement les variables",
        detail: `Un ajustement ciblé des variables pourrait libérer ${formatAmount(
          impacts.variableCut15CHF
        )} par mois.`,
      });
    } else if (metrics.variableRatio > 0.25) {
      actions.push({
        id: "trim-variables",
        title: "Tester une réduction des dépenses variables",
        detail: `Une baisse de 10% libérerait ${formatAmount(impacts.variableCut10CHF)} mensuels.`,
      });
    }

    const hasDebtFlag = flags?.some((flag) => flag.id.startsWith("debt"));
    if (hasDebtFlag && metrics.debtRatio > 0.1) {
      actions.push({
        id: "plan-debt",
        title: "Planifier la réduction des dettes",
        detail: "Priorise les dettes les plus coûteuses et augmente progressivement les mensualités.",
      });
    }

    if (taxPresent) {
      actions.push({
        id: "reserve-tax",
        title: "Réserver les impôts automatiquement",
        detail: "Intègre la provision fiscale dans ton plan SmartSave pour éviter les surprises.",
      });
    }

    return actions.slice(0, 3);
  }

  function normalizeLabel(label) {
    if (!label) return "";
    return String(label).trim().toLowerCase();
  }

  function formatSavingsCapacity(value) {
    if (value < 0) {
      return `Déficit ${formatAmount(Math.abs(value))}`;
    }
    return formatAmount(value);
  }

  function buildSnapshot(metrics, breakdownData, hasBreakdown) {
    const cards = [
      {
        id: "income-breakdown",
        title: "Répartition du revenu",
        type: "breakdown",
        breakdown: breakdownData,
      },
      {
        id: "savings-capacity",
        title: "Capacité d’épargne",
        value: metrics.monthlySavingsCapacity,
        label: "CHF / mois",
        formatted: formatSavingsCapacity(metrics.monthlySavingsCapacity),
      },
      {
        id: "security",
        title: "Sécurité",
        value: metrics.safetyMonths,
        label: "mois d’épargne",
        formatted: `${metrics.safetyMonths.toFixed(1)} mois`,
      },
      {
        id: "debts",
        title: "Dettes",
        value: metrics.debtRatio,
        label: "% du revenu",
        formatted: formatPercentage(metrics.debtRatio),
        meta: formatAmount(metrics.debtPaymentsMonthly),
      },
    ];
    return { cards, hasBreakdown };
  }

  function buildBreakdown(
    fixed,
    variable,
    exceptional,
    debt,
    tax,
    savingsCapacity,
    categories
  ) {
    if (categories?.top?.length) {
      const top = categories.top.map((entry) => ({
        label: entry.label,
        value: entry.amount,
      }));
      const others = categories.entries
        .slice(categories.top.length)
        .reduce((sum, entry) => sum + entry.amount, 0);
      if (others) {
        top.push({ label: "Autres", value: others });
      }
      const normalizedLabels = new Set(top.map((entry) => normalizeLabel(entry.label)));
      const appendIfMissing = (label, amount) => {
        if (!amount) return;
        const normalized = normalizeLabel(label);
        if (normalizedLabels.has(normalized)) return;
        normalizedLabels.add(normalized);
        top.push({ label, value: amount });
      };
      appendIfMissing("Dettes", debt);
      appendIfMissing("Exceptionnelles", exceptional);
      appendIfMissing("Impôts", tax);
      if (savingsCapacity > 0) {
        appendIfMissing("Capacité d’épargne", savingsCapacity);
      }
      return { type: "topCategories", entries: top };
    }
    const fallback = [
      { label: "Fixes", value: fixed },
      { label: "Variables", value: variable },
      { label: "Exceptionnelles", value: exceptional },
      { label: "Dettes", value: debt },
      { label: "Impôts", value: tax },
    ];
    if (savingsCapacity > 0) {
      fallback.push({ label: "Capacité d’épargne", value: savingsCapacity });
    }
    return { type: "fallback", entries: fallback };
  }

  function buildImpacts(metrics, baseline, currentSavings) {
    const { variableExpensesMonthly, monthlySavingsCapacity } = metrics;
    const needForSafety1 = Math.max(0, baseline * 1 - currentSavings);
    const needForSafety3 = Math.max(0, baseline * 3 - currentSavings);
    const needForSafety6 = Math.max(0, baseline * 6 - currentSavings);
    const monthsToSafety3 =
      monthlySavingsCapacity > 0 ? Math.ceil(needForSafety3 / monthlySavingsCapacity) : null;
    const monthlyDeficit = monthlySavingsCapacity < 0 ? Math.abs(monthlySavingsCapacity) : 0;

    return {
      variableCut10CHF: Math.round(variableExpensesMonthly * 0.1),
      variableCut15CHF: Math.round(variableExpensesMonthly * 0.15),
      needForSafety1MonthCHF: Math.round(needForSafety1),
      needForSafety3MonthsCHF: Math.round(needForSafety3),
      needForSafety6MonthsCHF: Math.round(needForSafety6),
      monthsToSafety3,
      monthlyDeficitCHF: Math.round(monthlyDeficit),
    };
  }

  function buildMetrics(values, taxReserveMonthly, baseline, currentSavings) {
    const {
      incomeNetMonthly,
      fixedExpensesMonthly,
      variableExpensesMonthly,
      debtPaymentsMonthly,
      exceptionalExpensesMonthly,
    } = values;
    const totalExpensesMonthly =
      fixedExpensesMonthly +
      variableExpensesMonthly +
      (exceptionalExpensesMonthly || 0) +
      debtPaymentsMonthly +
      taxReserveMonthly;
    const monthlySavingsCapacity = incomeNetMonthly - totalExpensesMonthly;

    const fixedRatio = incomeNetMonthly ? fixedExpensesMonthly / incomeNetMonthly : 0;
    const variableRatio = incomeNetMonthly ? variableExpensesMonthly / incomeNetMonthly : 0;
    const debtRatio = incomeNetMonthly ? debtPaymentsMonthly / incomeNetMonthly : 0;
    const taxRatio = incomeNetMonthly ? taxReserveMonthly / incomeNetMonthly : 0;
    const exceptionalRatio = incomeNetMonthly ? (exceptionalExpensesMonthly || 0) / incomeNetMonthly : 0;
    const savingsRate = incomeNetMonthly ? monthlySavingsCapacity / incomeNetMonthly : 0;
    const leftoverAfterFixedDebtTax =
      incomeNetMonthly - fixedExpensesMonthly - debtPaymentsMonthly - taxReserveMonthly;
    const baselineMonthly = baseline;
    const safetyMonths = baselineMonthly > 0 ? currentSavings / baselineMonthly : 0;

    return {
      incomeNetMonthly,
      fixedExpensesMonthly,
      variableExpensesMonthly,
      debtPaymentsMonthly,
      taxReserveMonthly,
      totalExpensesMonthly,
      monthlySavingsCapacity,
      fixedRatio,
      variableRatio,
      debtRatio,
      taxRatio,
      savingsRate,
      leftoverAfterFixedDebtTax,
      baselineMonthly,
      safetyMonths,
      exceptionalExpensesMonthly,
      exceptionalRatio,
    };
  }

  function analyze(userData = {}) {
    const incomes = ensureArray(userData.incomes?.entries || userData.incomes);
    const fixedEntries = ensureArray(userData.expenses?.fixed);
    const variableEntries = ensureArray(userData.expenses?.variable);
    const debtEntries = ensureArray(userData.credits?.loans || userData.loans);
    const fixedExpenseTotal =
      toNumber(userData.fixedExpensesMonthly) || sumMonthly(fixedEntries);
    const variableExpenseTotal =
      toNumber(userData.variableExpensesMonthly) || sumMonthly(variableEntries);
    const debtPaymentsTotal =
      toNumber(userData.debtPaymentsMonthly) || sumMonthly(debtEntries);
    const exceptionalEntries = ensureArray(userData.expenses?.exceptional);
    const exceptionalAnnualEntries = ensureArray(
      userData.exceptionalAnnual || userData.expenses?.annualExtra
    );
    const exceptionalExpenseTotal =
      toNumber(userData.exceptionalExpensesMonthly) ||
      sumMonthly(exceptionalEntries) +
        sumMonthly(exceptionalAnnualEntries);
    const incomeFromEntries = computeMonthlyIncome(incomes);
    const spouseIncome = toNumber(userData.incomes?.spouseNetIncome) || toNumber(userData.spouseIncome);
    const normalizedIncomeEntries = incomeFromEntries + spouseIncome;
    const incomeNetMonthly =
      toNumber(userData.incomeNetMonthly) ||
      normalizedIncomeEntries ||
      toNumber(userData.incomeNet) ||
      0;

    const currentSavings = toNumber(userData.currentSavings);
    const currentAccountBalance = toNumber(userData.currentAccountBalance);
    const investmentBalance = toNumber(userData.investmentBalance);

    const taxReserveMonthly = resolveTaxReserve(userData);

    const baselineMonthly = fixedExpenseTotal + variableExpenseTotal;

    const metrics = buildMetrics(
      {
        incomeNetMonthly,
        fixedExpensesMonthly: fixedExpenseTotal,
        variableExpensesMonthly: variableExpenseTotal,
        debtPaymentsMonthly: debtPaymentsTotal,
        exceptionalExpensesMonthly: exceptionalExpenseTotal,
      },
      taxReserveMonthly,
      baselineMonthly,
      currentSavings
    );

    const expenseBreakdown = buildExpenseCategories(
      userData.expenseBreakdownMonthly || userData.breakdown?.expenses || {}
    );
    const fixedBreakdown = buildExpenseCategories(userData.fixedBreakdownMonthly || {});
    const variableBreakdown = buildExpenseCategories(userData.variableBreakdownMonthly || {});

    const thresholds = userData.analysisThresholds || {};
    const flags = buildFlags(metrics, thresholds);
    const topIssues = pickTopIssues(flags);
    const impacts = buildImpacts(metrics, baselineMonthly, currentSavings);
    const breakdownSnapshot = buildBreakdown(
      metrics.fixedExpensesMonthly,
      metrics.variableExpensesMonthly,
      metrics.exceptionalExpensesMonthly,
      metrics.debtPaymentsMonthly,
      metrics.taxReserveMonthly,
      metrics.monthlySavingsCapacity,
      expenseBreakdown
    );
    const snapshot = buildSnapshot(metrics, breakdownSnapshot, !!expenseBreakdown.top.length);
    const suggestedActions = buildSuggestedActions(
      metrics,
      impacts,
      flags,
      metrics.taxReserveMonthly > 0
    );

    const dataQualityWarnings = [];
    if (!metrics.incomeNetMonthly) {
      dataQualityWarnings.push({
        id: "income-missing",
        message: "Le revenu net mensuel est manquant ou nul, certains ratios sont impossibles à calculer.",
      });
    }
    if (baselineMonthly === 0) {
      dataQualityWarnings.push({
        id: "baseline-zero",
        message: "Les dépenses fixes et variables sont vides, impossible d’évaluer la sécurité réelle.",
      });
    }
    if (!currentSavings) {
      dataQualityWarnings.push({
        id: "current-savings-missing",
        message: "L’épargne de sécurité n’est pas renseignée, les mois de couverture peuvent être sous-estimés.",
      });
    }

    return {
      metrics,
      flags,
      topIssues,
      impacts,
      snapshot,
      suggestedActions,
      dataQualityWarnings,
      breakdown: {
        categories: expenseBreakdown.entries,
        fixed: fixedBreakdown.entries,
        variable: variableBreakdown.entries,
        largestCategory: expenseBreakdown.entries[0] || null,
        largestFixedCategory: fixedBreakdown.entries[0] || null,
        largestVariableCategory: variableBreakdown.entries[0] || null,
      },
      savings: {
        currentSavings,
        currentAccountBalance,
        investmentBalance,
      },
    };
  }

  return {
    analyze,
  };
});
