(() => {
  const SNAPSHOT_VERSION = "1.0.0";
  const LOCALE = "fr-CH";

  const toNumber =
    window.toNumber ||
    ((value) => {
      const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    });

  const ensureArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

  const formatMonthKey = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return "";
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const getMonthKey = (date = new Date()) => formatMonthKey(date);

  const sanitizeFormData = (formData = {}) => {
    try {
      return JSON.parse(JSON.stringify(formData || {}));
    } catch (_error) {
      return {};
    }
  };

  const buildProjectionSummary = (projectionResult = {}, years = 10) => {
    const netWorthCurrent = Number(projectionResult?.current?.netWorth ?? 0);
    const netWorthSmartSave = Number(projectionResult?.smartSave?.netWorth ?? 0);
    const gain = Number(
      projectionResult?.deltaNetWorth ?? (netWorthSmartSave - netWorthCurrent) ?? 0
    );
    return {
      netWorthCurrent,
      netWorthSmartSave,
      gain,
      years,
    };
  };

  const safeScore = (formData) => {
    const engine = window.FinancialScoreEngine;
    if (!engine?.calculateScore) return null;
    try {
      return engine.calculateScore(formData);
    } catch (_error) {
      return null;
    }
  };

  const safeAllocation = (formData) => {
    const engine = window.AllocationEngine;
    if (!engine?.calculateAllocation) return null;
    try {
      return engine.calculateAllocation(formData);
    } catch (_error) {
      return null;
    }
  };

  const safeProjection = (formData, years) => {
    const engine = window.ProjectionEngine;
    if (!engine?.calculateProjection) return null;
    try {
      return engine.calculateProjection(formData, { years });
    } catch (_error) {
      return null;
    }
  };

  const safeTaxSummary = (formData) => {
    const engine = window.TaxEngine;
    if (!engine?.calculateAnnualTax) return null;
    try {
      return engine.calculateAnnualTax(formData);
    } catch (_error) {
      return null;
    }
  };

  const resolveMonthlyAmount = (entry) => {
    if (!entry) return 0;
    if (typeof window.toMonthlyEntryAmount === "function") {
      return Math.max(0, toNumber(window.toMonthlyEntryAmount(entry)));
    }
    const amount = Math.max(0, toNumber(entry.amount));
    const frequency = String(entry.frequency || "").toLowerCase();
    if (!frequency || frequency.includes("mens")) return amount;
    if (frequency.includes("ann")) return amount / 12;
    if (frequency.includes("trim")) return amount / 3;
    if (frequency.includes("heb")) return amount * 4.33;
    return amount;
  };

  const computeMonthlyIncome = (formData = {}) => {
    const entries = ensureArray(formData.incomes?.entries);
    const base = entries.reduce((sum, entry) => {
      if (typeof window.getIncomeMonthlyAmount === "function") {
        return sum + Math.max(0, toNumber(window.getIncomeMonthlyAmount(entry)));
      }
      return sum + Math.max(0, toNumber(entry?.amount));
    }, 0);
    const spouse =
      toNumber(formData.incomes?.spouseNetIncome) ||
      toNumber(formData.incomes?.spouseIncome) ||
      toNumber(formData.spouseIncome);
    return base + Math.max(0, spouse);
  };

  const computeSpendingTotals = (formData = {}) => {
    const fixed = ensureArray(formData.expenses?.fixed).reduce(
      (sum, entry) => sum + resolveMonthlyAmount(entry),
      0
    );
    const variable = ensureArray(formData.expenses?.variable).reduce(
      (sum, entry) => sum + resolveMonthlyAmount(entry),
      0
    );
    const exceptional = ensureArray(formData.expenses?.exceptional).reduce(
      (sum, entry) => sum + resolveMonthlyAmount(entry),
      0
    );
    return {
      fixed,
      variable,
      exceptional,
      total: fixed + variable + exceptional,
    };
  };

  const computeLiquidity = (assets = {}) => {
    const keys = [
      "currentAccount",
      "compteCourant",
      "checking",
      "paymentAccount",
      "paymentBalance",
      "securitySavings",
      "securityBalance",
      "savingsAccount",
      "savings",
      "epargne",
      "blocked",
      "securityBlocked",
    ];
    return keys.reduce((sum, key) => sum + Math.max(0, toNumber(assets[key])), 0);
  };

  const computeDebtMonthly = (formData = {}) => {
    const credits = formData.credits || {};
    const loans = Array.isArray(credits.loans) ? credits.loans : [];
    return loans.reduce((sum, loan) => {
      const amount =
        toNumber(loan.monthlyAmount) ||
        toNumber(loan.monthly) ||
        toNumber(loan.mensualite) ||
        toNumber(loan.payment) ||
        toNumber(loan.monthlyPayment);
      return sum + Math.max(0, amount);
    }, 0);
  };

  const resolveKeyMetrics = (formData = {}) => {
    const income = computeMonthlyIncome(formData);
    const spendingTotals = computeSpendingTotals(formData);
    const expenses = spendingTotals.total;
    const liquidity = computeLiquidity(formData.assets || {});
    const debtMonthly = computeDebtMonthly(formData);
    return {
      income,
      expenses,
      surplus: income - expenses - debtMonthly,
      liquidity,
      safetyMonths: expenses > 0 ? liquidity / expenses : 0,
      debtMonthly,
      spendingTotals,
    };
  };

  const buildSnapshot = (formData, options = {}) => {
    const sanitizedFormData = sanitizeFormData(formData);
    const now = new Date();
    const years = Math.max(1, Number(options.years) || 10);

    const score = safeScore(sanitizedFormData);
    const allocation = safeAllocation(sanitizedFormData);
    const projection = safeProjection(sanitizedFormData, years);
    const taxSummary = safeTaxSummary(sanitizedFormData);

    const keyMetrics = resolveKeyMetrics(sanitizedFormData);

    return {
      meta: {
        snapshotVersion: SNAPSHOT_VERSION,
        createdAtISO: now.toISOString(),
        monthKey: getMonthKey(now),
        userId: options.userId ?? null,
        locale: LOCALE,
      },
      calcMeta: {
        engines: {
          score: "FinancialScoreEngine",
          allocation: "AllocationEngine",
          projection: "ProjectionEngine",
          tax: "TaxEngine",
        },
        snapshotVersion: SNAPSHOT_VERSION,
      },
      inputs: {
        sanitizedFormData,
      },
      outputs: {
        score,
        allocation,
        projection,
        projectionSummary: buildProjectionSummary(projection, years),
        taxSummary,
        keyMetrics,
        spendingTotals: keyMetrics.spendingTotals,
        spendingAnalysis: null,
      },
    };
  };

  window.SmartSaveSnapshot = {
    SNAPSHOT_VERSION,
    buildSnapshot,
  };
})();
