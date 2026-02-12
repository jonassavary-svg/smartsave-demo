(() => {
  const ACTIONS_STORAGE_KEY = "smartsaveHubActionState";
  const TRANSACTIONS_KEY = "transactions";
  const STORAGE_KEY_FORM = "smartsaveFormData";
  const PROFILE_UPDATE_KEY = "smartsaveProfileUpdated";
  const PROFILE_VERSION_KEY = "smartsaveProfileVersion";
  const MONTH_STATE_KEY = "smartsaveMonthState";
  const SNAPSHOT_STORAGE_KEY = "smartsaveSnapshots";
  const PENDING_MON_ARGENT_ACTION_KEY = "smartsavePendingMonArgentAction";
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

  const loadTransactions = (activeUser) => {
    try {
      const stored = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
      const list = Array.isArray(stored) ? stored : [];
      const activeUserId = String(activeUser?.id || "").trim();
      const filtered = activeUser?.id
        ? list.filter((item) => {
            const entryUserId = String(item?.userId || "").trim();
            return !entryUserId || entryUserId === activeUserId;
          })
        : list;
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
      closeActiveMonth(activeUser, formData, transactions);
      const state = loadMonthState();
      const userState = state?.[activeUser?.id];
      if (!userState?.activeMonthKey) break;
      activeDate = parseMonthKey(userState.activeMonthKey);
      if (!activeDate) break;
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
      if (accountKey && Object.prototype.hasOwnProperty.call(updated, accountKey)) {
        updated[accountKey] += delta;
        return;
      }
      const derivedLabel =
        accountLabel ||
        (typeof accountKey === "string" && accountKey.startsWith("custom-")
          ? accountKey.slice("custom-".length)
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
      objective: "Gérer ton quotidien sans stress (factures, imprévus, dépenses du mois).",
      placement: [
        "Sur ton compte courant bancaire habituel.",
      ],
      rules: [
        "SmartSave maintient un montant cible sur le compte courant pour couvrir les dépenses mensuelles.",
        "Quand le solde est sous la cible, ce compte est réalimenté en priorité opérationnelle.",
        "Quand il dépasse la cible, le surplus est redirigé vers sécurité, impôts, projets ou investissement.",
      ],
      nextActions: [
        "Vérifie que tes prélèvements fixes partent bien de ce compte.",
        "Programme un virement mensuel vers ce compte à date fixe.",
      ],
      more: "À savoir: ce compte n'est pas fait pour accumuler de l'argent sur le long terme.",
    },
    securite: {
      title: "Sécurité",
      objective: "Te protéger en cas d’imprévu (santé, perte de revenu, grosse facture).",
      placement: [
        "Compte épargne séparé, sans risque et facilement accessible.",
      ],
      rules: [
        "SmartSave alimente ce compte en priorité jusqu'à atteindre le niveau de sécurité cible.",
        "Tant que l'écart de sécurité existe, les montants sont orientés ici avant les objectifs de croissance.",
        "Une fois l'objectif atteint, les nouveaux flux sont réalloués vers les autres priorités.",
      ],
      nextActions: [
        "Créer un virement automatique vers ton compte épargne.",
        "Vérifier le montant cible (3 à 6 mois de dépenses).",
      ],
      more: "À savoir: cet argent n'est pas là pour rapporter, mais pour sécuriser.",
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
      objective: "Faire croître ton argent sur le long terme plutôt que de le laisser perdre de la valeur.",
      placement: [
        "Supports diversifiés de type ETF, simples et à faible coût.",
        "Pas besoin de choisir des actions une par une: SmartSave privilégie une logique globale.",
      ],
      rules: [
        "SmartSave investit seulement le montant restant après avoir sécurisé le quotidien, la sécurité et les impôts.",
        "La logique est diversifiée (pays, secteurs, grand nombre d'entreprises) pour réduire le risque spécifique.",
        "Les montants peuvent varier d'un mois à l'autre selon la capacité réelle de répartition.",
      ],
      nextActions: [
        "Définir ton support d'investissement principal.",
        "Mettre en place un ordre récurrent mensuel.",
      ],
      more: "À savoir: la valeur peut varier à court terme. Ce compte est réservé à l'argent dont tu n'as pas besoin rapidement.",
    },
    pilier3a: {
      title: "3e pilier",
      objective:
        "Préparer ta retraite tout en réduisant tes impôts aujourd'hui, avec une épargne de long terme.",
      placement: [
        "3a bancaire: plus prudent.",
        "3a en fonds: plus orienté long terme.",
      ],
      rules: [
        "SmartSave propose un versement régulier vers le 3e pilier si ce pilier est activé dans ton plan.",
        "Le montant est ajusté selon la capacité mensuelle réelle après les priorités de base.",
        "Les versements sont limités par le cadre légal annuel du 3a.",
      ],
      nextActions: [
        "Vérifier ton versement cumulé de l'année.",
        "Planifier un versement automatique mensuel.",
      ],
      more: "À savoir: l'argent est bloqué jusqu'à la retraite (sauf conditions légales).",
    },
    impots: {
      title: "Impôts",
      objective: "Éviter une grosse facture d'impôts en fin d'année.",
      placement: [
        'Compte dédié "Impôts" (épargne ou sous-compte séparé).',
      ],
      rules: [
        "SmartSave calcule une provision mensuelle pour lisser la charge fiscale sur l'année.",
        "Ce montant est traité comme une priorité pour éviter un rattrapage de dernière minute.",
        "La provision est ajustée si l'estimation d'impôts évolue.",
      ],
      nextActions: [
        "Vérifier le montant d'impôts restant estimé.",
        "Créer un virement automatique vers le compte impôts.",
      ],
      more: "À savoir: cet argent doit rester disponible et sans risque.",
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

    const titleNode = modal.querySelector("[data-allocation-details-title]");
    const objectiveNode = modal.querySelector("[data-allocation-details-objective]");
    const placementNode = modal.querySelector("[data-allocation-details-placement]");
    const rulesNode = modal.querySelector("[data-allocation-details-rules]");
    const nextNode = modal.querySelector("[data-allocation-details-next]");
    const moreNode = modal.querySelector("[data-allocation-details-more]");
    const moreToggle = modal.querySelector("[data-allocation-details-more-toggle]");

    const renderSimpleList = (node, entries) => {
      if (!node) return;
      node.innerHTML = ensureArray(entries)
        .map((entry) => `<li>${entry}</li>`)
        .join("");
    };

    const renderChecklist = (node, entries) => {
      if (!node) return;
      node.innerHTML = ensureArray(entries)
        .map(
          (entry, index) => `
            <li>
              <label>
                <input type="checkbox" data-allocation-details-checkbox="${index}">
                <span>${entry}</span>
              </label>
            </li>
          `
        )
        .join("");
    };

    const closeModal = () => {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("allocation-details-open");
      window.setTimeout(() => {
        if (!modal.classList.contains("is-open")) modal.hidden = true;
      }, 120);
    };

    const openForCard = (card) => {
      if (!card) return;
      const key = String(card.dataset.allocationDetailKey || "").trim();
      const amount = Math.max(0, toNumber(card.dataset.allocationDetailAmount || 0));
      const fallbackLabel = card.querySelector(".allocation-card__title p")?.textContent?.trim() || "Compte";
      const template = getAllocationDetailsTemplate(key, fallbackLabel);

      if (titleNode) {
        titleNode.textContent = `${template.title} — ${formatCurrency(amount)}/mois`;
      }
      if (objectiveNode) objectiveNode.textContent = template.objective;
      renderSimpleList(placementNode, template.placement);
      renderSimpleList(rulesNode, template.rules);
      renderChecklist(nextNode, template.nextActions);

      if (moreNode && moreToggle) {
        const hasMore = Boolean(String(template.more || "").trim());
        moreNode.hidden = true;
        moreNode.textContent = template.more || "";
        moreToggle.hidden = !hasMore;
        moreToggle.setAttribute("aria-expanded", "false");
      }

      modal.hidden = false;
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

      const toggle = event.target.closest("[data-allocation-details-more-toggle]");
      if (toggle && moreNode) {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
        moreNode.hidden = expanded;
        return;
      }

      if (event.target.closest("[data-allocation-details-secondary]")) {
        modal.querySelectorAll("[data-allocation-details-checkbox]").forEach((checkbox) => {
          checkbox.checked = true;
        });
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

  const renderSmartSave = (data, formData, activeUser, monthContext) => {
    if (!document.querySelector("[data-allocation-total]")) return;

    const context = monthContext || lastMonthlyContext || null;
    const planSnapshot = context?.monthlyPlan?.allocationResultSnapshot || null;
    const allocations = planSnapshot?.allocations || data.allocation?.allocations || {};
    const shortTermAccount = data.allocation?.shortTermAccount || data.allocation?.debug?.shortTermAccount || null;
    const shortTermKey = String(shortTermAccount?.key || "projetsCourtTerme").trim();
    const shortTermAmount = Math.max(
      0,
      toNumber(planSnapshot?.shortTermDeduction || shortTermAccount?.amount || allocations[shortTermKey] || 0)
    );
    const longTermDiagnostic =
      data.allocation?.longTermDiagnostic || data.allocation?.debug?.longTermDiagnostic || {};
    const longTermType = String(
      longTermDiagnostic?.type || formData?.allocationPlan?.longTerm?.type || "security"
    ).toLowerCase();
    const balances = resolveBalances(formData);
    const goals = resolveGoals(formData);
    const taxInfo = data.taxProvision || {};

    const allocationEntries = Object.values(allocations).map((value) =>
      Math.max(0, toNumber(value))
    );
    const totalAllocated =
      Math.max(0, toNumber(planSnapshot?.totalSmartSave || 0)) ||
      allocationEntries.reduce((sum, value) => sum + value, 0);
    const monthlyToAllocate = Math.max(0, toNumber(data.allocation?.disponibleInitial));
    const allocationBase =
      totalAllocated > 0
        ? totalAllocated
        : Math.max(0, monthlyToAllocate + shortTermAmount);
    const safeTotal = Math.max(1, allocationBase);

    setText("[data-allocation-total]", formatCurrency(allocationBase));

    const securityTarget = Math.max(0, toNumber(data.allocation?.debug?.savingsTargets?.targetAmount || 0));
    const securityGap = Math.max(0, securityTarget - balances.security);
    const goalGap = Math.max(0, goals.totalTarget - goals.totalSaved);
    const taxTarget = Math.max(
      0,
      toNumber(taxInfo.remaining || taxInfo.outstanding || taxInfo.totalTax || 0)
    );

    const longTermKey = "projetsLongTerme";
    const longTermFallbackByType = (() => {
      if (longTermType === "security") return toNumber(allocations.securite || 0);
      if (longTermType === "invest") return toNumber(allocations.investissements || 0);
      if (longTermType === "retirement") {
        return toNumber(allocations.investissements || 0) + toNumber(allocations.pilier3a || 0);
      }
      return toNumber(allocations[longTermKey] || allocations.projets || 0);
    })();
    const longTermAmount = Math.max(
      0,
      toNumber(longTermDiagnostic?.monthlyContribution || 0) || longTermFallbackByType
    );
    const longTermTypeLabels = {
      security: "Sécurité financière",
      home: "Achat immobilier",
      invest: "Investissement long terme",
      children: "Épargne enfants",
      retirement: "Retraite",
    };
    const getAllocationAmount = (key) => {
      if (key === longTermKey) return longTermAmount;
      return Math.max(0, toNumber(allocations[key] || 0));
    };

    const allocationItems = [
      {
        key: "compteCourant",
        label: "Compte courant",
        subtitle: "Everyday spending",
        style: "current",
        icon: "M5 7h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm2 4h4",
        note: data.allocation?.debug?.currentTarget
          ? `Target SmartSave: ${formatCurrency(data.allocation.debug.currentTarget)}`
          : "Dépenses du quotidien couvertes.",
      },
      {
        key: "securite",
        label: "Compte épargne",
        subtitle: "Security pillar",
        style: "security",
        icon: "M12 3l7 4v5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V7l7-4z",
        note: securityTarget
          ? `${formatCurrency(securityGap)} more to reach target`
          : "Priorité à la sécurité.",
      },
      {
        key: longTermKey,
        label: longTermTypeLabels[longTermType] || "Objectif long terme",
        subtitle: "Objectifs long terme",
        style: "anticipation",
        icon: "M7 4h10v14H7zM7 7h10",
        note:
          longTermDiagnostic?.enabled && longTermDiagnostic?.message
            ? String(longTermDiagnostic.message)
            : goals.totalTarget
              ? `${formatCurrency(goalGap)} more to reach target`
              : goals.primaryName || "Plan ahead for goals.",
      },
      ...(shortTermAmount > 0
        ? [
            {
              key: shortTermKey,
              label: shortTermAccount?.label || `Compte ${shortTermAccount?.name || "court terme"}`,
              subtitle: "Objectif court terme",
              style: "anticipation",
              icon: "M7 4h10v14H7zM7 7h10",
              note: "Prélèvement mensuel dédié avant allocation SmartSave.",
            },
          ]
        : []),
      {
        key: "investissements",
        label: "Investissements",
        subtitle: "Growth pillar",
        style: "growth",
        icon: "M4 17l5-6 4 4 7-8",
        note: "Invest remaining funds for long-term growth.",
      },
      {
        key: "pilier3a",
        label: "3e pilier",
        subtitle: "Retirement pillar",
        style: "pillar",
        icon: "M7 5h10v3H7zM5 10h14v9H5z",
        note: "Préparer la retraite (3e pilier).",
      },
      {
        key: "impots",
        label: "Provision impôts",
        subtitle: "Tax reserve",
        style: "tax",
        icon: "M7 4h8l3 3v13H7z",
        note: taxTarget ? `Target SmartSave: ${formatCurrency(taxTarget)}` : "Provisionner les impôts.",
      },
      {
        key: "dettes",
        label: "Remboursement dettes",
        subtitle: "Debt management",
        style: "debt",
        icon: "M4 7h16v10H4zM8 11h8",
        note: data.debtMonthly ? `Mensualités: ${formatCurrency(data.debtMonthly)}` : "Réduire les dettes.",
      },
    ];

    const list = document.querySelector("[data-allocation-list]");
    if (list) {
      const sortedItems = allocationItems
        .map((item, index) => {
          const amount = getAllocationAmount(item.key);
          const percent = Math.round((amount / safeTotal) * 100);
          return { ...item, amount, percent, index };
        })
        .sort((a, b) => b.amount - a.amount || a.index - b.index);

      list.innerHTML = sortedItems
        .map((item) => {
          const percent = item.percent;
          return `
            <article
              class="allocation-card card allocation-card--${item.style}"
              data-allocation-details-trigger
              data-allocation-detail-key="${item.key}"
              data-allocation-detail-amount="${item.amount}"
              tabindex="0"
              role="button"
              aria-label="Voir le détail de ${item.label}"
            >
              <div class="allocation-card__header">
                <span class="allocation-card__icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="${item.icon}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <div class="allocation-card__title">
                  <p>${item.label}</p>
                  <small>${item.subtitle}</small>
                </div>
                <div class="allocation-card__value">
                  <strong>${formatCurrency(item.amount)}</strong>
                  <span>${percent}%</span>
                </div>
              </div>
              <div class="progress-track">
                <span class="progress-fill" style="width:${percent}%"></span>
              </div>
              <small class="allocation-card__note">${item.note}</small>
            </article>
          `;
        })
        .join("");
    }

    const nextNote = document.querySelector("[data-allocation-next]");
    if (nextNote) {
      if (longTermDiagnostic?.enabled && longTermDiagnostic?.message) {
        nextNote.textContent = longTermDiagnostic.message;
      } else if (securityTarget && securityGap > 0) {
        nextNote.textContent = `Focus on building your emergency fund. Allocate ${formatCurrency(
          Math.min(securityGap, allocations.securite || securityGap)
        )} from your next salary.`;
      } else if (goalGap > 0) {
        nextNote.textContent = `Keep funding your goals. Allocate ${formatCurrency(
          Math.min(goalGap, longTermAmount || goalGap)
        )} this month.`;
      } else {
        nextNote.textContent = "You are on track. Continue investing for long-term growth.";
      }
    }

    renderSmartSaveMonthCycle(activeUser, monthContext, data, formData);
  };

  const ensureSmartSaveMonthUi = () => {
    if (document.body?.dataset.page !== "smartsave") return null;
    const root = document.querySelector(".app-main");
    if (!root) return null;

    let cycleCard = document.querySelector("[data-smartsave-month-cycle]");
    if (!cycleCard) {
      cycleCard = document.createElement("section");
      cycleCard.className = "card smartsave-month-cycle";
      cycleCard.setAttribute("data-smartsave-month-cycle", "");
      cycleCard.innerHTML = `
        <div class="smartsave-month-cycle__header">
          <strong data-month-cycle-title>Mois —</strong>
          <span class="smartsave-month-cycle__badge" data-month-cycle-badge>ACTIF</span>
        </div>
        <p class="smartsave-month-cycle__text" data-month-cycle-text></p>
        <div class="smartsave-month-cycle__actions">
          <button class="cta" type="button" data-month-cycle-primary></button>
          <button class="ghost-btn small" type="button" data-month-cycle-secondary hidden></button>
        </div>
        <p class="smartsave-month-cycle__status" data-month-cycle-status></p>
      `;
      const titleSection = root.querySelector(".page-title");
      if (titleSection && titleSection.parentNode) {
        titleSection.parentNode.insertBefore(cycleCard, titleSection.nextSibling);
      } else {
        root.prepend(cycleCard);
      }
    }

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

    return { cycleCard, setupModal };
  };

  const getLiveAccountBalances = (_activeUser, formData) =>
    normalizeBalances(resolveBalances(formData || {}));

  const buildMonthZeroRecommendations = (activeUser, formData, data, monthContext) => {
    const balances = getLiveAccountBalances(activeUser, formData);
    const debug = data?.allocation?.debug || {};
    const inputs = monthContext?.monthlyPlan?.inputsSnapshot || {};
    const currentTarget = Math.max(
      0,
      toNumber(
        debug.currentTarget ||
          (toNumber(inputs.fixedTotal) + toNumber(inputs.mandatoryTotal) + toNumber(inputs.debtsTotal))
      )
    );
    const securityTarget = Math.max(
      0,
      toNumber(debug.savingsTargets?.targetAmount || 0)
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
    const employmentStatus = String(formData?.personal?.employmentStatus || "").toLowerCase();
    const annualNetIncome = Math.max(0, toNumber(inputs.revenuNetMensuel || 0) * 12);
    const pillarCap = employmentStatus.includes("indep")
      ? Math.max(7056, Math.min(annualNetIncome * 0.2, 35280))
      : 7056;
    const pillarPaidYtd = Math.max(
      0,
      toNumber(formData?.assets?.thirdPillarPaidYTD || formData?.taxes?.thirdPillarPaidYTD || 0)
    );
    const pillarRemaining = Math.max(0, pillarCap - pillarPaidYtd);

    const recommendations = [];
    const savingsCeiling = Math.max(securityTarget * 1.25, securityTarget + 5000);
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
    const availableFromSecurity = () => Math.max(0, projected.security - savingsCeiling);
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

    // 2) Keep building savings up to the ceiling from current surplus.
    const savingsKeepAmount = Math.min(
      poolAmount() * 0.15,
      Math.max(0, savingsCeiling - projected.security),
      availableFromCurrent()
    );
    const keepToSavings = transfer("current", "security", savingsKeepAmount);
    pushReco({
      title: "Conserver une partie sur l'épargne",
      detail: `Epargne cible ${formatCurrency(securityTarget)} · plafond ${formatCurrency(savingsCeiling)}.`,
      from: "current",
      to: "security",
      amount: keepToSavings,
    });

    // 3) Fill tax gap first from surplus pool.
    pullSurplusTo(
      "tax",
      taxGap(),
      "Combler la provision impôts",
      `Impôts ${formatCurrency(projected.tax)} / cible ${formatCurrency(taxTarget)}.`
    );

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
    if (existing && Array.isArray(existing.items) && existing.items.length) {
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
      rulesVersion: "setup-static-v1",
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

  const normalizeEntryIdPart = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item";

  const buildMonthlyApplyEntries = ({ activeUser, monthId, monthContext, mvpData }) => {
    const plan = monthContext?.monthlyPlan || {};
    const userSettings = monthContext?.userSettings || {};
    const inputs = plan.inputsSnapshot || {};
    const allocations = plan.allocationResultSnapshot?.allocations || {};
    const shortTermDeduction = Math.max(
      0,
      toNumber(plan.allocationResultSnapshot?.shortTermDeduction || 0)
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

    const transferSpecs = [
      { allocationKey: "securite", to: "security", label: "Compte épargne" },
      { allocationKey: "impots", to: "tax", label: "Provision impôts" },
      { allocationKey: "pilier3a", to: "pillar3a", label: "3e pilier" },
      { allocationKey: "investissements", to: "investments", label: "Investissements" },
    ];

    const shortTermAccount = mvpData?.allocation?.shortTermAccount || mvpData?.allocation?.debug?.shortTermAccount || {};
    const shortTermTo = "projects";
    const shortTermLabel = shortTermAccount?.name || shortTermAccount?.label || "Compte court terme";
    if (shortTermDeduction > 0) {
      transferSpecs.push({
        allocationKey: "__short_term__",
        to: shortTermTo,
        label: shortTermLabel,
      });
    }

    transferSpecs.forEach((spec) => {
      const amount =
        spec.allocationKey === "__short_term__"
          ? shortTermDeduction
          : Math.max(0, toNumber(allocations[spec.allocationKey] || 0));
      pushEntry({
        id: `autoapply-${userId}-${monthId}-transfer-${normalizeEntryIdPart(spec.to)}`,
        type: "transfer",
        from: "current",
        fromLabel: "Compte courant",
        to: spec.to,
        toLabel: spec.label,
        note: "Répartition SmartSave (auto)",
        isFixed: true,
        autoApplyKind: "allocation-transfer",
        amount,
      });
    });

    return entries;
  };

  const runMonthlyAutoApply = ({ activeUser, monthId, monthContext, mvpData }) => {
    const candidates = buildMonthlyApplyEntries({ activeUser, monthId, monthContext, mvpData });
    if (!candidates.length) return { addedCount: 0 };

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

    if (!added.length) return { addedCount: 0 };
    saveAllTransactionsRaw(stored);
    if (typeof window.syncTransactionToProfile === "function" && activeUser?.id) {
      added.forEach((entry) => window.syncTransactionToProfile(entry, activeUser.id));
    }
    return { addedCount: added.length };
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

  const renderSmartSaveMonthCycle = (activeUser, monthContext, data, formData) => {
    const ui = ensureSmartSaveMonthUi();
    if (!ui) return;
    const { cycleCard, setupModal } = ui;
    const titleNode = cycleCard.querySelector("[data-month-cycle-title]");
    const badgeNode = cycleCard.querySelector("[data-month-cycle-badge]");
    const textNode = cycleCard.querySelector("[data-month-cycle-text]");
    const statusNode = cycleCard.querySelector("[data-month-cycle-status]");
    const primaryButton = cycleCard.querySelector("[data-month-cycle-primary]");
    const secondaryButton = cycleCard.querySelector("[data-month-cycle-secondary]");
    const setupRecoNode = setupModal.querySelector("[data-smartsave-setup-recommendations]");
    const setupEmptyNode = setupModal.querySelector("[data-smartsave-setup-empty]");

    const monthId = monthContext?.monthId || getMonthKey(new Date());
    const monthDate = parseMonthKey(monthId) || new Date();
    const monthLabel = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(monthDate);
    const flags = monthContext?.monthlyPlan?.flags || {};
    const monthStatus = String(flags.monthStatus || "active");
    const appliedAt = flags.planAppliedAt || null;

    if (titleNode) titleNode.textContent = `Cycle ${monthLabel}`;
    if (secondaryButton) secondaryButton.hidden = true;

    if (monthStatus === "setup") {
      const setupPlan = getStaticSetupPlan(activeUser, formData, data, monthContext);
      const pendingTransfers = getPendingSetupTransfers(setupPlan, activeUser, monthId);
      const setupDone = pendingTransfers.length === 0;
      if (badgeNode) badgeNode.textContent = "MOIS 0";
      if (textNode) {
        textNode.textContent = setupDone
          ? "Vos comptes sont a jour, suivez votre budget jusqu'a la fin du mois !"
          : "Mise en place: organise tes comptes maintenant. L'application du plan commence le mois prochain.";
      }
      if (statusNode) {
        statusNode.textContent = setupDone
          ? "Rearrangement termine pour ce mois 0."
          : "Mode setup: conseils de reorganisation initiale.";
      }
      if (primaryButton) {
        primaryButton.disabled = setupDone;
        primaryButton.textContent = setupDone
          ? "Comptes a jour pour ce mois"
          : "Voir comment organiser mes comptes";
        primaryButton.onclick = () => {
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
      }
      if (secondaryButton) secondaryButton.hidden = true;
    } else if (monthStatus === "active" && !appliedAt) {
      if (badgeNode) badgeNode.textContent = "ACTIF";
      if (textNode) {
        textNode.textContent =
          "Applique ton plan SmartSave une seule fois apres reception du salaire.";
      }
      if (statusNode) statusNode.textContent = "Plan non applique pour ce mois.";
      if (primaryButton) {
        primaryButton.disabled = false;
        primaryButton.textContent = "Appliquer mon plan SmartSave ce mois-ci";
        primaryButton.onclick = () => {
          const store = getMonthlyStore();
          if (!store || !activeUser?.id || !monthId) return;
          const result = store.applyPlanForMonth({ userId: activeUser.id, monthId });
          if (!result?.ok) return;
          const execution = runMonthlyAutoApply({
            activeUser,
            monthId,
            monthContext,
            mvpData: data,
          });
          if (statusNode) {
            statusNode.textContent = `✔ Plan applique pour ${monthId} · ${execution.addedCount || 0} operations enregistrees`;
          }
          renderAll();
        };
      }
    } else {
      if (badgeNode) badgeNode.textContent = monthStatus === "closed" ? "CLOTURE" : "APPLIQUE";
      if (textNode) {
        textNode.textContent =
          monthStatus === "closed"
            ? "Ce mois est archive en lecture seule."
            : "Le plan est deja applique pour ce mois.";
      }
      if (statusNode) {
        statusNode.textContent = appliedAt
          ? `✔ Plan applique pour ${monthId}`
          : "Ce mois est en lecture seule.";
      }
      if (primaryButton) {
        primaryButton.disabled = true;
        primaryButton.textContent = appliedAt ? `✔ Plan applique pour ${monthId}` : "Plan indisponible";
        primaryButton.onclick = null;
      }
    }

    if (!setupModal.dataset.bound) {
      setupModal.addEventListener("click", (event) => {
        const transferButton = event.target.closest("[data-smartsave-setup-transfer]");
        if (transferButton) {
          openRecommendedTransfer({
            from: transferButton.getAttribute("data-transfer-from"),
            to: transferButton.getAttribute("data-transfer-to"),
            amount: toNumber(transferButton.getAttribute("data-transfer-amount")),
          });
          return;
        }
        const close = event.target.closest("[data-smartsave-setup-close]");
        if (!close) return;
        setupModal.classList.remove("is-open");
        setupModal.hidden = true;
        setupModal.setAttribute("aria-hidden", "true");
      });
      setupModal.dataset.bound = "true";
    }
  };

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
      const allocations =
        planSnapshot?.allocations ||
        data.allocation?.allocations ||
        {};
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
          value: Math.max(0, toNumber(allocations.impots || 0)),
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

    const projectionEngine = window.ProjectionEngine;
    const projection =
      projectionEngine?.calculateProjection && formData
        ? projectionEngine.calculateProjection(formData, { years, keepHistory: true })
        : data.projection || {};
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

    const allocationPlan = formData?.allocationPlan || {};
    const shortTerm = allocationPlan.shortTerm || {};
    const longTerm = allocationPlan.longTerm || {};
    const allocations = data?.allocation?.allocations || {};

    const fallbackMonthlyBeforePlan = Math.max(
      0,
      getMonthlyIncomeEstimate(formData) -
        getMonthlyExpenseTotal(formData?.expenses?.fixed) -
        getMonthlyExpenseTotal(formData?.expenses?.variable) -
        Math.max(0, toNumber(data?.debtMonthly))
    );
    const monthlyAvailableBeforePlan = Math.max(
      0,
      toNumber(data?.allocation?.debug?.monthlyAvailableBeforePlan || fallbackMonthlyBeforePlan)
    );

    const leisureMonthly = Math.max(
      0,
      Math.min(monthlyAvailableBeforePlan, toNumber(allocationPlan.leisureMonthly || 0))
    );
    const remainingAfterLifeBudget = Math.max(0, monthlyAvailableBeforePlan - leisureMonthly);

    const sliderNode = goalsRoot.querySelector('[data-goals-field="leisure-slider"]');
    const inputNode = goalsRoot.querySelector('[data-goals-field="leisure-input"]');
    const variableFeedbackNode = goalsRoot.querySelector("[data-goals-variable-feedback]");
    if (sliderNode) {
      sliderNode.max = String(Math.max(0, Math.round(monthlyAvailableBeforePlan)));
      sliderNode.value = String(Math.round(leisureMonthly));
    }
    if (inputNode) inputNode.value = String(Math.round(leisureMonthly));
    if (variableFeedbackNode) {
      variableFeedbackNode.textContent = `Avec ce choix, il te restera ${formatCurrency(
        remainingAfterLifeBudget
      )} à répartir.`;
    }

    const ctEnabled = Boolean(shortTerm.enabled);
    const ctType = String(shortTerm.type || "vacances").toLowerCase();
    const ctAmount = Math.max(0, toNumber(shortTerm.amount || 0));
    const ctHorizon = Math.max(1, Math.round(toNumber(shortTerm.horizonYears || 1)));
    const ctMonthly = ctEnabled && ctAmount > 0 ? ctAmount / (ctHorizon * 12) : 0;

    const ctEnabledNode = goalsRoot.querySelector('[data-goals-field="ct-enabled"]');
    const ctFieldsNode = goalsRoot.querySelector("[data-goals-ct-fields]");
    const ctTypeNode = goalsRoot.querySelector('[data-goals-field="ct-type"]');
    const ctAmountNode = goalsRoot.querySelector('[data-goals-field="ct-amount"]');
    const ctHorizonNode = goalsRoot.querySelector('[data-goals-field="ct-horizon"]');
    const ctMonthlyNode = goalsRoot.querySelector("[data-goals-ct-monthly]");
    if (ctEnabledNode) ctEnabledNode.checked = ctEnabled;
    if (ctFieldsNode) ctFieldsNode.hidden = !ctEnabled;
    if (ctTypeNode) ctTypeNode.value = ctType;
    if (ctAmountNode) ctAmountNode.value = String(Math.round(ctAmount));
    if (ctHorizonNode) ctHorizonNode.value = String(ctHorizon);
    if (ctMonthlyNode) {
      ctMonthlyNode.textContent = `Cela représente ${formatCurrency(
        ctMonthly
      )}/mois mis de côté avant la répartition.`;
    }

    const ltType = String(longTerm.type || "security").toLowerCase();
    const ltTarget = Math.max(0, toNumber(longTerm.amount || longTerm.target || 0));
    const ltHorizon = Math.max(3, Math.round(toNumber(longTerm.horizonYears || 10)));
    const ltNeedMonthly = ltTarget > 0 ? ltTarget / (ltHorizon * 12) : 0;
    const ltFundingMonthly = Math.max(
      0,
      toNumber(data?.allocation?.longTermDiagnostic?.monthlyContribution || 0)
    );

    const ltTypeNode = goalsRoot.querySelector(
      `[data-goals-field="lt-type"][value="${ltType}"]`
    );
    goalsRoot.querySelectorAll('[data-goals-field="lt-type"]').forEach((node) => {
      node.checked = false;
    });
    if (ltTypeNode) ltTypeNode.checked = true;

    const ltTargetNode = goalsRoot.querySelector('[data-goals-field="lt-target"]');
    const ltHorizonNode = goalsRoot.querySelector('[data-goals-field="lt-horizon"]');
    if (ltTargetNode) ltTargetNode.value = String(Math.round(ltTarget));
    if (ltHorizonNode) ltHorizonNode.value = String(ltHorizon);

    const diagnosticNode = goalsRoot.querySelector("[data-goals-lt-diagnostic]");
    const statusNode = goalsRoot.querySelector("[data-goals-lt-status]");
    if (diagnosticNode) {
      const lines = diagnosticNode.querySelectorAll("p");
      if (lines[0]) lines[0].textContent = `Besoin mensuel: ${formatCurrency(ltNeedMonthly)}`;
      if (lines[1]) lines[1].textContent = `Financement actuel: ${formatCurrency(ltFundingMonthly)}/mois`;
    }
    if (statusNode) {
      statusNode.classList.remove("is-green", "is-orange", "is-red", "is-neutral");
      if (ltNeedMonthly <= 0) {
        statusNode.classList.add("is-neutral");
        statusNode.textContent = "Renseigne une cible et un horizon pour le diagnostic.";
      } else {
        const ratio = ltFundingMonthly / ltNeedMonthly;
        if (ratio >= 1) {
          statusNode.classList.add("is-green");
          statusNode.textContent = "Dans les temps.";
        } else if (ratio >= 0.75) {
          statusNode.classList.add("is-orange");
          statusNode.textContent = "En retard: accélération conseillée.";
        } else {
          statusNode.classList.add("is-red");
          statusNode.textContent = "Hors trajectoire: ajustement nécessaire.";
        }
      }
    }

    const smartSaveDistributed = Math.max(0, toNumber(data?.allocation?.disponibleInitial || 0));
    const investedThisMonth = Math.max(0, toNumber(allocations.investissements || 0));
    setText(
      "[data-goals-impact-summary-life]",
      `${formatCurrency(leisureMonthly)} utilisés · ${formatCurrency(
        remainingAfterLifeBudget
      )} à répartir`
    );
    setText(
      "[data-goals-impact-summary-ct]",
      ctEnabled
        ? `${formatCurrency(ctAmount)} sur ${ctHorizon} an${ctHorizon > 1 ? "s" : ""} · ${formatCurrency(
            ctMonthly
          )}/mois`
        : "Non actif"
    );
    setText(
      "[data-goals-impact-summary-lt]",
      ltTarget > 0
        ? `${formatCurrency(ltTarget)} sur ${ltHorizon} an${ltHorizon > 1 ? "s" : ""} · besoin ${formatCurrency(
            ltNeedMonthly
          )}/mois`
        : `Horizon ${ltHorizon} an${ltHorizon > 1 ? "s" : ""} · cible non définie`
    );

    goalsRoot.dataset.monthlyAvailableBeforePlan = String(monthlyAvailableBeforePlan);
    goalsRoot.dataset.ltFundingMonthly = String(ltFundingMonthly);
    goalsRoot.dataset.investedThisMonth = String(investedThisMonth);
    goalsRoot.dataset.smartSaveDistributed = String(smartSaveDistributed);
  };

  const setupGoalsEditor = () => {
    const goalsRoot = document.querySelector("[data-goals-root]");
    if (!goalsRoot || goalsRoot.dataset.bound === "true") return;
    goalsRoot.dataset.bound = "true";
    const LT_DEFAULTS = {
      security: { target: 30000, horizonYears: 8 },
      home: { target: 120000, horizonYears: 15 },
      invest: { target: 80000, horizonYears: 12 },
      retirement: { target: 250000, horizonYears: 25 },
    };

    const savingNode = goalsRoot.querySelector("[data-goals-saving-state]");
    const setSavingLabel = (label) => {
      if (savingNode) savingNode.textContent = label;
    };

    const readGoalsValues = () => {
      const sliderNode = goalsRoot.querySelector('[data-goals-field="leisure-slider"]');
      const inputNode = goalsRoot.querySelector('[data-goals-field="leisure-input"]');
      const maxLeisure = Math.max(
        0,
        toNumber(sliderNode?.max || goalsRoot.dataset.monthlyAvailableBeforePlan || 0)
      );
      const rawLeisure = inputNode ? toNumber(inputNode.value) : toNumber(sliderNode?.value);
      const leisureMonthly = Math.max(0, Math.min(maxLeisure, rawLeisure));

      const ctEnabled = Boolean(
        goalsRoot.querySelector('[data-goals-field="ct-enabled"]')?.checked
      );
      const ctType = String(
        goalsRoot.querySelector('[data-goals-field="ct-type"]')?.value || "vacances"
      ).toLowerCase();
      const ctLabelNode = goalsRoot.querySelector(
        `[data-goals-field="ct-type"] option[value="${ctType}"]`
      );
      const ctAmount = Math.max(
        0,
        toNumber(goalsRoot.querySelector('[data-goals-field="ct-amount"]')?.value)
      );
      const ctHorizon = Math.max(
        1,
        Math.round(toNumber(goalsRoot.querySelector('[data-goals-field="ct-horizon"]')?.value || 1))
      );

      const ltType =
        goalsRoot.querySelector('[data-goals-field="lt-type"]:checked')?.value || "security";
      const ltTarget = Math.max(
        0,
        toNumber(goalsRoot.querySelector('[data-goals-field="lt-target"]')?.value)
      );
      const ltHorizon = Math.max(
        3,
        Math.round(toNumber(goalsRoot.querySelector('[data-goals-field="lt-horizon"]')?.value || 10))
      );

      return {
        leisureMonthly,
        shortTerm: {
          enabled: ctEnabled,
          type: ctType,
          name: String(ctLabelNode?.textContent || "Vacances").trim(),
          label: String(ctLabelNode?.textContent || "Vacances").trim(),
          amount: ctAmount,
          horizonYears: ctHorizon,
        },
        longTerm: {
          enabled: true,
          type: String(ltType).toLowerCase(),
          amount: ltTarget,
          horizonYears: ltHorizon,
        },
      };
    };

    const updateLocalFeedback = () => {
      const values = readGoalsValues();
      const monthlyAvailableBeforePlan = Math.max(
        0,
        toNumber(goalsRoot.dataset.monthlyAvailableBeforePlan || 0)
      );
      const remainingAfterLifeBudget = Math.max(0, monthlyAvailableBeforePlan - values.leisureMonthly);
      const ctMonthly =
        values.shortTerm.enabled && values.shortTerm.amount > 0
          ? values.shortTerm.amount / (values.shortTerm.horizonYears * 12)
          : 0;
      const ltNeedMonthly =
        values.longTerm.amount > 0
          ? values.longTerm.amount / (values.longTerm.horizonYears * 12)
          : 0;
      const ltFundingMonthly = Math.max(0, toNumber(goalsRoot.dataset.ltFundingMonthly || 0));

      const variableFeedbackNode = goalsRoot.querySelector("[data-goals-variable-feedback]");
      if (variableFeedbackNode) {
        variableFeedbackNode.textContent = `Avec ce choix, il te restera ${formatCurrency(
          remainingAfterLifeBudget
        )} à répartir.`;
      }

      const ctMonthlyNode = goalsRoot.querySelector("[data-goals-ct-monthly]");
      if (ctMonthlyNode) {
        ctMonthlyNode.textContent = `Cela représente ${formatCurrency(
          ctMonthly
        )}/mois mis de côté avant la répartition.`;
      }

      const diagnosticNode = goalsRoot.querySelector("[data-goals-lt-diagnostic]");
      if (diagnosticNode) {
        const lines = diagnosticNode.querySelectorAll("p");
        if (lines[0]) lines[0].textContent = `Besoin mensuel: ${formatCurrency(ltNeedMonthly)}`;
        if (lines[1]) lines[1].textContent = `Financement actuel: ${formatCurrency(ltFundingMonthly)}/mois`;
      }

      setText(
        "[data-goals-impact-summary-life]",
        `${formatCurrency(values.leisureMonthly)} utilisés · ${formatCurrency(
          remainingAfterLifeBudget
        )} à répartir`
      );
      setText(
        "[data-goals-impact-summary-ct]",
        values.shortTerm.enabled
          ? `${formatCurrency(values.shortTerm.amount)} sur ${values.shortTerm.horizonYears} an${
              values.shortTerm.horizonYears > 1 ? "s" : ""
            } · ${formatCurrency(ctMonthly)}/mois`
          : "Non actif"
      );
      setText(
        "[data-goals-impact-summary-lt]",
        values.longTerm.amount > 0
          ? `${formatCurrency(values.longTerm.amount)} sur ${values.longTerm.horizonYears} an${
              values.longTerm.horizonYears > 1 ? "s" : ""
            } · besoin ${formatCurrency(ltNeedMonthly)}/mois`
          : `Horizon ${values.longTerm.horizonYears} an${
              values.longTerm.horizonYears > 1 ? "s" : ""
            } · cible non définie`
      );

      const statusNode = goalsRoot.querySelector("[data-goals-lt-status]");
      if (statusNode) {
        statusNode.classList.remove("is-green", "is-orange", "is-red", "is-neutral");
        if (ltNeedMonthly <= 0) {
          statusNode.classList.add("is-neutral");
          statusNode.textContent = "Renseigne une cible et un horizon pour le diagnostic.";
        } else {
          const ratio = ltFundingMonthly / ltNeedMonthly;
          if (ratio >= 1) {
            statusNode.classList.add("is-green");
            statusNode.textContent = "Dans les temps.";
          } else if (ratio >= 0.75) {
            statusNode.classList.add("is-orange");
            statusNode.textContent = "En retard: accélération conseillée.";
          } else {
            statusNode.classList.add("is-red");
            statusNode.textContent = "Hors trajectoire: ajustement nécessaire.";
          }
        }
      }
    };

    const applyLtDefaults = () => {
      const selectedType =
        goalsRoot.querySelector('[data-goals-field="lt-type"]:checked')?.value || "security";
      const defaults = LT_DEFAULTS[String(selectedType).toLowerCase()] || LT_DEFAULTS.security;
      const ltTargetNode = goalsRoot.querySelector('[data-goals-field="lt-target"]');
      const ltHorizonNode = goalsRoot.querySelector('[data-goals-field="lt-horizon"]');
      if (ltTargetNode) ltTargetNode.value = String(Math.round(defaults.target));
      if (ltHorizonNode) ltHorizonNode.value = String(Math.round(defaults.horizonYears));
    };

    const scheduleSave = () => {
      if (goalsSaveTimer) clearTimeout(goalsSaveTimer);
      setSavingLabel("Enregistrement...");
      goalsSaveTimer = setTimeout(() => {
        const activeUser = window.loadActiveUser?.();
        if (!activeUser?.id || typeof window.updateProfileData !== "function") {
          setSavingLabel("Enregistrement indisponible");
          return;
        }
        const values = readGoalsValues();
        const updatedProfile = window.updateProfileData(activeUser.id, (profile) => {
          if (!profile || typeof profile !== "object") return;
          profile.allocationPlan =
            profile.allocationPlan && typeof profile.allocationPlan === "object"
              ? profile.allocationPlan
              : {};
          profile.allocationPlan.leisureMonthly = values.leisureMonthly;
          profile.allocationPlan.shortTerm = values.shortTerm;
          profile.allocationPlan.longTerm = values.longTerm;
        });
        const store = getMonthlyStore();
        const activeMonthId = lastMonthlyContext?.monthId || null;
        if (
          store &&
          updatedProfile &&
          activeMonthId &&
          typeof store.regeneratePlanForMonth === "function"
        ) {
          const userState = typeof store.getStateForUser === "function"
            ? store.getStateForUser(activeUser.id)
            : null;
          const monthStatus = userState?.monthlyPlan?.[activeMonthId]?.flags?.monthStatus || "active";
          if (monthStatus !== "closed") {
            const nextData =
              typeof window.buildMvpData === "function" ? window.buildMvpData(updatedProfile) : {};
            store.regeneratePlanForMonth({
              userId: activeUser.id,
              monthId: activeMonthId,
              formData: updatedProfile,
              mvpData: nextData,
            });
          }
        }
        setSavingLabel("Enregistré");
        renderAll();
      }, 260);
    };

    const syncLifeBudgetFields = (source) => {
      const sliderNode = goalsRoot.querySelector('[data-goals-field="leisure-slider"]');
      const inputNode = goalsRoot.querySelector('[data-goals-field="leisure-input"]');
      if (!sliderNode || !inputNode) return;
      const max = Math.max(0, toNumber(sliderNode.max));
      if (source === "slider") {
        const next = Math.max(0, Math.min(max, toNumber(sliderNode.value)));
        inputNode.value = String(Math.round(next));
      } else {
        const next = Math.max(0, Math.min(max, toNumber(inputNode.value)));
        sliderNode.value = String(Math.round(next));
      }
    };

    goalsRoot.addEventListener("input", (event) => {
      const field = event.target.closest("[data-goals-field]");
      if (!field) return;

      const key = String(field.dataset.goalsField || "");
      if (key === "leisure-slider") syncLifeBudgetFields("slider");
      if (key === "leisure-input") syncLifeBudgetFields("input");

      if (key === "ct-enabled") {
        const fieldsNode = goalsRoot.querySelector("[data-goals-ct-fields]");
        if (fieldsNode) fieldsNode.hidden = !field.checked;
      }
      if (key === "lt-type") {
        applyLtDefaults();
      }

      updateLocalFeedback();
      const shouldAutosaveOnInput = [
        "leisure-slider",
        "ct-enabled",
        "ct-type",
        "lt-type",
      ].includes(key);
      if (shouldAutosaveOnInput) {
        scheduleSave();
      }
    });

    goalsRoot.addEventListener("change", (event) => {
      const field = event.target.closest("[data-goals-field]");
      if (!field) return;
      const key = String(field.dataset.goalsField || "");
      if (key === "lt-type") {
        applyLtDefaults();
      }
      updateLocalFeedback();
      scheduleSave();
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
    setupGoalsEditor();
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
