(() => {
  const STORE_KEY = "smartsaveMonthlyStore";
  const TRANSACTIONS_KEY = "transactions";
  const VARIABLE_BUDGET_SWEEP_RULE = [
    { to: "security", toLabel: "Compte épargne", share: 0.4 },
    { to: "pillar3a", toLabel: "3e pilier", share: 0.3 },
    { to: "investments", toLabel: "Investissements", share: 0.3 },
  ];

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

    return {
      allocationPlan,
      fixedExpenses,
      mandatoryExpenses,
      preferences,
    };
  };

  const getMonthlyInputsSnapshot = (formData = {}, mvpData = {}) => {
    const fixedTotal = ensureArray(formData.expenses?.fixed).reduce(
      (sum, item) => sum + resolveMonthlyAmount(item),
      0
    );
    const mandatoryTotal = ensureArray(formData.expenses?.variable).reduce(
      (sum, item) => sum + resolveMonthlyAmount(item),
      0
    );

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
      toNumber(mvpData?.metrics?.monthlyNetIncome || mvpData?.monthlyNetIncome || 0)
    );

    const taxesNeed = Math.max(
      0,
      toNumber(mvpData?.taxProvision?.monthlyAmount || mvpData?.taxProvision?.monthlyNeed || 0)
    );

    return {
      revenuNetMensuel,
      fixedTotal,
      mandatoryTotal,
      debtsTotal,
      taxesNeed,
    };
  };

  const getAllocationResultSnapshot = (mvpData = {}) => {
    const allocations = deepClone(mvpData?.allocation?.allocations) || {};
    const shortTermAccount = mvpData?.allocation?.shortTermAccount || mvpData?.allocation?.debug?.shortTermAccount || {};
    const shortTermDeduction = Math.max(0, toNumber(shortTermAccount?.amount || 0));

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
      security: toRateDecimal(rates.savings, 0.012),
      tax: toRateDecimal(rates.savings, 0.012),
      projects: toRateDecimal(rates.blocked, 0.015),
      pillar3a: toRateDecimal(rates.pillar3, 0.02),
      investments: toRateDecimal(rates.investments, 0.04),
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
      const raw = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
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
      added.forEach((entry) => window.syncTransactionToProfile(entry, entry.userId));
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
        flags: {
          planAppliedAt: null,
          isFirstMonth: Boolean(isFirstMonth),
          monthStatus: status || (isFirstMonth ? "setup" : "active"),
          startingBalances,
          closingBalances: null,
          interestAppliedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
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

    const state = readStore();
    const bucket = normalizeUserState(state, userId);
    const monthNow = getMonthId(now);

    bucket.userSettings = getUserSettingsFromForm(formData);

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

    while (cursor < monthNow) {
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
        if (persistedInterest.added > 0) {
          workingTransactions = workingTransactions.concat(persistedInterest.entries);
        }
      }
      const nextMonth = addMonths(cursor, 1);
      if (!nextMonth) break;
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
      const alreadyApplied = Boolean(currentPlan.flags?.planAppliedAt);
      if (planStatus !== "closed" && !alreadyApplied) {
        currentPlan.inputsSnapshot = getMonthlyInputsSnapshot(formData, mvpData);
        currentPlan.allocationResultSnapshot = getAllocationResultSnapshot(mvpData);
        currentPlan.flags = {
          ...(currentPlan.flags || {}),
          updatedAt: new Date().toISOString(),
        };
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

    bucket.userSettings = getUserSettingsFromForm(formData);
    bucket.monthlyPlan[monthId] = {
      ...existing,
      inputsSnapshot: getMonthlyInputsSnapshot(formData, mvpData),
      allocationResultSnapshot: getAllocationResultSnapshot(mvpData),
      flags: {
        ...(existing.flags || {}),
        monthStatus,
        updatedAt: new Date().toISOString(),
      },
    };

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

  window.SmartSaveMonthlyStore = {
    STORE_KEY,
    getMonthId,
    parseMonthId,
    addMonths,
    ensureUserMonthContext,
    regeneratePlanForMonth,
    applyPlanForMonth,
    getStateForUser,
    getSetupPlanForMonth,
    saveSetupPlanForMonth,
    readStore,
    writeStore,
  };
})();
