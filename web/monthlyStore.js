(() => {
  const STORE_KEY = "smartsaveMonthlyStore";
  const DEBUG_NOW_KEY = "smartsaveDebugNow";
  const TRANSACTIONS_KEY = "transactions";
  const MAX_STORE_RAW_BYTES = 1_500_000;
  const MAX_TRANSACTIONS_RAW_BYTES = 2_500_000;
  const VARIABLE_BUDGET_SWEEP_RULE = [
    { to: "security", toLabel: "Compte épargne", share: 0.4 },
    { to: "pillar3a", toLabel: "3e pilier", share: 0.3 },
    { to: "investments", toLabel: "Investissements", share: 0.3 },
  ];
  const MONTHLY_FLOW_STATES = Object.freeze({
    NEW_MONTH: "NOUVEAU_MOIS",
    BUDGET_READY: "BUDGET_FAIT_REPARTITION_NON_VUE",
    PLAN_READY: "PLAN_REPARTITION_VALIDE",
    MONTH_REVIEW: "FIN_MOIS_A_CLOTURER",
    MONTH_CLOSED: "MOIS_CLOTURE",
  });
  const MONTHLY_FLOW_UI = Object.freeze({
    [MONTHLY_FLOW_STATES.NEW_MONTH]: {
      message: "Commence ton mois en définissant ton budget.",
      ctaLabel: "Faire mon budget",
      action: "open_budget",
    },
    [MONTHLY_FLOW_STATES.BUDGET_READY]: {
      message: "Ton budget est prêt — regarde maintenant ta répartition.",
      ctaLabel: "Voir la répartition",
      action: "open_allocation",
    },
    [MONTHLY_FLOW_STATES.PLAN_READY]: {
      message: "Ton plan est en place — le mois peut se dérouler.",
      ctaLabel: "Voir mon plan",
      action: "open_plan",
    },
    [MONTHLY_FLOW_STATES.MONTH_REVIEW]: {
      message: "Ton mois est terminé — fais le bilan.",
      ctaLabel: "Faire le bilan",
      action: "open_review",
    },
    [MONTHLY_FLOW_STATES.MONTH_CLOSED]: {
      message: "Nouveau mois prêt — relance ton budget.",
      ctaLabel: "Faire mon budget",
      action: "open_budget",
    },
  });

  const toNumber = (value) => {
    if (typeof window.toNumber === "function") return window.toNumber(value);
    const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const ensureArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

  const toISODate = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return "";
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const resolveDebugNow = (fallback = new Date()) => {
    const base = fallback instanceof Date ? fallback : new Date(fallback);
    try {
      const raw = localStorage.getItem(DEBUG_NOW_KEY);
      if (!raw) return base;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? base : parsed;
    } catch (_error) {
      return base;
    }
  };

  const getMonthId = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return "";
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const parseMonthId = (monthId) => {
    const parts = String(monthId || "").split("-");
    if (parts.length !== 2) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return new Date(year, month, 1);
  };

  const addMonths = (monthId, delta) => {
    const date = parseMonthId(monthId);
    if (!date) return "";
    return getMonthId(new Date(date.getFullYear(), date.getMonth() + delta, 1));
  };

  const MAX_MONTH_CATCH_UP_STEPS = 36;

  const getMonthDistance = (fromMonthId, toMonthId) => {
    const fromDate = parseMonthId(fromMonthId);
    const toDate = parseMonthId(toMonthId);
    if (!fromDate || !toDate) return 0;
    return (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth());
  };

  const resolveMonthlyAmount = (entry = {}) => {
    if (typeof window.toMonthlyEntryAmount === "function") {
      return Math.max(0, toNumber(window.toMonthlyEntryAmount(entry)));
    }
    const amount = Math.max(0, toNumber(entry.amount));
    const frequency = String(entry.frequency || "").toLowerCase();
    if (!frequency || frequency.includes("mens")) return amount;
    if (frequency.includes("ann")) return amount / 12;
    if (frequency.includes("trim")) return amount / 3;
    if (frequency.includes("sem")) return (amount * 52) / 12;
    if (frequency.includes("heb")) return (amount * 52) / 12;
    return amount;
  };

  const deepClone = (value) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return null;
    }
  };

  const readStore = () => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw && raw.length > MAX_STORE_RAW_BYTES) return {};
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const writeStore = (state) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state || {}));
    } catch (_error) {
      // ignore storage issues
    }
  };

  const getUserSettingsFromForm = (formData = {}) => {
    const allocationPlan =
      formData.allocationPlan && typeof formData.allocationPlan === "object"
        ? deepClone(formData.allocationPlan) || {}
        : {};

    const fixedExpenses = ensureArray(formData.expenses?.fixed)
      .map((item = {}, index) => {
        const label = item.label || item.name || `Charge fixe ${index + 1}`;
        const amount = resolveMonthlyAmount(item);
        return {
          label,
          amount,
          frequency: item.frequency || "mensuel",
        };
      })
      .filter((item) => item.amount > 0);

    const mandatoryExpenses = ensureArray(formData.expenses?.variable)
      .map((item = {}, index) => {
        const label = item.label || item.name || `Charge variable ${index + 1}`;
        const amount = resolveMonthlyAmount(item);
        return {
          label,
          amount,
          frequency: item.frequency || "mensuel",
        };
      })
      .filter((item) => item.amount > 0);

    const preferences = {
      salaryDay:
        formData.preferences?.salaryDay ||
        formData.salaryDay ||
        formData.incomes?.salaryDay ||
        null,
    };

    const resolveTaxDueDate = () => {
      const explicitDate =
        formData?.taxes?.taxDueDate ||
        formData?.taxes?.dueDate ||
        formData?.taxDueDate ||
        null;
      if (explicitDate) return String(explicitDate);
      const now = new Date();
      const dueYear = now.getFullYear() + 1;
      return `${dueYear}-03-31`;
    };
    const taxDueDate = resolveTaxDueDate();
    const thirteenthMonth = Math.max(
      1,
      Math.min(
        12,
        Math.round(
          toNumber(
            formData?.incomes?.thirteenthMonth ||
              formData?.incomes?.thirteenthSalaryMonth ||
              formData?.personal?.thirteenthSalaryMonth ||
              12
          )
        )
      )
    );
    const bonusMonthly = Math.max(
      0,
      toNumber(
        formData?.incomes?.bonusMonthly ||
          formData?.incomes?.regularBonusMonthly ||
          formData?.personal?.bonusMonthly ||
          0
      )
    );
    const taxFacts = {
      canton: String(formData?.taxes?.canton || formData?.personal?.canton || "").trim() || null,
      employmentStatus: String(formData?.personal?.employmentStatus || "").trim() || null,
      hasThirteenthSalary:
        formData?.incomes?.thirteenth === "oui" ||
        formData?.incomes?.thirteenth === true ||
        Boolean(formData?.incomes?.thirteenthSalary),
      thirteenthSalaryMonth: thirteenthMonth,
      bonusMonthly,
      taxDueDate,
      taxDueMonth: String(taxDueDate).slice(0, 7),
    };

    return {
      allocationPlan,
      fixedExpenses,
      mandatoryExpenses,
      preferences,
      taxFacts,
      taxMode: "AUTO_PROVISION",
      taxOnboardingChoice: null,
      taxLumpSumExpectedAmount: 0,
      taxLumpSumExpectedMonth: null,
      taxDueDate,
      taxDueMonth: String(taxDueDate).slice(0, 7),
    };
  };

  const mergeUserSettings = (existing = {}, nextFromForm = {}) => {
    const base = nextFromForm && typeof nextFromForm === "object" ? nextFromForm : {};
    const prev = existing && typeof existing === "object" ? existing : {};
    const merged = {
      ...base,
      ...prev,
      allocationPlan:
        base.allocationPlan && typeof base.allocationPlan === "object"
          ? { ...base.allocationPlan }
          : {},
      fixedExpenses: Array.isArray(base.fixedExpenses) ? base.fixedExpenses : [],
      mandatoryExpenses: Array.isArray(base.mandatoryExpenses) ? base.mandatoryExpenses : [],
      preferences:
        base.preferences && typeof base.preferences === "object" ? { ...base.preferences } : {},
      taxFacts:
        base.taxFacts && typeof base.taxFacts === "object" ? { ...base.taxFacts } : {},
    };
    if (prev.allocationPlan && typeof prev.allocationPlan === "object") {
      merged.allocationPlan = { ...merged.allocationPlan, ...prev.allocationPlan };
    }
    if (prev.preferences && typeof prev.preferences === "object") {
      merged.preferences = { ...merged.preferences, ...prev.preferences };
    }
    if (prev.taxFacts && typeof prev.taxFacts === "object") {
      merged.taxFacts = { ...merged.taxFacts, ...prev.taxFacts };
    }
    merged.taxMode = String(base.taxMode || prev.taxMode || "AUTO_PROVISION").toUpperCase();
    merged.taxOnboardingChoice =
      String(base.taxOnboardingChoice ?? prev.taxOnboardingChoice ?? "")
        .trim()
        .toUpperCase() || null;
    merged.taxLumpSumExpectedAmount = Math.max(
      0,
      toNumber(base.taxLumpSumExpectedAmount ?? prev.taxLumpSumExpectedAmount ?? 0)
    );
    merged.taxLumpSumExpectedMonth =
      String(base.taxLumpSumExpectedMonth || prev.taxLumpSumExpectedMonth || "").trim() || null;
    merged.taxDueDate = base.taxDueDate || prev.taxDueDate || merged.taxFacts?.taxDueDate || null;
    merged.taxDueMonth = base.taxDueMonth || prev.taxDueMonth || (merged.taxDueDate || "").slice(0, 7) || null;
    return merged;
  };

  const applySettingsPatch = (target = {}, patch = {}) => {
    if (!patch || typeof patch !== "object") return target;
    Object.keys(patch).forEach((key) => {
      const nextValue = patch[key];
      if (Array.isArray(nextValue)) {
        target[key] = nextValue.map((entry) =>
          entry && typeof entry === "object" ? { ...entry } : entry
        );
        return;
      }
      if (nextValue && typeof nextValue === "object") {
        const baseValue =
          target[key] && typeof target[key] === "object" && !Array.isArray(target[key])
            ? { ...target[key] }
            : {};
        target[key] = applySettingsPatch(baseValue, nextValue);
        return;
      }
      target[key] = nextValue;
    });
    return target;
  };

  const getMonthlyInputsSnapshot = (formData = {}, mvpData = {}, monthlyBudget = null) => {
    const normalizedBudget =
      monthlyBudget && typeof monthlyBudget === "object"
        ? normalizeMonthlyBudget(monthlyBudget, monthlyBudget)
        : null;
    const useBudgetSnapshot = Boolean(normalizedBudget);
    const fixedTotal = ensureArray(formData.expenses?.fixed).reduce(
      (sum, item) => sum + resolveMonthlyAmount(item),
      0
    );
    const mandatoryTotal = ensureArray(formData.expenses?.variable).reduce(
      (sum, item) => sum + resolveMonthlyAmount(item),
      0
    );
    const fixedFromBudget = Math.max(0, toNumber(normalizedBudget?.fixedTotal || 0));
    const mandatoryFromBudget = Math.max(0, toNumber(normalizedBudget?.mandatoryTotal || 0));

    const loans = ensureArray(formData.loans);
    const debtsTotal = loans.reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          toNumber(
            item?.monthlyAmount || item?.monthlyPayment || item?.monthly || item?.mensualite || 0
          )
        ),
      0
    );

    const revenuNetMensuel = Math.max(
      0,
      toNumber(
        mvpData?.metrics?.monthlyNetIncome ||
          mvpData?.monthlyNetIncome ||
          normalizedBudget?.totalIncome ||
          estimateMonthlyIncomeFromForm(formData)
      )
    );

    const taxesNeed = Math.max(
      0,
      toNumber(mvpData?.taxProvision?.monthlyAmount || mvpData?.taxProvision?.monthlyNeed || 0)
    );

    return {
      revenuNetMensuel,
      fixedTotal: useBudgetSnapshot ? fixedFromBudget : fixedTotal,
      mandatoryTotal: useBudgetSnapshot ? mandatoryFromBudget : mandatoryTotal,
      debtsTotal,
      taxesNeed,
    };
  };

  const getAllocationResultSnapshot = (mvpData = {}) => {
    const allocations = deepClone(mvpData?.allocation?.allocations) || {};
    const shortTermAccount = mvpData?.allocation?.shortTermAccount || mvpData?.allocation?.debug?.shortTermAccount || {};
    const shortTermKey = String(shortTermAccount?.key || "projetsCourtTerme").trim() || "projetsCourtTerme";
    const shortTermDeduction = Math.max(
      0,
      toNumber(
        mvpData?.allocation?.shortTermDeduction ??
          shortTermAccount?.amount ??
          allocations[shortTermKey] ??
          allocations.projetsCourtTerme ??
          0
      )
    );

    const totalSmartSave = Object.values(allocations).reduce(
      (sum, value) => sum + Math.max(0, toNumber(value)),
      0
    );

    const investedThisMonth =
      Math.max(0, toNumber(allocations.investissements || 0)) +
      Math.max(0, toNumber(allocations.pilier3a || 0));

    return {
      allocations,
      totalSmartSave,
      investedThisMonth,
      shortTermDeduction,
    };
  };

  const resolveBalancesFromAssets = (formData = {}) => {
    const assets = formData.assets || {};
    const sumKeys = (keys = []) =>
      keys.reduce((sum, key) => sum + Math.max(0, toNumber(assets[key])), 0);
    return {
      current: sumKeys(["currentAccount", "compteCourant", "checking", "paymentAccount", "paymentBalance"]),
      security: sumKeys([
        "securitySavings",
        "securityBalance",
        "savingsAccount",
        "savings",
        "epargne",
        "securityBlocked",
        "blocked",
      ]),
      tax: sumKeys(["taxProvision", "impotsProvision", "provisionImpots", "impots", "taxesProvision"]),
      investments: sumKeys(["investments", "investmentAccount", "portfolio", "portefeuille", "placements"]),
      pillar3a: sumKeys(["pillar3a", "thirdPillarAmount", "thirdPillar", "pillar3", "pilier3a", "thirdPillarValue"]),
      projects: 0,
    };
  };

  const normalizeBalances = (balances = {}) => ({
    current: toNumber(balances.current),
    security: toNumber(balances.security),
    tax: toNumber(balances.tax),
    investments: toNumber(balances.investments),
    pillar3a: toNumber(balances.pillar3a),
    projects: toNumber(balances.projects),
  });

  const normalizeAccountKey = (value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    if (["current", "comptecourant", "comptecourant"].includes(key)) return "current";
    if (["security", "securite", "epargne", "savings"].includes(key)) return "security";
    if (["tax", "impots", "provisionimpots"].includes(key)) return "tax";
    if (["investments", "investissement", "investissements"].includes(key)) return "investments";
    if (["pillar3a", "pilier3a", "thirdpillar", "pillar3"].includes(key)) return "pillar3a";
    if (["projects", "projets", "projetslongterme", "projetscourtterme", "longterm", "shortterm"].includes(key))
      return "projects";
    return key;
  };

  const estimateMonthlyIncomeFromForm = (formData = {}) => {
    if (typeof window.buildIncomeBreakdownEntries === "function") {
      return Math.max(
        0,
        ensureArray(window.buildIncomeBreakdownEntries(formData)).reduce(
          (sum, entry) => sum + Math.max(0, toNumber(entry?.amount)),
          0
        )
      );
    }
    const incomes = ensureArray(formData?.incomes?.entries);
    const base = incomes.reduce((sum, entry) => {
      if (typeof window.getIncomeMonthlyAmount === "function") {
        return sum + Math.max(0, toNumber(window.getIncomeMonthlyAmount(entry)));
      }
      return sum + Math.max(0, toNumber(entry?.amount));
    }, 0);
    const spouse =
      toNumber(formData?.incomes?.spouseNetIncome) ||
      toNumber(formData?.incomes?.spouseIncome) ||
      toNumber(formData?.spouseIncome);
    return Math.max(0, base + Math.max(0, spouse));
  };

  const normalizeBudgetFixedItems = (items = []) =>
    ensureArray(items)
      .map((item = {}, index) => ({
        id: String(item.id || `fixed-${index + 1}`).trim() || `fixed-${index + 1}`,
        label: String(item.label || `Charge fixe ${index + 1}`).trim() || `Charge fixe ${index + 1}`,
        amount: Math.max(0, toNumber(item.amount)),
      }))
      .filter((item) => item.amount >= 0);

  const buildBudgetExpenseItemsFromForm = (entries = [], labelPrefix = "Charge") =>
    ensureArray(entries)
      .map((entry = {}, index) => ({
        id:
          String(entry.id || `${labelPrefix.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`).trim() ||
          `${labelPrefix.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
        label: String(entry.label || entry.name || `${labelPrefix} ${index + 1}`).trim() || `${labelPrefix} ${index + 1}`,
        amount: Math.max(0, resolveMonthlyAmount(entry)),
      }))
      .filter((item) => item.amount >= 0);

  const applyFormExpensesToBudget = (budget = {}, formData = {}) => {
    const expenses = formData?.expenses || {};
    const hasFixed = Array.isArray(expenses.fixed);
    const hasMandatory = Array.isArray(expenses.variable);
    if (!hasFixed && !hasMandatory) return normalizeMonthlyBudget(budget, budget);

    const patched = { ...(budget || {}) };
    if (hasFixed) {
      const fixedItems = buildBudgetExpenseItemsFromForm(expenses.fixed, "Charge fixe");
      patched.fixedItems = fixedItems;
      patched.fixedTotal = fixedItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    }
    if (hasMandatory) {
      const mandatoryItems = buildBudgetExpenseItemsFromForm(expenses.variable, "Charge obligatoire");
      patched.mandatoryItems = mandatoryItems;
      patched.mandatoryTotal = mandatoryItems.reduce(
        (sum, item) => sum + Math.max(0, toNumber(item.amount)),
        0
      );
    }
    return normalizeMonthlyBudget(patched, patched);
  };

  const toVariableMonthlyAmount = (amount, period) => {
    const safe = Math.max(0, toNumber(amount));
    if (period === "week") return (safe * 52) / 12;
    if (period === "year") return safe / 12;
    return safe;
  };

  const normalizeVariableBudgetCategories = (items = [], fallbackSplit = {}) => {
    const rows = ensureArray(items)
      .map((item = {}, index) => {
        const period = ["week", "month", "year"].includes(item.period) ? item.period : "month";
        const amount = Math.max(0, toNumber(item.amount));
        return {
          id: String(item.id || `variable-${index + 1}`).trim() || `variable-${index + 1}`,
          label: String(item.label || `Catégorie ${index + 1}`).trim() || `Catégorie ${index + 1}`,
          period,
          amount,
          monthlyAmount: Math.max(0, toVariableMonthlyAmount(amount, period)),
        };
      })
      .filter((item) => item.label || item.amount > 0);

    if (rows.length) return rows;

    const legacy = [
      { label: "Nourriture", amount: Math.max(0, toNumber(fallbackSplit?.food)) },
      { label: "Loisirs / sorties", amount: Math.max(0, toNumber(fallbackSplit?.leisure)) },
      { label: "Divers", amount: Math.max(0, toNumber(fallbackSplit?.misc)) },
    ].filter((entry) => entry.amount > 0);

    return legacy.map((entry, index) => ({
      id: `variable-legacy-${index + 1}`,
      label: entry.label,
      period: "month",
      amount: entry.amount,
      monthlyAmount: entry.amount,
    }));
  };

  const variableLegacySplitFromCategories = (categories = []) => {
    const split = { food: 0, leisure: 0, misc: 0 };
    ensureArray(categories).forEach((item) => {
      const monthly = Math.max(0, toNumber(item?.monthlyAmount));
      const label = String(item?.label || "").toLowerCase();
      if (!monthly) return;
      if (label.includes("nourr") || label.includes("food") || label.includes("course")) {
        split.food += monthly;
        return;
      }
      if (label.includes("loisir") || label.includes("sortie") || label.includes("restaurant") || label.includes("resto")) {
        split.leisure += monthly;
        return;
      }
      split.misc += monthly;
    });
    return {
      food: Math.round(split.food * 100) / 100,
      leisure: Math.round(split.leisure * 100) / 100,
      misc: Math.round(split.misc * 100) / 100,
    };
  };

  const normalizeMonthlyBudget = (budget = {}, fallback = {}) => {
    const inputIncomeItems = ensureArray(
      budget.incomeItems != null ? budget.incomeItems : fallback.incomeItems
    );
    const normalizedIncomeItems = inputIncomeItems
      .map((item = {}, index) => ({
        id: String(item.id || `income-${index + 1}`).trim() || `income-${index + 1}`,
        label: String(item.label || `Revenu ${index + 1}`).trim() || `Revenu ${index + 1}`,
        amount: Math.max(0, toNumber(item.amount)),
      }))
      .filter((item) => item.label || item.amount > 0);
    const incomeMain = Math.max(0, toNumber(budget.incomeMain ?? fallback.incomeMain));
    const incomeOther = Math.max(0, toNumber(budget.incomeOther ?? fallback.incomeOther));
    const incomeFromItems = normalizedIncomeItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    const totalIncome = Math.max(
      0,
      toNumber(budget.totalIncome ?? (incomeFromItems || incomeMain + incomeOther))
    );
    const fixedItems = normalizeBudgetFixedItems(
      budget.fixedItems != null ? budget.fixedItems : fallback.fixedItems
    );
    const fixedTotal = Math.max(
      0,
      toNumber(
        budget.fixedTotal != null
          ? budget.fixedTotal
          : fixedItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0)
      )
    );
    const mandatoryItems = normalizeBudgetFixedItems(
      budget.mandatoryItems != null ? budget.mandatoryItems : fallback.mandatoryItems
    );
    const mandatoryTotal = Math.max(
      0,
      toNumber(
        budget.mandatoryTotal != null
          ? budget.mandatoryTotal
          : mandatoryItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0)
      )
    );
    const variablePlanned = Math.max(
      0,
      toNumber(budget.variablePlanned ?? fallback.variablePlanned)
    );
    const variableSplitEnabled = Boolean(
      budget.variableSplitEnabled ?? fallback.variableSplitEnabled
    );
    const splitInput = budget.variableSplit || fallback.variableSplit || {};
    const variableCategories = normalizeVariableBudgetCategories(
      budget.variableCategories != null ? budget.variableCategories : fallback.variableCategories,
      splitInput
    );
    const baseSplit = {
      food: Math.max(0, toNumber(splitInput.food)),
      leisure: Math.max(0, toNumber(splitInput.leisure)),
      misc: Math.max(0, toNumber(splitInput.misc)),
    };
    const derivedSplit = variableLegacySplitFromCategories(variableCategories);
    const variableSplit =
      variableSplitEnabled && variableCategories.length
        ? derivedSplit
        : {
            food: baseSplit.food,
            leisure: baseSplit.leisure,
            misc: baseSplit.misc,
          };
    const remaining = Math.round((totalIncome - fixedTotal - mandatoryTotal - variablePlanned) * 100) / 100;
    return {
      incomeMain,
      incomeOther,
      incomeItems: normalizedIncomeItems.length
        ? normalizedIncomeItems
        : [
            {
              id: "income-main",
              label: "Revenu principal",
              amount: Math.max(0, incomeMain),
            },
            ...(incomeOther > 0
              ? [
                  {
                    id: "income-other",
                    label: "Autre revenu",
                    amount: Math.max(0, incomeOther),
                  },
                ]
              : []),
          ],
      totalIncome,
      fixedItems,
      fixedTotal,
      mandatoryItems,
      mandatoryTotal,
      variablePlanned,
      variableSplitEnabled,
      variableSplit,
      variableCategories,
      remaining,
      source: String(budget.source || fallback.source || "").trim() || null,
      savedAt: budget.savedAt || fallback.savedAt || null,
    };
  };

  const getDefaultMonthlyBudget = ({ bucket, monthId, formData = {} }) => {
    const previousMonthId = addMonths(monthId, -1);
    const previousBudget = previousMonthId
      ? deepClone(bucket?.monthlyPlan?.[previousMonthId]?.monthlyBudget)
      : null;
    if (previousBudget && typeof previousBudget === "object") {
      return normalizeMonthlyBudget(previousBudget, previousBudget);
    }

    const fallbackFixedItems = normalizeBudgetFixedItems(
      ensureArray(bucket?.userSettings?.fixedExpenses).map((entry, index) => ({
        id: entry.id || `fixed-${index + 1}`,
        label: entry.label || `Charge fixe ${index + 1}`,
        amount: Math.max(0, toNumber(entry.amount)),
      }))
    );
    const fallbackMandatoryItems = normalizeBudgetFixedItems(
      ensureArray(bucket?.userSettings?.mandatoryExpenses).map((entry, index) => ({
        id: entry.id || `mandatory-${index + 1}`,
        label: entry.label || `Charge obligatoire ${index + 1}`,
        amount: Math.max(0, toNumber(entry.amount)),
      }))
    );
    const fixedTotal = fallbackFixedItems.reduce(
      (sum, item) => sum + Math.max(0, toNumber(item.amount)),
      0
    );
    const mandatoryTotal = fallbackMandatoryItems.reduce(
      (sum, item) => sum + Math.max(0, toNumber(item.amount)),
      0
    );
    const totalIncome = Math.max(0, estimateMonthlyIncomeFromForm(formData));
    const variablePlanned = Math.max(
      0,
      toNumber(
        bucket?.userSettings?.allocationPlan?.leisureMonthly ||
          formData?.allocationPlan?.leisureMonthly ||
          0
      )
    );
    return normalizeMonthlyBudget(
      {
        incomeMain: totalIncome,
        incomeOther: 0,
        incomeItems: [{ id: "income-main", label: "Revenu principal", amount: totalIncome }],
        totalIncome,
        fixedItems: fallbackFixedItems,
        fixedTotal,
        mandatoryItems: fallbackMandatoryItems,
        mandatoryTotal,
        variablePlanned,
        variableSplitEnabled: false,
        variableSplit: { food: 0, leisure: 0, misc: 0 },
        variableCategories: [],
      },
      {}
    );
  };

  const applyTransactionsToBalances = (baseBalances = {}, transactions = []) => {
    const balances = normalizeBalances(baseBalances);
    ensureArray(transactions).forEach((entry) => {
      const amount = Math.max(0, toNumber(entry?.amount));
      if (!amount) return;
      if (entry.type === "income") {
        const account = normalizeAccountKey(entry.account || "current");
        if (Object.prototype.hasOwnProperty.call(balances, account)) balances[account] += amount;
        return;
      }
      if (entry.type === "expense") {
        const account = normalizeAccountKey(entry.account || "current");
        if (Object.prototype.hasOwnProperty.call(balances, account)) balances[account] -= amount;
        return;
      }
      if (entry.type === "transfer") {
        const from = normalizeAccountKey(entry.from || "");
        const to = normalizeAccountKey(entry.to || "");
        if (from && Object.prototype.hasOwnProperty.call(balances, from)) balances[from] -= amount;
        if (to && Object.prototype.hasOwnProperty.call(balances, to)) balances[to] += amount;
      }
    });
    return balances;
  };

  const getTransactionsForMonth = (transactions = [], userId, monthId) =>
    ensureArray(transactions).filter((entry) => {
      if (!entry || !monthId) return false;
      if (userId && entry.userId && String(entry.userId).trim() !== String(userId).trim()) return false;
      return getMonthId(entry.date || entry.createdAt || new Date()) === monthId;
    });

  const toRateDecimal = (value, fallback = 0) => {
    if (value === undefined || value === null || value === "") return fallback;
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric === 0) return fallback;
    return numeric > 1 ? numeric / 100 : numeric;
  };

  const buildMonthlyInterestEntries = ({ userId, monthId, balances = {}, formData = {} }) => {
    if (!userId || !monthId) return [];
    const rates = formData.rates || {};
    const annualRates = {
      security: toRateDecimal(rates.savings, 0.018),
      tax: toRateDecimal(rates.savings, 0.018),
      projects: toRateDecimal(rates.blocked, 0.02),
      pillar3a: toRateDecimal(rates.pillar3, 0.03),
      investments: toRateDecimal(rates.investments, 0.05),
    };
    const labels = {
      security: "Compte épargne",
      tax: "Provision impôts",
      projects: "Compte projets",
      pillar3a: "3e pilier",
      investments: "Investissements",
    };
    const monthDate = parseMonthId(monthId);
    if (!monthDate) return [];
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const date = toISODate(monthEnd);
    const createdAt = new Date().toISOString();

    return Object.keys(annualRates)
      .map((account) => {
        const annualRate = Math.max(0, toRateDecimal(annualRates[account], 0));
        if (!annualRate) return null;
        const balance = Math.max(0, toNumber(balances[account]));
        if (!balance) return null;
        const amount = Math.round((balance * (annualRate / 12)) * 100) / 100;
        if (!amount) return null;
        return {
          id: `interest-${userId}-${monthId}-${account}`,
          userId,
          type: "income",
          amount,
          date,
          createdAt,
          account,
          accountLabel: labels[account] || account,
          category: `Intérêts ${labels[account] || account}`,
          note: "Intérêts mensuels (auto)",
          isFixed: true,
          autoGenerated: true,
          autoApplyKind: "interest",
          autoApplyMonthId: monthId,
        };
      })
      .filter(Boolean);
  };

  const buildVariableBudgetSweepEntries = ({
    userId,
    monthId,
    variableBudget = 0,
    variableSpent = 0,
    currentBalance = 0,
  }) => {
    if (!userId || !monthId) return [];
    const budget = Math.max(0, toNumber(variableBudget));
    const spent = Math.max(0, toNumber(variableSpent));
    const leftover = Math.max(0, budget - spent);
    const availableFromCurrent = Math.max(0, toNumber(currentBalance));
    const sweepTotal = Math.min(leftover, availableFromCurrent);
    if (!sweepTotal) return [];

    const monthDate = parseMonthId(monthId);
    if (!monthDate) return [];
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const date = toISODate(monthEnd);
    const createdAt = new Date().toISOString();

    let allocated = 0;
    return VARIABLE_BUDGET_SWEEP_RULE.map((rule, index) => {
      const isLast = index === VARIABLE_BUDGET_SWEEP_RULE.length - 1;
      const amount = isLast
        ? Math.max(0, Math.round((sweepTotal - allocated) * 100) / 100)
        : Math.max(0, Math.round((sweepTotal * rule.share) * 100) / 100);
      allocated += amount;
      if (!amount) return null;
      return {
        id: `sweep-${userId}-${monthId}-${rule.to}`,
        userId,
        type: "transfer",
        amount,
        date,
        createdAt,
        from: "current",
        fromLabel: "Compte courant",
        to: rule.to,
        toLabel: rule.toLabel,
        note: "Réallocation fin de mois (budget variable non dépensé)",
        isFixed: true,
        autoGenerated: true,
        autoApplyKind: "variable-budget-sweep",
        autoApplyMonthId: monthId,
      };
    }).filter(Boolean);
  };

  const persistGeneratedTransactions = (entries = []) => {
    if (!entries.length) return { added: 0, entries: [] };
    let stored = [];
    try {
      const rawString = localStorage.getItem(TRANSACTIONS_KEY) || "[]";
      if (rawString.length > MAX_TRANSACTIONS_RAW_BYTES) {
        return { added: 0, entries: [] };
      }
      const raw = JSON.parse(rawString);
      stored = Array.isArray(raw) ? raw : [];
    } catch (_error) {
      stored = [];
    }
    const existingIds = new Set(
      stored.map((entry) => String(entry?.id || "").trim()).filter(Boolean)
    );
    const added = [];
    entries.forEach((entry) => {
      const id = String(entry?.id || "").trim();
      if (!id || existingIds.has(id)) return;
      existingIds.add(id);
      stored.push(entry);
      added.push(entry);
    });
    if (!added.length) return { added: 0, entries: [] };
    try {
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(stored));
    } catch (_error) {
      // ignore storage issues
    }
    if (typeof window.syncTransactionToProfile === "function") {
      const syncableEntries = added.filter((entry) => !entry?.autoGenerated);
      syncableEntries.forEach((entry) => window.syncTransactionToProfile(entry, entry.userId));
    }
    return { added: added.length, entries: added };
  };

  const getTrackingTransactionsForMonth = (transactions = [], userId, monthId) =>
    ensureArray(transactions)
      .filter((entry) => {
        if (!entry || entry.type === "transfer") return false;
        if (userId && entry.userId && String(entry.userId).trim() !== String(userId).trim())
          return false;
        return getMonthId(entry.date) === monthId;
      })
      .map((entry) => ({
        id: entry.id || `${entry.type}-${entry.date}-${entry.amount}`,
        date: toISODate(entry.date || new Date()),
        label: String(entry.category || entry.note || (entry.type === "income" ? "Revenu" : "Dépense") || "").trim(),
        amount: Math.max(0, toNumber(entry.amount)),
        type: entry.type === "income" ? "income" : "expense",
        isFixed: Boolean(entry.isFixed),
      }));

  const toClosedReadonly = (plan = {}) => ({
    ...plan,
    flags: {
      ...(plan.flags || {}),
      monthStatus: "closed",
    },
  });

  const hasInputsSnapshotData = (inputs = {}) => {
    const keys = ["revenuNetMensuel", "fixedTotal", "mandatoryTotal", "debtsTotal", "taxesNeed"];
    return keys.some((key) => Math.abs(toNumber(inputs?.[key])) > 0);
  };

  const isInMonthReviewWindow = (monthId, now = new Date()) => {
    const nowMonthId = getMonthId(now);
    if (!monthId || monthId !== nowMonthId) return false;
    const target = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(target.getTime())) return false;
    return target.getDate() >= 25;
  };

  const inferBudgetValidatedAt = (plan = {}) => {
    const flags = plan.flags || {};
    const flow = flags.flow && typeof flags.flow === "object" ? flags.flow : {};
    const budget = plan.monthlyBudget && typeof plan.monthlyBudget === "object" ? plan.monthlyBudget : null;
    const budgetSource = String(budget?.source || "").trim().toLowerCase();
    const hasManualBudget = budgetSource === "manual-budget" || Boolean(budget?.savedAt);
    const allocationValidatedAt =
      flow.allocationValidatedAt ||
      flags.allocationValidatedAt ||
      flags.planAppliedAt ||
      flags.monthlyPlanAppliedAt ||
      null;
    const explicitBudgetValidatedAt = flow.budgetValidatedAt || flags.budgetValidatedAt || null;

    if (explicitBudgetValidatedAt) {
      if (allocationValidatedAt || hasManualBudget) return explicitBudgetValidatedAt;
      if (!budget) return null;
      const isAutoOnlyBudget = budgetSource === "auto-form-sync" && !budget.savedAt;
      if (isAutoOnlyBudget) return null;
      return explicitBudgetValidatedAt;
    }

    if (hasManualBudget) {
      return budget.savedAt || flags.updatedAt || flags.createdAt || new Date().toISOString();
    }
    if (allocationValidatedAt) return allocationValidatedAt;
    return null;
  };

  const inferAllocationValidatedAt = (plan = {}) => {
    const flags = plan.flags || {};
    const flow = flags.flow && typeof flags.flow === "object" ? flags.flow : {};
    if (flow.allocationValidatedAt) return flow.allocationValidatedAt;
    if (flags.allocationValidatedAt) return flags.allocationValidatedAt;
    if (flags.planAppliedAt) return flags.planAppliedAt;
    return null;
  };

  const getFlowStateFromPlan = ({ monthId, monthlyPlan, now = new Date() }) => {
    const plan = monthlyPlan || {};
    const flags = plan.flags || {};
    const monthStatus = String(flags.monthStatus || "active");
    if (monthStatus === "closed") return MONTHLY_FLOW_STATES.MONTH_CLOSED;

    const budgetValidatedAt = inferBudgetValidatedAt(plan);
    if (!budgetValidatedAt) return MONTHLY_FLOW_STATES.NEW_MONTH;

    const allocationValidatedAt = inferAllocationValidatedAt(plan);
    if (!allocationValidatedAt) return MONTHLY_FLOW_STATES.BUDGET_READY;

    if (isInMonthReviewWindow(monthId, now)) return MONTHLY_FLOW_STATES.MONTH_REVIEW;

    return MONTHLY_FLOW_STATES.PLAN_READY;
  };

  const buildFlowUi = (flowState) => {
    const safeState =
      MONTHLY_FLOW_UI[flowState] ? flowState : MONTHLY_FLOW_STATES.NEW_MONTH;
    const ui = MONTHLY_FLOW_UI[safeState];
    return {
      state: safeState,
      message: ui.message,
      ctaLabel: ui.ctaLabel,
      action: ui.action,
    };
  };

  const ensurePlanFlowFlags = (plan = {}, nowIso = null) => {
    if (!plan || typeof plan !== "object") return plan;
    const flags = plan.flags && typeof plan.flags === "object" ? plan.flags : {};
    const flow = flags.flow && typeof flags.flow === "object" ? flags.flow : {};
    const nextFlow = { ...flow };
    const at = nowIso || new Date().toISOString();

    const budgetValidatedAt = inferBudgetValidatedAt(plan);
    const allocationValidatedAt = inferAllocationValidatedAt(plan);

    if (budgetValidatedAt) {
      nextFlow.budgetValidatedAt = budgetValidatedAt;
    } else if (Object.prototype.hasOwnProperty.call(nextFlow, "budgetValidatedAt")) {
      delete nextFlow.budgetValidatedAt;
    }
    if (allocationValidatedAt) {
      nextFlow.allocationValidatedAt = allocationValidatedAt;
    } else if (Object.prototype.hasOwnProperty.call(nextFlow, "allocationValidatedAt")) {
      delete nextFlow.allocationValidatedAt;
    }
    if (flags.monthStatus === "closed" && !nextFlow.reviewCompletedAt) {
      nextFlow.reviewCompletedAt = flags.closedAt || at;
    }

    plan.flags = {
      ...flags,
      flow: nextFlow,
    };
    return plan;
  };

  const ensureMonthEntries = (
    bucket,
    monthId,
    formData,
    mvpData,
    isFirstMonth,
    status,
    startingBalancesOverride = null
  ) => {
    if (!bucket.monthlyPlan[monthId]) {
      const startingBalances = normalizeBalances(
        startingBalancesOverride || resolveBalancesFromAssets(formData)
      );
      bucket.monthlyPlan[monthId] = {
        inputsSnapshot: getMonthlyInputsSnapshot(formData, mvpData),
        allocationResultSnapshot: getAllocationResultSnapshot(mvpData),
        projectionSnapshot: null,
        settingsSnapshot: {
          smart: deepClone(bucket.userSettings?.smartSaveSettings || {}) || {},
          smartSave: deepClone(bucket.userSettings?.smartSaveSettings || {}) || {},
          advanced: deepClone(bucket.userSettings?.advancedSettings || {}) || {},
        },
        flags: {
          planAppliedAt: null,
          monthlyPlanIsApplied: false,
          monthlyPlanIsReady: false,
          isFirstMonth: Boolean(isFirstMonth),
          monthStatus: status || (isFirstMonth ? "setup" : "active"),
          flow: {
            budgetValidatedAt: null,
            allocationValidatedAt: null,
            reviewCompletedAt: null,
          },
          startingBalances,
          closingBalances: null,
          interestAppliedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      ensurePlanFlowFlags(bucket.monthlyPlan[monthId]);
    }

    if (!bucket.monthlyTracking[monthId]) {
      const variableBudget = Math.max(
        0,
        toNumber(
          bucket.userSettings?.allocationPlan?.leisureMonthly ||
            formData?.allocationPlan?.leisureMonthly ||
            0
        )
      );
      bucket.monthlyTracking[monthId] = {
        variableBudget,
        variableSpent: 0,
        transactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  };

  const syncTrackingWithTransactions = (bucket, userId, monthId, transactions = []) => {
    const tracking = bucket.monthlyTracking[monthId];
    if (!tracking) return;
    const monthTransactions = getTrackingTransactionsForMonth(transactions, userId, monthId);
    const variableSpent = monthTransactions.reduce((sum, entry) => {
      if (entry.type !== "expense") return sum;
      if (entry.isFixed) return sum;
      return sum + Math.max(0, toNumber(entry.amount));
    }, 0);
    tracking.transactions = monthTransactions;
    tracking.variableSpent = variableSpent;
    tracking.updatedAt = new Date().toISOString();
  };

  const normalizeUserState = (state, userId) => {
    const base = state[userId];
    if (base && typeof base === "object") {
      return {
        currentMonthId: base.currentMonthId || getMonthId(new Date()),
        userSettings: base.userSettings && typeof base.userSettings === "object" ? base.userSettings : {},
        monthlyPlan: base.monthlyPlan && typeof base.monthlyPlan === "object" ? base.monthlyPlan : {},
        monthlyTracking:
          base.monthlyTracking && typeof base.monthlyTracking === "object" ? base.monthlyTracking : {},
      };
    }
    return {
      currentMonthId: getMonthId(new Date()),
      userSettings: {},
      monthlyPlan: {},
      monthlyTracking: {},
    };
  };

  const ensureUserMonthContext = ({
    userId,
    formData = {},
    mvpData = {},
    allTransactions = [],
    now = new Date(),
  }) => {
    if (!userId) return null;
    const effectiveNow = resolveDebugNow(now);

    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const monthNow = getMonthId(effectiveNow);

    bucket.userSettings = mergeUserSettings(bucket.userSettings, getUserSettingsFromForm(formData));

    const hasAnyPlan = Object.keys(bucket.monthlyPlan || {}).length > 0;
    if (!hasAnyPlan) {
      bucket.currentMonthId = monthNow;
      ensureMonthEntries(bucket, monthNow, formData, mvpData, true, "setup");
    }

    let cursor = bucket.currentMonthId || monthNow;
    if (!bucket.monthlyPlan[cursor]) {
      ensureMonthEntries(bucket, cursor, formData, mvpData, false, "active");
    }

    let workingTransactions = ensureArray(allTransactions);

    const monthDistance = getMonthDistance(cursor, monthNow);
    if (monthDistance > MAX_MONTH_CATCH_UP_STEPS) {
      cursor = monthNow;
      bucket.currentMonthId = monthNow;
      ensureMonthEntries(bucket, monthNow, formData, mvpData, false, "active");
    }

    let rolloverSteps = 0;
    while (cursor < monthNow) {
      rolloverSteps += 1;
      if (rolloverSteps > MAX_MONTH_CATCH_UP_STEPS) {
        cursor = monthNow;
        bucket.currentMonthId = monthNow;
        ensureMonthEntries(bucket, monthNow, formData, mvpData, false, "active");
        break;
      }
      const currentPlan = bucket.monthlyPlan[cursor];
      let closingBalances = normalizeBalances(resolveBalancesFromAssets(formData));
      if (currentPlan) {
        const monthTransactions = getTransactionsForMonth(workingTransactions, userId, cursor);
        const startingBalances = normalizeBalances(
          currentPlan.flags?.startingBalances || resolveBalancesFromAssets(formData)
        );
        const trackingEntries = getTrackingTransactionsForMonth(workingTransactions, userId, cursor);
        const variableSpent = trackingEntries.reduce((sum, entry) => {
          if (entry.type !== "expense") return sum;
          if (entry.isFixed) return sum;
          return sum + Math.max(0, toNumber(entry.amount));
        }, 0);
        const variableBudget = Math.max(
          0,
          toNumber(bucket.monthlyTracking?.[cursor]?.variableBudget || 0)
        );

        const balancesAfterTransactions = applyTransactionsToBalances(startingBalances, monthTransactions);
        const sweepEntries = buildVariableBudgetSweepEntries({
          userId,
          monthId: cursor,
          variableBudget,
          variableSpent,
          currentBalance: balancesAfterTransactions.current,
        });
        const persistedSweep = persistGeneratedTransactions(sweepEntries);
        if (persistedSweep.added > 0) {
          workingTransactions = workingTransactions.concat(persistedSweep.entries);
        }
        const balancesBeforeInterest = applyTransactionsToBalances(
          balancesAfterTransactions,
          persistedSweep.entries
        );

        const interestEntries = buildMonthlyInterestEntries({
          userId,
          monthId: cursor,
          balances: balancesBeforeInterest,
          formData,
        });
        const persistedInterest = persistGeneratedTransactions(interestEntries);
        const balancesAfterInterest = applyTransactionsToBalances(
          balancesBeforeInterest,
          persistedInterest.entries
        );
        closingBalances = balancesAfterInterest;
        bucket.monthlyPlan[cursor] = toClosedReadonly({
          ...currentPlan,
          flags: {
            ...(currentPlan.flags || {}),
            closingBalances: balancesAfterInterest,
            variableBudgetLeftover: Math.max(0, variableBudget - variableSpent),
            variableBudgetSweepAmount: persistedSweep.entries.reduce(
              (sum, entry) => sum + Math.max(0, toNumber(entry.amount)),
              0
            ),
            variableBudgetSweepAppliedAt:
              persistedSweep.added > 0 ? new Date().toISOString() : currentPlan.flags?.variableBudgetSweepAppliedAt || null,
            interestAppliedAt: persistedInterest.added > 0 ? new Date().toISOString() : currentPlan.flags?.interestAppliedAt || null,
            closedAt: new Date().toISOString(),
          },
        });
        ensurePlanFlowFlags(bucket.monthlyPlan[cursor]);
        if (persistedInterest.added > 0) {
          workingTransactions = workingTransactions.concat(persistedInterest.entries);
        }
      }
      const nextMonth = addMonths(cursor, 1);
      if (!nextMonth || nextMonth === cursor) break;
      const isFirst = false;
      ensureMonthEntries(bucket, nextMonth, formData, mvpData, isFirst, "active", closingBalances);
      cursor = nextMonth;
      bucket.currentMonthId = nextMonth;
    }

    const currentMonthId = bucket.currentMonthId || monthNow;
    ensureMonthEntries(bucket, currentMonthId, formData, mvpData, false, "active");

    const currentPlan = bucket.monthlyPlan[currentMonthId];
    if (currentPlan) {
      const planStatus = currentPlan.flags?.monthStatus || "active";
      if (planStatus !== "closed") {
        currentPlan.inputsSnapshot = getMonthlyInputsSnapshot(
          formData,
          mvpData,
          currentPlan.monthlyBudget
        );
        currentPlan.allocationResultSnapshot = getAllocationResultSnapshot(mvpData);
        currentPlan.flags = {
          ...(currentPlan.flags || {}),
          updatedAt: new Date().toISOString(),
        };
        ensurePlanFlowFlags(currentPlan);
      }
    }

    const currentTracking = bucket.monthlyTracking[currentMonthId];
    if (currentTracking) {
      const currentPlanStatus = bucket.monthlyPlan[currentMonthId]?.flags?.monthStatus || "active";
      if (currentPlanStatus !== "closed") {
        currentTracking.variableBudget = Math.max(
          0,
          toNumber(bucket.userSettings?.allocationPlan?.leisureMonthly || 0)
        );
        currentTracking.updatedAt = new Date().toISOString();
      }
    }

    if (bucket.monthlyPlan[currentMonthId]) {
      ensurePlanFlowFlags(bucket.monthlyPlan[currentMonthId]);
    }
    syncTrackingWithTransactions(bucket, userId, currentMonthId, allTransactions);

    state[userId] = bucket;
    writeStore(state);

    return {
      monthId: currentMonthId,
      userSettings: deepClone(bucket.userSettings) || {},
      monthlyPlan: deepClone(bucket.monthlyPlan[currentMonthId]) || null,
      monthlyTracking: deepClone(bucket.monthlyTracking[currentMonthId]) || null,
      allMonthlyPlan: deepClone(bucket.monthlyPlan) || {},
      allMonthlyTracking: deepClone(bucket.monthlyTracking) || {},
    };
  };

  const regeneratePlanForMonth = ({ userId, monthId, formData = {}, mvpData = {} }) => {
    if (!userId || !monthId) return null;
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const existing = bucket.monthlyPlan[monthId];
    if (!existing) return null;

    const monthStatus = existing.flags?.monthStatus || "active";
    if (monthStatus === "closed") {
      state[userId] = bucket;
      writeStore(state);
      return deepClone(existing);
    }

    bucket.userSettings = mergeUserSettings(bucket.userSettings, getUserSettingsFromForm(formData));
    bucket.monthlyPlan[monthId] = {
      ...existing,
      inputsSnapshot: getMonthlyInputsSnapshot(formData, mvpData, existing.monthlyBudget),
      allocationResultSnapshot: getAllocationResultSnapshot(mvpData),
      settingsSnapshot:
        existing.settingsSnapshot && typeof existing.settingsSnapshot === "object"
          ? existing.settingsSnapshot
          : {
              smart: deepClone(bucket.userSettings?.smartSaveSettings || {}) || {},
              smartSave: deepClone(bucket.userSettings?.smartSaveSettings || {}) || {},
              advanced: deepClone(bucket.userSettings?.advancedSettings || {}) || {},
            },
      flags: {
        ...(existing.flags || {}),
        monthStatus,
        updatedAt: new Date().toISOString(),
      },
    };
    ensurePlanFlowFlags(bucket.monthlyPlan[monthId]);

    if (bucket.monthlyTracking[monthId]) {
      bucket.monthlyTracking[monthId].variableBudget = Math.max(
        0,
        toNumber(bucket.userSettings?.allocationPlan?.leisureMonthly || 0)
      );
      bucket.monthlyTracking[monthId].updatedAt = new Date().toISOString();
    }

    state[userId] = bucket;
    writeStore(state);
    return deepClone(bucket.monthlyPlan[monthId]);
  };

  const applyPlanForMonth = ({ userId, monthId }) => {
    if (!userId || !monthId) return { ok: false, reason: "missing" };
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };
    const status = plan.flags?.monthStatus;
    if (status !== "active") return { ok: false, reason: "not-active" };
    if (plan.flags?.planAppliedAt) {
      return { ok: false, reason: "already-applied", appliedAt: plan.flags.planAppliedAt };
    }

    const appliedAt = new Date().toISOString();
    plan.flags = {
      ...(plan.flags || {}),
      planAppliedAt: appliedAt,
      monthlyPlanApplied: true,
      monthlyPlanAppliedAt: appliedAt,
      monthlyPlanIsApplied: true,
      flow: {
        ...((plan.flags && plan.flags.flow) || {}),
        budgetValidatedAt: ((plan.flags && plan.flags.flow) || {}).budgetValidatedAt || appliedAt,
        allocationValidatedAt: appliedAt,
      },
      updatedAt: appliedAt,
    };

    const allocations = plan.allocationResultSnapshot?.allocations || {};
    const checklist = [
      { key: "securite", label: "Transfert vers Sécurité", amount: Math.max(0, toNumber(allocations.securite || 0)) },
      { key: "impots", label: "Transfert vers Impôts", amount: Math.max(0, toNumber(allocations.impots || 0)) },
      { key: "pilier3a", label: "Versement 3e pilier", amount: Math.max(0, toNumber(allocations.pilier3a || 0)) },
      { key: "investissements", label: "Investissements", amount: Math.max(0, toNumber(allocations.investissements || 0)) },
      {
        key: "projetsCourtTerme",
        label: "Objectif court terme",
        amount: Math.max(0, toNumber(plan.allocationResultSnapshot?.shortTermDeduction || 0)),
      },
    ].filter((item) => item.amount > 0);

    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);

    return {
      ok: true,
      appliedAt,
      checklist,
    };
  };

  const markAccountsBalancedForMonth = ({ userId, monthId, now = new Date(), details = null }) => {
    if (!userId || !monthId) return { ok: false, reason: "missing" };
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };

    const at = now.toISOString();
    const flags = plan.flags && typeof plan.flags === "object" ? plan.flags : {};
    plan.flags = {
      ...flags,
      accountsBalanced: true,
      accountsBalancedAt: flags.accountsBalancedAt || at,
      updatedAt: at,
    };

    const detailPayload = details && typeof details === "object" ? deepClone(details) : null;
    if (detailPayload) {
      plan.accountsBalanceSnapshot = {
        ...(plan.accountsBalanceSnapshot && typeof plan.accountsBalanceSnapshot === "object"
          ? plan.accountsBalanceSnapshot
          : {}),
        ...detailPayload,
        updatedAt: at,
      };
    }

    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);
    return {
      ok: true,
      accountsBalancedAt: plan.flags.accountsBalancedAt || at,
    };
  };

  const saveMonthlyPlanExecutionForMonth = ({
    userId,
    monthId,
    now = new Date(),
    entries = [],
    source = "auto-apply",
  }) => {
    if (!userId || !monthId) return { ok: false, reason: "missing" };
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };

    const at = now.toISOString();
    const transfers = ensureArray(entries)
      .filter((entry) => entry && entry.type === "transfer")
      .map((entry) => ({
        id: String(entry.id || "").trim() || null,
        from: String(entry.from || "").trim() || null,
        to: String(entry.to || "").trim() || null,
        amount: Math.max(0, toNumber(entry.amount)),
        note: String(entry.note || "").trim() || null,
        date: entry.date || null,
        createdAt: entry.createdAt || null,
        autoApplyKind: entry.autoApplyKind || null,
      }))
      .filter((entry) => entry.amount > 0);

    const flags = plan.flags && typeof plan.flags === "object" ? plan.flags : {};
    plan.flags = {
      ...flags,
      monthlyPlanApplied: true,
      monthlyPlanAppliedAt: flags.monthlyPlanAppliedAt || at,
      monthlyPlanIsApplied: true,
      updatedAt: at,
    };
    plan.monthlyPlanExecution = {
      source,
      capturedAt: at,
      transfers,
      transferCount: transfers.length,
    };
    plan.transfers = transfers.slice();

    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);
    return {
      ok: true,
      transferCount: transfers.length,
      capturedAt: at,
    };
  };

  const saveRebalanceExecutionForMonth = ({ userId, monthId, now = new Date(), transfers = [] }) => {
    if (!userId || !monthId) return { ok: false, reason: "missing" };
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };
    const at = now.toISOString();
    const rows = ensureArray(transfers)
      .map((entry) => ({
        from: String(entry?.from || "").trim() || null,
        to: String(entry?.to || "").trim() || null,
        amount: Math.max(0, toNumber(entry?.amount || 0)),
        reason: String(entry?.reason || "").trim() || null,
      }))
      .filter((entry) => entry.from && entry.to && entry.amount > 0);
    plan.rebalanceTransfers = rows;
    plan.flags = {
      ...(plan.flags || {}),
      accountsBalanced: rows.length === 0,
      accountsBalancedAt: rows.length === 0 ? at : plan.flags?.accountsBalancedAt || null,
      updatedAt: at,
    };
    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);
    return { ok: true, transferCount: rows.length };
  };

  const saveMonthlyPlanTaxForMonth = ({ userId, monthId, now = new Date(), tax = {} }) => {
    if (!userId || !monthId) return { ok: false, reason: "missing" };
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };
    const at = now.toISOString();
    plan.taxMode = String(tax.taxMode || plan.taxMode || "AUTO_PROVISION").toUpperCase();
    plan.taxOnboardingChoice =
      String(tax.taxOnboardingChoice || plan.taxOnboardingChoice || "").trim().toUpperCase() || null;
    plan.taxMonthlyTarget = Math.max(0, toNumber(tax.taxMonthlyTarget || 0));
    plan.taxMonthlyActual = Math.max(0, toNumber(tax.taxMonthlyActual || 0));
    plan.taxTopUpFromSurplus = Math.max(0, toNumber(tax.taxTopUpFromSurplus || 0));
    plan.taxShortfallThisMonth = Math.max(0, toNumber(tax.taxShortfallThisMonth || 0));
    plan.taxNotProvisionedAmount = Math.max(0, toNumber(tax.taxNotProvisionedAmount || 0));
    plan.flags = {
      ...(plan.flags || {}),
      updatedAt: at,
    };
    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);
    return {
      ok: true,
      taxMode: plan.taxMode,
      taxOnboardingChoice: plan.taxOnboardingChoice,
      taxMonthlyTarget: plan.taxMonthlyTarget,
      taxMonthlyActual: plan.taxMonthlyActual,
      taxTopUpFromSurplus: plan.taxTopUpFromSurplus,
      taxShortfallThisMonth: plan.taxShortfallThisMonth,
      taxNotProvisionedAmount: plan.taxNotProvisionedAmount,
    };
  };

  const updateUserSettingsForUser = ({ userId, patch = {} }) => {
    if (!userId || !patch || typeof patch !== "object") return { ok: false, reason: "missing" };
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const baseSettings = mergeUserSettings(bucket.userSettings, bucket.userSettings);
    const nextSettings = applySettingsPatch(deepClone(baseSettings) || {}, patch);
    bucket.userSettings = mergeUserSettings(nextSettings, nextSettings);
    state[userId] = bucket;
    writeStore(state);
    return {
      ok: true,
      userSettings: deepClone(bucket.userSettings),
    };
  };

  const getStateForUser = (userId) => {
    if (!userId) return null;
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    return deepClone(bucket);
  };

  const getSetupPlanForMonth = ({ userId, monthId }) => {
    if (!userId || !monthId) return null;
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan || !plan.setupPlan || typeof plan.setupPlan !== "object") return null;
    return deepClone(plan.setupPlan);
  };

  const saveSetupPlanForMonth = ({ userId, monthId, setupPlan }) => {
    if (!userId || !monthId || !setupPlan || typeof setupPlan !== "object") return null;
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return null;
    plan.setupPlan = deepClone(setupPlan) || null;
    plan.flags = {
      ...(plan.flags || {}),
      updatedAt: new Date().toISOString(),
    };
    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);
    return deepClone(plan.setupPlan);
  };

  const getFlowStateForMonth = ({ userId, monthId, now = new Date(), monthlyPlan = null }) => {
    if (!userId || !monthId) return null;
    const effectiveNow = resolveDebugNow(now);
    let plan = monthlyPlan;
    if (!plan) {
      const state = readStore();
      const bucket = normalizeUserState(state, userId);
      plan = bucket.monthlyPlan?.[monthId] || null;
    }
    if (!plan) {
      const fallback = buildFlowUi(MONTHLY_FLOW_STATES.NEW_MONTH);
      return { monthId, monthStatus: "missing", ...fallback };
    }
    const state = getFlowStateFromPlan({ monthId, monthlyPlan: plan, now: effectiveNow });
    const ui = buildFlowUi(state);
    return {
      monthId,
      monthStatus: String(plan.flags?.monthStatus || "active"),
      ...ui,
    };
  };

  const markBudgetValidatedForMonth = ({ userId, monthId, now = new Date() }) => {
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };
    const at = now.toISOString();
    const flags = plan.flags && typeof plan.flags === "object" ? plan.flags : {};
    plan.flags = {
      ...flags,
      monthStatus: flags.monthStatus === "setup" ? "active" : flags.monthStatus || "active",
      flow: {
        ...((flags.flow && typeof flags.flow === "object" ? flags.flow : {})),
        budgetValidatedAt:
          ((flags.flow && flags.flow.budgetValidatedAt) || flags.budgetValidatedAt || at),
      },
      updatedAt: at,
    };
    ensurePlanFlowFlags(plan, at);
    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);
    return { ok: true, budgetValidatedAt: plan.flags?.flow?.budgetValidatedAt || at };
  };

  const markAllocationValidatedForMonth = ({ userId, monthId, now = new Date() }) => {
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };
    const at = now.toISOString();
    const flags = plan.flags && typeof plan.flags === "object" ? plan.flags : {};
    const flow = flags.flow && typeof flags.flow === "object" ? flags.flow : {};
    plan.flags = {
      ...flags,
      monthStatus: flags.monthStatus === "setup" ? "active" : flags.monthStatus || "active",
      flow: {
        ...flow,
        budgetValidatedAt: flow.budgetValidatedAt || flags.budgetValidatedAt || at,
        allocationValidatedAt: flow.allocationValidatedAt || flags.allocationValidatedAt || at,
      },
      monthlyPlanIsReady: true,
      updatedAt: at,
    };
    ensurePlanFlowFlags(plan, at);
    bucket.monthlyPlan[monthId] = plan;
    state[userId] = bucket;
    writeStore(state);
    return {
      ok: true,
      budgetValidatedAt: plan.flags?.flow?.budgetValidatedAt || at,
      allocationValidatedAt: plan.flags?.flow?.allocationValidatedAt || at,
    };
  };

  const getMonthlyBudgetForMonth = ({ userId, monthId, formData = {} }) => {
    if (!userId || !monthId) return null;
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    if (!bucket.monthlyPlan[monthId]) {
      ensureMonthEntries(bucket, monthId, formData, {}, false, "active");
    }
    const plan = bucket.monthlyPlan[monthId];
    const existing = plan?.monthlyBudget && typeof plan.monthlyBudget === "object" ? plan.monthlyBudget : null;
    const fallback = getDefaultMonthlyBudget({ bucket, monthId, formData });
    const normalizedBase = normalizeMonthlyBudget(existing || {}, fallback);
    const existingSource = String(existing?.source || "").trim().toLowerCase();
    const hasLegacyManualMarker = Boolean(existing?.savedAt);
    const isLegacyBudgetWithoutSource = Boolean(existing && !existingSource);
    const shouldSyncFromForm =
      !existing ||
      existingSource === "auto-form-sync" ||
      (isLegacyBudgetWithoutSource && !hasLegacyManualMarker);
    const normalized = shouldSyncFromForm
      ? applyFormExpensesToBudget(normalizedBase, formData)
      : normalizedBase;
    normalized.source = shouldSyncFromForm ? "auto-form-sync" : "manual-budget";

    const existingRaw = existing ? JSON.stringify(existing) : "";
    const normalizedRaw = JSON.stringify(normalized);
    if (!existing || existingRaw !== normalizedRaw) {
      plan.monthlyBudget = normalized;
      ensurePlanFlowFlags(plan);
      bucket.monthlyPlan[monthId] = plan;
      state[userId] = bucket;
      writeStore(state);
    }
    return deepClone(normalized);
  };

  const saveMonthlyBudgetForMonth = ({ userId, monthId, budget, formData = {} }) => {
    if (!userId || !monthId || !budget || typeof budget !== "object") return null;
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    if (!bucket.monthlyPlan[monthId]) {
      ensureMonthEntries(bucket, monthId, formData, {}, false, "active");
    }
    const plan = bucket.monthlyPlan[monthId];
    const fallback = getDefaultMonthlyBudget({ bucket, monthId, formData });
    const normalized = normalizeMonthlyBudget(budget, fallback);
    const nowIso = new Date().toISOString();
    normalized.savedAt = nowIso;
    normalized.source = "manual-budget";

    plan.monthlyBudget = normalized;
    plan.inputsSnapshot = {
      ...(plan.inputsSnapshot || {}),
      revenuNetMensuel: normalized.totalIncome,
      fixedTotal: normalized.fixedTotal,
      mandatoryTotal: normalized.mandatoryTotal,
    };
    plan.flags = {
      ...(plan.flags || {}),
      updatedAt: nowIso,
    };
    ensurePlanFlowFlags(plan, nowIso);
    bucket.monthlyPlan[monthId] = plan;

    if (!bucket.monthlyTracking[monthId]) {
      bucket.monthlyTracking[monthId] = {
        variableBudget: normalized.variablePlanned,
        variableSpent: 0,
        transactions: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    } else {
      bucket.monthlyTracking[monthId].variableBudget = normalized.variablePlanned;
      bucket.monthlyTracking[monthId].updatedAt = nowIso;
    }

    state[userId] = bucket;
    writeStore(state);
    return deepClone(normalized);
  };

  const closeMonthWithReview = ({
    userId,
    monthId,
    formData = {},
    mvpData = {},
    allTransactions = [],
  }) => {
    if (!userId || !monthId) return { ok: false, reason: "missing" };
    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const plan = bucket.monthlyPlan?.[monthId];
    if (!plan) return { ok: false, reason: "no-plan" };
    const status = String(plan.flags?.monthStatus || "active");
    if (status === "closed") {
      const next = addMonths(monthId, 1);
      if (next) bucket.currentMonthId = next;
      state[userId] = bucket;
      writeStore(state);
      return { ok: true, monthId, nextMonthId: next || monthId, alreadyClosed: true };
    }

    syncTrackingWithTransactions(bucket, userId, monthId, allTransactions);

    const nowIso = new Date().toISOString();
    const nextMonthId = addMonths(monthId, 1) || monthId;
    const planFlags = plan.flags || {};
    const startingBalances = normalizeBalances(
      planFlags.closingBalances || planFlags.startingBalances || resolveBalancesFromAssets(formData)
    );

    plan.flags = {
      ...planFlags,
      monthStatus: "closed",
      closedAt: nowIso,
      updatedAt: nowIso,
      flow: {
        ...((planFlags.flow && typeof planFlags.flow === "object" ? planFlags.flow : {})),
        reviewCompletedAt: nowIso,
      },
    };
    ensurePlanFlowFlags(plan, nowIso);
    bucket.monthlyPlan[monthId] = plan;

    ensureMonthEntries(bucket, nextMonthId, formData, mvpData, false, "setup", startingBalances);
    if (plan.monthlyBudget && typeof plan.monthlyBudget === "object") {
      bucket.monthlyPlan[nextMonthId].monthlyBudget = normalizeMonthlyBudget(
        plan.monthlyBudget,
        plan.monthlyBudget
      );
    }
    bucket.currentMonthId = nextMonthId;

    state[userId] = bucket;
    writeStore(state);
    return { ok: true, monthId, nextMonthId };
  };

  window.SmartSaveMonthlyStore = {
    STORE_KEY,
    MONTHLY_FLOW_STATES,
    getMonthId,
    parseMonthId,
    addMonths,
    ensureUserMonthContext,
    regeneratePlanForMonth,
    applyPlanForMonth,
    getFlowStateForMonth,
    markBudgetValidatedForMonth,
    markAllocationValidatedForMonth,
    getMonthlyBudgetForMonth,
    saveMonthlyBudgetForMonth,
    closeMonthWithReview,
    getStateForUser,
    getSetupPlanForMonth,
    saveSetupPlanForMonth,
    markAccountsBalancedForMonth,
    saveMonthlyPlanExecutionForMonth,
    saveRebalanceExecutionForMonth,
    saveMonthlyPlanTaxForMonth,
    updateUserSettingsForUser,
    setDebugNow: (isoDateString) => {
      try {
        const parsed = new Date(isoDateString);
        if (Number.isNaN(parsed.getTime())) return { ok: false, reason: "invalid-date" };
        localStorage.setItem(DEBUG_NOW_KEY, parsed.toISOString());
        return { ok: true, now: parsed.toISOString() };
      } catch (_error) {
        return { ok: false, reason: "invalid-date" };
      }
    },
    clearDebugNow: () => {
      try {
        localStorage.removeItem(DEBUG_NOW_KEY);
      } catch (_error) {
        // ignore storage issues
      }
      return { ok: true };
    },
    getDebugNow: () => {
      try {
        return localStorage.getItem(DEBUG_NOW_KEY) || null;
      } catch (_error) {
        return null;
      }
    },
    readStore,
    writeStore,
  };
})();
