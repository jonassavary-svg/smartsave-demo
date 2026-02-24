(() => {
  const ACTIONS_STORAGE_KEY = "smartsaveHubActionState";
  const TRANSACTIONS_KEY = "transactions";
  const STORAGE_KEY_FORM = "smartsaveFormData";
  const PROFILE_UPDATE_KEY = "smartsaveProfileUpdated";
  const PROFILE_VERSION_KEY = "smartsaveProfileVersion";
  const MONTH_STATE_KEY = "smartsaveMonthState";
  const SNAPSHOT_STORAGE_KEY = "smartsaveSnapshots";
  const PENDING_MON_ARGENT_ACTION_KEY = "smartsavePendingMonArgentAction";
  const SMARTSAVE_PENDING_ACTIONS_KEY = "smartsavePendingBankActions";
  const MAX_TRANSACTIONS_RAW_BYTES = 2_500_000;
  const MAX_TRANSACTIONS_SORT_COUNT = 5_000;
  let futureRangeYears = 10;
  let lastRenderContext = null;
  let lastMonthlyContext = null;
  let goalsSaveTimer = null;

  const ensureArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

  const toNumber =
    window.toNumber ||
    ((value) => {
      const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    });

  const formatCurrency =
    window.formatCurrency ||
    ((value) =>
      new Intl.NumberFormat("fr-CH", {
        style: "currency",
        currency: "CHF",
        maximumFractionDigits: 0,
      }).format(Number.isFinite(value) ? value : toNumber(value)));

  const formatSignedCurrency =
    window.formatSignedCurrency ||
    ((value) => {
      const numeric = Number.isFinite(value) ? value : toNumber(value);
      const formatted = formatCurrency(Math.abs(numeric));
      if (numeric < 0) return `-${formatted}`;
      return `+${formatted}`;
    });

  const formatChartCurrency = (value) => {
    const numeric = Number.isFinite(value) ? value : toNumber(value);
    const abs = Math.abs(numeric);
    if (abs >= 1000000) return `CHF ${(abs / 1000000).toFixed(1)}m`;
    if (abs >= 1000) return `CHF ${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
    return formatCurrency(abs);
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const deepCloneJson = (value, fallback = null) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return fallback;
    }
  };
  const mergePlainObjects = (base = {}, patch = {}) => {
    const safeBase = base && typeof base === "object" && !Array.isArray(base) ? base : {};
    const safePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const output = { ...safeBase };
    Object.keys(safePatch).forEach((key) => {
      const patchValue = safePatch[key];
      if (Array.isArray(patchValue)) {
        output[key] = patchValue.slice();
        return;
      }
      if (patchValue && typeof patchValue === "object") {
        const baseValue =
          output[key] && typeof output[key] === "object" && !Array.isArray(output[key])
            ? output[key]
            : {};
        output[key] = mergePlainObjects(baseValue, patchValue);
        return;
      }
      output[key] = patchValue;
    });
    return output;
  };

  const SMARTSAVE_SETTINGS_DEFAULTS = Object.freeze({
    cycle: {
      monthId: (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      })(),
      closingDay: "eom",
      applyMode: "manual",
    },
    allocationPriority: {
      order: "security_tax_invest",
    },
    taxes: {
      enabled: true,
      provisionMode: "smoothed",
      priority: "normal",
    },
    goals: {
      smoothingEnabled: true,
      autoRecalculateMonthly: true,
    },
    limits: {
      minCurrentMonths: 1,
      precautionIncomeMonths: 3,
      investMaxSurplusPct: 25,
      scoreInfluenceEnabled: true,
    },
    savings: {
      strategy: "equilibre",
    },
    investments: {
      strategy: "equilibre",
    },
  });

  const ADVANCED_SETTINGS_DEFAULTS = Object.freeze({
    transferControls: {
      maxPerTransfer: 0,
      maxMonthlyTotal: 0,
      maxTransfersPerMonth: 0,
      requireConfirmation: true,
    },
    savingsUsage: {
      savingsFloor: 0,
      pullOrder: "current_first",
    },
    investmentAdvanced: {
      progressiveInvest: false,
      maxInvestPerMonth: 0,
      maxInvestPct: 40,
      stopOnHardMonth: true,
    },
    overrides: {
      skipCurrentMonth: false,
      freezeAccount: "",
      freezeMonths: 0,
      forceRecompute: false,
    },
    exceptions: {
      negativeSurplusMode: "no_transfer",
      urgentTaxBoostOneMonth: false,
    },
  });

  const normalizeSmartSaveSettings = (raw = {}) => {
    const merged = mergePlainObjects(deepCloneJson(SMARTSAVE_SETTINGS_DEFAULTS, {}) || {}, raw || {});
    merged.cycle.monthId = String(merged?.cycle?.monthId || SMARTSAVE_SETTINGS_DEFAULTS.cycle.monthId);
    merged.cycle.closingDay = String(merged?.cycle?.closingDay || "eom");
    merged.cycle.applyMode = String(merged?.cycle?.applyMode || "manual");
    merged.allocationPriority.order = String(
      merged?.allocationPriority?.order || "security_tax_invest"
    );
    if (!["security_tax_invest", "security_invest_tax"].includes(merged.allocationPriority.order)) {
      merged.allocationPriority.order = "security_tax_invest";
    }
    merged.taxes.enabled = Boolean(merged?.taxes?.enabled);
    merged.taxes.provisionMode = String(merged?.taxes?.provisionMode || "smoothed");
    if (!["smoothed", "recommendations"].includes(merged.taxes.provisionMode)) {
      merged.taxes.provisionMode = "smoothed";
    }
    merged.taxes.priority = String(merged?.taxes?.priority || "normal").toLowerCase();
    if (!["normal", "high", "critical"].includes(merged.taxes.priority)) {
      merged.taxes.priority = "normal";
    }
    merged.goals.smoothingEnabled = Boolean(merged?.goals?.smoothingEnabled);
    merged.goals.autoRecalculateMonthly = Boolean(merged?.goals?.autoRecalculateMonthly);
    merged.limits.minCurrentMonths = Math.max(
      1,
      Math.min(3, Math.round(toNumber(merged?.limits?.minCurrentMonths || 1)))
    );
    merged.limits.precautionIncomeMonths = Math.max(
      1,
      Math.min(12, Math.round(toNumber(merged?.limits?.precautionIncomeMonths || 3)))
    );
    merged.limits.investMaxSurplusPct = Math.max(
      0,
      Math.min(100, Math.round(toNumber(merged?.limits?.investMaxSurplusPct || 25)))
    );
    merged.limits.scoreInfluenceEnabled = Boolean(merged?.limits?.scoreInfluenceEnabled);
    merged.savings = merged.savings || {};
    merged.savings.strategy = String(merged?.savings?.strategy || "equilibre").toLowerCase();
    if (!["prudent", "equilibre", "agressif", "aggressif"].includes(merged.savings.strategy)) {
      merged.savings.strategy = "equilibre";
    }
    merged.investments = merged.investments || {};
    merged.investments.strategy = String(merged?.investments?.strategy || "equilibre").toLowerCase();
    if (!["securite", "equilibre", "agressif", "aggressif"].includes(merged.investments.strategy)) {
      merged.investments.strategy = "equilibre";
    }
    return merged;
  };

  const normalizeAdvancedSettings = (raw = {}) => {
    const merged = mergePlainObjects(deepCloneJson(ADVANCED_SETTINGS_DEFAULTS, {}) || {}, raw || {});
    merged.transferControls.maxPerTransfer = Math.max(
      0,
      toNumber(merged?.transferControls?.maxPerTransfer || 0)
    );
    merged.transferControls.maxMonthlyTotal = Math.max(
      0,
      toNumber(merged?.transferControls?.maxMonthlyTotal || 0)
    );
    merged.transferControls.maxTransfersPerMonth = Math.max(
      0,
      Math.round(toNumber(merged?.transferControls?.maxTransfersPerMonth || 0))
    );
    merged.transferControls.requireConfirmation = Boolean(
      merged?.transferControls?.requireConfirmation
    );
    merged.savingsUsage = merged.savingsUsage && typeof merged.savingsUsage === "object"
      ? merged.savingsUsage
      : {};
    if (Object.prototype.hasOwnProperty.call(merged.savingsUsage, "allowUseExistingSavings")) {
      delete merged.savingsUsage.allowUseExistingSavings;
    }
    merged.savingsUsage.savingsFloor = Math.max(0, toNumber(merged?.savingsUsage?.savingsFloor || 0));
    merged.savingsUsage.pullOrder =
      String(merged?.savingsUsage?.pullOrder || "current_first") === "savings_first"
        ? "savings_first"
        : "current_first";
    merged.investmentAdvanced.progressiveInvest = Boolean(
      merged?.investmentAdvanced?.progressiveInvest
    );
    merged.investmentAdvanced.maxInvestPerMonth = Math.max(
      0,
      toNumber(merged?.investmentAdvanced?.maxInvestPerMonth || 0)
    );
    merged.investmentAdvanced.maxInvestPct = Math.max(
      0,
      Math.min(100, Math.round(toNumber(merged?.investmentAdvanced?.maxInvestPct || 0)))
    );
    merged.investmentAdvanced.stopOnHardMonth = Boolean(
      merged?.investmentAdvanced?.stopOnHardMonth
    );
    merged.overrides.skipCurrentMonth = Boolean(merged?.overrides?.skipCurrentMonth);
    merged.overrides.freezeAccount = String(merged?.overrides?.freezeAccount || "").trim();
    merged.overrides.freezeMonths = Math.max(
      0,
      Math.min(24, Math.round(toNumber(merged?.overrides?.freezeMonths || 0)))
    );
    merged.overrides.forceRecompute = Boolean(merged?.overrides?.forceRecompute);
    merged.exceptions.negativeSurplusMode =
      String(merged?.exceptions?.negativeSurplusMode || "no_transfer") === "warn_only"
        ? "warn_only"
        : "no_transfer";
    merged.exceptions.urgentTaxBoostOneMonth = Boolean(
      merged?.exceptions?.urgentTaxBoostOneMonth
    );
    return merged;
  };

  const normalizeTransferAccountKey = (value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    if (["current", "comptecourant", "comptecourant", "checking"].includes(key)) return "current";
    if (["security", "securite", "savings", "epargne"].includes(key)) return "security";
    if (["tax", "impots", "provisionimpots"].includes(key)) return "tax";
    if (["investments", "investissement", "investissements"].includes(key)) return "investments";
    if (["pillar3a", "pilier3a", "thirdpillar", "pillar3"].includes(key)) return "pillar3a";
    if (
      ["projects", "projets", "projetslongterme", "projetscourtterme", "shortterm", "longterm"].includes(
        key
      )
    ) {
      return "projects";
    }
    return key;
  };

  const resolveActiveFrozenAccount = (advancedSettings = {}) => {
    const freezeMonths = Math.max(
      0,
      Math.round(toNumber(advancedSettings?.overrides?.freezeMonths || 0))
    );
    if (freezeMonths <= 0) return "";
    return normalizeTransferAccountKey(advancedSettings?.overrides?.freezeAccount || "");
  };

  const isGrowthDestination = (value) => {
    const key = normalizeTransferAccountKey(value);
    return key === "investments" || key === "pillar3a";
  };

  const resolveTaxPriority = ({ smartSaveSettings = {}, advancedSettings = {} } = {}) => {
    let priority = String(smartSaveSettings?.taxes?.priority || "normal").toLowerCase();
    if (!["normal", "high", "critical"].includes(priority)) priority = "normal";
    if (advancedSettings?.exceptions?.urgentTaxBoostOneMonth) return "critical";
    return priority;
  };

  const resolveTaxCapPct = ({ smartSaveSettings = {}, advancedSettings = {} } = {}) => {
    const priority = resolveTaxPriority({ smartSaveSettings, advancedSettings });
    if (priority === "critical") return 0.65;
    if (priority === "high") return 0.45;
    return 0.35;
  };

  const mapTaxPriorityToChoice = (priority = "normal") => {
    const safe = String(priority || "normal").toLowerCase();
    if (safe === "critical") return "USE_SAVINGS";
    if (safe === "high") return "MIX";
    return "SPREAD";
  };

  const resolveGrowthCapFromSettings = ({
    availableSurplus = 0,
    smartSaveSettings = {},
    advancedSettings = {},
  } = {}) => {
    const safeAvailable = Math.max(0, toNumber(availableSurplus));
    const smartPct = Math.max(
      0,
      Math.min(100, toNumber(smartSaveSettings?.limits?.investMaxSurplusPct || 0))
    );
    const advancedPctRaw = Math.max(
      0,
      Math.min(100, toNumber(advancedSettings?.investmentAdvanced?.maxInvestPct || 0))
    );
    const effectivePct = advancedPctRaw > 0 ? Math.min(smartPct, advancedPctRaw) : smartPct;
    const capByPct = safeAvailable * (effectivePct / 100);
    const capByAbsolute =
      toNumber(advancedSettings?.investmentAdvanced?.maxInvestPerMonth || 0) > 0
        ? toNumber(advancedSettings.investmentAdvanced.maxInvestPerMonth)
        : Number.POSITIVE_INFINITY;
    let cap = Math.max(0, Math.min(capByPct, capByAbsolute));
    if (advancedSettings?.investmentAdvanced?.progressiveInvest) cap *= 0.7;
    if (advancedSettings?.investmentAdvanced?.stopOnHardMonth && safeAvailable <= 0) cap = 0;
    return Math.max(0, roundMoney(cap));
  };

  const resolveEffectiveMonthSettings = (monthContext = {}) => {
    const liveUserSettings =
      monthContext?.userSettings && typeof monthContext.userSettings === "object"
        ? monthContext.userSettings
        : {};
    const liveSmartSaveSettings = normalizeSmartSaveSettings(
      liveUserSettings.smartSaveSettings || {}
    );
    const liveAdvancedSettings = normalizeAdvancedSettings(
      liveUserSettings.advancedSettings || {}
    );
    const snapshot =
      monthContext?.monthlyPlan?.settingsSnapshot &&
      typeof monthContext.monthlyPlan.settingsSnapshot === "object"
        ? monthContext.monthlyPlan.settingsSnapshot
        : null;
    const snapshotSmart =
      snapshot?.smart && typeof snapshot.smart === "object"
        ? snapshot.smart
        : snapshot?.smartSave && typeof snapshot.smartSave === "object"
        ? snapshot.smartSave
        : {};
    const snapshotAdvanced =
      snapshot?.advanced && typeof snapshot.advanced === "object" ? snapshot.advanced : {};
    const hasSnapshot = Boolean(
      snapshot &&
        (Object.keys(snapshotSmart).length > 0 || Object.keys(snapshotAdvanced).length > 0)
    );
    const monthStatus = String(monthContext?.monthlyPlan?.flags?.monthStatus || "active");
    const useSnapshot =
      hasSnapshot &&
      monthStatus === "closed" &&
      !liveAdvancedSettings.overrides.forceRecompute;
    const smartSaveSettings = useSnapshot
      ? normalizeSmartSaveSettings(snapshotSmart)
      : liveSmartSaveSettings;
    const advancedSettings = useSnapshot
      ? normalizeAdvancedSettings(snapshotAdvanced)
      : liveAdvancedSettings;
    return {
      source: useSnapshot ? "snapshot" : "live",
      userSettings: {
        ...liveUserSettings,
        smartSaveSettings,
        advancedSettings,
      },
      smartSaveSettings,
      advancedSettings,
      liveSmartSaveSettings,
      liveAdvancedSettings,
    };
  };

  const getProjectionHistoryLength = (projection = {}) =>
    Math.max(
      ensureArray(projection?.current?.history).length,
      ensureArray(projection?.smartSave?.history).length
    );

  const buildProjectionSourceData = (formData = {}) => {
    const centralBuilder =
      typeof window.buildCentralizedFinancialData === "function"
        ? window.buildCentralizedFinancialData
        : null;
    if (centralBuilder) {
      try {
        const activeUser =
          typeof window.loadActiveUser === "function" ? window.loadActiveUser() : null;
        const centralData = centralBuilder(formData, {
          userId: activeUser?.id || null,
          monthId: lastMonthlyContext?.monthId || null,
          persist: false,
        });
        if (
          centralData?.calculationData &&
          typeof centralData.calculationData === "object"
        ) {
          return deepCloneJson(centralData.calculationData, formData) || formData;
        }
      } catch (_error) {
        // fallback to raw form data
      }
    }
    return formData;
  };

  const resolveProjectionForApp = ({ data = {}, formData = {}, months = 240 } = {}) => {
    const projectionFromData =
      data?.projection && typeof data.projection === "object" ? data.projection : null;
    const requiredMonths = Math.max(1, Math.round(toNumber(months || 240)));
    const historyLength = getProjectionHistoryLength(projectionFromData || {});
    if (projectionFromData && historyLength >= requiredMonths) return projectionFromData;

    const projectionEngine = window.ProjectionEngine;
    if (!projectionEngine || typeof projectionEngine.calculateProjection !== "function") {
      return projectionFromData || {};
    }

    try {
      const sourceData = buildProjectionSourceData(formData || {});
      return (
        projectionEngine.calculateProjection(sourceData, {
          months: Math.max(240, requiredMonths),
          keepHistory: true,
        }) ||
        projectionFromData ||
        {}
      );
    } catch (_error) {
      return projectionFromData || {};
    }
  };

  const toISODate = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return "";
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getMonthKey = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return "";
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const startOfMonth = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return null;
    return new Date(target.getFullYear(), target.getMonth(), 1);
  };

  const parseMonthKey = (key) => {
    const parts = String(key || "").split("-");
    if (parts.length !== 2) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return new Date(year, month, 1);
  };

  const addMonths = (date, count) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return null;
    return new Date(target.getFullYear(), target.getMonth() + count, 1);
  };

  const isSameMonth = (date, compare) => {
    const left = date instanceof Date ? date : new Date(date);
    const right = compare instanceof Date ? compare : new Date(compare);
    if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
  };

  const isInMonthTransitionWindow = (date = new Date()) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return false;
    const day = target.getDate();
    return day >= 25 || day <= 5;
  };

  const loadTransactions = (activeUser, options = {}) => {
    try {
      const raw = localStorage.getItem(TRANSACTIONS_KEY) || "[]";
      if (raw.length > MAX_TRANSACTIONS_RAW_BYTES) return [];
      const stored = JSON.parse(raw);
      const list = Array.isArray(stored) ? stored : [];
      const activeUserId = String(activeUser?.id || "").trim();
      let filtered = activeUser?.id
        ? list.filter((item) => {
            const entryUserId = String(item?.userId || "").trim();
            return !entryUserId || entryUserId === activeUserId;
          })
        : list;
      if (filtered.length > MAX_TRANSACTIONS_SORT_COUNT) {
        filtered = filtered.slice(filtered.length - MAX_TRANSACTIONS_SORT_COUNT);
      }
      const shouldSort = options?.sort !== false;
      if (!shouldSort) return filtered;
      return filtered.sort((a, b) => {
        const aTime = new Date(a.date || a.createdAt || 0).getTime();
        const bTime = new Date(b.date || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
    } catch (_error) {
      return [];
    }
  };

  const getMonthlyStore = () => window.SmartSaveMonthlyStore || null;

  const resolveMonthlyExpenseAmount = (entry) => {
    if (!entry) return 0;
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

  const normalizeLabel = (value) => String(value || "").trim().toLowerCase();

  const getMonthlyIncomeEstimate = (formData = {}) => {
    if (typeof window.buildIncomeBreakdownEntries === "function") {
      return window
        .buildIncomeBreakdownEntries(formData)
        .reduce((sum, entry) => sum + Math.max(0, toNumber(entry.amount)), 0);
    }

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

  const getMonthlyExpenseTotal = (entries = []) =>
    ensureArray(entries).reduce((sum, entry) => sum + resolveMonthlyExpenseAmount(entry), 0);

  const buildFixedIncomeEntries = (formData = {}) => {
    if (typeof window.buildIncomeBreakdownEntries === "function") {
      return window
        .buildIncomeBreakdownEntries(formData)
        .map((entry) => ({
          label: entry.label,
          amount: Math.max(0, toNumber(entry.amount)),
        }))
        .filter((entry) => entry.amount > 0);
    }

    const entries = ensureArray(formData.incomes?.entries);
    const mapped = entries
      .map((income, index) => {
        const amount =
          typeof window.getIncomeMonthlyAmount === "function"
            ? window.getIncomeMonthlyAmount(income)
            : toNumber(income.amount);
        if (!amount) return null;
        const label = income?.label || income?.name || income?.source || `Revenu ${index + 1}`;
        return { label, amount: Math.max(0, toNumber(amount)) };
      })
      .filter(Boolean);

    const spouseAmount =
      toNumber(formData.incomes?.spouseNetIncome) ||
      toNumber(formData.incomes?.spouseIncome) ||
      toNumber(formData.spouseIncome);
    if (spouseAmount > 0) {
      mapped.push({ label: "Conjoint·e", amount: spouseAmount });
    }
    return mapped;
  };

  const buildFixedExpenseEntries = (formData = {}) =>
    ensureArray(formData.expenses?.fixed)
      .map((entry, index) => {
        const amount = resolveMonthlyExpenseAmount(entry);
        if (!amount) return null;
        const label = entry?.label || entry?.name || `Dépense fixe ${index + 1}`;
        return { label, amount: Math.max(0, toNumber(amount)) };
      })
      .filter(Boolean);

  const loadMonthState = () => {
    try {
      const raw = localStorage.getItem(MONTH_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const saveMonthState = (state) => {
    try {
      localStorage.setItem(MONTH_STATE_KEY, JSON.stringify(state));
    } catch (_error) {
      // ignore storage issues
    }
  };

  const normalizeBalances = (balances = {}) => ({
    current: toNumber(balances.current),
    security: toNumber(balances.security),
    tax: toNumber(balances.tax),
    investments: toNumber(balances.investments),
    pillar3a: toNumber(balances.pillar3a),
    projects: toNumber(balances.projects),
  });

  const ensureMonthState = (activeUser, formData, mvpData, transactions = []) => {
    if (!activeUser?.id || !formData) return null;
    const store = getMonthlyStore();
    if (!store || typeof store.ensureUserMonthContext !== "function") return null;
    const context = store.ensureUserMonthContext({
      userId: activeUser.id,
      formData,
      mvpData: mvpData || {},
      allTransactions: transactions,
      now: new Date(),
    });
    if (!context) return null;

    const monthFlags = context.monthlyPlan?.flags || {};
    const monthStatus = String(monthFlags.monthStatus || "active");
    const monthEntry = {
      status: monthStatus,
      monthStatus,
      isFirstMonth: Boolean(monthFlags.isFirstMonth),
      planAppliedAt: monthFlags.planAppliedAt || null,
      startingBalances: normalizeBalances(resolveBalances(formData)),
    };

    const userState = {
      activeMonthKey: context.monthId,
      months: {
        [context.monthId]: monthEntry,
      },
    };

    return { state: null, userState, context };
  };

  const getActiveMonthEntry = (activeUser, formData, mvpData, transactions = []) => {
    const result = ensureMonthState(activeUser, formData, mvpData, transactions);
    if (!result) return null;
    const { userState, context } = result;
    const activeKey = userState.activeMonthKey || getMonthKey(new Date());
    return {
      state: null,
      userState,
      activeKey,
      month: userState.months?.[activeKey],
      monthlyContext: context || null,
    };
  };

  const getMonthTransactions = (transactions = [], monthKey) =>
    transactions.filter((entry) => {
      if (!entry?.date) return false;
      return getMonthKey(entry.date) === monthKey;
    });

  const applyMonthTransactions = (startingBalances, transactions) => {
    const base = normalizeBalances(startingBalances);
    const result = applyTransactionsToBalances(base, transactions);
    const updated = result.balances;
    return {
      balances: {
        ...updated,
        growth: toNumber(updated.investments) + toNumber(updated.pillar3a),
      },
      extras: result.extras,
    };
  };

  const addFixedTransactionsForMonth = (activeUser, formData, monthKey) => {
    if (!activeUser?.id || !formData || !monthKey) return;
    const fixedIncomes = buildFixedIncomeEntries(formData);
    const fixedExpenses = buildFixedExpenseEntries(formData);
    if (!fixedIncomes.length && !fixedExpenses.length) return;

    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
      if (!Array.isArray(stored)) stored = [];
    } catch (_error) {
      stored = [];
    }

    const monthDate = parseMonthKey(monthKey);
    if (!monthDate) return;
    const date = toISODate(monthDate);
    const nowIso = new Date().toISOString();
    const defaultAccount = "current";

    fixedIncomes.forEach((income, index) => {
      stored.push({
        id: `fixed-${monthKey}-income-${index}-${Math.random().toString(16).slice(2)}`,
        userId: activeUser.id,
        type: "income",
        amount: income.amount,
        date,
        note: "Revenu fixe",
        account: defaultAccount,
        category: income.label,
        isFixed: true,
        fixedMonthKey: monthKey,
        createdAt: nowIso,
      });
    });

    fixedExpenses.forEach((expense, index) => {
      stored.push({
        id: `fixed-${monthKey}-expense-${index}-${Math.random().toString(16).slice(2)}`,
        userId: activeUser.id,
        type: "expense",
        amount: expense.amount,
        date,
        note: "Dépense fixe",
        account: defaultAccount,
        category: expense.label,
        isFixed: true,
        fixedMonthKey: monthKey,
        createdAt: nowIso,
      });
    });

    try {
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(stored));
    } catch (_error) {
      // ignore storage issues
    }
  };

  const loadSnapshotForUser = (activeUserId) => {
    if (!activeUserId) return null;
    try {
      const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      return payload?.[activeUserId] || null;
    } catch (_error) {
      return null;
    }
  };

  const buildMonthClosedPayload = (activeUser, formData, monthState, monthTransactions, balances) => {
    const closedMonthKey = monthState?.activeKey || "";
    const openedMonthKey = monthState?.nextKey || "";
    const fixedIncomes = buildFixedIncomeEntries(formData);
    const fixedExpenses = buildFixedExpenseEntries(formData);
    const incomeFixedTotal = fixedIncomes.reduce((sum, entry) => sum + toNumber(entry.amount), 0);
    const expenseFixedTotal = fixedExpenses.reduce((sum, entry) => sum + toNumber(entry.amount), 0);
    const snapshot =
      loadSnapshotForUser(activeUser.id) ||
      window.SmartSaveSnapshot?.buildSnapshot?.(formData, { years: 20, userId: activeUser.id }) ||
      null;

    return {
      event: "monthClosed",
      userId: activeUser.id,
      closedMonthKey,
      openedMonthKey,
      balances: normalizeBalances(balances),
      monthSummary: {
        incomeFixedTotal,
        expenseFixedTotal,
        transactionsCount: monthTransactions.length,
      },
      snapshot,
    };
  };

  async function notifyMonthClosed(payload) {
    const runtime = typeof window.getSmartSaveRuntime === "function"
      ? window.getSmartSaveRuntime()
      : {};
    const webhookUrl = runtime?.automations?.monthClosedWebhookUrl || "";
    const debugEnabled = Boolean(runtime?.debug?.enabled);
    if (!webhookUrl) {
      if (debugEnabled) {
        console.debug("[SmartSave] Month closed webhook disabled.");
      }
      return;
    }
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (debugEnabled) {
        console.debug("[SmartSave] Month closed webhook failed.", error);
      }
    }
  }

  const closeActiveMonth = (activeUser, formData, transactions = []) => {
    const state = loadMonthState();
    const userState = state?.[activeUser?.id];
    if (!userState) return null;
    const activeKey = userState.activeMonthKey;
    const activeMonth = userState.months?.[activeKey];
    if (!activeMonth || activeMonth.status !== "active") return null;
    if (!isInMonthTransitionWindow(new Date())) return null;

    const monthTransactions = getMonthTransactions(transactions, activeKey);
    const closingBalances = applyMonthTransactions(activeMonth.startingBalances, monthTransactions).balances;
    activeMonth.status = "closed";
    activeMonth.closedAt = new Date().toISOString();
    activeMonth.closingBalances = normalizeBalances(closingBalances);
    activeMonth.archive = {
      archivedAt: new Date().toISOString(),
      transactions: monthTransactions.map((entry) => ({ ...entry })),
      actions: getActionStateByMonth(activeUser.id, activeKey),
      balances: normalizeBalances(closingBalances),
    };

    const nextStart = addMonths(parseMonthKey(activeKey), 1);
    if (!nextStart) return null;
    const nextKey = getMonthKey(nextStart);
    userState.activeMonthKey = nextKey;
    userState.initialMonthKey = userState.initialMonthKey || activeKey;
    const existingNext = userState.months[nextKey] || {};
    userState.months[nextKey] = {
      ...existingNext,
      status: "ready_to_start",
      openedAt: existingNext.openedAt || new Date().toISOString(),
      startedAt: existingNext.startedAt || null,
      closedAt: null,
      fixedApplied: Boolean(existingNext.fixedApplied),
      isFirstMonth: false,
      startingBalances: normalizeBalances(existingNext.startingBalances || closingBalances),
      closingBalances: null,
      archive: existingNext.archive || null,
    };

    state[activeUser.id] = userState;
    saveMonthState(state);

    const payload = buildMonthClosedPayload(
      activeUser,
      formData,
      { activeKey, nextKey },
      monthTransactions,
      closingBalances
    );
    try {
      notifyMonthClosed(payload);
    } catch (_error) {
      // ignore webhook failures
    }

    return { activeKey, nextKey };
  };

  const ensureMonthRollover = (activeUser, formData, transactions = []) => {
    const info = getActiveMonthEntry(activeUser, formData);
    if (!info || !info.month) return;
    const currentKey = getMonthKey(new Date());
    let activeDate = parseMonthKey(info.activeKey);
    const currentDate = parseMonthKey(currentKey);
    if (!activeDate || !currentDate) return;
    if (activeDate >= currentDate) return;

    while (activeDate && activeDate < currentDate) {
      const closed = closeActiveMonth(activeUser, formData, transactions);
      if (!closed) break;
      const state = loadMonthState();
      const userState = state?.[activeUser?.id];
      if (!userState?.activeMonthKey) break;
      const nextActiveDate = parseMonthKey(userState.activeMonthKey);
      if (!nextActiveDate) break;
      if (nextActiveDate.getTime() === activeDate.getTime()) break;
      activeDate = nextActiveDate;
    }
  };


  const formatAccountLabel = (key) => {
    if (typeof key === "string" && key.startsWith("custom-")) {
      return key.slice("custom-".length) || "Compte";
    }
    const map = {
      current: "Compte courant",
      security: "Compte épargne",
      tax: "Provision impôts",
      investments: "Investissements",
      pillar3a: "3e pilier",
      projects: "Objectif court terme",
    };
    return map[key] || key || "Compte";
  };

  const applyTransactionsToBalances = (baseBalances, transactions) => {
    const updated = { ...baseBalances };
    const extras = {};

    const applyDelta = (accountKey, accountLabel, delta) => {
      const rawKey = String(accountKey || "").trim();
      const normalizedKey = normalizeTransferAccountKey(rawKey);
      if (normalizedKey && Object.prototype.hasOwnProperty.call(updated, normalizedKey)) {
        updated[normalizedKey] += delta;
        return;
      }
      if (rawKey && Object.prototype.hasOwnProperty.call(updated, rawKey)) {
        updated[rawKey] += delta;
        return;
      }
      const derivedLabel =
        accountLabel ||
        (rawKey.toLowerCase().startsWith("custom-")
          ? rawKey.slice("custom-".length)
          : "");
      if (derivedLabel) {
        extras[derivedLabel] = (extras[derivedLabel] || 0) + delta;
      }
    };

    transactions.forEach((entry) => {
      const amount = Math.max(0, toNumber(entry?.amount));
      if (!amount) return;
      if (entry.type === "income") {
        applyDelta(entry.account, entry.accountLabel, amount);
      } else if (entry.type === "expense") {
        applyDelta(entry.account, entry.accountLabel, -amount);
      } else if (entry.type === "transfer") {
        const from = entry.from || "";
        const to = entry.to || "";
        if (!from || !to || from === to) return;
        applyDelta(from, entry.fromLabel, -amount);
        applyDelta(to, entry.toLabel, amount);
      }
    });

    return { balances: updated, extras };
  };

  const formatTransactionTitle = (type) => {
    if (type === "income") return "Revenu";
    if (type === "transfer") return "Transfert";
    return "Dépense";
  };

  const renderTransactionList = (container, items, emptyLabel) => {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<li class="activity-empty">${emptyLabel}</li>`;
      return;
    }
    container.innerHTML = items
      .map((entry) => {
        const date = entry.date ? new Date(entry.date) : null;
        const dateLabel = date && !Number.isNaN(date.getTime())
          ? date.toLocaleDateString("fr-CH", { day: "2-digit", month: "short", year: "numeric" })
          : "";
        const amount = Math.max(0, toNumber(entry.amount));
        const signed = entry.type === "expense" ? -amount : amount;
        const amountLabel = entry.type === "expense"
          ? `-${formatCurrency(amount)}`
          : formatCurrency(amount);
        const metaParts = [];
        if (entry.type === "transfer") {
          const fromLabel = entry.fromLabel || formatAccountLabel(entry.from);
          const toLabel = entry.toLabel || formatAccountLabel(entry.to);
          metaParts.push(`${fromLabel} → ${toLabel}`);
        } else if (entry.account) {
          metaParts.push(entry.accountLabel || formatAccountLabel(entry.account));
        }
        if (entry.type !== "transfer") {
          metaParts.push(entry.isFixed ? "Fixe" : "Variable");
        }
        if (entry.category) metaParts.push(entry.category);
        if (dateLabel) metaParts.push(dateLabel);
        return `
          <li class="activity-item" data-transaction-item>
            <div class="activity-item__main">
              <div class="activity-item__title">${formatTransactionTitle(entry.type)}</div>
              <div class="activity-item__meta">${metaParts.join(" · ")}</div>
            </div>
            <div class="activity-item__amount ${signed < 0 ? "is-negative" : "is-positive"}">
              ${amountLabel}
            </div>
            <button class="activity-item__delete" type="button" data-transaction-delete="${entry.id}">
              Supprimer
            </button>
          </li>
        `;
      })
      .join("");
  };

  const loadActionState = () => {
    try {
      const raw = localStorage.getItem(ACTIONS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const saveActionState = (state) => {
    try {
      localStorage.setItem(ACTIONS_STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      /* ignore */
    }
  };

  const getActionStateByMonth = (userId, monthKey) => {
    const state = loadActionState();
    const userMap = state?.[userId];
    if (
      userMap &&
      typeof userMap === "object" &&
      !Array.isArray(userMap) &&
      userMap[monthKey] &&
      typeof userMap[monthKey] === "object"
    ) {
      return { ...userMap[monthKey] };
    }
    return {};
  };

  const saveActionStateByMonth = (userId, monthKey, monthState) => {
    if (!userId || !monthKey) return;
    const state = loadActionState();
    if (!state[userId] || typeof state[userId] !== "object" || Array.isArray(state[userId])) {
      state[userId] = {};
    }
    state[userId][monthKey] = { ...(monthState || {}) };
    saveActionState(state);
  };

  const readPendingBankActionsState = () => {
    try {
      const raw = localStorage.getItem(SMARTSAVE_PENDING_ACTIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const savePendingBankActionsState = (state) => {
    try {
      localStorage.setItem(SMARTSAVE_PENDING_ACTIONS_KEY, JSON.stringify(state || {}));
    } catch (_error) {
      // ignore storage issues
    }
  };

  const sanitizePendingPart = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item";

  const getPendingBankActionsByMonth = (userId, monthId) => {
    const state = readPendingBankActionsState();
    const items = ensureArray(state?.[userId]?.[monthId]);
    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || "").trim(),
        kind: String(item.kind || "plan").trim(),
        from: String(item.from || "").trim(),
        to: String(item.to || "").trim(),
        fromLabel: String(item.fromLabel || formatTransferAccountLabel(item.from)).trim(),
        toLabel: String(item.toLabel || formatTransferAccountLabel(item.to)).trim(),
        amount: Math.max(0, toNumber(item.amount)),
        why: String(item.why || item.reason || "").trim(),
        done: Boolean(item.done),
        createdAt: item.createdAt || null,
      }))
      .filter((item) => item.id && item.amount > 0 && item.from && item.to);
  };

  const savePendingBankActionsByMonth = (userId, monthId, items = []) => {
    if (!userId || !monthId) return;
    const state = readPendingBankActionsState();
    const userState = state[userId] && typeof state[userId] === "object" ? state[userId] : {};
    userState[monthId] = ensureArray(items);
    state[userId] = userState;
    savePendingBankActionsState(state);
  };

  const upsertPendingBankActionsByMonth = (userId, monthId, rows = [], kind = "plan") => {
    if (!userId || !monthId || !ensureArray(rows).length) return [];
    const existing = getPendingBankActionsByMonth(userId, monthId);
    const byId = new Map(existing.map((item) => [item.id, item]));
    const nowIso = new Date().toISOString();
    ensureArray(rows).forEach((row, index) => {
      const amount = Math.max(0, toNumber(row?.amount));
      const from = String(row?.from || "").trim();
      const to = String(row?.to || "").trim();
      if (!amount || !from || !to || from === to) return;
      const id =
        String(row?.id || "").trim() ||
        `${monthId}-${sanitizePendingPart(kind)}-${index + 1}-${sanitizePendingPart(from)}-${sanitizePendingPart(
          to
        )}-${Math.round(amount)}`;
      const prev = byId.get(id);
      byId.set(id, {
        id,
        kind,
        from,
        to,
        fromLabel: row?.fromLabel || formatTransferAccountLabel(from),
        toLabel: row?.toLabel || formatTransferAccountLabel(to),
        amount,
        why: String(row?.reason || row?.why || "").trim(),
        done: Boolean(prev?.done),
        createdAt: prev?.createdAt || nowIso,
      });
    });
    const next = Array.from(byId.values());
    savePendingBankActionsByMonth(userId, monthId, next);
    return next;
  };

  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (!node) return;
    node.textContent = value;
  };

  const setWidth = (node, value) => {
    if (!node) return;
    node.style.width = `${clamp(value, 0, 100)}%`;
  };

  const sumKeys = (source, keys) =>
    keys.reduce((sum, key) => sum + Math.max(0, toNumber(source?.[key])), 0);

  const resolveBalances = (formData = {}) => {
    const assets = formData.assets || {};
    const current = sumKeys(assets, [
      "currentAccount",
      "compteCourant",
      "checking",
      "paymentAccount",
      "paymentBalance",
    ]);
    const security = sumKeys(assets, [
      "securitySavings",
      "securityBalance",
      "savingsAccount",
      "savings",
      "epargne",
      "blocked",
      "securityBlocked",
    ]);
    const tax = sumKeys(assets, [
      "taxProvision",
      "impotsProvision",
      "provisionImpots",
      "impots",
      "taxesProvision",
    ]);
    const investments = sumKeys(assets, [
      "investments",
      "investmentAccount",
      "portfolio",
      "portefeuille",
      "placements",
    ]);
    const pillar3a = sumKeys(assets, [
      "pillar3a",
      "thirdPillarAmount",
      "thirdPillar",
      "pillar3",
      "pilier3a",
      "thirdPillarValue",
    ]);
    const projects = sumKeys(assets, [
      "projects",
      "projectAccount",
      "shortTermAccount",
      "shortTermGoal",
      "projetsCourtTerme",
      "projets",
      "compteCourtTerme",
    ]);
    return {
      current,
      security,
      tax,
      investments,
      pillar3a,
      projects,
      growth: investments + pillar3a,
    };
  };

  const resolveGoals = (formData = {}) => {
    const goals = Array.isArray(formData.goals) ? formData.goals : [];
    const totalSaved = goals.reduce(
      (sum, goal) => sum + Math.max(0, toNumber(goal.saved || goal.current || goal.balance)),
      0
    );
    const totalTarget = goals.reduce(
      (sum, goal) => sum + Math.max(0, toNumber(goal.target || goal.amount)),
      0
    );
    return {
      totalSaved,
      totalTarget,
      primaryName: goals[0]?.name || goals[0]?.title || goals[0]?.label || "",
    };
  };

  const renderHome = (data, formData, activeUser) => {
    if (!document.querySelector("[data-home-health]")) return;

    const transactions = loadTransactions(activeUser);
    const monthInfo = getActiveMonthEntry(activeUser, formData, data, transactions);
    const activeMonthKey = monthInfo?.activeKey || getMonthKey(new Date());
    const now = new Date();
    let monthExpenseDelta = 0;
    const monthTransactions = getMonthTransactions(transactions, activeMonthKey);

    monthTransactions.forEach((entry) => {
      const amount = Math.max(0, toNumber(entry.amount));
      if (entry.type === "expense") monthExpenseDelta += amount;
    });

    const planFixed = getMonthlyExpenseTotal(formData.expenses?.fixed);
    const planVariable = getMonthlyExpenseTotal(formData.expenses?.variable);
    const planTax = Math.max(
      0,
      toNumber(data?.taxProvision?.monthlyAmount || data?.taxProvision?.monthlyNeed || 0)
    );
    const plannedExpenses = planFixed + planVariable + planTax;
    const actualExpenses = monthExpenseDelta;
    const remaining = plannedExpenses - actualExpenses;

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = Math.max(1, now.getDate());
    const elapsedRatio = Math.min(1, dayOfMonth / daysInMonth);
    const spendRatio = plannedExpenses > 0 ? actualExpenses / plannedExpenses : 0;

    let statusLabel = "Dans le plan";
    let statusDetail = "Tes dépenses sont alignées avec ton plan SmartSave.";
    let paceText = "Ton rythme est bon.";
    let feedbackText = "Si tu continues comme ça, ton mois reste sécurisé.";
    let projectionText = "Au rythme actuel : fin de mois dans le plan.";
    let statusClass = "is-ok";

    if (plannedExpenses <= 0) {
      statusLabel = "Plan non défini";
      statusDetail = "Renseigne un budget mensuel pour suivre ton mois.";
      paceText = "Ajoute un budget pour comparer prévu vs réel.";
      feedbackText = "Ajoute ton budget mensuel pour obtenir un suivi précis.";
      projectionText = "Projection indisponible sans budget.";
      statusClass = "is-neutral";
    } else {
      if (spendRatio <= elapsedRatio * 1.05) {
        statusLabel = "Dans le plan";
        statusDetail = "Tes dépenses sont alignées avec ton plan SmartSave.";
        paceText = spendRatio < elapsedRatio * 0.9 ? "Tu es en dessous du plan." : "Ton rythme est bon.";
        feedbackText = "Si tu continues comme ça, ton mois reste sécurisé.";
        statusClass = "is-ok";
      } else if (spendRatio <= elapsedRatio * 1.2) {
        statusLabel = "Attention au rythme de dépenses";
        statusDetail = "Tes dépenses variables vont plus vite que prévu.";
        paceText = "Tu dépenses plus vite que prévu.";
        feedbackText = "Réduire un peu les variables sécuriserait ton mois.";
        statusClass = "is-warn";
      } else {
        statusLabel = "Hors plan ce mois-ci";
        statusDetail = "Tes dépenses dépassent le rythme prévu.";
        paceText = "Tu dépenses nettement plus vite que prévu.";
        feedbackText = "Réduis les variables pour revenir dans le plan.";
        statusClass = "is-bad";
      }

      if (elapsedRatio > 0) {
        const projected = actualExpenses / elapsedRatio;
        projectionText =
          projected <= plannedExpenses
            ? "Au rythme actuel : fin de mois dans le plan."
            : "Au rythme actuel : dépassement prévu.";
      }
    }

    setText("[data-home-status-label]", statusLabel);
    setText("[data-home-status-detail]", statusDetail);
    setText("[data-home-plan-expenses]", formatCurrency(plannedExpenses));
    setText("[data-home-real-expenses]", formatCurrency(actualExpenses));
    setText("[data-home-pace]", paceText);
    setText("[data-home-feedback]", feedbackText);
    setText("[data-home-projection]", projectionText);

    const remainingLabel =
      remaining >= 0
        ? formatCurrency(remaining)
        : `-${formatCurrency(Math.abs(remaining))}`;
    setText("[data-home-remaining]", remainingLabel);

    const progressFill = document.querySelector("[data-home-progress-fill]");
    const progressBar = document.querySelector("[data-home-progress-bar]");
    const progressPercent = plannedExpenses > 0 ? Math.round(spendRatio * 100) : 0;
    setWidth(progressFill, progressPercent);
    setText(
      "[data-home-progress-caption]",
      `${progressPercent}% du budget consommé • Jour ${dayOfMonth}/${daysInMonth}`
    );

    const healthCard = document.querySelector("[data-home-health]");
    if (healthCard) {
      healthCard.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
      healthCard.classList.add(statusClass);
    }
    if (progressBar) {
      progressBar.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
      progressBar.classList.add(statusClass);
    }
  };

  const ALLOCATION_DETAILS_TEMPLATES = {
    compteCourant: {
      title: "Compte courant",
      objective: "SmartSave protège ton quotidien en gardant ton compte courant dans une zone confortable.",
      placement: [
        "Sur ton compte courant bancaire habituel.",
      ],
      rules: [
        "Le compte courant est renforcé en priorité quand il est trop bas.",
        "S'il est déjà au bon niveau, aucun virement n'est ajouté.",
        "Le reste part ensuite vers les autres priorités du mois.",
      ],
      nextActions: [
        "Vérifie simplement que tes dépenses courantes passent bien par ce compte.",
      ],
      more: "Le détail des règles internes reste masqué sur la carte principale pour garder une lecture simple.",
    },
    securite: {
      title: "Sécurité",
      objective: "SmartSave alimente ton épargne sécurité pour absorber les imprévus.",
      placement: [
        "Compte épargne séparé, sans risque et facilement accessible.",
      ],
      rules: [
        "L'épargne sécurité progresse mois après mois tant que l'objectif n'est pas atteint.",
        "Si la sécurité est déjà suffisante, les virements passent vers d'autres comptes.",
      ],
      nextActions: [
        "Aucune action manuelle requise si ton virement automatique est actif.",
      ],
      more: "Le calcul détaillé de la cible reste visible uniquement ici, pas sur la carte principale.",
    },
    projetsLongTerme: {
      title: "Objectif long terme",
      objective: "Financer un projet important sur plusieurs années.",
      placement: [
        "Sur un compte ou support séparé dédié à l'objectif long terme.",
        "Option simple V1: un seul compartiment pour l'objectif principal.",
      ],
      rules: [
        "Le montant mensuel est maintenu selon l'horizon que tu as défini.",
        "Si l'effort requis dépasse le budget disponible, SmartSave ajuste les priorités.",
        "L'objectif long terme passe après sécurité, impôts et dettes prioritaires.",
      ],
      nextActions: [
        "Vérifier l'échéance de l'objectif dans ton profil.",
        "Mettre en place un versement automatique mensuel.",
      ],
      more: "Tu pourras affiner les règles d'arbitrage par objectif dans une version suivante.",
    },
    projetsCourtTerme: {
      title: "Objectif court terme",
      objective: "Préparer une dépense future sans toucher à ton épargne long terme.",
      placement: [
        "Compte épargne séparé dédié à cet objectif.",
      ],
      rules: [
        "Montant prélevé avant la répartition SmartSave.",
        "Le compte est alimenté automatiquement chaque mois jusqu'à l'échéance définie.",
        "À l'échéance, l'argent est prêt à être utilisé sans déséquilibrer les autres comptes.",
      ],
      nextActions: [
        "Confirmer la date cible de ce projet.",
        "Activer un virement auto dédié à ce projet.",
      ],
      more: "À savoir: objectif planifié = moins de stress et pas de déséquilibre financier.",
    },
    investissements: {
      title: "Investissements",
      objective: "SmartSave active les investissements uniquement quand les bases sont suffisamment solides.",
      placement: [
        "Supports diversifiés de type ETF, simples et à faible coût.",
      ],
      rules: [
        "Quand le mois est solide, une partie du surplus est investie.",
        "Quand le mois est tendu, SmartSave peut bloquer temporairement les investissements.",
      ],
      nextActions: [
        "Aucune modification requise depuis cette page.",
      ],
      more: "Le détail des conditions d'activation est volontairement gardé dans ce panneau.",
    },
    pilier3a: {
      title: "3e pilier",
      objective:
        "SmartSave poursuit les versements 3e pilier tant que le plafond annuel n'est pas atteint.",
      placement: [
        "3a bancaire: plus prudent.",
        "3a en fonds: plus orienté long terme.",
      ],
      rules: [
        "Le 3e pilier reste actif tant qu'il reste de la place sur l'année.",
        "Quand le plafond est atteint, SmartSave met automatiquement le montant à CHF 0.",
      ],
      nextActions: [
        "Aucune action requise: la reprise est automatique au début d'une nouvelle année fiscale.",
      ],
      more: "Les détails fiscaux complets restent dans cette fiche, pas dans la carte principale.",
    },
    impots: {
      title: "Impôts",
      objective: "SmartSave provisionne les impôts pour éviter un choc au moment du paiement.",
      placement: [
        'Compte dédié "Impôts" (épargne ou sous-compte séparé).',
      ],
      rules: [
        "En mode normal, SmartSave met une provision de côté chaque mois.",
        "En mode 'Gérer plus tard', le montant du mois peut rester à CHF 0.",
        "L'objectif est d'éviter un gros paiement d'un seul coup.",
      ],
      nextActions: [
        "Tu peux consulter les détails fiscaux complets dans cette fiche.",
      ],
      more: "La date d'échéance exacte peut apparaître ici sans surcharger la carte principale.",
    },
    dettes: {
      title: "Dettes",
      objective: "Réduire rapidement le coût de la dette et libérer du budget.",
      placement: [
        "Vers les crédits ou dettes avec le coût le plus élevé.",
        "Option simple V1: un plan de remboursement unique.",
      ],
      rules: [
        "SmartSave cible d'abord les dettes prioritaires et coûteuses.",
        "Le montant varie selon la capacité mensuelle disponible.",
        "Quand les dettes sont assainies, le flux est réalloué aux autres piliers.",
      ],
      nextActions: [
        "Lister les dettes à rembourser en priorité.",
        "Programmer une mensualité complémentaire automatique.",
      ],
      more: "Tu pourras ensuite définir une stratégie précise (avalanche/snowball).",
    },
  };

  const getAllocationDetailsTemplate = (key, fallbackLabel) => {
    if (ALLOCATION_DETAILS_TEMPLATES[key]) return ALLOCATION_DETAILS_TEMPLATES[key];
    return {
      title: fallbackLabel || "Compte",
      objective: "Expliquer le rôle de ce compte dans ta répartition SmartSave.",
      placement: ["Sur un compte dédié et séparé du compte courant."],
      rules: [
        "Le montant est calculé selon les priorités SmartSave du mois.",
        "Le flux peut être ajusté automatiquement si ta capacité change.",
      ],
      nextActions: ["Valider le compte de destination.", "Activer un virement automatique mensuel."],
      more: "",
    };
  };

  const setupSmartSaveAllocationDetails = () => {
    const modal = document.querySelector("[data-allocation-details-modal]");
    const list = document.querySelector("[data-allocation-list]");
    if (!modal || !list || modal.dataset.bound === "true") return;
    if (modal.hidden || modal.getAttribute("aria-hidden") === "true") {
      modal.setAttribute("inert", "");
    }

    const titleNode = modal.querySelector("[data-allocation-details-title]");
    const objectiveNode = modal.querySelector("[data-allocation-details-objective]");
    const rulesNode = modal.querySelector("[data-allocation-details-rules]");
    const moreNode = modal.querySelector("[data-allocation-details-more]");
    const monthlyNode = modal.querySelector("[data-allocation-details-monthly]");
    const goalNode = modal.querySelector("[data-allocation-details-goal]");
    let lastTrigger = null;

    const renderSimpleList = (node, entries) => {
      if (!node) return;
      node.innerHTML = ensureArray(entries)
        .map((entry) => `<li>${entry}</li>`)
        .join("");
    };

    const readTaxBreakdown = () => {
      const monthlyPlan = lastMonthlyContext?.monthlyPlan || {};
      const snapshot = monthlyPlan?.allocationResultSnapshot || {};
      const taxFunding =
        snapshot?.debug?.taxFunding ||
        lastRenderContext?.data?.allocation?.debug?.taxFunding ||
        {};
      const allocationDebug =
        snapshot?.debug ||
        lastRenderContext?.data?.allocation?.debug ||
        {};
      const taxProvision = lastRenderContext?.data?.taxProvision || {};

      const totalEstimate = Math.max(
        0,
        toNumber(taxFunding.totalEstimate || taxProvision.totalTax || 0)
      );
      const remainingEstimate = Math.max(
        0,
        toNumber(
          taxFunding.remainingEstimate != null
            ? taxFunding.remainingEstimate
            : taxProvision.remaining != null
            ? taxProvision.remaining
            : taxProvision.outstanding || 0
        )
      );
      const monthsRemaining = Math.max(
        0,
        Math.round(
          toNumber(
            taxFunding.monthsRemaining != null
              ? taxFunding.monthsRemaining
              : taxProvision.monthsRemaining || 0
          )
        )
      );
      const monthlyNeed = Math.max(0, toNumber(taxFunding.monthlyNeed || taxProvision.monthlyNeed || 0));
      const monthlyTarget = Math.max(0, toNumber(taxFunding.monthlyTarget || taxProvision.monthlyAmount || 0));
      const shortfall = Math.max(0, toNumber(taxFunding.shortfall || 0));
      const gapToNeed = Math.max(0, toNumber(taxFunding.gapToNeed || 0));
      const topUpFromCurrent = Math.max(0, toNumber(taxFunding.topUpFromCurrent || 0));
      const topUpFromSecurity = Math.max(0, toNumber(taxFunding.topUpFromSecurity || 0));
      const eligibleFromCurrent = Math.max(0, toNumber(taxFunding.eligibleFromCurrent || 0));
      const eligibleFromSecurity = Math.max(0, toNumber(taxFunding.eligibleFromSecurity || 0));
      const mode = String(taxFunding.mode || "AUTO_PROVISION").toUpperCase();
      const currentExcessRecycled = Math.max(0, toNumber(allocationDebug.currentExcessRecycled || 0));
      const pressureRatioPct = Math.max(0, toNumber(taxFunding.pressureRatio || 0));
      const softTrigger = !!taxFunding.softTrigger;
      const preTopUpNeeded = Math.max(0, toNumber(taxFunding.preTopUpNeeded || 0));
      const preTopUpApplied = Math.max(0, toNumber(taxFunding.preTopUpApplied || 0));
      const planTaxMonthlyTarget = Math.max(0, toNumber(monthlyPlan?.taxMonthlyTarget || 0));
      const planTaxMonthlyActual = Math.max(0, toNumber(monthlyPlan?.taxMonthlyActual || 0));
      const planTaxTopUp = Math.max(0, toNumber(monthlyPlan?.taxTopUpFromSurplus || 0));
      const planTaxShortfall = Math.max(0, toNumber(monthlyPlan?.taxShortfallThisMonth || 0));
      const planTaxNotProvisioned = Math.max(0, toNumber(monthlyPlan?.taxNotProvisionedAmount || 0));
      const planTaxMode = String(monthlyPlan?.taxMode || taxFunding.mode || "AUTO_PROVISION").toUpperCase();
      const planTaxChoice = String(monthlyPlan?.taxOnboardingChoice || "").toUpperCase() || null;
      const strategy = getTaxStrategyInfo({ mode: planTaxMode, choice: planTaxChoice });
      const rebalanceTopupToTax = ensureArray(monthlyPlan?.rebalanceTransfers)
        .filter((entry) => String(entry?.to || "").trim().toLowerCase() === "tax")
        .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount || 0)), 0);

      return {
        totalEstimate,
        remainingEstimate,
        monthsRemaining,
        monthlyNeed: planTaxMonthlyTarget > 0 ? planTaxMonthlyTarget : monthlyNeed,
        monthlyTarget: planTaxMonthlyActual > 0 ? planTaxMonthlyActual : monthlyTarget,
        monthlyTopUp: planTaxTopUp,
        shortfall: planTaxShortfall > 0 ? planTaxShortfall : shortfall,
        notProvisioned: planTaxNotProvisioned,
        strategyKey: strategy.key,
        strategyLabel: strategy.label,
        strategyRules: strategy.rules,
        strategyMore: strategy.more,
        gapToNeed,
        topUpFromCurrent,
        topUpFromSecurity,
        eligibleFromCurrent,
        eligibleFromSecurity,
        mode,
        currentExcessRecycled,
        pressureRatioPct,
        softTrigger,
        preTopUpNeeded,
        preTopUpApplied,
        rebalanceTopupToTax,
      };
    };

    const closeModal = () => {
      const activeEl = document.activeElement;
      if (activeEl && modal.contains(activeEl)) {
        const fallbackFocus =
          (lastTrigger && document.contains(lastTrigger) ? lastTrigger : null) ||
          list.querySelector("[data-allocation-details-trigger]") ||
          document.querySelector("[data-smartsave-main-cta]") ||
          document.body;
        if (fallbackFocus && typeof fallbackFocus.focus === "function") {
          try {
            fallbackFocus.focus({ preventScroll: true });
          } catch (_error) {
            fallbackFocus.focus();
          }
        } else if (typeof activeEl.blur === "function") {
          activeEl.blur();
        }
      }
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      modal.setAttribute("inert", "");
      document.body.classList.remove("allocation-details-open");
      window.setTimeout(() => {
        if (!modal.classList.contains("is-open")) modal.hidden = true;
      }, 120);
    };

    const openForCard = (card) => {
      if (!card) return;
      lastTrigger = card;
      const key = String(card.dataset.allocationDetailKey || "").trim();
      const amount = Math.max(0, toNumber(card.dataset.allocationDetailAmount || 0));
      const fallbackLabel =
        card.querySelector("[data-allocation-card-label]")?.textContent?.trim() ||
        card.querySelector(".allocation-card__title p")?.textContent?.trim() ||
        "Compte";
      const template = getAllocationDetailsTemplate(key, fallbackLabel);
      const goalLabel = String(card.dataset.allocationDetailGoal || "").trim();

      if (titleNode) {
        titleNode.textContent = `${template.title} — ${formatCurrency(amount)}`;
      }
      if (objectiveNode) objectiveNode.textContent = template.objective;
      renderSimpleList(rulesNode, template.rules);
      if (moreNode) moreNode.textContent = String(template.more || "").trim() || "Reste cohérent chaque mois.";
      if (monthlyNode) monthlyNode.textContent = `Ce mois-ci : ${formatCurrency(amount)}`;
      if (goalNode) {
        goalNode.hidden = !goalLabel;
        goalNode.textContent = goalLabel || "";
      }

      modal.hidden = false;
      modal.removeAttribute("inert");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("allocation-details-open");
      window.requestAnimationFrame(() => modal.classList.add("is-open"));
    };

    list.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-allocation-details-trigger]");
      if (!trigger || !list.contains(trigger)) return;
      openForCard(trigger);
    });

    modal.addEventListener("click", (event) => {
      const closeTrigger = event.target.closest("[data-allocation-details-close]");
      if (closeTrigger) {
        closeModal();
        return;
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("is-open")) {
        closeModal();
        return;
      }
      const target = event.target;
      const trigger =
        target && typeof target.closest === "function"
          ? target.closest("[data-allocation-details-trigger]")
          : null;
      if (!trigger) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openForCard(trigger);
      }
    });

    modal.dataset.bound = "true";
  };

  const formatTransferAccountLabel = (value) => {
    const key = String(value || "").trim().toLowerCase();
    const labels = {
      current: "Compte courant",
      security: "Compte épargne",
      tax: "Provision impôts",
      pillar3a: "3e pilier",
      investments: "Investissements",
      projects: "Projets",
      projets: "Projets",
      projetslongterme: "Projets long terme",
      projetscourtterme: "Projets court terme",
      comptecourant: "Compte courant",
      securite: "Compte épargne",
      impots: "Provision impôts",
      pilier3a: "3e pilier",
      investissements: "Investissements",
      projetsLongTerme: "Projets long terme",
      projetsCourtTerme: "Projets court terme",
    };
    return labels[key] || String(value || "Compte");
  };

  const roundMoney = (value) => Math.max(0, Math.round(toNumber(value)));

  const buildTransferTable = (rows = [], options = {}) => {
    const showAfter = Boolean(options.showAfter);
    if (!rows.length) {
      return '<p class="smartsave-inline-state">Aucun mouvement requis.</p>';
    }
    const headerAfter = showAfter ? "<th>Après transfert</th>" : "";
    const body = rows
      .map((row) => {
        const afterCell = showAfter ? `<td>${row.after || "—"}</td>` : "";
        return `
          <tr>
            <td>${row.fromLabel || "—"}</td>
            <td>${row.toLabel || "—"}</td>
            <td>${formatCurrency(roundMoney(row.amount))}</td>
            <td>${row.reason || "—"}</td>
            ${afterCell}
          </tr>
        `;
      })
      .join("");
    return `
      <div class="table-wrap">
        <table class="table" aria-label="Détails des mouvements">
          <thead>
            <tr>
              <th>De</th>
              <th>Vers</th>
              <th>Montant</th>
              <th>Pourquoi</th>
              ${headerAfter}
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  };

  const computeThirdPillarRoomForRebalance = (formData = {}, inputs = {}, balances = {}, monthId = "") => {
    const employmentStatus = String(formData?.personal?.employmentStatus || "").toLowerCase();
    const annualNetIncome = Math.max(0, toNumber(inputs.revenuNetMensuel || inputs.totalIncome || 0) * 12);
    const pillarCap = employmentStatus.includes("indep")
      ? Math.min(annualNetIncome * 0.2, 35280)
      : 7056;
    const monthDate = parseMonthKey(monthId) || new Date();
    const fiscalYear = monthDate.getFullYear();
    const pillarPaidYtdYearRaw = toNumber(
      formData?.assets?.thirdPillarPaidYTDYear || formData?.taxes?.thirdPillarPaidYTDYear || fiscalYear
    );
    const pillarPaidYtdYear = Math.round(pillarPaidYtdYearRaw) || fiscalYear;
    const pillarPaidYtdStored = Math.max(
      0,
      toNumber(formData?.assets?.thirdPillarPaidYTD || formData?.taxes?.thirdPillarPaidYTD || 0)
    );
    const pillarPaidYtd = pillarPaidYtdYear === fiscalYear ? pillarPaidYtdStored : 0;
    const hasExplicitYtd =
      formData?.assets?.thirdPillarPaidYTD != null || formData?.taxes?.thirdPillarPaidYTD != null;
    if (!hasExplicitYtd) {
      const pillarBalance = Math.max(
        0,
        toNumber(
          balances?.pillar3a ??
            formData?.assets?.pillar3a ??
            formData?.assets?.thirdPillarAmount ??
            formData?.assets?.thirdPillar ??
            formData?.assets?.thirdPillarValue ??
            0
        )
      );
      if (pillarBalance >= Math.max(0, roundMoney(pillarCap) - 0.5)) {
        return 0;
      }
    }
    return Math.max(0, pillarCap - pillarPaidYtd);
  };

  const monthsUntilDate = (dueDate, fromDate = new Date()) => {
    const now = fromDate instanceof Date ? fromDate : new Date(fromDate);
    const due = new Date(dueDate);
    if (Number.isNaN(now.getTime()) || Number.isNaN(due.getTime())) return 1;
    const years = due.getFullYear() - now.getFullYear();
    let months = years * 12 + (due.getMonth() - now.getMonth());
    if (due.getDate() >= now.getDate()) months += 1;
    return Math.max(1, months);
  };

  const defaultTaxDueDate = (fromDate = new Date()) => {
    const now = fromDate instanceof Date ? fromDate : new Date(fromDate);
    const dueYear = now.getFullYear() + 1;
    return `${dueYear}-03-31`;
  };

  const getTaxStrategyInfo = ({ mode = "AUTO_PROVISION", choice = null } = {}) => {
    const safeMode = String(mode || "AUTO_PROVISION").toUpperCase();
    const safeChoice = String(choice || "").toUpperCase();
    if (safeMode === "PAY_LATER" || safeChoice === "PAY_LATER") {
      return {
        key: "PAY_LATER",
        label: "Gérer plus tard",
        rules: [
          "Aucune provision impôts n'est faite ce mois.",
          "Le montant restant est reporté et peut créer un rattrapage plus tard.",
        ],
        more: "Option à risque: elle maximise le cash court terme mais augmente le risque d'un gros paiement.",
      };
    }
    if (safeChoice === "USE_SAVINGS") {
      return {
        key: "USE_SAVINGS",
        label: "Utiliser mon épargne",
        rules: [
          "SmartSave top-up d'abord la réserve impôts via réarrangement interne (courant puis épargne excédentaire).",
          "Ensuite, la mensualité impôts est recalculée sur le besoin restant.",
        ],
        more: "Cette option réduit vite la pression mensuelle, en respectant un plancher de sécurité.",
      };
    }
    if (safeChoice === "MIX") {
      return {
        key: "MIX",
        label: "Équilibré (MIX)",
        rules: [
          "Un top-up exceptionnel est prélevé sur le surplus du mois.",
          "Le reste est couvert par une mensualité impôts plafonnée.",
        ],
        more: "Compromis entre effort immédiat et lissage des prochains mois.",
      };
    }
    if (safeChoice === "SPREAD") {
      return {
        key: "SPREAD",
        label: "Mensualités légères (SPREAD)",
        rules: [
          "Aucun top-up exceptionnel.",
          "SmartSave verse le maximum mensuel raisonnable selon le cap.",
        ],
        more: "L'effort est lissé au maximum, avec report éventuel si le cap bloque.",
      };
    }
    return {
      key: "AUTO",
      label: "Provision automatique",
      rules: [
        "SmartSave calcule une mensualité impôts selon le besoin restant et le cap du mois.",
      ],
      more: "Mode standard: provision régulière sans action spéciale.",
    };
  };

  const getEffectiveTaxPlanAmount = ({ monthlyPlan = null, fallbackAllocationTax = 0 } = {}) => {
    const plan = monthlyPlan && typeof monthlyPlan === "object" ? monthlyPlan : {};
    const hasExplicitTaxPlan =
      Object.prototype.hasOwnProperty.call(plan, "taxMonthlyActual") ||
      Object.prototype.hasOwnProperty.call(plan, "taxTopUpFromSurplus") ||
      Object.prototype.hasOwnProperty.call(plan, "taxMode") ||
      Object.prototype.hasOwnProperty.call(plan, "taxOnboardingChoice");
    if (!hasExplicitTaxPlan) return Math.max(0, toNumber(fallbackAllocationTax || 0));
    const mode = String(plan.taxMode || "AUTO_PROVISION").toUpperCase();
    const choice = String(plan.taxOnboardingChoice || "").toUpperCase();
    if (mode === "PAY_LATER" || choice === "PAY_LATER") return 0;
    const monthly = Math.max(0, toNumber(plan.taxMonthlyActual || 0));
    const topup = Math.max(0, toNumber(plan.taxTopUpFromSurplus || 0));
    const topupIncluded = choice === "MIX" ? topup : 0;
    return Math.max(0, roundMoney(monthly + topupIncluded));
  };

  const computeTaxOnboardingTrigger = ({
    annualTaxEstimate = 0,
    taxReserveBalance = 0,
    taxDueDate = null,
    surplus = 0,
    capPct = 0.35,
    now = new Date(),
  }) => {
    const safeCapPct = clamp(toNumber(capPct || 0.35), 0, 1);
    const dueDate = String(taxDueDate || defaultTaxDueDate(now)).trim();
    const remainingNeed = Math.max(0, toNumber(annualTaxEstimate) - toNumber(taxReserveBalance));
    const monthsRemaining = Math.max(1, monthsUntilDate(dueDate, now));
    const theoreticalNeed = remainingNeed / Math.max(1, monthsRemaining);
    const capMonthlyFromSurplus = Math.max(0, toNumber(surplus) * safeCapPct);
    const pressureRatio = theoreticalNeed / Math.max(1, capMonthlyFromSurplus);
    const shouldTrigger = remainingNeed > 0 && (monthsRemaining <= 3 || pressureRatio > 1);
    return {
      dueDate,
      remainingNeed: roundMoney(remainingNeed),
      monthsRemaining,
      theoreticalNeed: roundMoney(theoreticalNeed),
      capPct: safeCapPct,
      capMonthlyFromSurplus: roundMoney(capMonthlyFromSurplus),
      pressureRatio,
      shouldTrigger,
    };
  };

  const computeMonthlyTaxContributionFromSurplus = ({
    taxMetrics = {},
    userSettings = {},
    smartSaveSettings = {},
    advancedSettings = {},
    surplus = 0,
    now = new Date(),
  }) => {
    const safeSmartSaveSettings = normalizeSmartSaveSettings(smartSaveSettings);
    const safeAdvancedSettings = normalizeAdvancedSettings(advancedSettings);
    const smartTaxDisabled =
      !safeSmartSaveSettings.taxes.enabled ||
      String(safeSmartSaveSettings.taxes.provisionMode || "").toLowerCase() === "recommendations";
    const priority = resolveTaxPriority({
      smartSaveSettings: safeSmartSaveSettings,
      advancedSettings: safeAdvancedSettings,
    });
    const defaultChoice = mapTaxPriorityToChoice(priority);
    const rawMode = smartTaxDisabled
      ? "PAY_LATER"
      : String(userSettings?.taxMode || "AUTO_PROVISION").toUpperCase();
    const choiceRaw = String(userSettings?.taxOnboardingChoice || "").toUpperCase();
    let onboardingChoice = choiceRaw || defaultChoice || null;
    if (priority === "critical") onboardingChoice = "USE_SAVINGS";
    if (smartTaxDisabled) onboardingChoice = "PAY_LATER";
    if (onboardingChoice === "PAY_LATER" && !smartTaxDisabled) {
      onboardingChoice = defaultChoice || "SPREAD";
    }
    const mode = onboardingChoice === "PAY_LATER" ? "PAY_LATER" : rawMode || "AUTO_PROVISION";
    const capPct = resolveTaxCapPct({
      smartSaveSettings: safeSmartSaveSettings,
      advancedSettings: safeAdvancedSettings,
    });
    let remainingNeed = Math.max(0, toNumber(taxMetrics.remainingNeed || 0));
    const monthsRemaining = Math.max(1, toNumber(taxMetrics.monthsRemaining || 1));
    const initialSurplus = Math.max(0, toNumber(surplus));
    const capMonthlyFromSurplus = Math.max(0, initialSurplus * capPct);
    const computeMonthlyLayer = (need, availableSurplus) => {
      const safeNeed = Math.max(0, toNumber(need));
      const theoretical = safeNeed / monthsRemaining;
      const capMonthly = Math.max(0, toNumber(availableSurplus) * capPct);
      const monthlyActual = Math.max(0, Math.min(theoretical, safeNeed, capMonthly));
      const shortfall = Math.max(0, theoretical - monthlyActual);
      return {
        theoretical,
        capMonthly,
        monthlyActual,
        shortfall,
      };
    };

    if (mode === "MIXED_WITH_13TH") {
      const expectedAmount = Math.max(0, toNumber(userSettings?.taxLumpSumExpectedAmount || 0));
      const expectedMonth = String(userSettings?.taxLumpSumExpectedMonth || "").trim();
      const currentMonth = getMonthKey(now);
      if (expectedAmount > 0 && expectedMonth && expectedMonth >= currentMonth) {
        remainingNeed = Math.max(0, remainingNeed - expectedAmount);
      }
    }

    if (mode === "PAY_LATER") {
      return {
        mode,
        onboardingChoice,
        taxMonthlyTarget: 0,
        taxMonthlyActual: 0,
        taxTopUpFromSurplus: 0,
        taxShortfallThisMonth: 0,
        taxNotProvisionedAmount: roundMoney(remainingNeed),
        capMonthlyFromSurplus: roundMoney(capMonthlyFromSurplus),
        pressure: roundMoney(toNumber(taxMetrics.pressureRatio || 0)),
      };
    }

    let taxTopUpFromSurplus = 0;
    let workingNeed = remainingNeed;
    let workingSurplus = initialSurplus;
    const isMix = onboardingChoice === "MIX" && workingNeed > 0;
    if (isMix) {
      const preTaxPct = monthsRemaining <= 2 ? 0.2 : 0.1;
      const targetRemaining = capMonthlyFromSurplus * monthsRemaining;
      const neededTopUpToStabilize = Math.max(0, workingNeed - targetRemaining);
      const topUpCap = Math.min(workingNeed, initialSurplus * preTaxPct);
      taxTopUpFromSurplus = Math.min(neededTopUpToStabilize, topUpCap);
      workingNeed = Math.max(0, workingNeed - taxTopUpFromSurplus);
      workingSurplus = Math.max(0, initialSurplus - taxTopUpFromSurplus);
    }

    const monthlyLayer = computeMonthlyLayer(workingNeed, workingSurplus);
    return {
      mode,
      onboardingChoice,
      taxMonthlyTarget: roundMoney(monthlyLayer.theoretical),
      taxMonthlyActual: roundMoney(monthlyLayer.monthlyActual),
      taxTopUpFromSurplus: roundMoney(taxTopUpFromSurplus),
      taxShortfallThisMonth: roundMoney(monthlyLayer.shortfall),
      taxNotProvisionedAmount: roundMoney(Math.max(0, workingNeed - monthlyLayer.monthlyActual)),
      capMonthlyFromSurplus: roundMoney(capMonthlyFromSurplus),
      capMonthlyAfterTopUp: roundMoney(monthlyLayer.capMonthly),
      pressure: roundMoney(toNumber(taxMetrics.pressureRatio || 0)),
    };
  };

  const computeRebalanceTransfers = ({
    balances = {},
    limits = {},
    taxFunding = {},
    taxPriorityNeed = 0,
    formData = {},
    monthInputs = {},
    monthId = "",
    smartSaveSettings = {},
    advancedSettings = {},
    monthlySurplus = 0,
  }) => {
    const safeSmartSaveSettings = normalizeSmartSaveSettings(smartSaveSettings);
    const safeAdvancedSettings = normalizeAdvancedSettings(advancedSettings);
    const state = {
      current: Math.max(0, roundMoney(balances.current)),
      security: Math.max(0, roundMoney(balances.security)),
      tax: Math.max(0, roundMoney(balances.tax)),
      pillar3a: Math.max(0, roundMoney(balances.pillar3a)),
      investments: Math.max(0, roundMoney(balances.investments)),
    };
    const frozenAccount = resolveActiveFrozenAccount(safeAdvancedSettings);
    const pullOrder =
      safeAdvancedSettings.savingsUsage.pullOrder === "savings_first"
        ? ["security", "current"]
        : ["current", "security"];
    const currentLimit = Math.max(0, roundMoney(limits.current || 0));
    const savingsLimit = Math.max(0, roundMoney(limits.savings || 0));
    const taxShortfall = Math.max(0, toNumber(taxPriorityNeed || 0));
    const surplusCurrent = Math.max(0, state.current - currentLimit);
    const savingsTarget = savingsLimit;
    const savingsFloor = savingsTarget;
    const surplusSavings = Math.max(0, state.security - savingsTarget);
    const savingsComfortCeiling = roundMoney(savingsTarget * 1.5);
    let savingsReallocationRate = 0;
    let savingsZone = "security";
    if (state.security > savingsComfortCeiling) {
      savingsReallocationRate = 0.35;
      savingsZone = "over_savings";
    } else if (state.security > savingsTarget) {
      savingsReallocationRate = 0.2;
      savingsZone = "comfort";
    }
    const configuredMonthlyCap = Math.max(
      0,
      toNumber(safeAdvancedSettings?.transferControls?.maxMonthlyTotal || 0)
    );
    const savingsMonthlyCap = configuredMonthlyCap > 0 ? roundMoney(configuredMonthlyCap) : Number.POSITIVE_INFINITY;
    const rawSavingsMovable = roundMoney(surplusSavings * savingsReallocationRate);
    const cappedSavingsMovable = Math.max(0, Math.min(rawSavingsMovable, savingsMonthlyCap));
    let movableFromCurrent = surplusCurrent;
    let movableFromSavings = cappedSavingsMovable;
    const initialMovableFromCurrent = roundMoney(movableFromCurrent);
    const initialMovableFromSavings = roundMoney(movableFromSavings);
    const initialMovablePool = roundMoney(initialMovableFromCurrent + initialMovableFromSavings);
    const pillarRoom = computeThirdPillarRoomForRebalance(formData, monthInputs, balances, monthId);
    const transfers = [];

    const pushTransfer = (from, to, amount, reason) => {
      const fromKey = normalizeTransferAccountKey(from);
      const toKey = normalizeTransferAccountKey(to);
      if (frozenAccount && (fromKey === frozenAccount || toKey === frozenAccount)) return 0;
      const sourceFloor =
        from === "current"
          ? currentLimit
          : from === "security"
          ? savingsFloor
          : 0;
      const maxAllowedFromSource =
        from === "current" || from === "security"
          ? Math.max(0, Math.floor(Math.max(0, toNumber(state[from])) - sourceFloor))
          : Math.max(0, Math.floor(Math.max(0, toNumber(state[from]))));
      const value = Math.min(roundMoney(amount), maxAllowedFromSource);
      if (value <= 0 || from === to) return 0;
      if (state[from] < value) return 0;
      state[from] -= value;
      state[to] = Math.max(0, toNumber(state[to])) + value;
      const after = `${formatTransferAccountLabel(from)}: ${formatCurrency(
        state[from]
      )} · ${formatTransferAccountLabel(to)}: ${formatCurrency(state[to])}`;
      transfers.push({
        from,
        to,
        fromLabel: formatTransferAccountLabel(from),
        toLabel: formatTransferAccountLabel(to),
        amount: value,
        reason,
        after,
      });
      return value;
    };

    const getMovablePool = () => Math.max(0, roundMoney(movableFromCurrent + movableFromSavings));
    let keepOnSavings = 0;

    const pullFromSource = (sourceKey, toKey, requestedAmount, reason) => {
      const wanted = Math.max(0, roundMoney(requestedAmount));
      if (!wanted) return 0;
      if (sourceKey === "current") {
        const part = Math.min(wanted, movableFromCurrent);
        if (part <= 0) return 0;
        const applied = pushTransfer("current", toKey, part, reason);
        movableFromCurrent = Math.max(0, roundMoney(movableFromCurrent - applied));
        return applied;
      }
      if (sourceKey === "security") {
        const part = Math.min(wanted, movableFromSavings);
        if (part <= 0) return 0;
        const applied = pushTransfer("security", toKey, part, reason);
        movableFromSavings = Math.max(0, roundMoney(movableFromSavings - applied));
        return applied;
      }
      return 0;
    };

    const pullFromPool = (toKey, requestedAmount, reasons = {}) => {
      let remaining = Math.max(0, roundMoney(requestedAmount));
      if (!remaining) return 0;
      let appliedTotal = 0;
      pullOrder.forEach((sourceKey) => {
        if (remaining <= 0) return;
        const reason =
          sourceKey === "security"
            ? reasons.security || reasons.default || "Réarrangement SmartSave"
            : reasons.current || reasons.default || "Réarrangement SmartSave";
        const applied = pullFromSource(sourceKey, toKey, remaining, reason);
        if (!applied) return;
        appliedTotal += applied;
        remaining = Math.max(0, roundMoney(remaining - applied));
      });
      return appliedTotal;
    };

    const reserveOnSavings = (requestedAmount) => {
      const wanted = Math.max(0, roundMoney(requestedAmount));
      if (!wanted) return 0;
      const reserved = Math.min(wanted, movableFromSavings);
      if (!reserved) return 0;
      movableFromSavings = Math.max(0, roundMoney(movableFromSavings - reserved));
      keepOnSavings += reserved;
      return reserved;
    };

    const allocateToSavings = (requestedAmount, reason) => {
      let remaining = Math.max(0, roundMoney(requestedAmount));
      if (!remaining) return 0;
      let applied = 0;
      const reserved = reserveOnSavings(remaining);
      if (reserved > 0) {
        applied += reserved;
        remaining = Math.max(0, roundMoney(remaining - reserved));
      }
      if (remaining > 0) {
        applied += pullFromSource(
          "current",
          "security",
          remaining,
          reason || "Renfort compte épargne"
        );
      }
      return applied;
    };

    // 1) Compte courant: combler le trou vers la cible depuis le surplus épargne mobilisable.
    const currentGap = Math.max(0, roundMoney(currentLimit - state.current));
    if (currentGap > 0 && movableFromSavings > 0) {
      pullFromSource("security", "current", Math.min(currentGap, movableFromSavings), "Compte courant sous la cible");
    }

    // 2) Impôts: réduction de pression basée sur ratio effort/revenu.
    const totalTaxEstimate = Math.max(0, toNumber(taxFunding?.totalEstimate || 0));
    const remainingTaxEstimate = Math.max(0, toNumber(taxFunding?.remainingEstimate || 0));
    const fallbackTaxTotal = Math.max(0, state.tax + Math.max(remainingTaxEstimate, taxShortfall));
    const totalTaxes = Math.max(totalTaxEstimate, fallbackTaxTotal);
    const provisionExisting = Math.max(0, toNumber(state.tax));
    const monthsRemaining = Math.max(1, Math.round(toNumber(taxFunding?.monthsRemaining || 1)));
    const taxOutstanding = Math.max(0, totalTaxes - provisionExisting);
    const effortMensuel = taxOutstanding / monthsRemaining;
    const revenuNetMensuel = Math.max(
      0,
      toNumber(monthInputs?.revenuNetMensuel || monthInputs?.totalIncome || 0)
    );
    const ratioImpots = revenuNetMensuel > 0 ? effortMensuel / revenuNetMensuel : taxOutstanding > 0 ? 1 : 0;

    let reductionRate = 0;
    let surplusCapRate = 0;
    let taxReasonLabel = "";
    if (ratioImpots > 0.2) {
      reductionRate = 0.3;
      surplusCapRate = 0.4;
      taxReasonLabel = "Charge impôts critique: réduction prioritaire";
    } else if (ratioImpots > 0.1) {
      reductionRate = 0.15;
      surplusCapRate = 0.25;
      taxReasonLabel = "Charge impôts lourde: réduction progressive";
    }

    if (taxOutstanding > 0 && reductionRate > 0) {
      const effortCible = effortMensuel * (1 - reductionRate);
      const reductionMensuelle = Math.max(0, effortMensuel - effortCible);
      const montantAProvisionner = roundMoney(reductionMensuelle * monthsRemaining);
      const surplusDisponible = getMovablePool();
      const montantFinal = Math.max(
        0,
        Math.min(montantAProvisionner, roundMoney(surplusDisponible * surplusCapRate), surplusDisponible)
      );
      if (montantFinal > 0) {
        pullFromPool("tax", montantFinal, {
          current: `${taxReasonLabel} (depuis courant)`,
          security: `${taxReasonLabel} (depuis épargne)`,
          default: taxReasonLabel,
        });
      }
    }

    // 3) Epargne: allocation progressive selon niveau de remplissage.
    const fillRatio = savingsTarget > 0 ? state.security / savingsTarget : 1;
    let savingsPct = 0;
    if (fillRatio < 0.5) savingsPct = 0.6;
    else if (fillRatio < 0.9) savingsPct = 0.3;
    else if (fillRatio < 1) savingsPct = 0.2;
    else savingsPct = 0;
    if (savingsPct > 0) {
      const remainingSurplus = getMovablePool();
      const savingsTargetAmount = roundMoney(remainingSurplus * savingsPct);
      if (savingsTargetAmount > 0) {
        allocateToSavings(savingsTargetAmount, "Renfort épargne selon palier de remplissage");
      }
    }

    // 4) Fin de réarrangement: priorité au 3e pilier jusqu'au plafond, puis investissements.
    const remainingBeforePillar = getMovablePool();
    if (remainingBeforePillar > 0 && pillarRoom > 0) {
      const pillarTarget = Math.min(remainingBeforePillar, roundMoney(pillarRoom));
      pullFromPool("pillar3a", pillarTarget, {
        current: "Priorité au 3e pilier (plafond annuel non atteint)",
        security: "Priorité au 3e pilier depuis surplus épargne",
        default: "Priorité au 3e pilier",
      });
    }

    const remainingToInvest = getMovablePool();
    if (remainingToInvest > 0) {
      pullFromPool("investments", remainingToInvest, {
        current: "Surplus résiduel vers investissements",
        security: "Surplus épargne résiduel vers investissements",
        default: "Surplus résiduel vers investissements",
      });
    }

    const totalTransfers = roundMoney(transfers.reduce((sum, item) => sum + toNumber(item.amount), 0));
    const finalMovableCurrent = roundMoney(movableFromCurrent);
    const finalMovableSavings = roundMoney(movableFromSavings);
    const usedFromCurrent = Math.max(0, roundMoney(initialMovableFromCurrent - finalMovableCurrent));
    const usedFromSavings = Math.max(0, roundMoney(initialMovableFromSavings - finalMovableSavings));
    const transferredFromCurrent = roundMoney(
      transfers
        .filter((item) => String(item?.from || "").trim().toLowerCase() === "current")
        .reduce((sum, item) => sum + toNumber(item.amount || 0), 0)
    );
    const transferredFromSavings = roundMoney(
      transfers
        .filter((item) => String(item?.from || "").trim().toLowerCase() === "security")
        .reduce((sum, item) => sum + toNumber(item.amount || 0), 0)
    );
    const rearrangedTotal = roundMoney(totalTransfers + keepOnSavings);
    return {
      transfers,
      totals: {
        pool: initialMovablePool,
        rearrangedTotal,
        keepOnSavings: roundMoney(keepOnSavings),
        savingsFloor: roundMoney(savingsFloor),
        savingsTarget: roundMoney(savingsTarget),
        savingsZone,
        savingsRatePct: roundMoney(savingsReallocationRate * 100),
        savingsProgressivePct: roundMoney(savingsPct * 100),
        savingsMonthlyCap: Number.isFinite(savingsMonthlyCap) ? roundMoney(savingsMonthlyCap) : 0,
        savingsMovable: roundMoney(cappedSavingsMovable),
        movablePool: roundMoney(getMovablePool()),
        unusedPool: roundMoney(getMovablePool()),
        sourceUsage: {
          currentUsed: usedFromCurrent,
          savingsUsed: usedFromSavings,
          currentTransferred: transferredFromCurrent,
          savingsTransferred: transferredFromSavings,
          savingsKept: roundMoney(keepOnSavings),
        },
        totalTransfers,
      },
      needsRebalance: transfers.length > 0,
      overflow: {
        current: roundMoney(surplusCurrent),
        savings: roundMoney(surplusSavings),
      },
    };
  };

  const computeMonthlyAllocationTransfers = ({
    entries = [],
    taxMonthly = {},
    availableSurplus = 0,
    currentLimit = 0,
    currentBalance = 0,
    pillarAnnualRoom = Number.POSITIVE_INFINITY,
    smartSaveSettings = {},
    advancedSettings = {},
    allocationSnapshot = null,
  }) => {
    const safeSmartSaveSettings = normalizeSmartSaveSettings(smartSaveSettings);
    const safeAdvancedSettings = normalizeAdvancedSettings(advancedSettings);
    const surplusEnvelope = Math.max(0, roundMoney(availableSurplus));
    const frozenAccount = resolveActiveFrozenAccount(safeAdvancedSettings);
    const isFrozenTransfer = (from, to) => {
      if (!frozenAccount) return false;
      const fromKey = normalizeTransferAccountKey(from);
      const toKey = normalizeTransferAccountKey(to);
      return fromKey === frozenAccount || toKey === frozenAccount;
    };
    const negativeSurplusMode = String(
      safeAdvancedSettings?.exceptions?.negativeSurplusMode || "no_transfer"
    ).toLowerCase();
    if (safeAdvancedSettings?.overrides?.skipCurrentMonth) {
      return {
        transfers: [],
        totalTransfers: 0,
        totalAllocated: surplusEnvelope,
        availableSurplus: surplusEnvelope,
        retainedOnCurrent: surplusEnvelope,
        breakdown: surplusEnvelope > 0 ? { compteCourant: surplusEnvelope } : {},
      };
    }
    if (surplusEnvelope <= 0 && negativeSurplusMode === "no_transfer") {
      return {
        transfers: [],
        totalTransfers: 0,
        totalAllocated: 0,
        availableSurplus: surplusEnvelope,
        retainedOnCurrent: surplusEnvelope,
        breakdown: {},
      };
    }

    let remainingPillarAnnualRoom = Number.isFinite(pillarAnnualRoom)
      ? Math.max(0, roundMoney(pillarAnnualRoom))
      : Number.POSITIVE_INFINITY;
    const capPillarAmount = (toAccount, amount) => {
      const safeAmount = Math.max(0, roundMoney(amount));
      if (safeAmount <= 0) return 0;
      if (normalizeTransferAccountKey(toAccount) !== "pillar3a") return safeAmount;
      if (!Number.isFinite(remainingPillarAnnualRoom)) return safeAmount;
      return Math.min(safeAmount, remainingPillarAnnualRoom);
    };
    const consumePillarAmount = (toAccount, amount) => {
      if (normalizeTransferAccountKey(toAccount) !== "pillar3a") return;
      if (!Number.isFinite(remainingPillarAnnualRoom)) return;
      remainingPillarAnnualRoom = Math.max(0, roundMoney(remainingPillarAnnualRoom - roundMoney(amount)));
    };

    const snapshotAllocations =
      allocationSnapshot &&
      typeof allocationSnapshot === "object" &&
      allocationSnapshot.allocations &&
      typeof allocationSnapshot.allocations === "object"
        ? allocationSnapshot.allocations
        : null;
    const snapshotEntries = snapshotAllocations ? Object.entries(snapshotAllocations) : [];
    const snapshotPositiveTotal = snapshotEntries.reduce((sum, [, amount]) => {
      const value = Math.max(0, roundMoney(amount));
      return sum + value;
    }, 0);
    const snapshotPositiveForEnvelope = Math.max(0, roundMoney(snapshotPositiveTotal));
    const snapshotNegativeTotal = snapshotEntries.reduce((sum, [, amount]) => {
      const value = Math.min(0, roundMoney(amount));
      return sum + Math.abs(value);
    }, 0);
    const snapshotUsable =
      snapshotEntries.length > 0 &&
      snapshotNegativeTotal <= 0.5 &&
      snapshotPositiveForEnvelope <= surplusEnvelope + 0.5;
    if (snapshotAllocations && snapshotUsable) {
      const breakdown = {};
      const transfers = [];
      const addBreakdown = (key, amount) => {
        const safeKey = String(key || "").trim() || "compteCourant";
        const safeAmount = Math.max(0, roundMoney(amount));
        if (safeAmount <= 0) return;
        breakdown[safeKey] = Math.max(0, roundMoney(toNumber(breakdown[safeKey] || 0) + safeAmount));
      };
      const resolveTransferSpecFromAllocationKey = (key) => {
        const normalized = String(key || "").trim().toLowerCase();
        if (!normalized || normalized === "comptecourant") return null;
        if (normalized === "securite") return { to: "security", toLabel: formatTransferAccountLabel("security") };
        if (normalized === "impots") return { to: "tax", toLabel: formatTransferAccountLabel("tax") };
        if (normalized === "pilier3a") return { to: "pillar3a", toLabel: formatTransferAccountLabel("pillar3a") };
        if (normalized === "investissements") {
          return { to: "investments", toLabel: formatTransferAccountLabel("investments") };
        }
        if (normalized === "projetscourtterme" || normalized === "projetslongterme" || normalized === "projets") {
          return { to: "projects", toLabel: formatTransferAccountLabel("projects") };
        }
        return null;
      };

      Object.entries(snapshotAllocations).forEach(([key, amount]) => {
        const value = Math.max(0, roundMoney(amount));
        if (value <= 0) return;
        const normalizedKey = String(key || "").trim().toLowerCase();
        if (normalizedKey === "comptecourant") {
          addBreakdown("compteCourant", value);
          return;
        }
        const transferSpec = resolveTransferSpecFromAllocationKey(key);
        if (!transferSpec) {
          addBreakdown(key, value);
          return;
        }
        if (isFrozenTransfer("current", transferSpec.to)) {
          addBreakdown("compteCourant", value);
          return;
        }
        const cappedValue = capPillarAmount(transferSpec.to, value);
        if (cappedValue <= 0) return;
        addBreakdown(key, cappedValue);
        transfers.push({
          from: "current",
          to: transferSpec.to,
          fromLabel: formatTransferAccountLabel("current"),
          toLabel: transferSpec.toLabel,
          amount: cappedValue,
          allocationKey: String(key || "").trim() || "compteCourant",
          reason: "Répartition SmartSave du mois",
        });
        consumePillarAmount(transferSpec.to, cappedValue);
      });

      const allocatedBeforeFallback = roundMoney(
        Object.values(breakdown).reduce((sum, amount) => sum + Math.max(0, toNumber(amount)), 0)
      );
      const allocatedForEnvelope = Math.max(0, roundMoney(allocatedBeforeFallback));
      let remainingToAllocate = Math.max(0, surplusEnvelope - allocatedForEnvelope);
      if (remainingToAllocate > 0) {
        if (!isFrozenTransfer("current", "security")) {
          const value = roundMoney(remainingToAllocate);
          if (value > 0) {
            addBreakdown("securite", value);
            transfers.push({
              from: "current",
              to: "security",
              fromLabel: formatTransferAccountLabel("current"),
              toLabel: formatTransferAccountLabel("security"),
              amount: value,
              allocationKey: "securite",
              reason: "Ajustement SmartSave: reliquat vers sécurité",
            });
            remainingToAllocate = Math.max(0, remainingToAllocate - value);
          }
        }
        if (remainingToAllocate > 0) {
          addBreakdown("compteCourant", remainingToAllocate);
          remainingToAllocate = 0;
        }
      }

      const totalTransfers = roundMoney(
        transfers.reduce((sum, item) => sum + Math.max(0, toNumber(item?.amount || 0)), 0)
      );
      const totalAllocated = roundMoney(
        Object.values(breakdown).reduce((sum, amount) => sum + Math.max(0, toNumber(amount)), 0)
      );
      const effectiveEnvelope = Math.max(surplusEnvelope, totalAllocated);
      const retainedOnCurrent = Math.max(0, roundMoney(toNumber(breakdown.compteCourant || 0)));
      return {
        transfers,
        totalTransfers,
        totalAllocated,
        availableSurplus: effectiveEnvelope,
        retainedOnCurrent,
        breakdown,
      };
    }

    let remainingSurplus = surplusEnvelope;
    let retainedOnCurrent = 0;
    const normalizedCurrentLimit = Math.max(0, roundMoney(currentLimit || 0));
    const normalizedCurrentBalance = Math.max(0, roundMoney(currentBalance || 0));
    let remainingCurrentHeadroom = Math.max(0, normalizedCurrentLimit - normalizedCurrentBalance);
    const taxPriority = resolveTaxPriority({
      smartSaveSettings: safeSmartSaveSettings,
      advancedSettings: safeAdvancedSettings,
    });
    const taxesEnabled =
      Boolean(safeSmartSaveSettings.taxes.enabled) &&
      String(safeSmartSaveSettings.taxes.provisionMode || "").toLowerCase() !== "recommendations";
    const allocationOrder = String(
      safeSmartSaveSettings.allocationPriority.order || "security_tax_invest"
    );
    let remainingGrowthCap = resolveGrowthCapFromSettings({
      availableSurplus: surplusEnvelope,
      smartSaveSettings: safeSmartSaveSettings,
      advancedSettings: safeAdvancedSettings,
    });

    const breakdown = {};
    const source = ensureArray(entries).filter(
      (entry) =>
        entry &&
        entry.type === "transfer" &&
        entry.autoApplyKind === "allocation-transfer" &&
        Math.max(0, toNumber(entry.amount)) > 0
    );
    const transfers = [];
    const addBreakdown = (key, amount) => {
      const safeKey = String(key || "").trim() || "compteCourant";
      const safeAmount = Math.max(0, roundMoney(amount));
      if (safeAmount <= 0) return;
      breakdown[safeKey] = Math.max(0, roundMoney(toNumber(breakdown[safeKey] || 0) + safeAmount));
    };
    const resolveAllocationKey = (entry = {}) => {
      const explicit = String(entry?.allocationKey || entry?.key || "").trim();
      if (explicit) return explicit;
      const to = String(entry?.to || "").trim().toLowerCase();
      if (to === "security") return "securite";
      if (to === "tax") return "impots";
      if (to === "pillar3a") return "pilier3a";
      if (to === "investments") return "investissements";
      if (to === "projects") return "projetsCourtTerme";
      return to || "compteCourant";
    };
    const getPriorityRank = (entry = {}) => {
      const toKey = normalizeTransferAccountKey(entry?.to || "");
      const isTax = toKey === "tax";
      const isSecurity = toKey === "security";
      const isGrowth = isGrowthDestination(toKey);
      if (taxPriority === "critical" && isTax) return 5;
      if (isSecurity) return 10;
      if (toKey === "current") return 12;
      if (taxPriority === "high" && isTax) return 20;
      if (allocationOrder === "security_invest_tax") {
        if (isGrowth) return 30;
        if (isTax) return 40;
      } else {
        if (isTax) return 30;
        if (isGrowth) return 40;
      }
      if (toKey === "projects") return 50;
      return 60;
    };

    const queue = [];
    let queueIndex = 0;
    const pushQueue = (entry = {}) => {
      queue.push({
        ...entry,
        _queueIndex: queueIndex++,
        _rank: getPriorityRank(entry),
      });
    };

    const topUpFromSurplusRequested =
      String(taxMonthly?.onboardingChoice || "").toUpperCase() === "MIX"
        ? taxMonthly?.taxTopUpFromSurplus || 0
        : 0;
    if (taxesEnabled) {
      pushQueue({
        type: "tax",
        from: "current",
        to: "tax",
        amount: topUpFromSurplusRequested,
        reason: "Top-up exceptionnel impôts (réduit la pression des prochains mois)",
        taxType: "topup",
      });
      pushQueue({
        type: "tax",
        from: "current",
        to: "tax",
        amount: taxMonthly?.taxMonthlyActual || 0,
        reason: `Impôts (mensuel): objectif ${formatCurrency(
          Math.max(0, toNumber(taxMonthly?.taxMonthlyTarget || 0))
        )}, réalisé ${formatCurrency(Math.max(0, toNumber(taxMonthly?.taxMonthlyActual || 0)))}, manque ${formatCurrency(
          Math.max(0, toNumber(taxMonthly?.taxShortfallThisMonth || 0))
        )}`,
        taxType: "monthly",
      });
    }

    source.forEach((entry) => {
      const to = normalizeTransferAccountKey(entry?.to || "");
      if (to === "tax") return;
      const allocationKey = resolveAllocationKey(entry);
      pushQueue({
        type: "allocation",
        from: String(entry?.from || "").trim(),
        to: String(entry?.to || "").trim(),
        fromLabel: formatTransferAccountLabel(entry?.fromLabel || entry?.from),
        toLabel: formatTransferAccountLabel(entry?.toLabel || entry?.to),
        amount: Math.max(0, toNumber(entry?.amount || 0)),
        allocationKey,
      });
    });

    queue
      .sort((a, b) => {
        if (a._rank !== b._rank) return a._rank - b._rank;
        return a._queueIndex - b._queueIndex;
      })
      .forEach((entry) => {
        if (remainingSurplus < 1) return;
        const from = String(entry?.from || "").trim();
        const to = String(entry?.to || "").trim();
        const normalizedTo = normalizeTransferAccountKey(to);
        if (!from || !to || isFrozenTransfer(from, to)) return;
        if (entry.type === "tax" && !taxesEnabled) return;
        const requested = roundMoney(entry?.amount || 0);
        if (requested <= 0) return;
        let amount = Math.min(requested, remainingSurplus);
        if (normalizedTo === "current") {
          amount = Math.min(amount, remainingCurrentHeadroom);
        }
        if (isGrowthDestination(normalizedTo)) {
          amount = Math.min(amount, Math.max(0, remainingGrowthCap));
        }
        amount = capPillarAmount(to, amount);
        if (amount <= 0) return;
        const allocationKey =
          entry.type === "tax" ? "impots" : String(entry?.allocationKey || "").trim() || resolveAllocationKey(entry);
        transfers.push({
          from,
          to,
          fromLabel: formatTransferAccountLabel(entry?.fromLabel || from),
          toLabel: formatTransferAccountLabel(entry?.toLabel || to),
          amount,
          allocationKey,
          reason:
            amount < requested
              ? `${entry.reason || "Répartition du surplus du mois"} (ajusté au surplus disponible)`
              : entry.reason || "Répartition du surplus du mois",
          meta:
            entry.type === "tax"
              ? {
                  taxType: entry.taxType || "monthly",
                }
              : undefined,
        });
        addBreakdown(allocationKey, amount);
        remainingSurplus = Math.max(0, remainingSurplus - amount);
        if (normalizedTo === "current") {
          remainingCurrentHeadroom = Math.max(0, remainingCurrentHeadroom - amount);
        }
        if (isGrowthDestination(normalizedTo)) {
          remainingGrowthCap = Math.max(0, remainingGrowthCap - amount);
        }
        consumePillarAmount(to, amount);
      });

    if (remainingSurplus > 0 && remainingCurrentHeadroom > 0) {
      const keepOnCurrent = Math.min(remainingSurplus, remainingCurrentHeadroom);
      addBreakdown("compteCourant", keepOnCurrent);
      retainedOnCurrent += keepOnCurrent;
      remainingSurplus = Math.max(0, remainingSurplus - keepOnCurrent);
      remainingCurrentHeadroom = Math.max(0, remainingCurrentHeadroom - keepOnCurrent);
    }
    if (
      remainingSurplus >= 1 &&
      remainingGrowthCap > 0 &&
      !isFrozenTransfer("current", "investments")
    ) {
      const value = roundMoney(Math.min(remainingSurplus, remainingGrowthCap));
      transfers.push({
        from: "current",
        to: "investments",
        fromLabel: formatTransferAccountLabel("current"),
        toLabel: formatTransferAccountLabel("investments"),
        amount: value,
        allocationKey: "investissements",
        reason: "Ajustement SmartSave: surplus restant alloué en croissance",
      });
      addBreakdown("investissements", value);
      remainingSurplus = Math.max(0, remainingSurplus - value);
      remainingGrowthCap = Math.max(0, remainingGrowthCap - value);
    }
    if (remainingSurplus > 0) {
      if (!isFrozenTransfer("current", "security")) {
        const value = roundMoney(remainingSurplus);
        if (value > 0) {
          transfers.push({
            from: "current",
            to: "security",
            fromLabel: formatTransferAccountLabel("current"),
            toLabel: formatTransferAccountLabel("security"),
            amount: value,
            allocationKey: "securite",
            reason: "Ajustement SmartSave: reliquat vers sécurité",
          });
          addBreakdown("securite", value);
          remainingSurplus = Math.max(0, remainingSurplus - value);
        }
      }
      if (remainingSurplus > 0) {
        addBreakdown("compteCourant", remainingSurplus);
        retainedOnCurrent += remainingSurplus;
        remainingSurplus = 0;
      }
    }
    const totalTransfers = roundMoney(transfers.reduce((sum, item) => sum + toNumber(item.amount), 0));
    const totalAllocated = roundMoney(
      Object.values(breakdown).reduce((sum, amount) => sum + Math.max(0, toNumber(amount)), 0)
    );
    const effectiveEnvelope = Math.max(surplusEnvelope, totalAllocated);
    return {
      transfers,
      totalTransfers,
      totalAllocated,
      availableSurplus: effectiveEnvelope,
      retainedOnCurrent: Math.max(0, roundMoney(retainedOnCurrent)),
      breakdown,
    };
  };

  const renderSmartSave = (data, formData, activeUser, monthContext) => {
    if (!document.querySelector("[data-smartsave-main-cta]")) return;
    const store = getMonthlyStore();
    const context = monthContext || lastMonthlyContext || null;
    const monthId = context?.monthId || getMonthKey(new Date());
    const monthDate = parseMonthKey(monthId) || new Date();
    const monthLabel = new Intl.DateTimeFormat("fr-CH", {
      month: "long",
      year: "numeric",
    }).format(monthDate);

    const flow =
      store && typeof store.getFlowStateForMonth === "function"
        ? store.getFlowStateForMonth({
            userId: activeUser?.id,
            monthId,
            now: new Date(),
            monthlyPlan: context?.monthlyPlan || null,
          }) || { state: "NOUVEAU_MOIS" }
        : { state: "NOUVEAU_MOIS" };

    const titleNode = document.querySelector("[data-smartsave-title]");
    if (titleNode) titleNode.textContent = `Répartition – ${monthLabel}`;

    const blockingCard = document.querySelector("[data-smartsave-blocking]");
    const starCard = document.querySelector("[data-smartsave-star]");
    const setupCard = document.querySelector("[data-smartsave-setup-card]");
    const setupBody = document.querySelector("[data-smartsave-setup-body]");
    const setupStatusNode = document.querySelector("[data-smartsave-setup-status]");
    const setupTotalNode = document.querySelector("[data-smartsave-setup-total]");
    const setupChecklistNode = document.querySelector("[data-smartsave-setup-checklist]");
    const setupHintNode = document.querySelector("[data-smartsave-setup-profile-hint]");
    const setupToggleNode = document.querySelector("[data-smartsave-setup-toggle]");
    const setupApplyAllBtn = document.querySelector("[data-smartsave-setup-apply-all]");
    const transfersCard = document.querySelector("[data-smartsave-transfers-card]");
    const allocationLinesNode = document.querySelector("[data-smartsave-allocation-lines]");
    const transferTotalNode = document.querySelector("[data-smartsave-transfer-total]");
    const monthlyStatusNode = document.querySelector("[data-smartsave-monthly-status]");
    const mainCta = document.querySelector("[data-smartsave-main-cta]");
    const ctaWrap = document.querySelector(".smartsave-cta-wrap");
    const mainRoot = document.querySelector(".app-main");
    const projectionCard = document.querySelector("[data-smartsave-projection-card]");
    const projectionNoteNode = document.querySelector("[data-smartsave-projection-note]");
    const planStatusBadgeNode = document.querySelector("[data-smartsave-plan-status-badge]");
    const reviewBanner = document.querySelector("[data-smartsave-review-banner]");
    const statusBanner = document.querySelector("[data-smartsave-status-banner]");

    if (reviewBanner) reviewBanner.hidden = flow.state !== "FIN_MOIS_A_CLOTURER";
    if (statusBanner) statusBanner.hidden = true;

    if (flow.state === "NOUVEAU_MOIS") {
      if (blockingCard) blockingCard.hidden = false;
      if (starCard) starCard.hidden = true;
      if (setupCard) setupCard.hidden = true;
      if (transfersCard) transfersCard.hidden = true;
      if (projectionCard) projectionCard.hidden = true;
      if (mainCta) mainCta.hidden = true;
      return;
    }

    if (blockingCard) blockingCard.hidden = true;
    if (starCard) starCard.hidden = false;

    const budget = store?.getMonthlyBudgetForMonth
      ? store.getMonthlyBudgetForMonth({ userId: activeUser?.id, monthId, formData }) || {}
      : {};
    const totalIncome = Math.max(0, toNumber(budget.totalIncome));
    const totalExpenses =
      Math.max(0, toNumber(budget.fixedTotal)) +
      Math.max(0, toNumber(budget.mandatoryTotal)) +
      Math.max(0, toNumber(budget.variablePlanned));
    const remaining =
      budget.remaining != null ? toNumber(budget.remaining) : Math.max(0, totalIncome - totalExpenses);
    const surplus = Math.max(0, remaining);

    const surplusNode = document.querySelector("[data-smartsave-surplus-value]");
    if (surplusNode) {
      surplusNode.textContent = formatSignedCurrency(surplus);
      surplusNode.classList.remove("is-positive", "is-neutral", "is-negative");
      if (surplus > 0) surplusNode.classList.add("is-positive");
      else if (surplus < 0) surplusNode.classList.add("is-negative");
      else surplusNode.classList.add("is-neutral");
    }

    const heroEquationNode = document.querySelector("[data-smartsave-hero-equation]");
    if (heroEquationNode && totalIncome > 0) {
      const incomeNode = heroEquationNode.querySelector("[data-smartsave-income-value]");
      const expensesNode = heroEquationNode.querySelector("[data-smartsave-expenses-value]");
      if (incomeNode) incomeNode.textContent = formatCurrency(totalIncome);
      if (expensesNode) expensesNode.textContent = formatCurrency(totalExpenses);
      heroEquationNode.hidden = false;
    } else if (heroEquationNode) {
      heroEquationNode.hidden = true;
    }

    const monthStatus = String(context?.monthlyPlan?.flags?.monthStatus || "active");
    const monthlyFlags = context?.monthlyPlan?.flags || {};
    const isPlanReady = flow.state !== "NOUVEAU_MOIS";
    const isPlanApplied =
      Boolean(monthlyFlags.monthlyPlanIsApplied) ||
      Boolean(monthlyFlags.planAppliedAt) ||
      Boolean(monthlyFlags.monthlyPlanApplied) ||
      monthStatus === "closed";

    const setupUi = ensureSmartSaveMonthUi();
    const taxModal = setupUi?.taxModal || null;
    const rebalanceDetailModal = setupUi?.rebalanceDetailModal || null;
    let openRebalanceDetailModal = null;
    if (rebalanceDetailModal) {
      const detailTitleNode = rebalanceDetailModal.querySelector("[data-smartsave-rebalance-modal-title]");
      const detailRouteNode = rebalanceDetailModal.querySelector("[data-smartsave-rebalance-modal-route]");
      const detailAmountNode = rebalanceDetailModal.querySelector("[data-smartsave-rebalance-modal-amount]");
      const detailFromNode = rebalanceDetailModal.querySelector("[data-smartsave-rebalance-modal-from]");
      const detailToNode = rebalanceDetailModal.querySelector("[data-smartsave-rebalance-modal-to]");
      const detailWhyNode = rebalanceDetailModal.querySelector("[data-smartsave-rebalance-modal-why]");
      const closeRebalanceDetailModal = () => {
        const fallbackFocus =
          rebalanceDetailModal.__lastTrigger && document.contains(rebalanceDetailModal.__lastTrigger)
            ? rebalanceDetailModal.__lastTrigger
            : null;
        rebalanceDetailModal.classList.remove("is-open");
        rebalanceDetailModal.setAttribute("aria-hidden", "true");
        rebalanceDetailModal.setAttribute("inert", "");
        document.body.classList.remove("allocation-details-open");
        window.setTimeout(() => {
          if (!rebalanceDetailModal.classList.contains("is-open")) rebalanceDetailModal.hidden = true;
        }, 120);
        if (fallbackFocus && typeof fallbackFocus.focus === "function") {
          try {
            fallbackFocus.focus({ preventScroll: true });
          } catch (_error) {
            fallbackFocus.focus();
          }
        }
      };
      openRebalanceDetailModal = (detail, triggerEl) => {
        if (!detail) return;
        if (detailTitleNode) detailTitleNode.textContent = detail.title || "Détail du transfert";
        if (detailRouteNode) detailRouteNode.textContent = detail.route || "";
        if (detailAmountNode) detailAmountNode.textContent = detail.amountLabel || formatCurrency(0);
        if (detailFromNode) detailFromNode.textContent = detail.fromLabel || "";
        if (detailToNode) detailToNode.textContent = detail.toLabel || "";
        if (detailWhyNode) detailWhyNode.textContent = detail.whyText || "";
        rebalanceDetailModal.__lastTrigger = triggerEl || null;
        rebalanceDetailModal.hidden = false;
        rebalanceDetailModal.removeAttribute("inert");
        rebalanceDetailModal.setAttribute("aria-hidden", "false");
        rebalanceDetailModal.classList.add("is-open");
        document.body.classList.add("allocation-details-open");
      };
      if (!rebalanceDetailModal.dataset.bound) {
        rebalanceDetailModal.addEventListener("click", (event) => {
          if (!event.target.closest("[data-smartsave-rebalance-close]")) return;
          closeRebalanceDetailModal();
        });
        rebalanceDetailModal.dataset.bound = "true";
      }
    }
    const planSnapshot = context?.monthlyPlan?.allocationResultSnapshot || null;
    const allocationsRaw = planSnapshot?.allocations || data?.allocation?.allocations || {};
    const taxFunding = planSnapshot?.debug?.taxFunding || data?.allocation?.debug?.taxFunding || {};
    const monthInputs = context?.monthlyPlan?.inputsSnapshot || {};
    const settingsContext = resolveEffectiveMonthSettings(context || {});
    const userSettings = settingsContext.userSettings || {};
    const smartSaveSettings = settingsContext.smartSaveSettings;
    const advancedSettings = settingsContext.advancedSettings;
    const liveBalances = getLiveAccountBalances(activeUser, formData);
    const forcedPayLaterBySettings =
      !smartSaveSettings.taxes.enabled ||
      String(smartSaveSettings.taxes.provisionMode || "").toLowerCase() === "recommendations";
    const taxPriority = resolveTaxPriority({ smartSaveSettings, advancedSettings });
    const defaultTaxChoice = mapTaxPriorityToChoice(taxPriority);
    const taxMode = String(
      forcedPayLaterBySettings ? "PAY_LATER" : userSettings?.taxMode || "AUTO_PROVISION"
    ).toUpperCase();
    const rawTaxOnboardingChoice = String(userSettings?.taxOnboardingChoice || "").toUpperCase();
    let taxOnboardingChoice = taxMode === "PAY_LATER"
      ? "PAY_LATER"
      : rawTaxOnboardingChoice || defaultTaxChoice || null;
    if (taxOnboardingChoice === "PAY_LATER" && taxMode !== "PAY_LATER") {
      taxOnboardingChoice = defaultTaxChoice || "SPREAD";
    }
    if (taxPriority === "critical" && taxMode !== "PAY_LATER") {
      taxOnboardingChoice = "USE_SAVINGS";
    }
    const taxDueDate = userSettings?.taxDueDate || defaultTaxDueDate(new Date());
    const taxCapPct = resolveTaxCapPct({ smartSaveSettings, advancedSettings });
    const annualTaxEstimate = Math.max(0, toNumber(taxFunding.totalEstimate || data?.taxProvision?.totalTax || 0));

    const taxOnboarding = computeTaxOnboardingTrigger({
      annualTaxEstimate,
      taxReserveBalance: liveBalances.tax,
      taxDueDate,
      surplus,
      capPct: taxCapPct,
      now: new Date(),
    });

    const mandatoryMonthlyNeed = Math.max(
      0,
      toNumber(monthInputs.mandatoryTotal)
    );
    const fixedMandatoryMonthlyNeed = Math.max(
      0,
      toNumber(monthInputs.fixedTotal) + toNumber(monthInputs.mandatoryTotal)
    );
    const debugCurrentLimit = Math.max(
      0,
      toNumber(data?.allocation?.debug?.currentTarget || 0)
    );
    const settingsCurrentLimit = Math.max(
      0,
      roundMoney(mandatoryMonthlyNeed * Math.max(1, toNumber(smartSaveSettings?.limits?.minCurrentMonths || 1)))
    );
    const currentLimit = Math.max(0, roundMoney(debugCurrentLimit > 0 ? debugCurrentLimit : settingsCurrentLimit));
    const debugSecurityLimit = Math.max(
      0,
      toNumber(data?.allocation?.debug?.savingsTargets?.targetAmount || 0)
    );
    const settingsSecurityLimit = Math.max(
      0,
      roundMoney(
        fixedMandatoryMonthlyNeed *
          Math.max(0, toNumber(smartSaveSettings?.limits?.precautionIncomeMonths || 0))
      )
    );
    const advancedSavingsFloor = Math.max(0, toNumber(advancedSettings?.savingsUsage?.savingsFloor || 0));
    const securityLimit = Math.max(
      0,
      roundMoney(
        debugSecurityLimit > 0 ? debugSecurityLimit : Math.max(settingsSecurityLimit, advancedSavingsFloor)
      )
    );

    const rebalance = computeRebalanceTransfers({
      balances: liveBalances,
      limits: {
        current: currentLimit,
        savings: securityLimit,
      },
      taxFunding,
      taxPriorityNeed: taxOnboardingChoice === "USE_SAVINGS" ? taxOnboarding.remainingNeed : 0,
      formData,
      monthInputs,
      monthId,
      smartSaveSettings,
      advancedSettings,
      monthlySurplus: surplus,
    });

    const rebalanceTaxTopup = roundMoney(
      ensureArray(rebalance.transfers)
        .filter((entry) => String(entry?.to || "").trim().toLowerCase() === "tax")
        .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount || 0)), 0)
    );
    const effectiveTaxOnboarding =
      taxOnboardingChoice === "USE_SAVINGS" && rebalanceTaxTopup > 0
        ? computeTaxOnboardingTrigger({
            annualTaxEstimate,
            taxReserveBalance: liveBalances.tax + rebalanceTaxTopup,
            taxDueDate,
            surplus,
            capPct: taxCapPct,
            now: new Date(),
          })
        : taxOnboarding;
    const taxMonthly = computeMonthlyTaxContributionFromSurplus({
      taxMetrics: effectiveTaxOnboarding,
      userSettings,
      smartSaveSettings,
      advancedSettings,
      surplus,
      now: new Date(),
    });
    const taxChoiceEffective = String(taxMonthly.onboardingChoice || taxOnboardingChoice || "").toUpperCase();
    const taxTopUpFromSurplusEffective =
      taxChoiceEffective === "MIX" ? Math.max(0, toNumber(taxMonthly.taxTopUpFromSurplus || 0)) : 0;

    setText("[data-smartsave-tax-estimate]", formatCurrency(annualTaxEstimate));
    const dueDateLabel = new Intl.DateTimeFormat("fr-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(effectiveTaxOnboarding.dueDate || taxDueDate));
    setText("[data-smartsave-tax-deadline]", dueDateLabel);

    const shouldOpenTaxOnboardingModal = Boolean(
      effectiveTaxOnboarding.shouldTrigger &&
        !rawTaxOnboardingChoice &&
        taxMode !== "PAY_LATER" &&
        smartSaveSettings.taxes.enabled
    );

    if (taxModal && shouldOpenTaxOnboardingModal) {
      const closeTaxModal = () => {
        taxModal.hidden = true;
        taxModal.setAttribute("aria-hidden", "true");
        taxModal.classList.remove("is-open");
      };
      const taxSummaryNeed = taxModal.querySelector("[data-smartsave-tax-summary-need]");
      const taxSummaryDue = taxModal.querySelector("[data-smartsave-tax-summary-due]");
      const taxSummaryReco = taxModal.querySelector("[data-smartsave-tax-summary-reco]");
      const taxOptionSpread = taxModal.querySelector('[data-smartsave-tax-impact="SPREAD"]');
      const taxOptionMix = taxModal.querySelector('[data-smartsave-tax-impact="MIX"]');
      const taxOptionUseSavings = taxModal.querySelector('[data-smartsave-tax-impact="USE_SAVINGS"]');
      const taxOptionPayLater = taxModal.querySelector('[data-smartsave-tax-impact="PAY_LATER"]');
      const modalSpread = computeMonthlyTaxContributionFromSurplus({
        taxMetrics: effectiveTaxOnboarding,
        userSettings: { ...userSettings, taxMode: "AUTO_PROVISION", taxOnboardingChoice: "SPREAD" },
        smartSaveSettings,
        advancedSettings,
        surplus,
        now: new Date(),
      });
      const modalMix = computeMonthlyTaxContributionFromSurplus({
        taxMetrics: effectiveTaxOnboarding,
        userSettings: { ...userSettings, taxMode: "AUTO_PROVISION", taxOnboardingChoice: "MIX" },
        smartSaveSettings,
        advancedSettings,
        surplus,
        now: new Date(),
      });
      const modalUseSavings = computeMonthlyTaxContributionFromSurplus({
        taxMetrics: effectiveTaxOnboarding,
        userSettings: { ...userSettings, taxMode: "AUTO_PROVISION", taxOnboardingChoice: "USE_SAVINGS" },
        smartSaveSettings,
        advancedSettings,
        surplus,
        now: new Date(),
      });
      if (taxSummaryNeed) taxSummaryNeed.textContent = formatCurrency(effectiveTaxOnboarding.remainingNeed || 0);
      if (taxSummaryDue) taxSummaryDue.textContent = `${effectiveTaxOnboarding.monthsRemaining || 0} mois (${dueDateLabel})`;
      if (taxSummaryReco) taxSummaryReco.textContent = `${formatCurrency(effectiveTaxOnboarding.theoreticalNeed || 0)} / mois`;
      if (taxOptionSpread) taxOptionSpread.textContent = `Ce mois: ${formatCurrency(modalSpread.taxMonthlyActual || 0)}.`;
      if (taxOptionMix) {
        taxOptionMix.textContent = `Ce mois: ${formatCurrency(modalMix.taxTopUpFromSurplus || 0)} + ${formatCurrency(
          modalMix.taxMonthlyActual || 0
        )}.`;
      }
      if (taxOptionUseSavings) {
        taxOptionUseSavings.textContent = `Ajustements: ${formatCurrency(rebalanceTaxTopup)} + ${formatCurrency(
          modalUseSavings.taxMonthlyActual || 0
        )}.`;
      }
      if (taxOptionPayLater) taxOptionPayLater.textContent = "Ce mois: CHF 0.";

      taxModal.hidden = false;
      taxModal.setAttribute("aria-hidden", "false");
      taxModal.classList.add("is-open");
      if (!taxModal.dataset.bound) {
        taxModal.addEventListener("click", (event) => {
          if (event.target.closest("[data-smartsave-tax-close]")) return closeTaxModal();
          const optionCard = event.target.closest("[data-smartsave-tax-option]");
          if (optionCard) {
            const choice = String(optionCard.dataset.smartsaveTaxOption || "").toUpperCase();
            const input = taxModal.querySelector(`input[name="smartsave-tax-choice"][value="${choice}"]`);
            if (input) input.checked = true;
          }
          if (!event.target.closest("[data-smartsave-tax-continue]")) return;
          const selected = taxModal.querySelector('input[name="smartsave-tax-choice"]:checked');
          const choice = String(selected?.value || "").toUpperCase();
          if (!choice || !activeUser?.id || typeof store?.updateUserSettingsForUser !== "function") return;
          store.updateUserSettingsForUser({
            userId: activeUser.id,
            patch: {
              taxOnboardingChoice: choice,
              taxMode: choice === "PAY_LATER" ? "PAY_LATER" : "AUTO_PROVISION",
            },
          });
          closeTaxModal();
          renderAll();
        });
        taxModal.dataset.bound = "true";
      }
    } else if (taxModal) {
      taxModal.hidden = true;
      taxModal.setAttribute("aria-hidden", "true");
      taxModal.classList.remove("is-open");
    }

    if (typeof store?.saveMonthlyPlanTaxForMonth === "function" && activeUser?.id && monthId) {
      store.saveMonthlyPlanTaxForMonth({
        userId: activeUser.id,
        monthId,
        now: new Date(),
        tax: {
          taxMode: taxMonthly.mode || taxMode,
          taxOnboardingChoice: taxMonthly.onboardingChoice || taxOnboardingChoice,
          taxMonthlyTarget: taxMonthly.taxMonthlyTarget,
          taxMonthlyActual: taxMonthly.taxMonthlyActual,
          taxTopUpFromSurplus: taxTopUpFromSurplusEffective,
          taxShortfallThisMonth: taxMonthly.taxShortfallThisMonth,
          taxNotProvisionedAmount: taxMonthly.taxNotProvisionedAmount,
        },
      });
    }

    const counters = getCompletedSetupTransferKeys(activeUser, monthId);
    const isRebalanceLockedForMonth = Boolean(monthlyFlags.accountsBalanced);
    const rebalanceRows = ensureArray(rebalance.transfers).map((row, index) => {
      const matchKey = getTransferMatchKey(row.from, row.to, row.amount);
      const done = isRebalanceLockedForMonth || (counters[matchKey] || 0) > 0;
      if (!isRebalanceLockedForMonth && done) counters[matchKey] -= 1;
      return {
        ...row,
        amount: Math.max(0, toNumber(row.amount)),
        matchKey,
        actionId: `row-${index + 1}-${normalizeEntryIdPart(row.from)}-${normalizeEntryIdPart(row.to)}-${Math.round(
          Math.max(0, toNumber(row.amount))
        )}`,
        done,
      };
    });
    const hasRebalance = rebalanceRows.length > 0;
    const allRebalanceDone = hasRebalance && rebalanceRows.every((row) => row.done);
    const pendingRebalanceRows = rebalanceRows.filter((row) => !row.done);

    if (
      allRebalanceDone &&
      !monthlyFlags.accountsBalanced &&
      activeUser?.id &&
      typeof store?.markAccountsBalancedForMonth === "function"
    ) {
      store.markAccountsBalancedForMonth({
        userId: activeUser.id,
        monthId,
        now: new Date(),
        details: {
          currentLimit,
          securityLimit,
          totals: rebalance.totals,
        },
      });
    }

    const showSetupSection = hasRebalance;
    if (setupCard) setupCard.hidden = !showSetupSection;

    if (setupCard) {
      setupCard.classList.toggle("is-readonly", hasRebalance && allRebalanceDone);
      setupCard.classList.toggle("is-collapsed", hasRebalance && allRebalanceDone);
    }
    if (setupStatusNode) {
      setupStatusNode.textContent = "";
    }
    if (setupTotalNode) {
      setupTotalNode.textContent = "";
    }
    if (setupHintNode) {
      setupHintNode.textContent = "";
    }
    if (setupChecklistNode) {
      setupChecklistNode.__rebalanceRows = rebalanceRows;
      const escapeForHtml = (value) =>
        String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const taxNeedForDetails = Math.max(
        0,
        toNumber(effectiveTaxOnboarding?.remainingNeed || annualTaxEstimate || 0)
      );
      const securityTargetForDetails = Math.max(
        0,
        toNumber(rebalance?.totals?.savingsFloor || securityLimit || 0)
      );
      const pillarRoomForDetails = Math.max(
        0,
        toNumber(computeThirdPillarRoomForRebalance(formData, monthInputs, liveBalances, monthId))
      );
      const growthCapForDetails = Math.max(
        0,
        toNumber(
          resolveGrowthCapFromSettings({
            availableSurplus: surplus,
            smartSaveSettings,
            advancedSettings,
          })
        )
      );
      const destinationObjectiveByKey = {
        current: "garder du cash disponible pour les dépenses et les charges à venir",
        security: "renforcer ton épargne de sécurité",
        tax: "anticiper les futurs impôts à payer",
        pillar3a: "faire travailler ton argent pour ta retraite",
        investments: "faire travailler ton argent et créer un patrimoine futur",
        projects: "financer tes objectifs court terme",
      };
      const buildRebalanceDetail = (row) => {
        const toKey = normalizeTransferAccountKey(row?.to || "");
        const fromKey = normalizeTransferAccountKey(row?.from || "");
        const objectiveText =
          destinationObjectiveByKey[toKey] ||
          "réaligner ce compte avec la stratégie SmartSave du mois";
        const sourceLimitText =
          fromKey === "current" && currentLimit > 0.5
            ? `Le compte courant est limité à ${formatCurrency(currentLimit)}.`
            : fromKey === "security" && securityTargetForDetails > 0.5
            ? `Le compte épargne garde une base de ${formatCurrency(securityTargetForDetails)}.`
            : "";
        let destinationTargetText = "";
        if (toKey === "tax" && taxNeedForDetails > 0.5) {
          destinationTargetText = `Besoin impôts estimé: ${formatCurrency(taxNeedForDetails)}.`;
        } else if (toKey === "security" && securityTargetForDetails > 0.5) {
          destinationTargetText = `Objectif épargne de sécurité: ${formatCurrency(securityTargetForDetails)}.`;
        } else if (toKey === "pillar3a" && pillarRoomForDetails > 0.5) {
          destinationTargetText = `Plafond 3e pilier restant: ${formatCurrency(pillarRoomForDetails)}.`;
        } else if (toKey === "investments" && growthCapForDetails > 0.5) {
          destinationTargetText = `Cap d'investissement du mois: ${formatCurrency(growthCapForDetails)}.`;
        }
        const whyText = [sourceLimitText, `Ce transfert sert à ${objectiveText}.`, destinationTargetText]
          .filter(Boolean)
          .join(" ");
        return {
          title: "Détail du transfert",
          route: `${row.fromLabel} → ${row.toLabel}`,
          amountLabel: formatCurrency(row.amount),
          fromLabel: row.fromLabel,
          toLabel: row.toLabel,
          whyText: whyText || "Ce transfert garde tes comptes alignés avec ton plan du mois.",
        };
      };
      const detailsByActionId = {};
      rebalanceRows.forEach((row) => {
        detailsByActionId[String(row.actionId)] = buildRebalanceDetail(row);
      });
      setupChecklistNode.__rebalanceDetailByActionId = detailsByActionId;
      setupChecklistNode.innerHTML = hasRebalance
        ? `
            ${
              allRebalanceDone
                ? `<p class="smartsave-rebalance-intro smartsave-rebalance-intro--done">Virements effectués. Tu peux ouvrir une carte pour revoir le détail.</p>`
                : `<p class="smartsave-rebalance-intro">Fais ces virements dans ta banque. Clique sur une carte pour voir le détail.</p>`
            }
            <ol class="smartsave-rebalance-steps">
              ${rebalanceRows
                .map((row, i) => {
                  return `
                  <li class="smartsave-rebalance-step ${row.done ? "is-done" : ""}">
                    <button
                      class="smartsave-rebalance-step__card"
                      type="button"
                      data-smartsave-rebalance-open="${escapeForHtml(row.actionId)}"
                    >
                      <span class="smartsave-rebalance-step__num" aria-hidden="true">${row.done ? "✓" : i + 1}</span>
                      <div class="smartsave-rebalance-step__body">
                        <p class="smartsave-rebalance-step__route">
                          <span class="smartsave-rebalance-step__from">${escapeForHtml(row.fromLabel)}</span>
                          <span class="smartsave-rebalance-step__arrow" aria-hidden="true">→</span>
                          <span class="smartsave-rebalance-step__to">${escapeForHtml(row.toLabel)}</span>
                        </p>
                        <p class="smartsave-rebalance-step__amount">${formatCurrency(row.amount)}</p>
                      </div>
                      <span class="smartsave-rebalance-step__badge">${row.done ? "Fait" : "Voir"}</span>
                    </button>
                  </li>
                `;
                })
                .join("")}
            </ol>
          `
        : "";
      if (!setupChecklistNode.dataset.rebalanceDetailBound) {
        setupChecklistNode.addEventListener("click", (event) => {
          const cardBtn = event.target.closest("[data-smartsave-rebalance-open]");
          if (!cardBtn || !setupChecklistNode.contains(cardBtn)) return;
          if (typeof openRebalanceDetailModal !== "function") return;
          const actionId = String(cardBtn.dataset.smartsaveRebalanceOpen || "").trim();
          if (!actionId) return;
          const detailById =
            setupChecklistNode.__rebalanceDetailByActionId &&
            typeof setupChecklistNode.__rebalanceDetailByActionId === "object"
              ? setupChecklistNode.__rebalanceDetailByActionId
              : {};
          const detail = detailById[actionId] || null;
          if (!detail) return;
          openRebalanceDetailModal(detail, cardBtn);
        });
        setupChecklistNode.dataset.rebalanceDetailBound = "true";
      }
    }
    if (setupToggleNode) {
      setupToggleNode.hidden = !(hasRebalance && allRebalanceDone);
      if (hasRebalance && allRebalanceDone) {
        const isOpen = setupToggleNode.dataset.open === "true";
        setupToggleNode.setAttribute("aria-expanded", isOpen ? "true" : "false");
        setupToggleNode.textContent = isOpen ? "⌃" : "⌄";
        if (setupBody) setupBody.hidden = !isOpen;
      } else {
        setupToggleNode.dataset.open = "false";
        setupToggleNode.setAttribute("aria-expanded", "false");
        setupToggleNode.textContent = "⌄";
        if (setupBody) setupBody.hidden = false;
      }
      if (!setupToggleNode.dataset.bound) {
        setupToggleNode.addEventListener("click", () => {
          const nowOpen = setupToggleNode.dataset.open === "true";
          setupToggleNode.dataset.open = nowOpen ? "false" : "true";
          setupToggleNode.setAttribute("aria-expanded", nowOpen ? "false" : "true");
          setupToggleNode.textContent = nowOpen ? "⌄" : "⌃";
          if (setupBody) setupBody.hidden = nowOpen;
        });
        setupToggleNode.dataset.bound = "true";
      }
    }
    if (setupApplyAllBtn) {
      setupApplyAllBtn.hidden = allRebalanceDone || !hasRebalance;
      setupApplyAllBtn.disabled = pendingRebalanceRows.length === 0;
      setupApplyAllBtn.__rebalanceRows = pendingRebalanceRows;
      setupApplyAllBtn.onclick = () => {
        if (setupApplyAllBtn.dataset.processing === "true") return;
        if (!activeUser?.id || !pendingRebalanceRows.length) return;
        setupApplyAllBtn.dataset.processing = "true";
        setupApplyAllBtn.disabled = true;
        appendTransferTransactions({
          activeUser,
          monthId,
          transfers: pendingRebalanceRows.map((row, index) => ({
            ...row,
            id: `smartsave-rebalance-${activeUser.id}-${monthId}-${index + 1}-${row.actionId}`,
          })),
          idPrefix: "smartsave-rebalance",
          noteFallback: "Ajustement SmartSave",
          autoApplyKind: "account-balance-adjustment",
        });
        if (typeof store?.saveRebalanceExecutionForMonth === "function") {
          store.saveRebalanceExecutionForMonth({
            userId: activeUser.id,
            monthId,
            now: new Date(),
            transfers: rebalanceRows,
          });
        }
        if (typeof store?.markAccountsBalancedForMonth === "function") {
          store.markAccountsBalancedForMonth({
            userId: activeUser.id,
            monthId,
            now: new Date(),
            details: {
              currentLimit,
              securityLimit,
              totals: rebalance.totals,
            },
          });
        }
        if (typeof store?.regeneratePlanForMonth === "function" && typeof window.buildMvpData === "function") {
          const latestFormData = typeof window.loadUserForm === "function" ? window.loadUserForm(activeUser.id) : null;
          if (latestFormData) {
            const latestMvpData = window.buildMvpData(latestFormData);
            store.regeneratePlanForMonth({
              userId: activeUser.id,
              monthId,
              formData: latestFormData,
              mvpData: latestMvpData,
            });
          }
        }
        renderAll();
      };
      setupApplyAllBtn.dataset.processing = "false";
    }

    let planBadgeLabel = "Plan prêt";
    let planBadgeClass = "is-ready";
    if (isPlanApplied) {
      planBadgeLabel = "Plan appliqué";
      planBadgeClass = "is-applied";
    } else if (hasRebalance && !allRebalanceDone) {
      planBadgeLabel = "Ajustement requis";
      planBadgeClass = "is-adjustment";
    }
    if (planStatusBadgeNode) {
      planStatusBadgeNode.textContent = planBadgeLabel;
      planStatusBadgeNode.classList.remove("is-ready", "is-applied", "is-adjustment");
      planStatusBadgeNode.classList.add(planBadgeClass);
    }

    const lockPlanByRebalance = hasRebalance && !allRebalanceDone;
    if (mainRoot && setupCard && transfersCard) {
      if (hasRebalance && allRebalanceDone) {
        const target = ctaWrap && ctaWrap.parentElement === mainRoot ? ctaWrap : null;
        if (target && setupCard.nextElementSibling !== target) {
          mainRoot.insertBefore(setupCard, target);
        }
      } else if (setupCard.nextElementSibling !== transfersCard) {
        mainRoot.insertBefore(setupCard, transfersCard);
      }
    }
    if (transfersCard) transfersCard.hidden = lockPlanByRebalance;
    if (projectionCard) projectionCard.hidden = false;

    const monthlyTransferEntries = buildMonthlyApplyEntries({
      activeUser,
      monthId,
      monthContext: context,
      mvpData: data,
    });
    const allocationEnvelope = Math.max(
      0,
      roundMoney(
        toNumber(
          data?.allocation?.disponibleInitial != null
            ? data.allocation.disponibleInitial
            : surplus
        )
      )
    );
    const pillarAnnualRoom = computeThirdPillarRoomForRebalance(formData, monthInputs, liveBalances, monthId);
    const monthlyPlan = computeMonthlyAllocationTransfers({
      entries: monthlyTransferEntries,
      taxMonthly,
      availableSurplus: allocationEnvelope,
      currentLimit,
      currentBalance: liveBalances.current,
      pillarAnnualRoom,
      smartSaveSettings,
      advancedSettings,
      allocationSnapshot: data?.allocation || planSnapshot || null,
    });

    const fallbackAllocationSource = {
      ...allocationsRaw,
      impots:
        taxMode === "PAY_LATER"
          ? 0
          : roundMoney(Math.max(0, toNumber(taxMonthly.taxMonthlyActual || 0)) + taxTopUpFromSurplusEffective),
    };
    const hasPlanBreakdown =
      monthlyPlan && monthlyPlan.breakdown && typeof monthlyPlan.breakdown === "object";
    const allocationSource = hasPlanBreakdown ? monthlyPlan.breakdown : fallbackAllocationSource;
    const shortTermAccount =
      planSnapshot?.shortTermAccount ||
      data?.allocation?.shortTermAccount ||
      data?.allocation?.debug?.shortTermAccount ||
      {};
    const shortTermKey = String(shortTermAccount?.key || "projetsCourtTerme").trim() || "projetsCourtTerme";
    const shortTermKeyLower = shortTermKey.toLowerCase();
    const shortTermLabel =
      String(shortTermAccount?.label || shortTermAccount?.name || "Projets court terme").trim() ||
      "Projets court terme";
    const readAllocationAmount = (source, key) => {
      if (!source || typeof source !== "object") return 0;
      const direct = toNumber(source[key]);
      if (direct > 0) return direct;
      const needle = String(key || "").trim().toLowerCase();
      if (!needle) return 0;
      const match = Object.entries(source).find(
        ([entryKey]) => String(entryKey || "").trim().toLowerCase() === needle
      );
      return match ? toNumber(match[1]) : 0;
    };
    const shortTermAmountFromPlan = Math.max(
      0,
      toNumber(
        readAllocationAmount(allocationSource, shortTermKey) ||
          readAllocationAmount(allocationSource, "projetsCourtTerme") ||
          planSnapshot?.shortTermDeduction ||
          data?.allocation?.shortTermDeduction ||
          shortTermAccount?.amount ||
          0
      )
    );

    const allocationPriority = [
      "impots",
      "compteCourant",
      "securite",
      shortTermKey,
      "pilier3a",
      "investissements",
    ].filter((key, index, all) => all.indexOf(key) === index);
    const allocationLabels = {
      impots: "Impôts",
      compteCourant: "Compte courant",
      securite: "Épargne",
      [shortTermKey]: shortTermLabel,
      pilier3a: "3e pilier",
      investissements: "Investissements",
    };
    const allocationWhy = {
      impots: "Anticipe ta facture fiscale pour éviter un choc.",
      compteCourant: "Sécurise ton compte courant pour couvrir tes dépenses essentielles.",
      securite: "Renforce ton matelas de sécurité pour les imprévus.",
      [shortTermKey]: "Tu finances ton objectif court terme défini dans ton plan.",
      pilier3a: "Optimise ta fiscalité tant que le plafond annuel n’est pas atteint.",
      investissements: "Tes bases sont assez solides : SmartSave fait travailler ton argent.",
    };
    const toDetailKey = {
      impots: "impots",
      compteCourant: "compteCourant",
      securite: "securite",
      [shortTermKeyLower]: "projetsCourtTerme",
      pilier3a: "pilier3a",
      investissements: "investissements",
    };
    const iconSvg = {
      tax: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M10 12h5M10 16h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      current:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h17v10h-17z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M17 12.5h3.5M3.5 8.5l2-3h13l2 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      security:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.2-2.8 8-7 10-4.2-2-7-5.8-7-10V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 12.2l1.9 1.9 3.4-3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      pillar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14c0-4.3 3.3-7.5 8.7-8-0.6 5.4-3.8 8.6-8.7 8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 14v6M9 20h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      project:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
      invest:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 15l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 8h2v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      default:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    };
    const iconMeta = {
      impots: { style: "tax", icon: "tax" },
      compteCourant: { style: "current", icon: "current" },
      securite: { style: "security", icon: "security" },
      [shortTermKey]: { style: "project", icon: "project" },
      pilier3a: { style: "pillar", icon: "pillar" },
      investissements: { style: "invest", icon: "invest" },
    };
    const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(toNumber(value))));
    const getProgressPercent = (current, target) => {
      const safeTarget = Math.max(0, toNumber(target));
      if (safeTarget <= 0) return 0;
      return clampPercent((Math.max(0, toNumber(current)) / safeTarget) * 100);
    };

    const currentBefore = Math.max(0, toNumber(liveBalances.current || 0));
    const securityBefore = Math.max(0, toNumber(liveBalances.security || 0));
    const taxBefore = Math.max(0, toNumber(liveBalances.tax || 0));
    const pillarBefore = Math.max(0, toNumber(liveBalances.pillar3a || 0));
    const investBefore = Math.max(0, toNumber(liveBalances.investments || 0));
    const currentTargetReached = currentBefore >= Math.max(0, toNumber(currentLimit)) - 0.5;
    const pillarCapReached = Math.max(0, toNumber(pillarAnnualRoom || 0)) <= 0.5;
    const pillarAnnualCap = Math.max(0, roundMoney(pillarBefore + Math.max(0, toNumber(pillarAnnualRoom || 0))));

    const allocationActionVerbs = {
      securite: "Virer sur",
      impots: "Virer sur",
      [shortTermKey]: "Virer sur",
      pilier3a: "Verser sur",
      investissements: "Virer sur",
      compteCourant: "Conserver dans",
    };
    const allocationDistColors = {
      securite: "#10b981",
      impots: "#f472b6",
      [shortTermKey]: "#0ea5e9",
      investissements: "#f59e0b",
      pilier3a: "#6366f1",
      compteCourant: "#0ea5e9",
    };

    const rows = allocationPriority.map((key) => {
      let baseAmount = Math.max(0, toNumber(allocationSource[key] || 0));
      const keyLower = String(key || "").trim().toLowerCase();
      if (keyLower === shortTermKeyLower || keyLower === "projetscourtterme") {
        if (baseAmount <= 0.5) {
          baseAmount = shortTermAmountFromPlan;
        }
      }
      const icon = iconMeta[key] || { style: "other", icon: "default" };
      const label = allocationLabels[key] || formatTransferAccountLabel(key);
      const hasAlloc = baseAmount > 0.5;
      const row = {
        key,
        label,
        amount: baseAmount,
        why: allocationWhy[key] || "Répartition SmartSave automatique.",
        action: hasAlloc
          ? `${allocationActionVerbs[key] || "Virer sur"} ${label}`
          : null,
        distColor: allocationDistColors[key] || "#94a3b8",
        stateKind: "text",
        stateText: "",
        stateLabel: "",
        statePercent: 0,
        stateValue: "",
        detailGoal: "",
        isMuted: false,
        hasAllocation: hasAlloc,
        iconStyle: icon.style,
        iconSvg: iconSvg[icon.icon] || iconSvg.default,
      };

      if (key === "impots") {
        const afterTax = roundMoney(taxBefore + baseAmount);
        if (String(taxMode || "").toUpperCase() === "PAY_LATER") {
          row.isMuted = true;
          row.why = "Paiement des impôts reporté";
          row.stateText = "Aucune provision ce mois-ci";
        } else if (baseAmount <= 0.5) {
          row.isMuted = true;
          row.stateText = "Aucune provision ce mois-ci";
        } else if (annualTaxEstimate > afterTax + 0.5) {
          row.stateText = "Provision en cours pour l’échéance fiscale";
        } else {
          row.stateText = `Après ce mois-ci : ${formatCurrency(afterTax)}`;
        }
        row.detailGoal = row.stateText;
        return row;
      }

      if (key === "compteCourant") {
        const afterCurrent = roundMoney(currentBefore + baseAmount);
        const securedAfter = afterCurrent >= Math.max(0, toNumber(currentLimit)) - 0.5;
        if (baseAmount <= 0.5 && currentTargetReached) {
          row.why = "Compte courant déjà sécurisé";
          row.stateText = "Compte courant sécurisé";
        } else if (baseAmount <= 0.5) {
          row.isMuted = true;
          row.stateText = "Aucun versement ce mois-ci";
        } else if (securedAfter) {
          row.stateText = "Compte courant sécurisé";
        } else {
          row.stateText = `Après ce mois-ci : ${formatCurrency(afterCurrent)}`;
        }
        row.detailGoal = row.stateText;
        return row;
      }

      if (key === "securite") {
        const afterSecurity = roundMoney(securityBefore + baseAmount);
        if (baseAmount <= 0.5) {
          row.isMuted = true;
          row.stateText = "Aucun versement ce mois-ci";
          row.detailGoal = row.stateText;
          return row;
        }
        if (Math.max(0, toNumber(securityLimit)) > 0.5) {
          const pct = getProgressPercent(afterSecurity, securityLimit);
          row.stateKind = "progress";
          row.stateLabel = "Progression";
          row.statePercent = pct;
          row.stateValue = `${pct} %`;
          row.detailGoal = `Progression : ${pct} %`;
        } else {
          row.stateText = `Après ce mois-ci : ${formatCurrency(afterSecurity)}`;
          row.detailGoal = row.stateText;
        }
        return row;
      }

      if (key === "pilier3a") {
        const displayedAmount = pillarCapReached ? 0 : baseAmount;
        const afterPillar = roundMoney(pillarBefore + displayedAmount);
        row.amount = displayedAmount;
        row.hasAllocation = displayedAmount > 0.5;
        if (pillarCapReached) {
          row.isMuted = true;
          row.why = "Plafond annuel atteint";
          row.stateText = "Plafond annuel atteint";
          row.detailGoal = row.stateText;
          return row;
        }
        if (displayedAmount <= 0.5) {
          row.isMuted = true;
          row.stateText = "Aucun versement ce mois-ci";
          row.detailGoal = row.stateText;
          return row;
        }
        const pct = getProgressPercent(afterPillar, Math.max(1, pillarAnnualCap));
        row.stateKind = "progress";
        row.stateLabel = "Progression";
        row.statePercent = pct;
        row.stateValue = `${pct} % du plafond annuel`;
        row.detailGoal = `Progression : ${pct} % du plafond annuel`;
        return row;
      }

      if (key === "investissements") {
        const afterInvest = roundMoney(investBefore + baseAmount);
        if (baseAmount <= 0.5) {
          row.isMuted = true;
          row.why = "Investissements bloqués pour l’instant";
          row.stateText = "Investissements bloqués pour l’instant";
        } else if (afterInvest > 0.5) {
          row.stateText = `Après ce mois-ci : ${formatCurrency(afterInvest)} investis`;
        } else {
          row.stateText = "Investissements activés";
        }
        row.detailGoal = row.stateText;
        return row;
      }

      row.stateText = "";
      row.detailGoal = row.stateText;
      return row;
    });

    const totalUsed = Math.max(
      0,
      roundMoney(monthlyPlan.totalAllocated || rows.reduce((sum, row) => sum + row.amount, 0))
    );
    const activeRows = rows.filter((row) => row.hasAllocation && row.amount > 0.5);
    if (allocationLinesNode) {
      allocationLinesNode.innerHTML = activeRows.length
        ? activeRows
            .map((row) => {
              const detailKey = toDetailKey[String(row.key || "").trim().toLowerCase()] || row.key;
              const classes = [
                "smartsave-account-card",
                `is-${row.iconStyle}`,
                row.isMuted ? "is-muted" : "is-active",
              ]
                .filter(Boolean)
                .join(" ");
              const pct = totalUsed > 0 ? Math.round((row.amount / totalUsed) * 100) : 0;
              const visualPct = Math.max(4, Math.min(100, pct || 0));
              return `
              <article
                class="${classes}"
                data-allocation-details-trigger
                data-allocation-detail-key="${detailKey}"
                data-allocation-detail-amount="${row.amount}"
                data-allocation-detail-goal="${row.detailGoal}"
                tabindex="0"
                role="button"
                aria-label="Voir le détail de ${row.label}"
                style="--allocation-color:${row.distColor};"
              >
                <div class="smartsave-account-card__top">
                  <div class="smartsave-account-card__lead">
                    <span class="smartsave-account-card__icon" aria-hidden="true">${row.iconSvg}</span>
                    <p data-allocation-card-label>${row.label}</p>
                  </div>
                  <div class="smartsave-account-card__amount">
                    <strong>${formatCurrency(row.amount)}</strong>
                    <span>${pct}%</span>
                  </div>
                </div>
                <span class="smartsave-account-card__progress" aria-hidden="true"><span style="width:${visualPct}%"></span></span>
              </article>
            `;
            })
            .join("")
        : '<p class="smartsave-inline-state">Aucun surplus à répartir ce mois.</p>';
    }

    if (transferTotalNode) {
      transferTotalNode.hidden = true;
    }

    const lockPlanByModal = shouldOpenTaxOnboardingModal && !taxOnboardingChoice;
    const lockPlanByStatus = monthStatus === "closed";
    const lockPlanByReadiness = !isPlanReady;
    const lockPlanByOverride = Boolean(advancedSettings?.overrides?.skipCurrentMonth);
    const planHasTransfers = activeRows.length > 0;
    if (monthlyStatusNode) {
      if (lockPlanByRebalance) {
        monthlyStatusNode.textContent = "Répartition prête. Ajuste d'abord tes comptes pour l'appliquer.";
      } else if (lockPlanByStatus) {
        monthlyStatusNode.textContent = "Mois clôturé: le plan n'est plus modifiable.";
      } else if (lockPlanByOverride) {
        monthlyStatusNode.textContent = "Plan non appliqué: l'option d'override est active.";
      } else if (lockPlanByModal) {
        monthlyStatusNode.textContent = "Choisis d'abord une stratégie impôts.";
      } else if (lockPlanByReadiness) {
        monthlyStatusNode.textContent = "Le plan n'est pas encore prêt.";
      } else if (surplus <= 0) {
        monthlyStatusNode.textContent = "Pas de surplus à répartir ce mois.";
      } else if (isPlanApplied) {
        monthlyStatusNode.textContent = "Plan appliqué.";
      } else {
        monthlyStatusNode.textContent = "Plan prêt à appliquer.";
      }
    }

    const canApplyPlan =
      !isPlanApplied &&
      !lockPlanByRebalance &&
      !lockPlanByModal &&
      !lockPlanByStatus &&
      !lockPlanByOverride &&
      !lockPlanByReadiness &&
      surplus > 0 &&
      planHasTransfers;

    if (mainCta) {
      mainCta.hidden = lockPlanByRebalance;
      mainCta.disabled = !canApplyPlan;
      mainCta.textContent = isPlanApplied ? "Plan appliqué" : "Appliquer mon plan";
      mainCta.onclick = () => {
        if (!canApplyPlan || !store || !activeUser?.id) return;
        const transferControls =
          advancedSettings.transferControls && typeof advancedSettings.transferControls === "object"
            ? advancedSettings.transferControls
            : {};
        const overrides =
          advancedSettings.overrides && typeof advancedSettings.overrides === "object"
            ? advancedSettings.overrides
            : {};
        const planTransfers = ensureArray(monthlyPlan?.transfers);
        const transferCount = planTransfers.length;
        const transferTotal = roundMoney(
          planTransfers.reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount || 0)), 0)
        );
        const maxTransfers = Math.max(0, Math.round(toNumber(transferControls.maxTransfersPerMonth || 0)));
        const maxPerTransfer = Math.max(0, toNumber(transferControls.maxPerTransfer || 0));
        const maxMonthlyTotal = Math.max(0, toNumber(transferControls.maxMonthlyTotal || 0));

        if (overrides.skipCurrentMonth) {
          if (monthlyStatusNode) {
            monthlyStatusNode.textContent =
              "Plan non appliqué: l'override 'Ignorer SmartSave pour ce mois' est actif.";
          }
          return;
        }
        if (maxTransfers > 0 && transferCount > maxTransfers) {
          if (monthlyStatusNode) {
            monthlyStatusNode.textContent =
              `Plan bloqué: ${transferCount} transferts prévus (max autorisé ${maxTransfers}).`;
          }
          return;
        }
        if (maxPerTransfer > 0) {
          const exceedsPerTransfer = planTransfers.some(
            (entry) => Math.max(0, toNumber(entry?.amount || 0)) > maxPerTransfer + 1e-6
          );
          if (exceedsPerTransfer) {
            if (monthlyStatusNode) {
              monthlyStatusNode.textContent =
                `Plan bloqué: au moins un transfert dépasse le plafond unitaire (${formatCurrency(maxPerTransfer)}).`;
            }
            return;
          }
        }
        if (maxMonthlyTotal > 0 && transferTotal > maxMonthlyTotal + 1e-6) {
          if (monthlyStatusNode) {
            monthlyStatusNode.textContent =
              `Plan bloqué: total des transferts ${formatCurrency(transferTotal)} > plafond mensuel ${formatCurrency(maxMonthlyTotal)}.`;
          }
          return;
        }
        if (transferControls.requireConfirmation) {
          const confirmed = window.confirm(
            `Confirmer l'application du plan (${transferCount} transferts, total ${formatCurrency(transferTotal)}) ?`
          );
          if (!confirmed) return;
        }
        const result = store.applyPlanForMonth({ userId: activeUser.id, monthId });
        if (!result?.ok) return;
        if (typeof store.markAllocationValidatedForMonth === "function") {
          store.markAllocationValidatedForMonth({
            userId: activeUser.id,
            monthId,
            now: new Date(),
          });
        }
        if (context?.monthlyPlan) {
          context.monthlyPlan.taxMode = taxMonthly.mode || taxMode;
          context.monthlyPlan.taxOnboardingChoice = taxMonthly.onboardingChoice || taxOnboardingChoice;
          context.monthlyPlan.taxMonthlyTarget = Math.max(0, toNumber(taxMonthly.taxMonthlyTarget || 0));
          context.monthlyPlan.taxMonthlyActual = Math.max(0, toNumber(taxMonthly.taxMonthlyActual || 0));
          context.monthlyPlan.taxTopUpFromSurplus = Math.max(0, toNumber(taxMonthly.taxTopUpFromSurplus || 0));
          context.monthlyPlan.taxShortfallThisMonth = Math.max(0, toNumber(taxMonthly.taxShortfallThisMonth || 0));
          context.monthlyPlan.taxNotProvisionedAmount = Math.max(0, toNumber(taxMonthly.taxNotProvisionedAmount || 0));
        }

        const fundingAmount = Math.max(
          0,
          roundMoney(
            toNumber(
              monthlyPlan?.availableSurplus != null
                ? monthlyPlan.availableSurplus
                : allocationEnvelope
            )
          )
        );
        const fundingExecution = appendExternalFundingTransaction({
          activeUser,
          monthId,
          amount: fundingAmount,
          idPrefix: "smartsave-plan-funding",
          note: "Alimentation externe du surplus SmartSave du mois",
          autoApplyKind: "allocation-funding",
        });
        const execution = appendTransferTransactions({
          activeUser,
          monthId,
          transfers: monthlyPlan.transfers,
          idPrefix: "smartsave-plan",
          noteFallback: "Répartition SmartSave du mois",
          autoApplyKind: "allocation-transfer",
        });
        const executionEntries = []
          .concat(
            Array.isArray(fundingExecution?.addedEntries) ? fundingExecution.addedEntries : []
          )
          .concat(Array.isArray(execution?.addedEntries) ? execution.addedEntries : []);
        if (typeof store.saveMonthlyPlanExecutionForMonth === "function") {
          store.saveMonthlyPlanExecutionForMonth({
            userId: activeUser.id,
            monthId,
            now: new Date(),
            entries: executionEntries,
            source: "smartsave-main-cta",
          });
        }
        if (typeof store.regeneratePlanForMonth === "function" && typeof window.buildMvpData === "function") {
          const latestFormData = typeof window.loadUserForm === "function" ? window.loadUserForm(activeUser.id) : null;
          if (latestFormData) {
            const latestMvpData = window.buildMvpData(latestFormData);
            store.regeneratePlanForMonth({
              userId: activeUser.id,
              monthId,
              formData: latestFormData,
              mvpData: latestMvpData,
            });
          }
        }
        renderAll();
      };
    }

    if (projectionCard) {
      projectionCard.hidden = false;
      // Reuse the centralized projection already built from form + monthly budget.
      const projection = data?.projection || null;
      const currentHistory = ensureArray(projection?.current?.history);
      const smartHistory = ensureArray(projection?.smartSave?.history);
      const hasHistory = smartHistory.length > 0 || currentHistory.length > 0;
      const smart10 = hasHistory
        ? getHistoryValueAtMonth(smartHistory, 119)
        : Math.max(0, toNumber(projection?.smartSave?.netWorth || 0));
      const current10 = hasHistory
        ? getHistoryValueAtMonth(currentHistory, 119)
        : Math.max(0, toNumber(projection?.current?.netWorth || 0));
      const smart20 = hasHistory
        ? getHistoryValueAtMonth(smartHistory, 239)
        : Math.max(0, toNumber(projection?.smartSave?.netWorth || 0));
      const current20 = hasHistory
        ? getHistoryValueAtMonth(currentHistory, 239)
        : Math.max(0, toNumber(projection?.current?.netWorth || 0));
      const gain10 = smart10 - current10;
      const gain20 = smart20 - current20;

      setText("[data-smartsave-projection-10y]", formatCurrency(smart10));
      setText(
        "[data-smartsave-projection-10y-gain]",
        `Gain vs trajectoire actuelle: ${formatSignedCurrency(gain10)}`
      );
      setText("[data-smartsave-projection-20y]", formatCurrency(smart20));
      setText(
        "[data-smartsave-projection-20y-gain]",
        `Gain vs trajectoire actuelle: ${formatSignedCurrency(gain20)}`
      );
      setText(
        "[data-smartsave-projection-compound]",
        `Impact des intérêts composés: ${formatSignedCurrency(
          gain20
        )} de patrimoine supplémentaire sur 20 ans en suivant SmartSave.`
      );
      if (projectionNoteNode) {
        projectionNoteNode.hidden = isPlanApplied;
        if (!isPlanApplied) {
          projectionNoteNode.textContent = "En appliquant ton plan, tu actives cette trajectoire.";
        }
      }
    }
  };

  const ensureSmartSaveMonthUi = () => {
    if (document.body?.dataset.page !== "smartsave") return null;
    const root = document.querySelector(".app-main");
    if (!root) return null;
    const cycleCard = document.querySelector("[data-smartsave-month-cycle]");
    if (cycleCard) cycleCard.remove();

    let setupModal = document.querySelector("[data-smartsave-setup-modal]");
    if (!setupModal) {
      setupModal = document.createElement("div");
      setupModal.className = "allocation-details-modal";
      setupModal.setAttribute("data-smartsave-setup-modal", "");
      setupModal.hidden = true;
      setupModal.setAttribute("aria-hidden", "true");
      setupModal.innerHTML = `
        <div class="allocation-details-modal__overlay" data-smartsave-setup-close></div>
        <div class="allocation-details-modal__content" role="dialog" aria-modal="true" aria-labelledby="smartsave-setup-title">
          <header class="allocation-details-modal__header">
            <h2 id="smartsave-setup-title">Premiere mise en place</h2>
            <button class="allocation-details-modal__close" type="button" data-smartsave-setup-close aria-label="Fermer">×</button>
          </header>
          <div class="allocation-details-modal__body">
            <section class="allocation-details-block">
              <p>Le salaire du mois est deja arrive. Cette etape sert a organiser tes comptes proprement, sans appliquer un mois complet.</p>
            </section>
            <section class="allocation-details-block">
              <h3>Recommandations de reorganisation (mois 0)</h3>
              <p class="smartsave-setup__hint">Ces recommandations sont basees sur les limites SmartSave de tes comptes.</p>
              <div class="smartsave-setup__list" data-smartsave-setup-recommendations></div>
              <p class="smartsave-setup__empty" data-smartsave-setup-empty hidden>Aucun transfert one-shot necessaire pour l'instant.</p>
            </section>
            <section class="allocation-details-block">
              <h3>Checklist one-shot</h3>
              <ul>
                <li>Creer/nommer les comptes: Securite, Impots, Court terme, Invest.</li>
                <li>Preparer les virements automatiques pour le mois prochain.</li>
              </ul>
            </section>
          </div>
        </div>
      `;
      document.body.appendChild(setupModal);
    }

    let taxModal = document.querySelector("[data-smartsave-tax-modal]");
    if (!taxModal) {
      taxModal = document.createElement("div");
      taxModal.className = "allocation-details-modal";
      taxModal.setAttribute("data-smartsave-tax-modal", "");
      taxModal.hidden = true;
      taxModal.setAttribute("aria-hidden", "true");
      taxModal.innerHTML = `
        <div class="allocation-details-modal__overlay" data-smartsave-tax-close></div>
        <div class="allocation-details-modal__content" role="dialog" aria-modal="true" aria-labelledby="smartsave-tax-title">
          <header class="allocation-details-modal__header">
            <h2 id="smartsave-tax-title">Échéance fiscale proche</h2>
            <button class="allocation-details-modal__close" type="button" data-smartsave-tax-close aria-label="Fermer">×</button>
          </header>
          <div class="allocation-details-modal__body">
            <section class="allocation-details-block">
              <p>
                L’échéance est proche. Pour éviter un effort mensuel trop lourd, choisis comment tu veux t’organiser.<br>
                Tu pourras changer plus tard.
              </p>
            </section>
            <section class="allocation-details-block">
              <div class="smartsave-tax-summary">
                <p><span>Impôts restants</span><strong data-smartsave-tax-summary-need>CHF 0</strong></p>
                <p><span>Échéance</span><strong data-smartsave-tax-summary-due>0 mois</strong></p>
                <p><span>Recommandation actuelle</span><strong data-smartsave-tax-summary-reco>CHF 0 / mois</strong></p>
              </div>
            </section>
            <section class="allocation-details-block">
              <div class="smartsave-tax-options-grid">
                <label class="smartsave-tax-option-card" data-smartsave-tax-option="MIX">
                  <input type="radio" name="smartsave-tax-choice" value="MIX">
                  <div>
                    <p class="smartsave-tax-option-title">Équilibré <span class="smartsave-tax-badge">Recommandé</span></p>
                    <p class="smartsave-tax-option-copy">Je mets un peu maintenant, puis le reste chaque mois.</p>
                    <p class="smartsave-tax-option-impact" data-smartsave-tax-impact="MIX"></p>
                  </div>
                </label>
                <label class="smartsave-tax-option-card" data-smartsave-tax-option="SPREAD">
                  <input type="radio" name="smartsave-tax-choice" value="SPREAD">
                  <div>
                    <p class="smartsave-tax-option-title">Mensualités légères</p>
                    <p class="smartsave-tax-option-copy">Je mets le maximum raisonnable chaque mois (sans toucher à mon épargne).</p>
                    <p class="smartsave-tax-option-impact" data-smartsave-tax-impact="SPREAD"></p>
                  </div>
                </label>
                <label class="smartsave-tax-option-card" data-smartsave-tax-option="USE_SAVINGS">
                  <input type="radio" name="smartsave-tax-choice" value="USE_SAVINGS">
                  <div>
                    <p class="smartsave-tax-option-title">Utiliser mon épargne</p>
                    <p class="smartsave-tax-option-copy">Je couvre une grande partie tout de suite via l’excès d’épargne.</p>
                    <p class="smartsave-tax-option-impact" data-smartsave-tax-impact="USE_SAVINGS"></p>
                  </div>
                </label>
                <label class="smartsave-tax-option-card smartsave-tax-option-card--danger" data-smartsave-tax-option="PAY_LATER">
                  <input type="radio" name="smartsave-tax-choice" value="PAY_LATER">
                  <div>
                    <p class="smartsave-tax-option-title">Gérer plus tard</p>
                    <p class="smartsave-tax-option-copy">Je ne mets rien de côté pour l’instant (risque d’un gros paiement).</p>
                    <p class="smartsave-tax-option-impact" data-smartsave-tax-impact="PAY_LATER"></p>
                  </div>
                </label>
              </div>
            </section>
            <section class="allocation-details-block">
              <button class="cta" type="button" data-smartsave-tax-continue>Continuer</button>
            </section>
          </div>
        </div>
      `;
      document.body.appendChild(taxModal);
    }

    let rebalanceDetailModal = document.querySelector("[data-smartsave-rebalance-modal]");
    if (!rebalanceDetailModal) {
      rebalanceDetailModal = document.createElement("div");
      rebalanceDetailModal.className = "allocation-details-modal smartsave-rebalance-modal";
      rebalanceDetailModal.setAttribute("data-smartsave-rebalance-modal", "");
      rebalanceDetailModal.hidden = true;
      rebalanceDetailModal.setAttribute("aria-hidden", "true");
      rebalanceDetailModal.setAttribute("inert", "");
      rebalanceDetailModal.innerHTML = `
        <div class="allocation-details-modal__overlay" data-smartsave-rebalance-close></div>
        <div class="allocation-details-modal__content" role="dialog" aria-modal="true" aria-labelledby="smartsave-rebalance-title">
          <header class="allocation-details-modal__header">
            <h2 id="smartsave-rebalance-title" data-smartsave-rebalance-modal-title>Détail du transfert</h2>
            <button class="allocation-details-modal__close" type="button" data-smartsave-rebalance-close aria-label="Fermer">×</button>
          </header>
          <div class="allocation-details-modal__body">
            <section class="smartsave-rebalance-modal__summary">
              <p class="smartsave-rebalance-modal__route" data-smartsave-rebalance-modal-route>Compte source → Compte destination</p>
              <p class="smartsave-rebalance-modal__amount" data-smartsave-rebalance-modal-amount>CHF 0</p>
            </section>
            <section class="smartsave-rebalance-modal__mini">
              <p><span>Depuis</span><strong data-smartsave-rebalance-modal-from>Compte source</strong></p>
              <p><span>Vers</span><strong data-smartsave-rebalance-modal-to>Compte destination</strong></p>
            </section>
            <section class="allocation-details-block">
              <p class="smartsave-rebalance-modal__why" data-smartsave-rebalance-modal-why></p>
            </section>
          </div>
        </div>
      `;
      document.body.appendChild(rebalanceDetailModal);
    }

    return { setupModal, taxModal, rebalanceDetailModal };
  };

  const getLiveAccountBalances = (_activeUser, formData) =>
    normalizeBalances(resolveBalances(formData || {}));
  const SETUP_RULES_VERSION = "setup-static-v2";

  const buildMonthZeroRecommendations = (activeUser, formData, data, monthContext) => {
    const balances = getLiveAccountBalances(activeUser, formData);
    const debug = data?.allocation?.debug || {};
    const inputs = monthContext?.monthlyPlan?.inputsSnapshot || {};
    const currentTarget = Math.max(
      0,
      toNumber(
        debug.currentTarget || toNumber(inputs.mandatoryTotal)
      )
    );
    const securityTarget = Math.max(
      0,
      toNumber(
        debug.savingsTargets?.targetAmount ||
          (toNumber(inputs.fixedTotal) + toNumber(inputs.mandatoryTotal)) * 3
      )
    );
    const taxTarget = Math.max(
      0,
      toNumber(
        data?.taxProvision?.remaining ||
          data?.taxProvision?.outstanding ||
          data?.taxProvision?.totalTax ||
          inputs.taxesNeed ||
          0
      )
    );
    const monthId = monthContext?.monthId || getMonthKey(new Date());
    const pillarRemaining = computeThirdPillarRoomForRebalance(formData, inputs, balances, monthId);

    const recommendations = [];
    const savingsCeiling = Math.max(securityTarget * 1.25, securityTarget + 5000);
    let reservedSecurityOverflow = 0;
    const projected = {
      current: Math.max(0, toNumber(balances.current)),
      security: Math.max(0, toNumber(balances.security)),
      tax: Math.max(0, toNumber(balances.tax)),
      pillar3a: Math.max(0, toNumber(balances.pillar3a)),
      projects: 0,
      investments: Math.max(0, toNumber(balances.investments)),
    };

    const pushReco = (item) => {
      if (!item || !item.amount || item.amount <= 0) return;
      recommendations.push({
        ...item,
        amount: Math.round(item.amount),
      });
    };

    const transfer = (from, to, amount) => {
      const safeAmount = Math.max(0, Math.floor(toNumber(amount)));
      if (!safeAmount || from === to) return 0;
      const available = Math.max(0, toNumber(projected[from]));
      const moved = Math.min(available, safeAmount);
      if (!moved) return 0;
      projected[from] = Math.max(0, toNumber(projected[from]) - moved);
      projected[to] = Math.max(0, toNumber(projected[to]) + moved);
      return moved;
    };

    const availableFromCurrent = () => Math.max(0, projected.current - currentTarget);
    const availableFromSecurity = () =>
      Math.max(0, projected.security - savingsCeiling - reservedSecurityOverflow);
    const poolAmount = () => availableFromCurrent() + availableFromSecurity();
    const securityGap = () => Math.max(0, securityTarget - projected.security);
    const taxGap = () => Math.max(0, taxTarget - projected.tax);
    const pillarRoomNow = () => {
      const addedInSetup = Math.max(0, projected.pillar3a - Math.max(0, toNumber(balances.pillar3a)));
      return Math.max(0, pillarRemaining - addedInSetup);
    };

    const pullSurplusTo = (toAccount, targetAmount, title, detail) => {
      let remaining = Math.max(0, toNumber(targetAmount));
      if (!remaining) return 0;
      let moved = 0;

      const fromCurrent = transfer("current", toAccount, Math.min(remaining, availableFromCurrent()));
      if (fromCurrent > 0) {
        pushReco({
          title,
          detail,
          from: "current",
          to: toAccount,
          amount: fromCurrent,
        });
        moved += fromCurrent;
        remaining -= fromCurrent;
      }

      const fromSecurity = transfer("security", toAccount, Math.min(remaining, availableFromSecurity()));
      if (fromSecurity > 0) {
        pushReco({
          title,
          detail,
          from: "security",
          to: toAccount,
          amount: fromSecurity,
        });
        moved += fromSecurity;
        remaining -= fromSecurity;
      }

      return moved;
    };

    // 1) Realign current account if below its limit.
    const currentGap = Math.max(0, currentTarget - projected.current);
    if (currentGap > 0) {
      const topup = transfer("security", "current", Math.min(currentGap, projected.security - securityTarget));
      pushReco({
        title: "Reequilibrer le compte courant",
        detail: `Courant ${formatCurrency(balances.current)} / limite ${formatCurrency(currentTarget)}.`,
        from: "security",
        to: "current",
        amount: topup,
      });
    }

    // 2) Fill tax gap first from surplus pool.
    pullSurplusTo(
      "tax",
      taxGap(),
      "Combler la provision impôts",
      `Impôts ${formatCurrency(projected.tax)} / cible ${formatCurrency(taxTarget)}.`
    );

    // 3) Keep 15% on savings from the surplus pool (including security-origin surplus).
    const savingsKeepAmount = Math.min(
      poolAmount() * 0.15,
      Math.max(0, savingsCeiling - projected.security) + availableFromSecurity()
    );
    const keepToSavingsFromCurrent = transfer(
      "current",
      "security",
      Math.min(savingsKeepAmount, availableFromCurrent())
    );
    if (keepToSavingsFromCurrent > 0) {
      pushReco({
        title: "Conserver une partie sur l'épargne",
        detail: `Epargne cible ${formatCurrency(securityTarget)} · plafond ${formatCurrency(savingsCeiling)}.`,
        from: "current",
        to: "security",
        amount: keepToSavingsFromCurrent,
      });
    }
    const keepToSavingsFromSecurity = Math.min(
      Math.max(0, savingsKeepAmount - keepToSavingsFromCurrent),
      availableFromSecurity()
    );
    if (keepToSavingsFromSecurity > 0) {
      // Virtual reserve: this part stays on savings instead of being reallocated out.
      reservedSecurityOverflow += keepToSavingsFromSecurity;
    }

    // 4) Growth allocation from remaining pool: 60% pillar3a, 40% investments.
    const growthPool = poolAmount();
    if (growthPool > 0) {
      const pillarTarget = Math.min(growthPool * 0.6, pillarRoomNow());
      pullSurplusTo(
        "pillar3a",
        pillarTarget,
        "Alimenter le 3e pilier",
        `Cap 3a restant: ${formatCurrency(pillarRoomNow())}.`
      );

      const investTarget = poolAmount();
      pullSurplusTo(
        "investments",
        investTarget,
        "Investir le surplus",
        "Surplus au-dessus des limites courant/épargne orienté vers la croissance."
      );
    }

    return recommendations;
  };

  const getTransferMatchKey = (from, to, amount) =>
    `${String(from || "").trim()}|${String(to || "").trim()}|${Math.round(Math.max(0, toNumber(amount)))}`;

  const getCompletedSetupTransferKeys = (activeUser, monthId) => {
    const counters = {};
    const transfers = loadTransactions(activeUser).filter((entry) => {
      if (!entry || entry.type !== "transfer") return false;
      return getMonthKey(entry.date || entry.createdAt || new Date()) === monthId;
    });
    transfers.forEach((entry) => {
      const key = getTransferMatchKey(entry.from, entry.to, entry.amount);
      counters[key] = (counters[key] || 0) + 1;
    });
    return counters;
  };

  const getStaticSetupPlan = (activeUser, formData, data, monthContext) => {
    const monthId = String(monthContext?.monthId || "").trim();
    if (!activeUser?.id || !monthId) {
      return {
        createdAt: new Date().toISOString(),
        monthId,
        items: buildMonthZeroRecommendations(activeUser, formData, data, monthContext),
      };
    }

    const store = getMonthlyStore();
    const existing = store?.getSetupPlanForMonth
      ? store.getSetupPlanForMonth({ userId: activeUser.id, monthId })
      : null;
    if (
      existing &&
      existing.rulesVersion === SETUP_RULES_VERSION &&
      Array.isArray(existing.items)
    ) {
      return existing;
    }

    const balances = getLiveAccountBalances(activeUser, formData);
    const items = buildMonthZeroRecommendations(activeUser, formData, data, monthContext).map(
      (item, index) => ({
        ...item,
        id:
          item.id ||
          `setup-${monthId}-${index + 1}-${String(item.from || "")}-${String(item.to || "")}-${Math.round(
            Math.max(0, toNumber(item.amount))
          )}`,
      })
    );
    const setupPlan = {
      monthId,
      rulesVersion: SETUP_RULES_VERSION,
      createdAt: new Date().toISOString(),
      balancesSnapshot: balances,
      items,
    };

    if (store?.saveSetupPlanForMonth) {
      return store.saveSetupPlanForMonth({
        userId: activeUser.id,
        monthId,
        setupPlan,
      }) || setupPlan;
    }
    return setupPlan;
  };

  const getPendingSetupTransfers = (setupPlan, activeUser, monthId) => {
    const items = Array.isArray(setupPlan?.items) ? setupPlan.items : [];
    if (!items.length) return [];
    const counters = getCompletedSetupTransferKeys(activeUser, monthId);
    const pending = [];
    items.forEach((item) => {
      const key = getTransferMatchKey(item.from, item.to, item.amount);
      if ((counters[key] || 0) > 0) {
        counters[key] -= 1;
        return;
      }
      pending.push(item);
    });
    return pending;
  };

  const readAllTransactionsRaw = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch (_error) {
      return [];
    }
  };

  const saveAllTransactionsRaw = (items = []) => {
    try {
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(Array.isArray(items) ? items : []));
    } catch (_error) {
      // ignore storage issues
    }
  };

  const saveUserFormLocal = (userId, formData) => {
    if (!userId || !formData || typeof formData !== "object") return;
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_FORM) || "{}");
      parsed[userId] = formData;
      if (!parsed.__default) parsed.__default = formData;
      localStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(parsed));
    } catch (_error) {
      // ignore
    }
  };

  const normalizeEntryIdPart = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item";

  const appendTransferTransactions = ({
    activeUser,
    monthId,
    transfers = [],
    idPrefix = "smartsave-transfer",
    noteFallback = "Transfert SmartSave",
    autoApplyKind = "allocation-transfer",
  }) => {
    const userId = String(activeUser?.id || "").trim();
    if (!userId || !monthId) return { addedCount: 0, addedEntries: [] };

    const monthDate = parseMonthKey(monthId) || new Date();
    const now = new Date();
    const entryDate = isSameMonth(now, monthDate) ? toISODate(now) : toISODate(monthDate);
    const nowIso = now.toISOString();
    const stored = readAllTransactionsRaw();
    const existingIds = new Set(stored.map((entry) => String(entry?.id || "").trim()).filter(Boolean));
    const added = [];

    ensureArray(transfers).forEach((row, index) => {
      const from = String(row?.from || "").trim();
      const to = String(row?.to || "").trim();
      const amount = Math.max(0, toNumber(row?.amount || 0));
      if (!from || !to || from === to || amount <= 0) return;
      const id =
        String(row?.id || "").trim() ||
        `${idPrefix}-${userId}-${monthId}-${index + 1}-${normalizeEntryIdPart(from)}-${normalizeEntryIdPart(
          to
        )}-${Math.round(amount)}`;
      if (existingIds.has(id)) return;
      const entry = {
        id,
        userId,
        type: "transfer",
        from,
        fromLabel: row?.fromLabel || formatTransferAccountLabel(from),
        to,
        toLabel: row?.toLabel || formatTransferAccountLabel(to),
        amount,
        date: entryDate,
        note: String(row?.reason || row?.why || "").trim() || noteFallback,
        isFixed: true,
        autoApplyKind,
        autoApplyMonthId: monthId,
        autoGenerated: true,
        createdAt: nowIso,
      };
      existingIds.add(id);
      stored.push(entry);
      added.push(entry);
    });

    if (!added.length) return { addedCount: 0, addedEntries: [] };
    saveAllTransactionsRaw(stored);
    if (typeof window.syncTransactionToProfile === "function") {
      added.forEach((entry) => window.syncTransactionToProfile(entry, userId));
    }
    return { addedCount: added.length, addedEntries: added };
  };

  const appendExternalFundingTransaction = ({
    activeUser,
    monthId,
    amount = 0,
    idPrefix = "smartsave-funding",
    note = "Alimentation externe SmartSave",
    autoApplyKind = "allocation-funding",
  }) => {
    const userId = String(activeUser?.id || "").trim();
    const safeAmount = Math.max(0, roundMoney(toNumber(amount)));
    if (!userId || !monthId || safeAmount <= 0) return { addedCount: 0, addedEntries: [] };

    const monthDate = parseMonthKey(monthId) || new Date();
    const now = new Date();
    const entryDate = isSameMonth(now, monthDate) ? toISODate(now) : toISODate(monthDate);
    const nowIso = now.toISOString();
    const stored = readAllTransactionsRaw();
    const id = `${idPrefix}-${userId}-${monthId}-current-${Math.round(safeAmount)}`;
    if (stored.some((entry) => String(entry?.id || "").trim() === id)) {
      return { addedCount: 0, addedEntries: [] };
    }

    const entry = {
      id,
      userId,
      type: "income",
      account: "current",
      accountLabel: formatTransferAccountLabel("current"),
      category: "Alimentation SmartSave",
      amount: safeAmount,
      date: entryDate,
      note: String(note || "").trim() || "Alimentation externe SmartSave",
      isFixed: true,
      autoApplyKind,
      autoApplyMonthId: monthId,
      autoGenerated: true,
      createdAt: nowIso,
    };

    stored.push(entry);
    saveAllTransactionsRaw(stored);
    if (typeof window.syncTransactionToProfile === "function") {
      window.syncTransactionToProfile(entry, userId);
    }
    return { addedCount: 1, addedEntries: [entry] };
  };

  const getNetWorthFromHistoryEntry = (entry = {}) => {
    const accounts = entry?.accounts || {};
    return (
      toNumber(accounts.current) +
      toNumber(accounts.savings) +
      toNumber(accounts.blocked) +
      toNumber(accounts.pillar3) +
      toNumber(accounts.investments)
    );
  };

  const getHistoryValueAtMonth = (history = [], monthIndex = 0) => {
    if (!Array.isArray(history) || !history.length) return 0;
    const safeIndex = Math.max(0, Math.min(history.length - 1, monthIndex));
    return getNetWorthFromHistoryEntry(history[safeIndex] || {});
  };

  const buildMonthlyApplyEntries = ({
    activeUser,
    monthId,
    monthContext,
    mvpData,
    transferPlan = null,
  }) => {
    const plan = monthContext?.monthlyPlan || {};
    const settingsContext = resolveEffectiveMonthSettings(monthContext || {});
    const userSettings = settingsContext.userSettings || monthContext?.userSettings || {};
    const smartSaveSettings = settingsContext.smartSaveSettings;
    const advancedSettings = settingsContext.advancedSettings;
    const inputs = plan.inputsSnapshot || {};
    const liveAllocation = mvpData?.allocation && typeof mvpData.allocation === "object" ? mvpData.allocation : null;
    const allocations =
      liveAllocation?.allocations && typeof liveAllocation.allocations === "object"
        ? liveAllocation.allocations
        : plan.allocationResultSnapshot?.allocations || {};
    const shortTermAccount = liveAllocation?.shortTermAccount || liveAllocation?.debug?.shortTermAccount || {};
    const shortTermKey = String(shortTermAccount?.key || "projetsCourtTerme").trim() || "projetsCourtTerme";
    const shortTermLabel = shortTermAccount?.name || shortTermAccount?.label || "Compte court terme";
    const forcedPayLaterBySettings =
      !smartSaveSettings.taxes.enabled ||
      String(smartSaveSettings.taxes.provisionMode || "").toLowerCase() === "recommendations";
    const taxMode = String(
      forcedPayLaterBySettings ? "PAY_LATER" : plan.taxMode || userSettings?.taxMode || "AUTO_PROVISION"
    ).toUpperCase();
    const frozenAccount = resolveActiveFrozenAccount(advancedSettings);
    const skipCurrentMonth = Boolean(advancedSettings?.overrides?.skipCurrentMonth);
    const shortTermAllocationFromAllocations = Math.max(
      0,
      toNumber(
        allocations[shortTermKey] ||
          allocations.projetsCourtTerme ||
          0
      )
    );
    const shortTermDeduction = Math.max(
      0,
      toNumber(
        shortTermAccount?.amount ||
          liveAllocation?.shortTermDeduction ||
          plan.allocationResultSnapshot?.shortTermDeduction ||
          shortTermAllocationFromAllocations
      )
    );

    const today = new Date();
    const monthDate = parseMonthKey(monthId) || today;
    const entryDate = isSameMonth(today, monthDate) ? toISODate(today) : toISODate(monthDate);
    const nowIso = new Date().toISOString();
    const userId = String(activeUser?.id || "").trim();
    if (!userId || !monthId) return [];

    const entries = [];
    const pushEntry = (entry) => {
      const amount = Math.max(0, toNumber(entry?.amount));
      if (!amount) return;
      entries.push({
        ...entry,
        amount,
        date: entryDate,
        createdAt: nowIso,
        userId,
        autoApplyMonthId: monthId,
        autoGenerated: true,
      });
    };

    const incomeAmount = Math.max(0, toNumber(inputs.revenuNetMensuel || 0));
    pushEntry({
      id: `autoapply-${userId}-${monthId}-income-main`,
      type: "income",
      account: "current",
      accountLabel: "Compte courant",
      category: "Revenu mensuel",
      note: "Salaire du mois (auto SmartSave)",
      isFixed: true,
      autoApplyKind: "income",
      amount: incomeAmount,
    });

    const fixedItems = ensureArray(userSettings.fixedExpenses).filter(
      (item) => Math.max(0, toNumber(item?.amount)) > 0
    );
    const mandatoryItems = ensureArray(userSettings.mandatoryExpenses).filter(
      (item) => Math.max(0, toNumber(item?.amount)) > 0
    );

    if (fixedItems.length) {
      fixedItems.forEach((item, index) => {
        const label = String(item?.label || `Dépense fixe ${index + 1}`).trim();
        pushEntry({
          id: `autoapply-${userId}-${monthId}-fixed-${index + 1}-${normalizeEntryIdPart(label)}`,
          type: "expense",
          account: "current",
          accountLabel: "Compte courant",
          category: label,
          note: "Charge fixe du mois (auto SmartSave)",
          isFixed: true,
          autoApplyKind: "fixed-expense",
          amount: Math.max(0, toNumber(item.amount)),
        });
      });
    } else {
      const fixedTotal = Math.max(0, toNumber(inputs.fixedTotal || 0));
      pushEntry({
        id: `autoapply-${userId}-${monthId}-fixed-total`,
        type: "expense",
        account: "current",
        accountLabel: "Compte courant",
        category: "Dépenses fixes",
        note: "Charges fixes du mois (auto SmartSave)",
        isFixed: true,
        autoApplyKind: "fixed-expense",
        amount: fixedTotal,
      });
    }

    if (mandatoryItems.length) {
      mandatoryItems.forEach((item, index) => {
        const label = String(item?.label || `Dépense obligatoire ${index + 1}`).trim();
        pushEntry({
          id: `autoapply-${userId}-${monthId}-mandatory-${index + 1}-${normalizeEntryIdPart(label)}`,
          type: "expense",
          account: "current",
          accountLabel: "Compte courant",
          category: label,
          note: "Charge obligatoire du mois (auto SmartSave)",
          isFixed: true,
          autoApplyKind: "mandatory-expense",
          amount: Math.max(0, toNumber(item.amount)),
        });
      });
    } else {
      const mandatoryTotal = Math.max(0, toNumber(inputs.mandatoryTotal || 0));
      pushEntry({
        id: `autoapply-${userId}-${monthId}-mandatory-total`,
        type: "expense",
        account: "current",
        accountLabel: "Compte courant",
        category: "Dépenses obligatoires",
        note: "Charges obligatoires du mois (auto SmartSave)",
        isFixed: true,
        autoApplyKind: "mandatory-expense",
        amount: mandatoryTotal,
      });
    }

    const plannedTransfers = ensureArray(transferPlan).filter(
      (row) =>
        row &&
        String(row.from || "").trim() &&
        String(row.to || "").trim() &&
        Math.max(0, toNumber(row.amount)) > 0
    ).filter((row) => {
      if (skipCurrentMonth) return false;
      if (!frozenAccount) return true;
      const fromKey = normalizeTransferAccountKey(row?.from || "");
      const toKey = normalizeTransferAccountKey(row?.to || "");
      return fromKey !== frozenAccount && toKey !== frozenAccount;
    });
    if (plannedTransfers.length) {
      plannedTransfers.forEach((row, index) => {
        const from = String(row.from || "").trim();
        const to = String(row.to || "").trim();
        const reason = String(row.reason || "").trim();
        pushEntry({
          id: `autoapply-${userId}-${monthId}-transfer-plan-${index + 1}-${normalizeEntryIdPart(from)}-${normalizeEntryIdPart(
            to
          )}`,
          type: "transfer",
          from,
          fromLabel: formatTransferAccountLabel(row.fromLabel || from),
          to,
          toLabel: formatTransferAccountLabel(row.toLabel || to),
          note: reason || "Répartition SmartSave (auto)",
          isFixed: true,
          autoApplyKind: "allocation-transfer",
          allocationKey: String(row.allocationKey || row.key || "").trim() || null,
          amount: Math.max(0, toNumber(row.amount || 0)),
        });
      });
    } else if (!skipCurrentMonth) {
      const transferSpecs = [
        { allocationKey: "securite", to: "security", label: "Compte épargne" },
        { allocationKey: "pilier3a", to: "pillar3a", label: "3e pilier" },
        { allocationKey: "investissements", to: "investments", label: "Investissements" },
        { allocationKey: "projetsLongTerme", to: "projects", label: "Projet long terme" },
      ];
      if (shortTermDeduction > 0) {
        transferSpecs.push({
          allocationKey: shortTermKey,
          to: "projects",
          label: shortTermLabel,
        });
      }

      transferSpecs.forEach((spec) => {
        const fromKey = normalizeTransferAccountKey("current");
        const toKey = normalizeTransferAccountKey(spec.to);
        if (frozenAccount && (fromKey === frozenAccount || toKey === frozenAccount)) return;
        let amount = Math.max(0, toNumber(allocations[spec.allocationKey] || 0));
        if (spec.allocationKey === shortTermKey) amount = shortTermDeduction;
        if (spec.allocationKey === "projetsLongTerme") {
          amount = Math.max(0, toNumber(allocations.projetsLongTerme || allocations.projets || 0));
        }
        pushEntry({
          id: `autoapply-${userId}-${monthId}-transfer-${normalizeEntryIdPart(
            spec.allocationKey || spec.to
          )}-${normalizeEntryIdPart(spec.to)}`,
          type: "transfer",
          from: "current",
          fromLabel: "Compte courant",
          to: spec.to,
          toLabel: spec.label,
          note: "Répartition SmartSave (auto)",
          isFixed: true,
          autoApplyKind: "allocation-transfer",
          allocationKey: spec.allocationKey,
          amount,
        });
      });

      const taxMonthlyActual = Math.max(0, toNumber(plan.taxMonthlyActual || 0));
      const taxTopUpFromSurplus = Math.max(0, toNumber(plan.taxTopUpFromSurplus || 0));
      if (
        taxMode !== "PAY_LATER" &&
        taxTopUpFromSurplus > 0 &&
        !(frozenAccount && (frozenAccount === "current" || frozenAccount === "tax"))
      ) {
        pushEntry({
          id: `autoapply-${userId}-${monthId}-transfer-tax-topup`,
          type: "transfer",
          from: "current",
          fromLabel: "Compte courant",
          to: "tax",
          toLabel: "Provision impôts",
          note: "Top-up exceptionnel impôts (auto)",
          isFixed: true,
          autoApplyKind: "allocation-transfer",
          allocationKey: "impots",
          amount: taxTopUpFromSurplus,
        });
      }
      if (
        taxMode !== "PAY_LATER" &&
        taxMonthlyActual > 0 &&
        !(frozenAccount && (frozenAccount === "current" || frozenAccount === "tax"))
      ) {
        pushEntry({
          id: `autoapply-${userId}-${monthId}-transfer-tax-monthly`,
          type: "transfer",
          from: "current",
          fromLabel: "Compte courant",
          to: "tax",
          toLabel: "Provision impôts",
          note: "Provision mensuelle impôts (auto)",
          isFixed: true,
          autoApplyKind: "allocation-transfer",
          allocationKey: "impots",
          amount: taxMonthlyActual,
        });
      }
    }

    return entries;
  };

  const runMonthlyAutoApply = ({ activeUser, monthId, monthContext, mvpData, transferPlan = null }) => {
    const candidates = buildMonthlyApplyEntries({
      activeUser,
      monthId,
      monthContext,
      mvpData,
      transferPlan,
    });
    if (!candidates.length) return { addedCount: 0, addedEntries: [] };

    const stored = readAllTransactionsRaw();
    const existingIds = new Set(
      stored.map((entry) => String(entry?.id || "").trim()).filter(Boolean)
    );

    const added = [];
    candidates.forEach((entry) => {
      const id = String(entry?.id || "").trim();
      if (!id || existingIds.has(id)) return;
      existingIds.add(id);
      stored.push(entry);
      added.push(entry);
    });

    if (!added.length) return { addedCount: 0, addedEntries: [] };
    saveAllTransactionsRaw(stored);
    if (typeof window.syncTransactionToProfile === "function" && activeUser?.id) {
      added.forEach((entry) => window.syncTransactionToProfile(entry, activeUser.id));
    }
    return { addedCount: added.length, addedEntries: added };
  };

  const openRecommendedTransfer = (transfer = {}) => {
    const amount = Math.max(0, toNumber(transfer.amount));
    const from = String(transfer.from || "").trim();
    const to = String(transfer.to || "").trim();
    if (!amount || !from || !to || from === to) return;
    try {
      localStorage.setItem(
        PENDING_MON_ARGENT_ACTION_KEY,
        JSON.stringify({
          type: "transfer",
          openTransferModal: true,
          transfer: {
            from,
            to,
            amount,
          },
        })
      );
    } catch (_error) {
      // ignore storage issues
    }
    const params = new URLSearchParams({
      tab: "comptes",
      openTransfer: "1",
      transferFrom: from,
      transferTo: to,
      transferAmount: String(Math.round(amount)),
    });
    window.location.href = `mon-argent.html?${params.toString()}`;
  };

  const openSetupRecommendationsModal = ({
    setupModal,
    activeUser,
    formData,
    data,
    monthContext,
  }) => {
    if (!setupModal) return;
    const setupRecoNode = setupModal.querySelector("[data-smartsave-setup-recommendations]");
    const setupEmptyNode = setupModal.querySelector("[data-smartsave-setup-empty]");
    const monthId = monthContext?.monthId || getMonthKey(new Date());
    const liveSetupPlan = getStaticSetupPlan(activeUser, formData, data, monthContext);
    const livePendingTransfers = getPendingSetupTransfers(liveSetupPlan, activeUser, monthId);
    if (setupRecoNode) {
      setupRecoNode.innerHTML = livePendingTransfers
        .map(
          (item, index) => `
                <article class="smartsave-setup-reco">
                  <p class="smartsave-setup-reco__title">${index + 1}. ${item.title}</p>
                  <p class="smartsave-setup-reco__detail">${item.detail}</p>
                  <button
                    class="cta small"
                    type="button"
                    data-smartsave-setup-transfer
                    data-transfer-from="${item.from}"
                    data-transfer-to="${item.to}"
                    data-transfer-amount="${Math.round(item.amount)}"
                  >
                    Faire ce transfert
                  </button>
                </article>
              `
        )
        .join("");
    }
    if (setupEmptyNode) {
      setupEmptyNode.textContent = livePendingTransfers.length
        ? "Aucun transfert one-shot necessaire pour l'instant."
        : "Rearrangement termine: tous les transferts one-shot sont faits.";
      setupEmptyNode.hidden = livePendingTransfers.length > 0;
    }
    setupModal.hidden = false;
    setupModal.setAttribute("aria-hidden", "false");
    setupModal.classList.add("is-open");
  };

  const renderSmartSaveMonthCycle = () => {};

  const renderActions = (data, formData, activeUser) => {
    const homeDashboard = document.querySelector("[data-home-dashboard-root]");
    if (homeDashboard) {
      const homeTransactions = loadTransactions(activeUser);
      const monthInfo = activeUser ? getActiveMonthEntry(activeUser, formData, data, homeTransactions) : null;
      const activeMonthKey = monthInfo?.activeKey || getMonthKey(new Date());
      const monthDate = parseMonthKey(activeMonthKey) || new Date();
      const monthLabel = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(
        monthDate
      );
      setText("[data-home-month]", monthLabel);

      const planAppliedAt = monthInfo?.month?.planAppliedAt || null;
      const planSnapshot =
        monthInfo?.monthlyContext?.monthlyPlan?.allocationResultSnapshot || null;
      const homeMonthlyPlan = monthInfo?.monthlyContext?.monthlyPlan || null;
      const allocations =
        planSnapshot?.allocations ||
        data.allocation?.allocations ||
        {};
      const effectiveTaxAmount = getEffectiveTaxPlanAmount({
        monthlyPlan: homeMonthlyPlan,
        fallbackAllocationTax: allocations.impots || 0,
      });
      const shortTermAccount =
        data.allocation?.shortTermAccount || data.allocation?.debug?.shortTermAccount || null;
      const shortTermKey = String(shortTermAccount?.key || "projetsCourtTerme").trim();
      const shortTermAmount = Math.max(
        0,
        toNumber(
          planSnapshot?.shortTermDeduction ||
            shortTermAccount?.amount ||
            allocations[shortTermKey] ||
            allocations.projetsCourtTerme ||
            0
        )
      );
      const composition = [
        {
          key: "current",
          className: "home-plan__dot--current",
          label: "Courant",
          value: Math.max(0, toNumber(allocations.compteCourant || 0)),
        },
        {
          key: "security",
          className: "home-plan__dot--security",
          label: "Securite",
          value: Math.max(0, toNumber(allocations.securite || 0)),
        },
        {
          key: "tax",
          className: "home-plan__dot--tax",
          label: "Impots",
          value: effectiveTaxAmount,
        },
        {
          key: "pillar3a",
          className: "home-plan__dot--pillar3a",
          label: "3e pilier",
          value: Math.max(0, toNumber(allocations.pilier3a || 0)),
        },
        {
          key: "invest",
          className: "home-plan__dot--invest",
          label: "Investissements",
          value: Math.max(0, toNumber(allocations.investissements || 0)),
        },
        ...(shortTermAmount > 0
          ? [
              {
                key: "short-term",
                className: "home-plan__dot--security",
                label: shortTermAccount?.label || shortTermAccount?.name || "Objectif court terme",
                value: shortTermAmount,
              },
            ]
          : []),
      ];
      const allocationTotal = composition.reduce((sum, item) => sum + item.value, 0);
      const planMain = document.querySelector("[data-home-plan-main]");
      const planMicro = document.querySelector("[data-home-plan-micro]");
      const planCta = document.querySelector("[data-home-plan-cta]");
      const planBreakdown = document.querySelector("[data-home-plan-breakdown]");
      if (allocationTotal <= 0) {
        if (planMain) planMain.textContent = "Aucun montant a repartir ce mois";
        if (planMicro) {
          planMicro.textContent = planAppliedAt
            ? `Plan applique pour ${activeMonthKey}.`
            : "Le CT est preleve avant repartition SmartSave.";
        }
        if (planCta) {
          planCta.textContent = "Modifier mes choix";
          planCta.setAttribute("href", "score.html");
        }
        if (planBreakdown) {
          planBreakdown.innerHTML = "";
          planBreakdown.style.opacity = "0.55";
        }
      } else {
        setText("[data-home-plan-total]", formatCurrency(allocationTotal));
        if (planMain) planMain.innerHTML = `<span data-home-plan-total>${formatCurrency(allocationTotal)}</span>`;
        if (planMicro) {
          planMicro.textContent = planAppliedAt
            ? `✔ Plan applique pour ${activeMonthKey}`
            : "Inclut securite, impots, 3e pilier et objectif court terme";
        }
        if (planCta) {
          planCta.textContent = "Voir la repartition";
          planCta.setAttribute("href", "smartsave.html");
        }
        if (planBreakdown) {
          const visible = composition.filter((item) => item.value > 0);
          planBreakdown.style.opacity = "1";
          planBreakdown.innerHTML = visible
            .map((item) => {
              const pct = Math.max(0, (item.value / allocationTotal) * 100);
              const title = `${item.label}: ${formatCurrency(item.value)}`;
              return `
                <div class="home-plan__row" title="${title}" aria-label="${title}">
                  <div class="home-plan__row-left">
                    <i class="home-plan__dot ${item.className}"></i>
                    <span class="home-plan__label">${item.label}</span>
                  </div>
                  <div class="home-plan__row-right">
                    <span class="home-plan__amount">${formatCurrency(item.value)}</span>
                    <span class="home-plan__pct">${Math.round(pct)}%</span>
                  </div>
                </div>
              `;
            })
            .join("");
        }
      }

      const planCard = document.querySelector("[data-home-plan-link]");
      if (planCard && !planCard.dataset.bound) {
        const route = planCard.getAttribute("data-home-plan-route") || "smartsave.html";
        const goToPlan = () => {
          window.location.href = route;
        };
        planCard.addEventListener("click", (event) => {
          if (event.target.closest("a, button, input, select, textarea")) return;
          goToPlan();
        });
        planCard.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            goToPlan();
          }
        });
        planCard.dataset.bound = "true";
      }

      const profileBalances = normalizeBalances(resolveBalances(formData || {}));
      const allTransactions = homeTransactions;
      const monthTransactions = getMonthTransactions(allTransactions, activeMonthKey);
      const liveBalances = profileBalances;
      const totalWealth =
        Math.max(0, toNumber(liveBalances.current)) +
        Math.max(0, toNumber(liveBalances.security)) +
        Math.max(0, toNumber(liveBalances.tax)) +
        Math.max(0, toNumber(liveBalances.projects)) +
        Math.max(0, toNumber(liveBalances.investments)) +
        Math.max(0, toNumber(liveBalances.pillar3a));
      setText("[data-home-available-today]", formatCurrency(Math.max(0, toNumber(liveBalances.current))));
      setText("[data-home-total-wealth]", formatCurrency(totalWealth));

      const previousBalances = liveBalances;
      const previousWealth =
        Math.max(0, toNumber(previousBalances.current)) +
        Math.max(0, toNumber(previousBalances.security)) +
        Math.max(0, toNumber(previousBalances.tax)) +
        Math.max(0, toNumber(previousBalances.projects)) +
        Math.max(0, toNumber(previousBalances.investments)) +
        Math.max(0, toNumber(previousBalances.pillar3a));
      const wealthDelta = totalWealth - previousWealth;
      const trendNode = document.querySelector("[data-home-wealth-trend]");
      if (trendNode) {
        trendNode.classList.remove("is-up", "is-down", "is-flat");
        if (Math.abs(wealthDelta) < 0.5) {
          trendNode.classList.add("is-flat");
          trendNode.textContent = "Stable vs mois precedent";
        } else if (wealthDelta > 0) {
          trendNode.classList.add("is-up");
          trendNode.textContent = `↑ ${formatSignedCurrency(wealthDelta)} ce mois`;
        } else {
          trendNode.classList.add("is-down");
          trendNode.textContent = `↓ ${formatSignedCurrency(wealthDelta)} ce mois`;
        }
      }

      const budgetTarget = Math.max(
        0,
        toNumber(monthInfo?.monthlyContext?.monthlyTracking?.variableBudget || 0) ||
          toNumber(formData?.allocationPlan?.leisureMonthly || 0) ||
          getMonthlyExpenseTotal(formData?.expenses?.variable)
      );
      const variableSpent = Math.max(
        0,
        toNumber(
          monthInfo?.monthlyContext?.monthlyTracking?.variableSpent ||
            monthTransactions.reduce((sum, entry) => {
              if (entry?.type !== "expense") return sum;
              if (entry?.isFixed) return sum;
              return sum + Math.max(0, toNumber(entry?.amount));
            }, 0)
        )
      );
      const budgetRemaining = budgetTarget - variableSpent;
      const budgetRatio = budgetTarget > 0 ? variableSpent / budgetTarget : 0;

      setText(
        "[data-home-budget-ratio]",
        `${formatCurrency(variableSpent)} / ${formatCurrency(budgetTarget)}`
      );
      setText(
        "[data-home-budget-remaining]",
        budgetRemaining >= 0
          ? formatCurrency(budgetRemaining)
          : `-${formatCurrency(Math.abs(budgetRemaining))}`
      );
      setWidth(document.querySelector("[data-home-budget-progress]"), Math.round(budgetRatio * 100));

      const budgetMessage = document.querySelector("[data-home-budget-message]");
      if (budgetMessage) {
        budgetMessage.classList.remove("is-ok", "is-warn", "is-bad");
        if (budgetTarget <= 0) {
          budgetMessage.classList.add("is-warn");
          budgetMessage.textContent = "Definis ton budget variable pour suivre le mois.";
        } else if (budgetRatio <= 0.8) {
          budgetMessage.classList.add("is-ok");
          budgetMessage.textContent = "Tu es dans ton budget.";
        } else if (budgetRatio <= 1) {
          budgetMessage.classList.add("is-warn");
          budgetMessage.textContent = "Attention, tu approches de la limite.";
        } else {
          budgetMessage.classList.add("is-bad");
          budgetMessage.textContent = `Budget depasse de ${formatCurrency(Math.abs(budgetRemaining))}.`;
        }
      }

      const shortTermPlan = formData?.allocationPlan?.shortTerm || {};
      const shortTermName = String(
        shortTermPlan.name || data?.allocation?.shortTermAccount?.name || "Objectif CT"
      ).trim();
      const shortTermTarget = Math.max(0, toNumber(shortTermPlan.amount || 0));
      const matchingGoal = ensureArray(formData?.goals).find((goal) => {
        const goalName = String(goal?.name || goal?.label || goal?.title || "").trim().toLowerCase();
        return goalName && goalName === shortTermName.toLowerCase();
      });
      const shortTermCurrent = Math.max(
        0,
        toNumber(liveBalances.projects) ||
          toNumber(matchingGoal?.saved || matchingGoal?.current || matchingGoal?.balance || 0)
      );
      const shortTermProgress = shortTermTarget > 0 ? Math.round((shortTermCurrent / shortTermTarget) * 100) : 0;
      setText("[data-home-goal-ct-name]", shortTermName || "Objectif CT");
      setText(
        "[data-home-goal-ct-progress]",
        `${Math.max(0, shortTermProgress)}% • ${formatCurrency(shortTermCurrent)} / ${formatCurrency(shortTermTarget)}`
      );
      setWidth(document.querySelector("[data-home-goal-ct-bar]"), shortTermProgress);

      const longTermPlan = formData?.allocationPlan?.longTerm || {};
      const longTermDiagnostic = data?.allocation?.longTermDiagnostic || {};
      const longTermType = String(
        longTermPlan.type || longTermDiagnostic.type || "security"
      ).toLowerCase();
      const resolveLtFundingMonthly = () => {
        const alloc = allocations || {};
        if (longTermType === "security") return Math.max(0, toNumber(alloc.securite || 0));
        if (longTermType === "home" || longTermType === "children") {
          return Math.max(0, toNumber(alloc.projetsLongTerme || alloc.projets || 0));
        }
        if (longTermType === "invest") return Math.max(0, toNumber(alloc.investissements || 0));
        if (longTermType === "retirement") {
          return (
            Math.max(0, toNumber(alloc.investissements || 0)) +
            Math.max(0, toNumber(alloc.pilier3a || 0))
          );
        }
        return (
          Math.max(0, toNumber(alloc.investissements || 0)) +
          Math.max(0, toNumber(alloc.projetsLongTerme || alloc.projets || 0))
        );
      };
      const ltFundingMonthly = resolveLtFundingMonthly();
      const ltTarget = Math.max(0, toNumber(longTermPlan.amount || longTermPlan.target || 0));
      const ltHorizon = Math.max(3, Math.round(toNumber(longTermPlan.horizonYears || 10)));
      const ltNeedMonthly = ltTarget > 0 ? ltTarget / (ltHorizon * 12) : 0;
      const longTermTypeLabels = {
        security: "Epargne de precaution",
        home: "Maison",
        invest: "Investissement long terme",
        children: "Epargne enfants",
        retirement: "Retraite",
      };
      const longTermName = longTermTypeLabels[longTermType] || "Objectif LT";
      setText("[data-home-goal-lt-name]", longTermName);
      const diagnosticNode = document.querySelector("[data-home-goal-lt-diagnostic]");
      if (diagnosticNode) {
        diagnosticNode.classList.remove("is-good", "is-warn", "is-bad");
        const hasLongTermTarget = ltTarget > 0 && Boolean(longTermPlan.enabled);
        if (!hasLongTermTarget) {
          diagnosticNode.textContent = "Aucun objectif LT actif.";
          diagnosticNode.classList.add("is-warn");
        } else {
          const ratio = ltNeedMonthly > 0 ? ltFundingMonthly / ltNeedMonthly : 0;
          diagnosticNode.textContent = `Besoin ${formatCurrency(ltNeedMonthly)}/mois · financement ${formatCurrency(
            ltFundingMonthly
          )}/mois`;
          if (ratio >= 1) {
            diagnosticNode.classList.add("is-good");
          } else if (ratio >= 0.75) {
            diagnosticNode.classList.add("is-warn");
          } else {
            diagnosticNode.classList.add("is-bad");
          }
        }
      }

      const customOnlyBalances = applyTransactionsToBalances(
        normalizeBalances({ current: 0, security: 0, tax: 0, investments: 0, pillar3a: 0, projects: 0 }),
        allTransactions
      );
      const shortTermAccountLive = data?.allocation?.shortTermAccount || {};
      const shortTermBalance = Math.max(
        0,
        toNumber(
          customOnlyBalances.extras?.[shortTermAccountLive.name] ||
            customOnlyBalances.extras?.[shortTermAccountLive.label] ||
            0
        )
      );
      const accountRows = [
        { label: "Courant", amount: liveBalances.current },
        { label: "Epargne", amount: liveBalances.security },
        { label: "Provision impots", amount: liveBalances.tax },
        { label: shortTermAccountLive.name || "Objectif CT", amount: liveBalances.projects },
        { label: "3e pilier", amount: liveBalances.pillar3a },
        { label: "Investissements", amount: liveBalances.investments },
      ];
      if (toNumber(liveBalances.projects) <= 0.5 && (shortTermBalance > 0.5 || Math.max(0, toNumber(shortTermAccountLive.amount)) > 0)) {
        accountRows.push({
          label: `${shortTermAccountLive.name || "Objectif CT"} (legacy)`,
          amount: shortTermBalance,
        });
      }
      const accountsNode = document.querySelector("[data-home-accounts-list]");
      if (accountsNode) {
        accountsNode.innerHTML = accountRows
          .map(
            (entry) =>
              `<li><span>${entry.label}</span><strong>${formatCurrency(Math.max(0, toNumber(entry.amount)))}</strong></li>`
          )
          .join("");
      }
      return;
    }

    const list = document.querySelector("[data-actions-list]");
    if (!list) return;

    const monthInfo = activeUser ? getActiveMonthEntry(activeUser, formData, data, loadTransactions(activeUser)) : null;
    const activeMonthKey = monthInfo?.activeKey || getMonthKey(new Date());
    const monthStatus = monthInfo?.month?.status || "active";

    const monthNode = document.querySelector("[data-actions-month]");
    if (monthNode) {
      const monthDate = parseMonthKey(activeMonthKey) || new Date();
      monthNode.textContent = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(
        monthDate
      );
    }

    const allocations =
      monthInfo?.monthlyContext?.monthlyPlan?.allocationResultSnapshot?.allocations ||
      data.allocation?.allocations ||
      {};
    const shortTermAccount = data.allocation?.shortTermAccount || data.allocation?.debug?.shortTermAccount || null;
    const longTermKey = "projetsLongTerme";
    const shortTermKey = String(shortTermAccount?.key || "projetsCourtTerme").trim();
    const shortTermLabel = shortTermAccount?.label || `Compte ${shortTermAccount?.name || "court terme"}`;
    const monthTransactions = getMonthTransactions(loadTransactions(activeUser), activeMonthKey);
    const balances = normalizeBalances(resolveBalances(formData || {}));
    const goals = resolveGoals(formData || {});
    const debug = data.allocation?.debug || {};
    const taxInfo = data.taxProvision || {};

    const currentTarget = Math.max(0, toNumber(debug.currentTarget || 0));
    const securityTarget = Math.max(0, toNumber(debug.savingsTargets?.targetAmount || 0));
    const taxTarget = Math.max(
      0,
      toNumber(taxInfo.remaining || taxInfo.outstanding || taxInfo.totalTax || 0)
    );

    const securityGap = Math.max(0, securityTarget - balances.security);
    const goalGap = Math.max(0, goals.totalTarget - goals.totalSaved);
    const taxGap = Math.max(0, taxTarget - balances.tax);
    const currentExcess = currentTarget > 0 ? Math.max(0, balances.current - currentTarget) : 0;
    const securityExcess = securityTarget > 0 ? Math.max(0, balances.security - securityTarget) : 0;
    const currentGap = Math.max(0, currentTarget - balances.current);

    const ACCOUNT_LABELS = {
      compteCourant: "Compte courant",
      securite: "Compte épargne",
      [longTermKey]: "Compte long terme",
      [shortTermKey]: shortTermLabel,
      investissements: "Investissements",
      pilier3a: "3e pilier",
      impots: "Provision impôts",
    };

    const getAccountLabel = (key) => ACCOUNT_LABELS[key] || key;
    const MON_ARGENT_ACCOUNT_MAP = {
      compteCourant: "current",
      securite: "security",
      impots: "tax",
      investissements: "investments",
      pilier3a: "pillar3a",
      [longTermKey]: "projects",
      [shortTermKey]: "projects",
      current: "current",
      security: "security",
      tax: "tax",
      investments: "investments",
      pillar3a: "pillar3a",
      projects: "projects",
    };
    const toMonArgentAccountKey = (key, fallback = "current") =>
      MON_ARGENT_ACCOUNT_MAP[String(key || "").trim()] || fallback;

    const formatDay = (day) => {
      const now = new Date();
      const date = new Date(now.getFullYear(), now.getMonth(), day);
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    };

    const actions = [];
    const addAction = (entry) => {
      if (!entry) return;
      actions.push(entry);
    };

    if (monthStatus === "closed") {
      list.innerHTML =
        '<li class="action-item action-item--empty">Ce mois est clôturé en lecture seule.</li>';
      setText("[data-actions-done]", 0);
      setText("[data-actions-total]", 0);
      setText("[data-actions-percent]", "0%");
      setWidth(document.querySelector("[data-actions-progress]"), 0);
      setText("[data-actions-progress-note]", "Passe au mois actif pour exécuter les actions.");
      return;
    }

    // 1) Transferts liés à l'allocation SmartSave mensuelle
    const allocationTransfers = [
      { key: "securite", from: "compteCourant", to: "securite" },
      { key: longTermKey, from: "compteCourant", to: longTermKey },
      { key: shortTermKey, from: "compteCourant", to: shortTermKey },
      { key: "impots", from: "compteCourant", to: "impots" },
      { key: "investissements", from: "compteCourant", to: "investissements" },
      { key: "pilier3a", from: "compteCourant", to: "pilier3a" },
    ];
    if (!Object.prototype.hasOwnProperty.call(allocations, longTermKey) && toNumber(allocations.projets) > 0) {
      allocationTransfers.push({ key: "projets", from: "compteCourant", to: longTermKey });
    }
    allocationTransfers.forEach((transfer) => {
      if (!transfer.from || !transfer.to || transfer.from === transfer.to) return;
      const amount = Math.max(0, toNumber(allocations[transfer.key] || 0));
      if (amount <= 0) return;
      const fromLabel = getAccountLabel(transfer.from);
      const toLabel = getAccountLabel(transfer.to);
      addAction({
        key: `action-transfer-allocation-${transfer.key}`,
        title: `Transfert de ${formatCurrency(amount)} du compte ${getAccountLabel(
          transfer.from
        )} vers le compte ${getAccountLabel(transfer.to)}`,
        description: "allocation SmartSave mensuelle",
        kind: "smartsave-transfer",
        fromLabel,
        toLabel,
        fromKey: transfer.from,
        toKey: transfer.to,
        amount,
        dateLabel: formatDay(2),
        recommended: true,
      });
    });

    // 1b) Sécurité: renflouer le compte courant s'il est sous la cible
    const safetyTopupCurrent = Math.min(currentGap, securityExcess);
    if (safetyTopupCurrent > 0) {
      addAction({
        key: "action-safety-topup-current",
        kind: "safety-transfer",
        transferLabel: "Sécurité compte courant",
        fromLabel: getAccountLabel("securite"),
        toLabel: getAccountLabel("compteCourant"),
        fromKey: "securite",
        toKey: "compteCourant",
        amount: safetyTopupCurrent,
        description: "renfort de sécurité du compte courant",
        dateLabel: formatDay(2),
        recommended: true,
      });
    }

    const buildOverflowDestinations = (totalAmount, candidates, fallbackKey = "investissements") => {
      let remaining = Math.max(0, toNumber(totalAmount));
      const destinations = [];
      candidates.forEach((candidate) => {
        if (remaining <= 0) return;
        const capacity = Math.max(0, toNumber(candidate.capacity));
        if (capacity <= 0) return;
        const value = Math.min(remaining, capacity);
        if (value <= 0) return;
        destinations.push({ key: candidate.key, amount: value });
        remaining -= value;
      });
      if (remaining > 0) {
        destinations.push({ key: fallbackKey, amount: remaining });
      }
      return destinations;
    };

    // 2) Dépassements de limites (compte courant / compte épargne)
    if (currentExcess > 0) {
      const destinations = buildOverflowDestinations(
        currentExcess,
        [
          { key: "securite", capacity: securityGap },
          { key: longTermKey, capacity: goalGap },
          { key: "impots", capacity: taxGap },
        ],
        "investissements"
      );
      addAction({
        key: "action-overflow-compte-courant",
        kind: "account-reduction",
        sourceKey: "compteCourant",
        sourceLabel: getAccountLabel("compteCourant"),
        destinations,
        title: `Réduire le compte ${getAccountLabel("compteCourant")} de ${formatCurrency(
          currentExcess
        )}`,
        description: "limite de compte dépassée",
        amount: currentExcess,
        dateLabel: formatDay(2),
        recommended: true,
      });
    }

    if (securityExcess > 0) {
      const securityExcessAfterSafety = Math.max(0, securityExcess - safetyTopupCurrent);
      if (securityExcessAfterSafety > 0) {
        const destinations = buildOverflowDestinations(
          securityExcessAfterSafety,
          [
            { key: longTermKey, capacity: goalGap },
            { key: "impots", capacity: taxGap },
          ],
          "investissements"
        );
        addAction({
          key: "action-overflow-compte-epargne",
          kind: "account-reduction",
          sourceKey: "securite",
          sourceLabel: getAccountLabel("securite"),
          destinations,
          title: `Réduire le compte ${getAccountLabel("securite")} de ${formatCurrency(
            securityExcessAfterSafety
          )}`,
          description: "limite de compte dépassée",
          amount: securityExcessAfterSafety,
          dateLabel: formatDay(2),
          recommended: true,
        });
      }
    }

    const actionsTrimmed = actions.filter((action) => action.amount > 0 || action.onlyIf);

    if (!actionsTrimmed.length) {
      list.innerHTML = '<li class="action-item action-item--empty">Aucun transfert recommandé pour ce mois.</li>';
      return;
    }

    const state = activeUser?.id ? getActionStateByMonth(activeUser.id, activeMonthKey) : {};
    list.innerHTML = actionsTrimmed
      .map((action) => {
        const done = Object.prototype.hasOwnProperty.call(state, action.key)
          ? Boolean(state[action.key])
          : Boolean(action.done);
        const amountText = action.amount ? formatCurrency(action.amount) : "";
        const transferRow =
          action.kind === "smartsave-transfer" || action.kind === "safety-transfer"
            ? `
              <div class="action-transfer-wrap">
                <strong class="action-transfer-label">${action.transferLabel || "Transfert SmartSave"}</strong>
                <div class="action-transfer-row">
                  <span class="action-transfer-route">${action.fromLabel || "Compte"} <span class="action-transfer-arrow">→</span> ${
                    action.toLabel || "Compte"
                  }</span>
                  <span class="action-transfer-amount">${amountText}</span>
                </div>
              </div>
            `
            : "";
        const reductionRows =
          action.kind === "account-reduction"
            ? ensureArray(action.destinations)
                .filter((entry) => toNumber(entry.amount) > 0)
                .map(
                  (entry) => `
                    <div class="action-reduction-destination">
                      <span class="action-reduction-destination-name">${getAccountLabel(entry.key)}</span>
                      <span class="action-reduction-destination-amount">${formatCurrency(entry.amount)}</span>
                    </div>
                  `
                )
                .join("")
            : "";
        const reductionRow =
          action.kind === "account-reduction"
            ? `
              <div class="action-reduction-wrap">
                <strong class="action-transfer-label">Réduction de compte</strong>
                <div class="action-reduction-row">
                  <span class="action-reduction-text">Réduire ${action.sourceLabel || "ce compte"} de</span>
                  <span class="action-reduction-amount">${amountText}</span>
                </div>
                <div class="action-reduction-plan">
                  <div class="action-reduction-destinations">${reductionRows}</div>
                </div>
              </div>
            `
            : "";
        const actionBody =
          action.kind === "smartsave-transfer" || action.kind === "safety-transfer"
            ? transferRow
            : action.kind === "account-reduction"
            ? reductionRow
            : `<div class="action-title-row">
                <span class="action-title">${action.title}</span>
                ${amountText ? `<span class="action-amount">${amountText}</span>` : ""}
              </div>`;
        return `
          <li class="action-item${done ? " action-item--done" : ""}${action.recommended ? " action-item--recommended" : ""}" data-action-key="${action.key}">
            <label class="action-checkbox">
              <input type="checkbox" ${done ? "checked" : ""}>
              <span class="action-check"></span>
            </label>
            <div class="action-info">
              ${actionBody}
              ${action.description ? `<small>${action.description}</small>` : ""}
              <div class="action-meta">
                ${action.recommended ? '<span class="action-tag">Recommended</span>' : ""}
                ${action.dateLabel ? `<span class="action-date">${action.dateLabel}</span>` : ""}
                ${
                  action.recommended
                    ? '<button class="action-cta" type="button">Do it now →</button>'
                    : ""
                }
              </div>
            </div>
          </li>
        `;
      })
      .join("");
    list.__actionsTrimmed = actionsTrimmed;

    const updateProgress = () => {
      const total = actionsTrimmed.length;
      const done = actionsTrimmed.filter((action) =>
        Object.prototype.hasOwnProperty.call(state, action.key)
          ? Boolean(state[action.key])
          : Boolean(action.done)
      ).length;
      const percent = total ? Math.round((done / total) * 100) : 0;
      setText("[data-actions-done]", done);
      setText("[data-actions-total]", total);
      setText("[data-actions-percent]", `${percent}%`);
      setWidth(document.querySelector("[data-actions-progress]"), percent);
      const status = document.querySelector("[data-actions-status]");
      const progressNote = document.querySelector("[data-actions-progress-note]");
      if (status) {
        if (percent >= 60) {
          status.textContent = `You've completed ${done} actions this month. Just ${
            total - done
          } more to reach your financial goals.`;
        } else {
          status.textContent = `You've completed ${done} actions this month. ${
            total - done
          } to go to reach your goals.`;
        }
      }
      if (progressNote) {
        progressNote.textContent = percent >= 60 ? "Great progress! Keep it up!" : "Keep going!";
      }
    };

    updateProgress();

    if (!list.dataset.actionsListener) {
      list.addEventListener("change", (event) => {
        const checkbox = event.target.closest("input[type='checkbox']");
        if (!checkbox) return;
        const item = checkbox.closest("[data-action-key]");
        if (!item) return;
        const key = item.dataset.actionKey;
        if (!key) return;
        if (checkbox.checked) {
          state[key] = true;
          item.classList.add("action-item--done");
        } else {
          state[key] = false;
          item.classList.remove("action-item--done");
        }
        if (activeUser?.id) {
          saveActionStateByMonth(activeUser.id, activeMonthKey, state);
        }
        updateProgress();
      });
      list.dataset.actionsListener = "true";
    }

    if (!list.dataset.actionsCtaListener) {
      list.addEventListener("click", (event) => {
        const cta = event.target.closest(".action-cta");
        if (!cta) return;
        const item = cta.closest("[data-action-key]");
        if (!item) return;
        const key = String(item.dataset.actionKey || "").trim();
        if (!key) return;
        const sourceActions = Array.isArray(list.__actionsTrimmed) ? list.__actionsTrimmed : [];
        const action = sourceActions.find((entry) => String(entry?.key || "") === key);
        if (!action) return;

        let from = "";
        let to = "";
        let amount = Math.max(0, toNumber(action.amount));

        if (action.kind === "smartsave-transfer" || action.kind === "safety-transfer") {
          from = toMonArgentAccountKey(action.fromKey, "current");
          to = toMonArgentAccountKey(action.toKey, "security");
        } else if (action.kind === "account-reduction") {
          const firstDestination = ensureArray(action.destinations).find(
            (entry) => toNumber(entry?.amount) > 0
          );
          if (!firstDestination) return;
          from = toMonArgentAccountKey(action.sourceKey || "compteCourant", "current");
          to = toMonArgentAccountKey(firstDestination.key, "security");
          amount = Math.max(0, toNumber(firstDestination.amount));
        } else {
          return;
        }

        if (!from || !to || from === to || !amount) return;

        const payload = {
          source: "actions",
          type: "transfer",
          openTransferModal: true,
          targetTab: "comptes",
          transfer: { from, to, amount },
          createdAt: new Date().toISOString(),
        };
        try {
          localStorage.setItem(PENDING_MON_ARGENT_ACTION_KEY, JSON.stringify(payload));
        } catch (_error) {
          // ignore storage issues
        }
        window.location.href = "mon-argent.html?tab=comptes";
      });
      list.dataset.actionsCtaListener = "true";
    }
  };

  const renderFuture = (data, formData, years = futureRangeYears) => {
    const assumptionSmart = document.querySelector("[data-projection-assumption-smart]");
    if (!assumptionSmart) return;

    const projection = resolveProjectionForApp({
      data,
      formData,
      months: Math.max(1, Math.round(toNumber(years || 10) * 12)),
    });
    const current = projection.current || {};
    const smart = projection.smartSave || {};
    const currentHistory = Array.isArray(current.history) ? current.history : [];
    const smartHistory = Array.isArray(smart.history) ? smart.history : [];
    const targetYears = years || 10;
    const targetIndex = Math.max(
      0,
      Math.min(
        smartHistory.length - 1,
        targetYears * 12 - 1
      )
    );

    const sumAccounts = (accounts = {}) =>
      toNumber(accounts.current) +
      toNumber(accounts.savings) +
      toNumber(accounts.blocked) +
      toNumber(accounts.pillar3) +
      toNumber(accounts.investments);

    const balances = resolveBalances(formData || {});
    const currentNetWorth =
      Math.max(0, balances.current) +
      Math.max(0, balances.security) +
      Math.max(0, balances.tax) +
      Math.max(0, balances.investments) +
      Math.max(0, balances.pillar3a);

    const currentAtTarget = currentHistory.length
      ? sumAccounts(currentHistory[targetIndex]?.accounts || {})
      : current.netWorth || 0;
    const smartAtTarget = smartHistory.length
      ? sumAccounts(smartHistory[targetIndex]?.accounts || {})
      : smart.netWorth || 0;

    const smartInterest = smart.interestEarned || {};
    const totalInterest = Object.values(smartInterest).reduce(
      (sum, value) => sum + (Number.isFinite(value) ? value : 0),
      0
    );
    const gain = smartAtTarget - currentNetWorth;
    const formatCompactSigned = (value) => {
      const formatted = formatCurrency(Math.abs(value));
      return value < 0 ? `-${formatted}` : `+${formatted}`;
    };

    const sumContrib = (contrib = {}) =>
      Object.values(contrib).reduce((sum, value) => sum + Math.max(0, toNumber(value)), 0);
    const months = Math.max(1, smartHistory.length || targetYears * 12);
    const smartMonthly = sumContrib(smart.contributions) / months;
    const currentMonthly = sumContrib(current.contributions) / months;

    const assumptionCurrent = document.querySelector("[data-projection-assumption-current]");
    if (assumptionCurrent) {
      assumptionCurrent.textContent = `Solde actuel: 3% average return, ${formatCurrency(currentMonthly)}/month savings`;
    }
    assumptionSmart.textContent = `SmartSave: 6.5% average return, ${formatCurrency(smartMonthly)}/month savings`;

    const yearLabel = new Date().getFullYear() + targetYears;
    document.querySelectorAll("[data-future-year]").forEach((node) => {
      node.textContent = String(yearLabel);
    });

    setText("[data-future-current-total]", formatCurrency(currentNetWorth));
    setText("[data-future-smart-total]", formatCurrency(smartAtTarget));
    setText("[data-future-compound]", formatCompactSigned(totalInterest));
    setText("[data-future-gain]", formatCompactSigned(gain));

    const impactNote = document.querySelector("[data-future-impact-note]");
    if (impactNote) {
      const percent = currentNetWorth > 0 ? Math.round((gain / currentNetWorth) * 100) : 0;
      impactNote.textContent = `That's ${percent}% more wealth in ${targetYears} years by following the SmartSave system.`;
    }

    const buildSeries = window.buildProjectionSeries;
    const renderChart = window.renderProjectionChart;
    if (typeof buildSeries === "function" && typeof renderChart === "function") {
      renderChart(buildSeries(currentHistory), buildSeries(smartHistory));
    }
  };

  const renderScore = (data, formData) => {
    const goalsRoot = document.querySelector("[data-goals-root]");
    if (!goalsRoot) return;

    const resolveTaxEngineTotal = () => {
      const engine = window.TaxEngine || window.SmartSaveTaxEngine;
      if (!engine || typeof engine.calculateAnnualTax !== "function") return 0;
      try {
        const taxData = engine.calculateAnnualTax(formData || {});
        return Math.max(0, toNumber(taxData?.total || 0));
      } catch (_error) {
        return 0;
      }
    };

    const escapeHtml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const toAllocObject = (source) => {
      if (!source || typeof source !== "object") return null;
      if (source.allocations && typeof source.allocations === "object") return source.allocations;
      return source;
    };

    const toDateValue = (raw) => {
      if (!raw) return null;
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      if (typeof raw !== "string") return null;
      const value = raw.trim();
      if (!value) return null;
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
        const [day, month, year] = value.split(".").map((part) => Number(part));
        const parsed = new Date(year, month - 1, day);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatDate = (raw) => {
      const parsed = toDateValue(raw);
      if (!parsed) return "";
      return new Intl.DateTimeFormat("fr-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
        .format(parsed)
        .replace(/\//g, ".");
    };

    const monthId = lastMonthlyContext?.monthId || getMonthKey(new Date());
    const monthDate = parseMonthKey(monthId) || new Date();
    const monthlyPlan =
      lastMonthlyContext?.allMonthlyPlan?.[monthId] ||
      lastMonthlyContext?.monthlyPlan ||
      null;
    const planFlags = monthlyPlan?.flags || {};
    const isPlanValidated =
      Boolean(planFlags.planAppliedAt) ||
      Boolean(planFlags.monthlyPlanApplied) ||
      String(planFlags.monthStatus || "") === "closed";

    const allocationSnapshot =
      monthlyPlan?.allocation ||
      monthlyPlan?.allocationResultSnapshot ||
      lastMonthlyContext?.monthlyPlan?.allocation ||
      lastMonthlyContext?.monthlyPlan?.allocationResultSnapshot ||
      null;
    let allocations = toAllocObject(allocationSnapshot) || toAllocObject(data?.allocation) || {};

    if (!Object.keys(allocations).length) {
      const allocationEngine = window.AllocationEngine;
      if (allocationEngine && typeof allocationEngine.calculateAllocation === "function") {
        const fallback = allocationEngine.calculateAllocation(formData || {});
        allocations = toAllocObject(fallback) || {};
      }
    }

    const shortTermTypeLabels = {
      vacances: "Vacances",
      cadeaux: "Cadeaux",
      voiture: "Voiture",
      mariage: "Mariage",
      autre: "Projet court terme",
    };
    const longTermTypeLabels = {
      security: "Épargne sécurité",
      home: "Achat immobilier",
      invest: "Investissement long terme",
      children: "Épargne pour enfants",
      retirement: "Retraite",
    };
    const categoryLabels = {
      projects: "Projets",
      safety: "Sécurité",
      growth: "Croissance",
    };
    const statusClassMap = {
      ahead: "is-ahead",
      ontrack: "is-ontrack",
      late: "is-late",
      done: "is-done",
    };

    const balances = resolveBalances(formData || {});
    const shortTermAccount =
      allocationSnapshot?.shortTermAccount ||
      data?.allocation?.shortTermAccount ||
      data?.allocation?.debug?.shortTermAccount ||
      null;
    const shortTermAmount = Math.max(
      0,
      toNumber(shortTermAccount?.amount || allocations.projetsCourtTerme || 0)
    );
    const allocLongTerm = Math.max(
      0,
      toNumber(allocations.projetsLongTerme || allocations.projets || 0)
    );
    const allocSafety = Math.max(0, toNumber(allocations.securite || 0));
    const allocInvest =
      Math.max(0, toNumber(allocations.investissements || 0)) +
      Math.max(0, toNumber(allocations.pilier3a || 0));
    const allocTaxPlan = getEffectiveTaxPlanAmount({
      monthlyPlan,
      fallbackAllocationTax: allocations.impots || 0,
    });
    const resolveTaxAllocationLikeSmartSave = () => {
      try {
        const activeUserForPreview = window.loadActiveUser?.() || null;
        const monthContext = lastMonthlyContext || {};
        const settingsContext = resolveEffectiveMonthSettings(monthContext);
        const smartSaveSettings = settingsContext.smartSaveSettings || {};
        const advancedSettings = settingsContext.advancedSettings || {};
        const userSettings = settingsContext.userSettings || {};
        const monthInputs = monthlyPlan?.inputsSnapshot || {};

        const store = getMonthlyStore();
        const budget =
          store && typeof store.getMonthlyBudgetForMonth === "function"
            ? store.getMonthlyBudgetForMonth({ userId: activeUserForPreview?.id, monthId, formData }) || {}
            : {};
        const totalIncome = Math.max(0, toNumber(budget.totalIncome));
        const totalExpenses =
          Math.max(0, toNumber(budget.fixedTotal)) +
          Math.max(0, toNumber(budget.mandatoryTotal)) +
          Math.max(0, toNumber(budget.variablePlanned));
        const remaining =
          budget.remaining != null ? toNumber(budget.remaining) : Math.max(0, totalIncome - totalExpenses);
        const surplus = Math.max(0, remaining);
        const allocationEnvelope = Math.max(
          0,
          roundMoney(
            toNumber(
              data?.allocation?.disponibleInitial != null ? data.allocation.disponibleInitial : surplus
            )
          )
        );

        const liveBalances = getLiveAccountBalances(activeUserForPreview, formData);
        const mandatoryMonthlyNeed = Math.max(0, toNumber(monthInputs.mandatoryTotal || 0));
        const fixedMandatoryMonthlyNeed = Math.max(
          0,
          toNumber(monthInputs.fixedTotal || 0) + toNumber(monthInputs.mandatoryTotal || 0)
        );
        const debugCurrentLimit = Math.max(0, toNumber(data?.allocation?.debug?.currentTarget || 0));
        const settingsCurrentLimit = Math.max(
          0,
          roundMoney(
            mandatoryMonthlyNeed * Math.max(1, toNumber(smartSaveSettings?.limits?.minCurrentMonths || 1))
          )
        );
        const currentLimit = Math.max(
          0,
          roundMoney(debugCurrentLimit > 0 ? debugCurrentLimit : settingsCurrentLimit)
        );
        const pillarAnnualRoom = computeThirdPillarRoomForRebalance(
          formData,
          monthInputs,
          liveBalances,
          monthId
        );

        const taxPreview = {
          mode: String(monthlyPlan?.taxMode || userSettings?.taxMode || "AUTO_PROVISION").toUpperCase(),
          onboardingChoice: String(monthlyPlan?.taxOnboardingChoice || ""),
          taxMonthlyTarget: Math.max(0, toNumber(monthlyPlan?.taxMonthlyTarget || 0)),
          taxMonthlyActual: Math.max(0, toNumber(monthlyPlan?.taxMonthlyActual || allocTaxPlan || 0)),
          taxTopUpFromSurplus: Math.max(0, toNumber(monthlyPlan?.taxTopUpFromSurplus || 0)),
          taxShortfallThisMonth: Math.max(0, toNumber(monthlyPlan?.taxShortfallThisMonth || 0)),
        };

        const previewEntries = buildMonthlyApplyEntries({
          activeUser: activeUserForPreview,
          monthId,
          monthContext: monthContext || null,
          mvpData: data,
        });
        const previewPlan = computeMonthlyAllocationTransfers({
          entries: previewEntries,
          taxMonthly: taxPreview,
          availableSurplus: allocationEnvelope,
          currentLimit,
          currentBalance: Math.max(0, toNumber(liveBalances.current || 0)),
          pillarAnnualRoom,
          smartSaveSettings,
          advancedSettings,
          allocationSnapshot: data?.allocation || allocationSnapshot || null,
        });

        const breakdownTax = Math.max(0, toNumber(previewPlan?.breakdown?.impots || 0));
        return breakdownTax;
      } catch (_error) {
        return Math.max(0, toNumber(allocTaxPlan || 0));
      }
    };
    const allocTax = resolveTaxAllocationLikeSmartSave();
    const totalMonthlyContribution = Math.max(0, shortTermAmount + allocLongTerm + allocSafety + allocInvest + allocTax);

    const surplusNoteNode = goalsRoot.querySelector("[data-goals-surplus-note]");
    if (surplusNoteNode) surplusNoteNode.hidden = totalMonthlyContribution > 0;

    const monthPlans = lastMonthlyContext?.allMonthlyPlan || {};
    const monthIds = Object.keys(monthPlans).sort((a, b) => a.localeCompare(b));
    const isAppliedPlan = (plan) => {
      const flags = plan?.flags || {};
      return (
        Boolean(flags.planAppliedAt) ||
        Boolean(flags.monthlyPlanApplied) ||
        String(flags.monthStatus || "") === "closed"
      );
    };
    const historyByAllocationKeys = (keys = [], limit = 6) =>
      monthIds
        .map((entryMonthId) => {
          const plan = monthPlans[entryMonthId];
          if (!isAppliedPlan(plan)) return null;
          const snap = plan?.allocationResultSnapshot || plan?.allocation || {};
          const alloc = toAllocObject(snap) || {};
          const amount = keys.reduce((sum, key) => sum + Math.max(0, toNumber(alloc[key] || 0)), 0);
          return amount > 0 ? { monthId: entryMonthId, amount } : null;
        })
        .filter(Boolean)
        .slice(limit > 0 ? -limit : undefined);

    const historyByGoalName = (name, limit = 6) => {
      const needle = normalizeLabel(name);
      if (!needle) return [];
      return monthIds
        .map((entryMonthId) => {
          const plan = monthPlans[entryMonthId];
          if (!isAppliedPlan(plan)) return null;
          const entries = Array.isArray(plan?.allocationResultSnapshot?.objectifsFinances)
            ? plan.allocationResultSnapshot.objectifsFinances
            : [];
          const found = entries.find(
            (entry) => normalizeLabel(entry?.name || entry?.label || "") === needle
          );
          const amount = Math.max(0, toNumber(found?.allocated || found?.amount || 0));
          return amount > 0 ? { monthId: entryMonthId, amount } : null;
        })
        .filter(Boolean)
        .slice(limit > 0 ? -limit : undefined);
    };

    const resolveGoalList = (profile = {}) => {
      const source = Array.isArray(profile.goalTargets)
        ? profile.goalTargets
        : Array.isArray(profile.goals)
        ? profile.goals
        : [];
      return source
        .map((goal, index) => {
          const id = String(goal?.id || `goal-${index + 1}`);
          const name = String(goal?.name || goal?.title || goal?.label || "Objectif").trim();
          const target = Math.max(0, toNumber(goal?.target || goal?.amount || 0));
          const current = Math.max(
            0,
            toNumber(goal?.current || goal?.saved || goal?.balance || goal?.achieved || 0)
          );
          const rawType = String(goal?.type || goal?.category || "projet").toLowerCase();
          const type =
            rawType === "securite" || rawType === "croissance" || rawType === "projet"
              ? rawType
              : "projet";
          return {
            ...goal,
            id,
            name,
            target,
            current,
            type,
            priority: Math.max(0, Math.round(toNumber(goal?.priority || 0))),
            horizonMonths: Math.max(0, Math.round(toNumber(goal?.horizonMonths || 0))),
            why: String(goal?.why || goal?.reason || "Objectif personnel").trim(),
            archivedAt: goal?.archivedAt || null,
            createdAt: goal?.createdAt || null,
          };
        })
        .filter((goal) => goal.name && goal.target > 0 && !String(goal.id).startsWith("builtin:"));
    };

    const addMonths = (baseDate, months) => {
      const source = baseDate instanceof Date ? new Date(baseDate) : new Date();
      return new Date(source.getFullYear(), source.getMonth() + Math.max(1, months), 0);
    };

    const resolveGoalDeadline = (goal) => {
      const direct =
        formatDate(goal?.deadline) ||
        formatDate(goal?.date) ||
        formatDate(goal?.targetDate) ||
        formatDate(goal?.dueDate);
      if (direct) return direct;
      if (toNumber(goal?.horizonMonths) > 0) return formatDate(addMonths(monthDate, goal.horizonMonths));
      return "";
    };

    const shouldPayTaxes = () => {
      const raw = formData?.taxes?.paysTaxes ?? formData?.paysTaxes;
      if (raw == null) return true;
      const normalized = String(raw).trim().toLowerCase();
      if (!normalized) return true;
      return !["non", "false", "0", "no", "off"].includes(normalized);
    };

    const resolveNextTaxDeadline = (baseDate) => {
      const from = baseDate instanceof Date ? new Date(baseDate) : new Date();
      // Fiscal deadline policy: nearest upcoming 30.03.
      const thisYearDeadline = new Date(from.getFullYear(), 2, 30);
      const thisYearDeadlineEnd = new Date(from.getFullYear(), 2, 30, 23, 59, 59, 999);
      return from.getTime() <= thisYearDeadlineEnd.getTime()
        ? thisYearDeadline
        : new Date(from.getFullYear() + 1, 2, 30);
    };
    const monthsUntilNextTaxDeadline = (baseDate, deadlineDate) => {
      const from = baseDate instanceof Date ? new Date(baseDate) : new Date();
      const deadline =
        deadlineDate instanceof Date && !Number.isNaN(deadlineDate.getTime())
          ? new Date(deadlineDate)
          : resolveNextTaxDeadline(from);
      const raw = (deadline.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      return Math.max(1, Math.ceil(raw));
    };

    const computeGoalState = (goal) => {
      const target = Math.max(0, toNumber(goal?.target || 0));
      const current = Math.max(0, toNumber(goal?.current || 0));
      const monthlyContribution = Math.max(0, toNumber(goal?.monthlyContribution || 0));
      const reached = target > 0 && current >= target;
      const remain = Math.max(0, target - current);
      const percent = target > 0 ? Math.round(Math.min(1, current / target) * 100) : 0;
      const horizonMonths = Math.max(0, Math.round(toNumber(goal?.horizonMonths || 0)));
      const etaMonths = !reached && monthlyContribution > 0 ? Math.ceil(remain / monthlyContribution) : null;
      return { target, current, monthlyContribution, reached, remain, percent, horizonMonths, etaMonths };
    };

    const resolveStandardStatus = (state) => {
      if (state.reached) return { key: "done", label: "Terminé" };
      if (state.monthlyContribution <= 0) return { key: "late", label: "En retard" };
      if (state.horizonMonths > 0 && state.etaMonths != null) {
        if (state.etaMonths <= state.horizonMonths * 0.85) return { key: "ahead", label: "En avance" };
        if (state.etaMonths <= state.horizonMonths * 1.1) {
          return { key: "ontrack", label: "Sur la bonne trajectoire" };
        }
        return { key: "late", label: "En retard" };
      }
      const ratio = state.target > 0 ? state.current / state.target : 0;
      if (ratio >= 0.7) return { key: "ahead", label: "En avance" };
      if (ratio >= 0.35) return { key: "ontrack", label: "Sur la bonne trajectoire" };
      return { key: "late", label: "En retard" };
    };

    const sections = { projects: [], safety: [], growth: [] };
    const sectionStats = {
      projects: { count: 0, monthly: 0 },
      safety: { count: 0, monthly: 0 },
      growth: { count: 0, monthly: 0 },
    };
    const detailMap = {};
    const summary = { ahead: 0, ontrack: 0, late: 0 };
    let activeGoalsCount = 0;
    let growthStandardCount = 0;
    const completed = [];
    const completedKeys = new Set();
    const expandedMap =
      goalsRoot.__goalsExpanded && typeof goalsRoot.__goalsExpanded === "object"
        ? goalsRoot.__goalsExpanded
        : {};
    goalsRoot.__goalsExpanded = expandedMap;

    const pushCompleted = (goal, rawDate) => {
      const key = `${goal?.id || ""}:${goal?.name || ""}`;
      if (completedKeys.has(key)) return;
      completedKeys.add(key);
      completed.push({
        id: String(goal?.id || key),
        name: String(goal?.name || "Objectif"),
        dateLabel: formatDate(rawDate) || formatDate(new Date()),
        timestamp: toDateValue(rawDate)?.getTime?.() || Date.now(),
      });
    };

    const pushCard = (sectionKey, card) => {
      if (!card || !sections[sectionKey]) return;
      sections[sectionKey].push(card.html);
      if (sectionStats[sectionKey]) {
        sectionStats[sectionKey].count += 1;
        sectionStats[sectionKey].monthly += Math.max(0, toNumber(card.monthlyValue || 0));
      }
      if (card.summaryKey && summary[card.summaryKey] != null) {
        summary[card.summaryKey] += 1;
        activeGoalsCount += 1;
      }
      if (card.detail?.id) {
        detailMap[card.detail.id] = card.detail;
      }
    };

    const buildStandardCard = (goal, categoryKey) => {
      if (!goal?.active) return null;
      const state = computeGoalState(goal);
      const status = resolveStandardStatus(state);
      if (status.key === "done") {
        pushCompleted(goal, goal?.archivedAt || goal?.completedAt || new Date());
        return null;
      }

      const deadlineLabel = resolveGoalDeadline(goal);
      const nextLine = deadlineLabel
        ? `Échéance : ${deadlineLabel}`
        : state.etaMonths != null
        ? `À ce rythme : ~${state.etaMonths} mois`
        : `Reste : ${formatCurrency(state.remain)}`;
      const isPaused = state.monthlyContribution <= 0;
      const cardClass = statusClassMap[status.key] || "is-ontrack";
      const html = `
        <button
          class="objectifs-goal-card ${cardClass}${isPaused ? " is-paused" : ""}"
          type="button"
          data-goal-open="${escapeHtml(goal.id)}"
        >
          <span class="objectifs-goal-card__head">
            <strong>${escapeHtml(goal.name)}</strong>
            <span class="objectifs-goal-card__badge">${escapeHtml(status.label)}</span>
          </span>
          <span class="objectifs-goal-card__ratio">${formatCurrency(state.current)} / ${formatCurrency(state.target)}</span>
          <span class="progress-track"><span class="progress-fill" style="width:${state.percent}%"></span></span>
          <span class="objectifs-goal-card__next">${escapeHtml(nextLine)}</span>
          ${isPaused ? '<span class="objectifs-goal-card__micro">Contribution en pause</span>' : ""}
        </button>
      `;

      return {
        html,
        summaryKey: status.key,
        monthlyValue: state.monthlyContribution,
        detail: {
          id: String(goal.id),
          title: goal.name,
          category: categoryLabels[categoryKey],
          ratioLabel: `${formatCurrency(state.current)} / ${formatCurrency(state.target)}`,
          progressPercent: state.percent,
          statusLabel: status.label,
          monthLabel: `+${formatCurrency(state.monthlyContribution)}`,
          remainingLabel: formatCurrency(state.remain),
          dateLabel: deadlineLabel,
          advice:
            "Si tu veux aller plus vite, baisse ton budget variable ou allonge l’échéance.",
          editHref: "profil.html",
        },
      };
    };

    const sumAccounts = (accounts = {}) =>
      toNumber(accounts.current) +
      toNumber(accounts.savings) +
      toNumber(accounts.blocked) +
      toNumber(accounts.pillar3) +
      toNumber(accounts.investments);

    const projection = resolveProjectionForApp({ data, formData, months: 240 });
    const smartHistory = ensureArray(projection?.smartSave?.history);
    const extractProjectedValue = (projectionData) => {
      const smart = projectionData?.smartSave || {};
      const history = Array.isArray(smart.history) ? smart.history : [];
      if (history.length) return sumAccounts(history[history.length - 1]?.accounts || {});
      return toNumber(smart.netWorth || 0);
    };
    const projected10y = smartHistory.length
      ? sumAccounts(smartHistory[Math.min(119, smartHistory.length - 1)]?.accounts || {})
      : extractProjectedValue(projection);
    const projected20y = smartHistory.length
      ? sumAccounts(smartHistory[Math.min(239, smartHistory.length - 1)]?.accounts || {})
      : extractProjectedValue(projection);

    const shortPlan = formData?.allocationPlan?.shortTerm || {};
    const shortGoal = {
      id: "builtin:short",
      active: Boolean(shortPlan?.enabled) || Math.max(0, toNumber(shortPlan?.amount || 0)) > 0,
      name:
        String(
          shortPlan?.name ||
            shortTermAccount?.name ||
            shortTermTypeLabels[shortPlan?.type] ||
            "Objectif projet"
        ).trim() || "Objectif projet",
      target: Math.max(0, toNumber(shortPlan?.amount || 0)),
      current: Math.max(0, toNumber(balances.projects || 0)),
      monthlyContribution: shortTermAmount,
      horizonMonths: Math.max(1, Math.round(toNumber(shortPlan?.horizonYears || 1) * 12)),
    };

    const longPlan = formData?.allocationPlan?.longTerm || {};
    const longType = String(longPlan?.type || "security").toLowerCase();
    const longCategory =
      longType === "security"
        ? "safety"
        : longType === "invest" || longType === "retirement"
        ? "growth"
        : "projects";
    const longCurrent = (() => {
      if (longType === "security") return Math.max(0, toNumber(balances.security || 0));
      if (longType === "invest") return Math.max(0, toNumber(balances.investments || 0));
      if (longType === "retirement") return Math.max(0, toNumber(balances.pillar3a || 0));
      return Math.max(0, toNumber(balances.projects || 0));
    })();
    const longGoal = {
      id: "builtin:long",
      active: Boolean(longPlan?.enabled) || Math.max(0, toNumber(longPlan?.amount || 0)) > 0,
      name:
        String(
          longPlan?.label || longPlan?.name || longTermTypeLabels[longType] || "Objectif long terme"
        ).trim() || "Objectif long terme",
      target: Math.max(0, toNumber(longPlan?.amount || 0)),
      current: longCurrent,
      monthlyContribution: allocLongTerm,
      horizonMonths: Math.max(1, Math.round(toNumber(longPlan?.horizonYears || 10) * 12)),
    };

    const taxInfo = data?.taxProvision || {};
    const taxFundingEstimate = Math.max(
      0,
      toNumber(
        allocationSnapshot?.debug?.taxFunding?.totalEstimate ||
          data?.allocation?.debug?.taxFunding?.totalEstimate ||
          0
      )
    );
    const taxCurrent = Math.max(
      0,
      toNumber(
        taxInfo?.currentProvision != null ? taxInfo.currentProvision : balances.tax || 0
      )
    );
    // "Ce mois-ci" on Objectifs must reflect the plan contribution, not a theoretical tax need.
    const taxMonthly = Math.max(0, toNumber(allocTax || 0));
    const taxTotalEstimate = Math.max(
      0,
      toNumber(taxFundingEstimate || taxInfo?.totalTax || resolveTaxEngineTotal() || 0)
    );
    const taxRemaining = Math.max(0, toNumber(taxInfo?.remaining || taxInfo?.outstanding || 0));
    const taxTarget = taxTotalEstimate > 0 ? taxTotalEstimate : taxCurrent + taxRemaining;
    const taxReferenceDate = new Date();
    const taxDeadlineDate = resolveNextTaxDeadline(taxReferenceDate);
    const taxHorizon = monthsUntilNextTaxDeadline(taxReferenceDate, taxDeadlineDate);
    const taxDeadline = formatDate(taxDeadlineDate);
    const taxEnabled = shouldPayTaxes() && (taxTarget > 0 || taxCurrent > 0 || taxMonthly > 0);

    if (taxEnabled) {
      const taxState = computeGoalState({
        target: taxTarget,
        current: taxCurrent,
        monthlyContribution: taxMonthly,
        horizonMonths: taxHorizon,
      });
      const underControl =
        taxState.reached ||
        (taxState.etaMonths != null && taxState.etaMonths <= taxState.horizonMonths);
      const statusLabel = underControl ? "Sous contrôle" : "À rattraper";
      const statusKey = underControl ? "ontrack" : "late";
      const html = `
        <button
          class="objectifs-goal-card objectifs-goal-card--tax ${statusClassMap[statusKey]}"
          type="button"
          data-goal-open="builtin:tax"
        >
          <span class="objectifs-goal-card__head">
            <strong>Impôts</strong>
            <span class="objectifs-goal-card__badge">${statusLabel}</span>
          </span>
          <span class="objectifs-goal-card__line">Estimé : ${formatCurrency(taxState.target)}</span>
          <span class="objectifs-goal-card__line">Provisionné : ${formatCurrency(taxState.current)}</span>
          <span class="progress-track"><span class="progress-fill" style="width:${taxState.percent}%"></span></span>
          <span class="objectifs-goal-card__next">Échéance : ${taxDeadline}</span>
          <span class="objectifs-goal-card__micro">
            SmartSave met de côté automatiquement pour éviter un choc fiscal.
          </span>
        </button>
      `;
      pushCard("safety", {
        html,
        summaryKey: statusKey,
        monthlyValue: taxState.monthlyContribution,
        detail: {
          id: "builtin:tax",
          title: "Impôts",
          category: categoryLabels.safety,
          ratioLabel: `${formatCurrency(taxState.current)} / ${formatCurrency(taxState.target)}`,
          progressPercent: taxState.percent,
          statusLabel,
          monthLabel: isPlanValidated
            ? `+${formatCurrency(taxState.monthlyContribution)}`
            : `Prévu ce mois-ci : +${formatCurrency(taxState.monthlyContribution)}`,
          remainingLabel: formatCurrency(taxState.remain),
          dateLabel: taxDeadline,
          advice:
            "Si tu veux aller plus vite, baisse ton budget variable ou allonge l’échéance.",
          editHref: "profil.html",
        },
      });
      if (taxState.reached) {
        pushCompleted({ id: "builtin:tax", name: "Impôts" }, new Date());
      }
    }

    const cardShort = buildStandardCard(shortGoal, "projects");
    pushCard("projects", cardShort);

    const cardLong = buildStandardCard(longGoal, longCategory);
    if (longCategory === "growth" && cardLong) growthStandardCount += 1;
    pushCard(longCategory, cardLong);

    const customGoals = resolveGoalList(formData || {});
    customGoals
      .filter((goal) => !goal.archivedAt)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      })
      .forEach((goal) => {
        const monthlyContribution = Math.max(
          0,
          toNumber(historyByGoalName(goal.name, 1).slice(-1)[0]?.amount || 0)
        );
        const categoryKey =
          goal.type === "securite" ? "safety" : goal.type === "croissance" ? "growth" : "projects";
        const card = buildStandardCard(
          {
            ...goal,
            active: true,
            monthlyContribution,
          },
          categoryKey
        );
        if (categoryKey === "growth" && card) growthStandardCount += 1;
        pushCard(categoryKey, card);
      });

    customGoals
      .filter((goal) => goal.archivedAt)
      .forEach((goal) => pushCompleted(goal, goal.archivedAt));

    const investHistory12 = historyByAllocationKeys(["investissements", "pilier3a"], 12);
    const trend12 = Math.max(
      0,
      investHistory12.reduce((sum, entry) => sum + Math.max(0, toNumber(entry.amount || 0)), 0) ||
        allocInvest * 12
    );
    const patrimonyCurrent =
      Math.max(0, toNumber(balances.investments || 0)) + Math.max(0, toNumber(balances.pillar3a || 0));
    const patrimonyStatus =
      trend12 > 0 || allocInvest > 0
        ? { key: "ahead", label: "En croissance" }
        : patrimonyCurrent > 0
        ? { key: "ontrack", label: "Stable" }
        : { key: "late", label: "À renforcer" };
    const patrimonyTrendLine = trend12 > 0 ? `+${formatCurrency(trend12)} sur 12 mois` : "↗ en progression";
    const patrimonyProjectionLine = `10 ans : ${formatCurrency(projected10y)} / 20 ans : ${formatCurrency(projected20y)}`;
    const patrimonyProgress =
      patrimonyStatus.key === "ahead" ? 78 : patrimonyStatus.key === "ontrack" ? 48 : 24;
    const patrimonyHtml = `
      <button
        class="objectifs-goal-card objectifs-goal-card--patrimony ${statusClassMap[patrimonyStatus.key]}"
        type="button"
        data-goal-open="builtin:patrimony"
      >
        <span class="objectifs-goal-card__head">
          <strong>Patrimoine</strong>
          <span class="objectifs-goal-card__badge">${patrimonyStatus.label}</span>
        </span>
        <span class="objectifs-goal-card__line">Valeur estimée : ${formatCurrency(patrimonyCurrent)}</span>
        <span class="objectifs-goal-card__line">Tendance 12 mois : ${escapeHtml(patrimonyTrendLine)}</span>
        <span class="objectifs-goal-card__next">${escapeHtml(patrimonyProjectionLine)}</span>
        <span class="objectifs-goal-card__micro">
          Tu construis ton patrimoine progressivement grâce au plan SmartSave.
        </span>
      </button>
    `;
    pushCard("growth", {
      html: patrimonyHtml,
      summaryKey: patrimonyStatus.key,
      monthlyValue: allocInvest,
      detail: {
        id: "builtin:patrimony",
        title: "Patrimoine",
        category: categoryLabels.growth,
        ratioLabel: `Valeur actuelle : ${formatCurrency(patrimonyCurrent)}`,
        progressPercent: patrimonyProgress,
        statusLabel: patrimonyStatus.label,
        monthLabel: `+${formatCurrency(allocInvest)}`,
        remainingLabel: "—",
        dateLabel: "",
        advice:
          "Si tu veux aller plus vite, baisse ton budget variable ou allonge l’échéance.",
        editHref: "profil.html",
      },
    });

    const summaryActiveNode = goalsRoot.querySelector("[data-goals-summary-active]");
    const summaryStatusNode = goalsRoot.querySelector("[data-goals-summary-status]");
    const summaryCopyNode = goalsRoot.querySelector("[data-goals-summary-copy]");
    if (summaryActiveNode) {
      summaryActiveNode.textContent = `Objectifs actifs : ${activeGoalsCount}`;
    }
    if (summaryStatusNode) {
      summaryStatusNode.textContent =
        `En avance : ${summary.ahead} • ` +
        `Sur la bonne trajectoire : ${summary.ontrack} • ` +
        `En retard : ${summary.late}`;
    }
    if (summaryCopyNode) {
      summaryCopyNode.textContent =
        summary.late > 0
          ? "Certains objectifs nécessitent un ajustement."
          : "Tu avances régulièrement.";
    }

    const sectionSummaryNodes = {
      projects: goalsRoot.querySelector('[data-goals-section-summary="projects"]'),
      safety: goalsRoot.querySelector('[data-goals-section-summary="safety"]'),
      growth: goalsRoot.querySelector('[data-goals-section-summary="growth"]'),
    };
    const formatSectionSummary = (sectionKey) => {
      const stats = sectionStats[sectionKey] || { count: 0, monthly: 0 };
      const goalLabel = stats.count > 1 ? "objectifs" : "objectif";
      return `${stats.count} ${goalLabel} • +${formatCurrency(stats.monthly)}/mois`;
    };
    Object.keys(sectionSummaryNodes).forEach((key) => {
      const node = sectionSummaryNodes[key];
      if (!node) return;
      node.textContent = formatSectionSummary(key);
    });

    const renderSection = (sectionKey, listSelector, seeMoreSelector) => {
      const listNode = goalsRoot.querySelector(listSelector);
      const seeMoreNode = goalsRoot.querySelector(seeMoreSelector);
      if (!listNode) return;
      const cards = sections[sectionKey] || [];
      const hasOverflow = cards.length > 5;
      const isExpanded = hasOverflow ? Boolean(expandedMap[sectionKey]) : false;
      const visibleCount = hasOverflow && !isExpanded ? 5 : cards.length;
      listNode.innerHTML = cards
        .map((cardHtml, index) => {
          const isHidden = index >= visibleCount;
          return `
            <div class="objectifs-card-wrap"${isHidden ? ' hidden aria-hidden="true"' : ""}>
              ${cardHtml}
            </div>
          `;
        })
        .join("");
      if (seeMoreNode) {
        seeMoreNode.hidden = !hasOverflow;
        seeMoreNode.dataset.expanded = isExpanded ? "true" : "false";
        seeMoreNode.textContent = isExpanded ? "Voir moins" : "Voir plus";
      }
      if (!hasOverflow) expandedMap[sectionKey] = false;
    };

    renderSection("projects", "[data-goals-projects-list]", '[data-goals-see-more="projects"]');
    renderSection("safety", "[data-goals-safety-list]", '[data-goals-see-more="safety"]');
    renderSection("growth", "[data-goals-growth-list]", '[data-goals-see-more="growth"]');

    const emptyProjectsNode = goalsRoot.querySelector("[data-goals-empty-projects]");
    if (emptyProjectsNode) emptyProjectsNode.hidden = (sections.projects || []).length > 0;
    const emptyGrowthNode = goalsRoot.querySelector("[data-goals-empty-growth]");
    if (emptyGrowthNode) emptyGrowthNode.hidden = growthStandardCount > 0;

    const completedWrap = goalsRoot.querySelector("[data-goals-completed-wrap]");
    const completedList = goalsRoot.querySelector("[data-goals-completed-list]");
    completed.sort((a, b) => b.timestamp - a.timestamp);
    if (completedList) {
      completedList.innerHTML = completed
        .map(
          (entry) =>
            `<li><span>${escapeHtml(entry.name)}</span><strong>${escapeHtml(entry.dateLabel)}</strong></li>`
        )
        .join("");
    }
    if (completedWrap) completedWrap.hidden = completed.length === 0;

    goalsRoot.__goalsDetailMap = detailMap;
  };

  const setupGoalsInteractions = () => {
    const goalsRoot = document.querySelector("[data-goals-root]");
    if (!goalsRoot || goalsRoot.dataset.interactionsBound === "true") return;
    goalsRoot.dataset.interactionsBound = "true";

    const infoModal = document.querySelector("[data-goals-info-modal]");
    const drawer = document.querySelector("[data-goals-detail-drawer]");
    if (!infoModal || !drawer) return;

    const drawerTitle = drawer.querySelector("[data-goals-detail-title]");
    const drawerCategory = drawer.querySelector("[data-goals-detail-category]");
    const drawerRatio = drawer.querySelector("[data-goals-detail-ratio]");
    const drawerProgress = drawer.querySelector("[data-goals-detail-progress]");
    const drawerStatus = drawer.querySelector("[data-goals-detail-status]");
    const drawerMonth = drawer.querySelector("[data-goals-detail-month]");
    const drawerRemaining = drawer.querySelector("[data-goals-detail-remaining]");
    const drawerDateRow = drawer.querySelector("[data-goals-detail-date-row]");
    const drawerDate = drawer.querySelector("[data-goals-detail-date]");
    const drawerAdvice = drawer.querySelector("[data-goals-detail-advice]");
    const drawerEdit = drawer.querySelector("[data-goals-detail-edit]");

    const syncOverlayState = () => {
      const hasOpenOverlay = !infoModal.hidden || !drawer.hidden;
      document.body.classList.toggle("objectifs-overlay-open", hasOpenOverlay);
    };

    const toggleOverlay = (node, open) => {
      node.hidden = !open;
      node.setAttribute("aria-hidden", open ? "false" : "true");
      syncOverlayState();
    };

    const closeInfo = () => toggleOverlay(infoModal, false);
    const closeDrawer = () => toggleOverlay(drawer, false);

    const openDrawer = (goalId) => {
      const detailMap = goalsRoot.__goalsDetailMap || {};
      const detail = detailMap[String(goalId || "")];
      if (!detail) return;
      if (drawerTitle) drawerTitle.textContent = detail.title || "Objectif";
      if (drawerCategory) drawerCategory.textContent = detail.category || "Objectif";
      if (drawerRatio) drawerRatio.textContent = detail.ratioLabel || "CHF 0 / CHF 0";
      if (drawerProgress) {
        const value = Math.max(0, Math.min(100, toNumber(detail.progressPercent || 0)));
        drawerProgress.style.width = `${value}%`;
      }
      if (drawerStatus) drawerStatus.textContent = detail.statusLabel || "Sur la bonne trajectoire";
      if (drawerMonth) drawerMonth.textContent = detail.monthLabel || "+CHF 0";
      if (drawerRemaining) drawerRemaining.textContent = detail.remainingLabel || "CHF 0";
      if (drawerDate && drawerDateRow) {
        const hasDate = Boolean(detail.dateLabel);
        drawerDateRow.hidden = !hasDate;
        drawerDate.textContent = hasDate ? detail.dateLabel : "—";
      }
      if (drawerAdvice) {
        drawerAdvice.textContent =
          detail.advice ||
          "Si tu veux aller plus vite, baisse ton budget variable ou allonge l’échéance.";
      }
      if (drawerEdit) {
        drawerEdit.setAttribute("href", detail.editHref || "profil.html");
      }
      toggleOverlay(drawer, true);
    };

    goalsRoot.addEventListener("click", (event) => {
      const infoOpen = event.target.closest("[data-goals-info-open]");
      if (infoOpen) {
        toggleOverlay(infoModal, true);
        return;
      }

      const openGoal = event.target.closest("[data-goal-open]");
      if (openGoal) {
        openDrawer(openGoal.dataset.goalOpen || "");
        return;
      }

      const seeMore = event.target.closest("[data-goals-see-more]");
      if (seeMore) {
        const key = String(seeMore.dataset.goalsSeeMore || "");
        if (!key) return;
        goalsRoot.__goalsExpanded =
          goalsRoot.__goalsExpanded && typeof goalsRoot.__goalsExpanded === "object"
            ? goalsRoot.__goalsExpanded
            : {};
        goalsRoot.__goalsExpanded[key] = !Boolean(goalsRoot.__goalsExpanded[key]);
        if (lastRenderContext) {
          renderScore(lastRenderContext.data, lastRenderContext.formData);
        }
      }
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-goals-info-close]")) {
        closeInfo();
        return;
      }
      if (event.target.closest("[data-goals-drawer-close]")) {
        closeDrawer();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeInfo();
      closeDrawer();
    });
  };

  const setupQuickActions = () => {
    const modal = document.querySelector("[data-quick-modal]");
    const form = document.querySelector("[data-quick-form]");
    if (!modal || !form) return;

    const isHomePage = document.body?.dataset.page === "home";
    const title = modal.querySelector("#quick-modal-title");
    const accountField = modal.querySelector('[data-quick-field="account"]');
    const categoryField = modal.querySelector('[data-quick-field="category"]');
    const transferField = modal.querySelector('[data-quick-field="transfer"]');
    const dateInput = modal.querySelector("#quick-date");
    const accountSelect = modal.querySelector("#quick-account");
    const accountOtherInput = modal.querySelector('[data-quick-other="account"]');
    const categorySelect = modal.querySelector("#quick-category");
    const categoryOtherInput = modal.querySelector('[data-quick-other="category"]');

    const syncOtherField = (select, input, triggerValue) => {
      if (!select || !input) return;
      const isOther = select.value === triggerValue;
      input.hidden = !isOther;
      if (!isOther) input.value = "";
    };

    const getActiveMonthBounds = () => {
      if (!isHomePage || !window.loadActiveUser || !window.loadUserForm) return null;
      const activeUser = window.loadActiveUser();
      if (!activeUser) return null;
      const formData = window.loadUserForm(activeUser.id);
      if (!formData) return null;
      const data = typeof window.buildMvpData === "function" ? window.buildMvpData(formData) : {};
      const info = getActiveMonthEntry(activeUser, formData, data, loadTransactions(activeUser));
      const monthKey = info?.activeKey || getMonthKey(new Date());
      const monthDate = parseMonthKey(monthKey);
      if (!monthDate) return null;
      const start = monthDate;
      const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      return { start, end };
    };

    const openModal = (type) => {
      modal.classList.add("is-open");
      modal.dataset.type = type;
      if (title) {
        title.textContent =
          type === "transfer"
            ? "Nouveau transfert"
            : type === "income"
            ? "Ajouter un revenu"
            : "Ajouter une dépense";
      }
      if (categoryField) categoryField.hidden = type === "transfer";
      if (accountField) accountField.hidden = type === "transfer";
      if (transferField) transferField.hidden = type !== "transfer";
      form.reset();
      syncOtherField(categorySelect, categoryOtherInput, "Autre");
      syncOtherField(accountSelect, accountOtherInput, "__other__");
      if (dateInput) {
        const today = new Date();
        const bounds = getActiveMonthBounds();
        if (bounds) {
          dateInput.value = toISODate(bounds.start);
          dateInput.min = toISODate(bounds.start);
          dateInput.max = toISODate(bounds.end);
        } else {
          dateInput.value = toISODate(today);
          dateInput.removeAttribute("min");
          dateInput.removeAttribute("max");
        }
      }
    };

    const closeModal = () => {
      modal.classList.remove("is-open");
      delete modal.dataset.type;
    };

    document.querySelectorAll("[data-quick-action]").forEach((button) => {
      button.addEventListener("click", () => openModal(button.dataset.quickAction));
    });

    modal.querySelectorAll("[data-quick-close]").forEach((button) => {
      button.addEventListener("click", closeModal);
    });

    if (categorySelect) {
      categorySelect.addEventListener("change", () =>
        syncOtherField(categorySelect, categoryOtherInput, "Autre")
      );
    }
    if (accountSelect) {
      accountSelect.addEventListener("change", () =>
        syncOtherField(accountSelect, accountOtherInput, "__other__")
      );
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const type = modal.dataset.type || "expense";
      const formData = new FormData(form);
      const amount = toNumber(formData.get("amount"));
      if (!amount) return;

      const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
        amount,
        date: formData.get("date") || toISODate(new Date()),
        note: String(formData.get("note") || "").trim(),
        createdAt: new Date().toISOString(),
      };
      if (isHomePage && entry.date) {
        const bounds = getActiveMonthBounds();
        if (bounds && !isSameMonth(entry.date, bounds.start)) {
          entry.date = toISODate(bounds.start);
        }
      }
      const activeUser = window.loadActiveUser ? window.loadActiveUser() : null;
      if (activeUser?.id) entry.userId = activeUser.id;

      if (type === "transfer") {
        entry.from = formData.get("from") || "current";
        entry.to = formData.get("to") || "security";
        if (entry.from === entry.to) return;
      } else {
        entry.account = "current";
        entry.accountLabel = "Compte courant";

        const categoryValue = String(formData.get("category") || "").trim();
        if (categoryValue === "Autre") {
          const categoryName = String(formData.get("categoryOther") || "").trim();
          if (!categoryName) return;
          entry.category = categoryName;
        } else {
          entry.category = categoryValue;
        }
      }
      entry.isFixed = false;

      try {
        const stored = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
        stored.push(entry);
        localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(stored));
      } catch (_error) {
        // ignore storage issues
      }
      if (typeof window.syncTransactionToProfile === "function" && activeUser?.id) {
        window.syncTransactionToProfile(entry, activeUser.id);
      }

      closeModal();
      renderAll();
    });
  };

  const renderTransactionsHistory = (activeUser) => {
    const history = document.querySelector("[data-transaction-history]");
    if (!history) return;
    const items = loadTransactions(activeUser).filter((entry) => entry.type !== "transfer");
    renderTransactionList(history, items, "Aucune transaction enregistrée.");
  };

  const setupTransactionDeletes = () => {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-transaction-delete]");
      if (!button) return;
      const id = button.getAttribute("data-transaction-delete");
      if (!id) return;
      try {
        const stored = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
        const updated = Array.isArray(stored) ? stored.filter((item) => item.id !== id) : [];
        localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
      } catch (_error) {
        return;
      }
      renderAll();
    });
  };

  const renderAll = () => {
    const loadActiveUser = window.loadActiveUser;
    const loadUserForm = window.loadUserForm;
    const buildMvpData = window.buildMvpData;
    if (!loadActiveUser || !loadUserForm || !buildMvpData) return;

    const activeUser = loadActiveUser();
    if (!activeUser) {
      window.showNoProfileMessage?.();
      return;
    }
    const formData = loadUserForm(activeUser.id);
    if (!formData) {
      window.showNoProfileMessage?.();
      return;
    }

    const data = buildMvpData(formData);
    const transactions = loadTransactions(activeUser);
    const monthInfo = getActiveMonthEntry(activeUser, formData, data, transactions);
    lastMonthlyContext = monthInfo?.monthlyContext || null;
    lastRenderContext = { data, formData };
    renderHome(data, formData, activeUser);
    renderSmartSave(data, formData, activeUser, lastMonthlyContext);
    renderActions(data, formData, activeUser);
    renderFuture(data, formData);
    renderScore(data, formData);
    renderTransactionsHistory(activeUser);
  };

  const setupFutureRangeToggle = () => {
    const buttons = document.querySelectorAll(".range-btn");
    if (!buttons.length) return;

    const readYears = (button) => {
      const value = button?.dataset?.rangeYears || button?.textContent || "";
      const parsed = Number(String(value).replace(/[^0-9]/g, ""));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const setActive = (years) => {
      buttons.forEach((button) => {
        const isActive = readYears(button) === years;
        button.classList.toggle("is-active", isActive);
      });
    };

    const initialButton = Array.from(buttons).find((button) =>
      button.classList.contains("is-active")
    );
    const initialYears = readYears(initialButton) || 10;
    futureRangeYears = initialYears;
    setActive(initialYears);

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const years = readYears(button);
        if (!years) return;
        futureRangeYears = years;
        setActive(years);
        if (lastRenderContext) {
          renderFuture(lastRenderContext.data, lastRenderContext.formData, years);
        }
      });
    });
  };

  const setupHamburgerMenu = () => {
    const button = document.querySelector(".menu-button");
    const menu = document.querySelector(".hamburger-menu");
    if (!button || !menu) return;

    const toggleMenu = (force) => {
      const open = force != null ? force : !menu.classList.contains("is-open");
      menu.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
    };

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (link) toggleMenu(false);
    });

    document.addEventListener("click", (event) => {
      if (!menu.classList.contains("is-open")) return;
      if (!menu.contains(event.target) && !button.contains(event.target)) {
        toggleMenu(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        toggleMenu(false);
      }
    });
  };

  const ensureUserMenuExpensesLink = () => {
    const menu = document.querySelector(".user-menu");
    if (!menu) return;
    if (menu.querySelector('a[href*="mes-depenses.html"]')) return;
    const header = menu.querySelector(".user-menu__header");
    if (!header) return;

    const link = document.createElement("a");
    link.className = "user-menu-link";
    link.href = "mes-depenses.html";
    link.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />' +
      "</svg>" +
      "<span>Mois précédents</span>";

    header.insertAdjacentElement("afterend", link);
  };

  const setupUserMenu = () => {
    const button = document.querySelector(".user-pill--account");
    const menu = document.querySelector(".user-menu");
    if (!button || !menu) return;

    const toggleMenu = (force) => {
      const open = force != null ? force : !menu.classList.contains("active");
      menu.classList.toggle("active", open);
      button.setAttribute("aria-expanded", String(open));
    };

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener("click", (event) => {
      const link = event.target.closest("a, button");
      if (link) toggleMenu(false);
    });

    document.addEventListener("click", (event) => {
      if (!menu.classList.contains("active")) return;
      if (!menu.contains(event.target) && !button.contains(event.target)) {
        toggleMenu(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        toggleMenu(false);
      }
    });
  };

  let lastProfileVersion = null;

  const readProfileVersion = () => {
    try {
      const raw = localStorage.getItem(PROFILE_VERSION_KEY);
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch (_error) {
      return null;
    }
  };

  const ensureProfileVersion = () => {
    const next = readProfileVersion();
    if (next && next !== lastProfileVersion) {
      lastProfileVersion = next;
      renderAll();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    lastProfileVersion = readProfileVersion();
    ensureUserMenuExpensesLink();
    renderAll();
    setupUserMenu();
    setupHamburgerMenu();
    setupGoalsInteractions();
    setupSmartSaveAllocationDetails();
    setupQuickActions();
    setupTransactionDeletes();
    setupFutureRangeToggle();
  });

  window.addEventListener("storage", (event) => {
    if (!event) return;
    if (event.key === PROFILE_VERSION_KEY) {
      ensureProfileVersion();
      return;
    }
    if (event.key === STORAGE_KEY_FORM || event.key === PROFILE_UPDATE_KEY) {
      renderAll();
    }
  });

  window.addEventListener("pageshow", () => {
    ensureProfileVersion();
    renderAll();
  });

})();
