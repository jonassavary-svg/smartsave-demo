(() => {
  const ACTIONS_STORAGE_KEY = "smartsaveHubActionState";
  const TRANSACTIONS_KEY = "transactions";
  const STORAGE_KEY_FORM = "smartsaveFormData";
  const PROFILE_UPDATE_KEY = "smartsaveProfileUpdated";
  const MONTH_STATE_KEY = "smartsaveMonthState";
  const SNAPSHOT_STORAGE_KEY = "smartsaveSnapshots";
  let futureRangeYears = 10;
  let lastRenderContext = null;

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

  const loadTransactions = (activeUser) => {
    try {
      const stored = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
      const list = Array.isArray(stored) ? stored : [];
      const filtered = activeUser?.id
        ? list.filter((item) => !item.userId || item.userId === activeUser.id)
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
  });

  const ensureMonthState = (activeUser, formData) => {
    if (!activeUser?.id || !formData) return null;
    const state = loadMonthState();
    const userState = state[activeUser.id];
    if (userState?.activeMonthKey && userState?.months?.[userState.activeMonthKey]) {
      return { state, userState };
    }

    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    const startingBalances = normalizeBalances(resolveBalances(formData));
    const monthEntry = {
      status: "open",
      openedAt: now.toISOString(),
      closedAt: null,
      startingBalances,
      closingBalances: null,
    };

    const nextState = {
      activeMonthKey: currentMonthKey,
      initialMonthKey: currentMonthKey,
      months: {
        [currentMonthKey]: monthEntry,
      },
    };

    state[activeUser.id] = nextState;
    saveMonthState(state);
    return { state, userState: nextState };
  };

  const getActiveMonthEntry = (activeUser, formData) => {
    const result = ensureMonthState(activeUser, formData);
    if (!result) return null;
    const { state, userState } = result;
    const activeKey = userState.activeMonthKey || getMonthKey(new Date());
    return { state, userState, activeKey, month: userState.months?.[activeKey] };
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
    if (!activeMonth || activeMonth.status === "closed") return null;

    const monthTransactions = getMonthTransactions(transactions, activeKey);
    const closingBalances = applyMonthTransactions(activeMonth.startingBalances, monthTransactions).balances;
    activeMonth.status = "closed";
    activeMonth.closedAt = new Date().toISOString();
    activeMonth.closingBalances = normalizeBalances(closingBalances);

    const nextStart = addMonths(parseMonthKey(activeKey), 1);
    if (!nextStart) return null;
    const nextKey = getMonthKey(nextStart);
    userState.activeMonthKey = nextKey;
    userState.initialMonthKey = userState.initialMonthKey || activeKey;
    userState.months[nextKey] = {
      status: "open",
      openedAt: new Date().toISOString(),
      closedAt: null,
      startingBalances: normalizeBalances(closingBalances),
      closingBalances: null,
    };

    state[activeUser.id] = userState;
    saveMonthState(state);
    addFixedTransactionsForMonth(activeUser, formData, nextKey);

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
        applyDelta(entry.from, entry.fromLabel, -amount);
        applyDelta(entry.to, entry.toLabel, amount);
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
      return raw ? JSON.parse(raw) : {};
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
      "thirdPillarAmount",
      "thirdPillar",
      "pillar3",
      "pilier3a",
      "thirdPillarValue",
    ]);
    return {
      current,
      security,
      tax,
      investments,
      pillar3a,
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
    if (!document.querySelector("[data-home-available]")) return;

    const monthInfo = getActiveMonthEntry(activeUser, formData);
    const fallbackBalances = resolveBalances(formData);
    const activeMonthKey = monthInfo?.activeKey || getMonthKey(new Date());
    const startingBalances = monthInfo?.month?.startingBalances
      ? normalizeBalances(monthInfo.month.startingBalances)
      : normalizeBalances(fallbackBalances);

    const goals = resolveGoals(formData);
    const now = new Date();
    let monthIncomeDelta = 0;
    let monthExpenseDelta = 0;
    const baseMonthlyIncome = 0;
    const baseMonthlyExpenses = 0;
    const allocations = data.allocation?.allocations || {};
    const transactions = loadTransactions(activeUser);
    const monthTransactions = getMonthTransactions(transactions, activeMonthKey);
    const adjusted = applyMonthTransactions(startingBalances, monthTransactions);
    const adjustedBalances = adjusted.balances;
    const extraAccounts = adjusted.extras;

    monthTransactions.forEach((entry) => {
      const amount = Math.max(0, toNumber(entry.amount));
      if (entry.type === "income") monthIncomeDelta += amount;
      if (entry.type === "expense") monthExpenseDelta += amount;
    });

    const displayMonthlyIncome = baseMonthlyIncome + monthIncomeDelta;
    const displayMonthlyExpenses = baseMonthlyExpenses + monthExpenseDelta;
    const saved = displayMonthlyIncome - displayMonthlyExpenses;

    setText("[data-home-available]", formatCurrency(adjustedBalances.current));
    setText("[data-home-income]", formatCurrency(displayMonthlyIncome));
    setText("[data-home-expenses]", formatCurrency(displayMonthlyExpenses));
    setText("[data-home-saved]", formatCurrency(saved));
    setText("[data-home-saved-delta]", formatSignedCurrency(saved));

    const planIncome = getMonthlyIncomeEstimate(formData);
    const planFixed = getMonthlyExpenseTotal(formData.expenses?.fixed);
    const planVariable = getMonthlyExpenseTotal(formData.expenses?.variable);
    const planTax = Math.max(
      0,
      toNumber(data?.taxProvision?.monthlyAmount || data?.taxProvision?.monthlyNeed || 0)
    );
    const planForecast = planIncome - planFixed - planVariable - planTax;
    const planReal = toNumber(adjustedBalances.current);
    const planGap = planReal - planForecast;

    setText("[data-plan-income]", formatCurrency(planIncome));
    setText("[data-plan-fixed]", formatCurrency(planFixed));
    setText("[data-plan-variable]", formatCurrency(planVariable));
    setText("[data-plan-tax]", formatCurrency(planTax));
    setText("[data-plan-forecast]", formatCurrency(planForecast));
    setText("[data-plan-real]", formatCurrency(planReal));
    setText("[data-plan-gap]", formatSignedCurrency(planGap));

    const budgetsContainer = document.querySelector("[data-variable-budgets]");
    if (budgetsContainer) {
      const variableEntries = ensureArray(formData.expenses?.variable);
      if (!variableEntries.length) {
        budgetsContainer.innerHTML = '<div class="mini-card">Aucun budget variable renseigné.</div>';
      } else {
        const monthExpenses = monthTransactions.filter(
          (entry) => entry?.type === "expense" && entry?.category
        );

        budgetsContainer.innerHTML = variableEntries
          .map((entry, index) => {
            const label = entry?.label || entry?.name || `Budget ${index + 1}`;
            const budget = resolveMonthlyExpenseAmount(entry);
            const spent = monthExpenses.reduce((sum, item) => {
              return normalizeLabel(item.category) === normalizeLabel(label)
                ? sum + Math.max(0, toNumber(item.amount))
                : sum;
            }, 0);
            const remaining = budget - spent;
            const percent = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
            return `
              <article class="allocation-card card">
                <div class="allocation-card__header">
                  <span class="allocation-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M6 4h11l3 3v13H4V4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                      <path d="M8 4v6h7V4" fill="none" stroke="currentColor" stroke-width="1.8" />
                    </svg>
                  </span>
                  <div class="allocation-card__title">
                    <p>${label}</p>
                    <small>Budget mensuel</small>
                  </div>
                  <div class="allocation-card__value">
                    <strong>${formatCurrency(budget)}</strong>
                    <span>${percent}%</span>
                  </div>
                </div>
                <div class="progress-track">
                  <span class="progress-fill" style="width:${percent}%"></span>
                </div>
                <small class="allocation-card__note">Dépensé: ${formatCurrency(spent)} · Reste: ${formatSignedCurrency(remaining)}</small>
              </article>
            `;
          })
          .join("");
      }
    }

    const chart = document.querySelector("[data-home-chart]");
    if (chart) {
      const monthKeys = [];
      for (let i = 5; i >= 0; i -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = getMonthKey(date);
        monthKeys.push({ key, date });
      }

      const buckets = monthKeys.reduce((acc, item, index) => {
        acc[item.key] = {
          label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(item.date),
          income: index === monthKeys.length - 1 ? baseMonthlyIncome : 0,
          expense: index === monthKeys.length - 1 ? baseMonthlyExpenses : 0,
        };
        return acc;
      }, {});

      transactions.forEach((entry) => {
        if (!entry?.date) return;
        const date = new Date(entry.date);
        if (Number.isNaN(date.getTime())) return;
        const key = getMonthKey(date);
        if (!buckets[key]) return;
        const amount = Math.max(0, toNumber(entry.amount));
        if (entry.type === "income") {
          buckets[key].income += amount;
        } else if (entry.type === "expense") {
          buckets[key].expense += amount;
        }
      });

      const series = monthKeys.map((item) => buckets[item.key]);
      const maxValue = Math.max(
        ...series.map((item) => item.income),
        ...series.map((item) => item.expense),
        1
      );

      chart.innerHTML = series
        .map((item) => {
          const incomeValue = item.income;
          const expenseValue = item.expense;
          const incomeHeight = Math.round((incomeValue / maxValue) * 100);
          const expenseHeight = Math.round((expenseValue / maxValue) * 100);
          return `
            <div class="chart-bar-group">
              <div class="chart-bars">
                <div class="chart-bar chart-bar--income" style="height:${incomeHeight}%">
                  <span class="chart-value">${formatChartCurrency(incomeValue)}</span>
                </div>
                <div class="chart-bar chart-bar--expense" style="height:${expenseHeight}%">
                  <span class="chart-value">${formatChartCurrency(expenseValue)}</span>
                </div>
              </div>
              <span class="chart-label">${item.label}</span>
            </div>
          `;
        })
        .join("");
    }

    const recentList = document.querySelector("[data-home-transactions]");
    if (recentList) {
      const recent = loadTransactions(activeUser).slice(0, 5);
      renderTransactionList(recentList, recent, "Aucune transaction récente.");
    }

    const debug = data.allocation?.debug || {};
    const savingsTargets = debug.savingsTargets || {};
    const taxInfo = data.taxProvision || {};
    const currentTarget = Math.max(0, toNumber(debug.currentTarget || 0));
    const securityTarget = Math.max(0, toNumber(savingsTargets.targetAmount || 0));
    const taxTarget = Math.max(
      0,
      toNumber(taxInfo.remaining || taxInfo.outstanding || taxInfo.totalTax || 0)
    );

    const accountsContainer = document.querySelector("[data-home-accounts]");
    const accountConfigs = [
      {
        key: "current",
        label: "Compte courant",
        subtitle: "Everyday spending",
        balance: adjustedBalances.current,
        target: currentTarget,
        icon: "M5 7h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm2 4h4",
        style: "current",
      },
      {
        key: "security",
        label: "Compte épargne",
        subtitle: "Emergency Fund",
        balance: adjustedBalances.security,
        target: securityTarget,
        icon: "M12 3l7 4v5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V7l7-4z",
        style: "security",
      },
      {
        key: "tax",
        label: "Provision impôts",
        subtitle: "Tax provision",
        balance: adjustedBalances.tax,
        target: taxTarget,
        icon: "M7 4h8l3 3v13H7z",
        style: "tax",
      },
      {
        key: "investments",
        label: "Investissements",
        subtitle: "Growth",
        balance: adjustedBalances.investments,
        target: Math.max(0, toNumber(allocations.investissements)),
        icon: "M5 17l4-5 4 3 6-7",
        style: "growth",
      },
      {
        key: "pillar3a",
        label: "3e pilier",
        subtitle: "Retirement",
        balance: adjustedBalances.pillar3a,
        target: Math.max(0, toNumber(allocations.pilier3a)),
        icon: "M7 5h10v3H7zM5 10h14v9H5z",
        style: "pillar",
      },
    ];

    const extraConfigs = Object.entries(extraAccounts).map(([label, balance]) => ({
      key: `custom-${label}`,
      label,
      subtitle: "Compte personnalisé",
      balance,
      target: 0,
      icon: "M5 7h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm2 4h4",
      style: "current",
      custom: true,
    }));

    const allAccounts = accountConfigs.concat(extraConfigs);
    const displayAccounts = allAccounts.filter(
      (account) => (account.balance || 0) !== 0 || (account.target || 0) > 0
    );
    const modalAccounts = allAccounts.length ? allAccounts : accountConfigs.slice(0, 3);
    if (accountsContainer) {
      accountsContainer.innerHTML = displayAccounts
        .map((account) => {
          const target = Math.max(0, account.target || 0);
          const percent = target > 0 ? Math.round((account.balance / target) * 100) : 0;
          const progress = target > 0 ? Math.min(100, percent) : 0;
          const progressLabel =
            target > 0
              ? `${Math.min(100, percent)}% of target (${formatCurrency(target)})`
              : "Target SmartSave —";
          return `
            <article class="account-card account-card--${account.style}">
              <div class="account-card__header">
                <span class="account-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="${account.icon}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <div>
                  <p>${account.label}</p>
                  <small>${account.subtitle}</small>
                </div>
                <strong>${formatCurrency(account.balance)}</strong>
              </div>
              <div class="progress-track">
                <span class="progress-fill" style="width:${progress}%"></span>
              </div>
              <small>${progressLabel}</small>
            </article>
          `;
        })
        .join("");
    }

    const modalSelects = {
      account: document.querySelector("[data-quick-field=\"account\"] select"),
      from: document.querySelector("[data-quick-field=\"transfer\"] select[name=\"from\"]"),
      to: document.querySelector("[data-quick-field=\"transfer\"] select[name=\"to\"]"),
    };

    const accountOptionMarkup = `${modalAccounts
      .map((account) => `<option value="${account.key}">${account.label}</option>`)
      .join("")}<option value="__other__">Autre</option>`;

    const transferOptionMarkup = modalAccounts
      .map((account) => `<option value="${account.key}">${account.label}</option>`)
      .join("");

    if (modalSelects.account) {
      modalSelects.account.innerHTML = accountOptionMarkup;
    }
    if (modalSelects.from) {
      modalSelects.from.innerHTML = transferOptionMarkup;
    }
    if (modalSelects.to) {
      modalSelects.to.innerHTML = transferOptionMarkup;
    }
  };

  const renderSmartSave = (data, formData) => {
    if (!document.querySelector("[data-allocation-total]")) return;

    const allocations = data.allocation?.allocations || {};
    const balances = resolveBalances(formData);
    const goals = resolveGoals(formData);
    const taxInfo = data.taxProvision || {};

    const allocationEntries = Object.values(allocations).map((value) => Math.max(0, toNumber(value)));
    const totalAllocated = allocationEntries.reduce((sum, value) => sum + value, 0);
    const monthlyToAllocate = Math.max(0, toNumber(data.allocation?.disponibleInitial));
    const allocationBase = monthlyToAllocate > 0 ? monthlyToAllocate : totalAllocated;
    const safeTotal = Math.max(1, allocationBase);

    setText("[data-allocation-total]", formatCurrency(allocationBase));

    const securityTarget = Math.max(0, toNumber(data.allocation?.debug?.savingsTargets?.targetAmount || 0));
    const securityGap = Math.max(0, securityTarget - balances.security);
    const goalGap = Math.max(0, goals.totalTarget - goals.totalSaved);
    const taxTarget = Math.max(
      0,
      toNumber(taxInfo.remaining || taxInfo.outstanding || taxInfo.totalTax || 0)
    );

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
        key: "projets",
        label: "Compte pour projets",
        subtitle: "Anticipation pillar",
        style: "anticipation",
        icon: "M7 4h10v14H7zM7 7h10",
        note: goals.totalTarget
          ? `${formatCurrency(goalGap)} more to reach target`
          : goals.primaryName || "Plan ahead for goals.",
      },
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
          const amount = Math.max(0, toNumber(allocations[item.key] || 0));
          const percent = Math.round((amount / safeTotal) * 100);
          return { ...item, amount, percent, index };
        })
        .sort((a, b) => b.amount - a.amount || a.index - b.index);

      list.innerHTML = sortedItems
        .map((item) => {
          const percent = item.percent;
          return `
            <article class="allocation-card card allocation-card--${item.style}">
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
      if (securityTarget && securityGap > 0) {
        nextNote.textContent = `Focus on building your emergency fund. Allocate ${formatCurrency(
          Math.min(securityGap, allocations.securite || securityGap)
        )} from your next salary.`;
      } else if (goalGap > 0) {
        nextNote.textContent = `Keep funding your goals. Allocate ${formatCurrency(
          Math.min(goalGap, allocations.projets || goalGap)
        )} this month.`;
      } else {
        nextNote.textContent = "You are on track. Continue investing for long-term growth.";
      }
    }
  };

  const renderActions = (data, formData) => {
    const list = document.querySelector("[data-actions-list]");
    if (!list) return;

    const monthNode = document.querySelector("[data-actions-month]");
    if (monthNode) {
      monthNode.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
        new Date()
      );
    }

    const allocations = data.allocation?.allocations || {};
    const balances = resolveBalances(formData || {});
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
      projets: "Compte pour projets",
      investissements: "Investissements",
      pilier3a: "3e pilier",
      impots: "Provision impôts",
    };

    const getAccountLabel = (key) => ACCOUNT_LABELS[key] || key;

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

    // 1) Transferts liés à l'allocation SmartSave mensuelle
    const allocationTransfers = [
      { key: "securite", from: "compteCourant", to: "securite" },
      { key: "projets", from: "compteCourant", to: "projets" },
      { key: "impots", from: "compteCourant", to: "impots" },
      { key: "investissements", from: "compteCourant", to: "investissements" },
      { key: "pilier3a", from: "compteCourant", to: "pilier3a" },
    ];
    allocationTransfers.forEach((transfer) => {
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
          { key: "projets", capacity: goalGap },
          { key: "impots", capacity: taxGap },
        ],
        "investissements"
      );
      addAction({
        key: "action-overflow-compte-courant",
        kind: "account-reduction",
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
            { key: "projets", capacity: goalGap },
            { key: "impots", capacity: taxGap },
          ],
          "investissements"
        );
        addAction({
          key: "action-overflow-compte-epargne",
          kind: "account-reduction",
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

    const state = loadActionState();
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
        saveActionState(state);
        updateProgress();
      });
      list.dataset.actionsListener = "true";
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

  const renderScore = (data) => {
    const container = document.querySelector("[data-score-breakdown]");
    if (!container) return;

    const scoreData = data.score || {};
    const totalScore = Math.round(scoreData.score || 0);
    setText("[data-score-total]", totalScore);

    const pillarNote = (value) => {
      if (value >= 80) return "Excellent! Above average";
      if (value >= 65) return "Good progress, keep building";
      if (value >= 50) return "On track, room to grow";
      return "Needs attention";
    };

    const pillars = scoreData.pillars || {};
    const breakdown = [
      {
        key: "securite",
        label: "Sécurité",
        value: pillars.securite?.score ?? 0,
        color: "#2563eb",
      },
      {
        key: "anticipation",
        label: "Anticipation",
        value: pillars.anticipation?.score ?? 0,
        color: "#7c3aed",
      },
      {
        key: "croissance",
        label: "Croissance",
        value: pillars.croissance?.score ?? 0,
        color: "#16a34a",
      },
    ];

    container.innerHTML = breakdown
      .map((entry) => {
        const percent = Math.max(0, Math.min(100, Math.round(entry.value || 0)));
        return `
          <article class=\"score-breakdown-card card\">\n            <div class=\"breakdown-header\">\n              <div>\n                <div class=\"breakdown-title\">${entry.label}</div>\n                <div class=\"breakdown-subtitle\">${pillarNote(percent)}</div>\n              </div>\n              <div class=\"breakdown-score\">${percent}</div>\n            </div>\n            <div class=\"progress-track\">\n              <span class=\"progress-fill\" style=\"width:${percent}%; background:${entry.color}\"></span>\n            </div>\n          </article>\n        `;
      })
      .join("");

    const recList = document.querySelector("[data-score-recommendations]");
    if (recList) {
      const recs = Array.isArray(scoreData.recommandations) ? scoreData.recommandations : [];
      recList.innerHTML = recs
        .slice(0, 3)
        .map((rec) => `<li>${rec}</li>`)
        .join("");
    }

    const scoreBar = document.querySelector(".score-bar__fill");
    setWidth(scoreBar, totalScore);
    const trend = document.querySelector("[data-score-trend]");
    if (trend) {
      trend.textContent = totalScore >= 70 ? "Keep going! You're on track." : "Room to improve this month.";
    }
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
      const info = getActiveMonthEntry(activeUser, formData);
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
      if (window.loadActiveUser) {
        const activeUser = window.loadActiveUser();
        if (activeUser?.id) entry.userId = activeUser.id;
      }

      if (type === "transfer") {
        entry.from = formData.get("from") || "current";
        entry.to = formData.get("to") || "security";
        if (entry.from === entry.to) return;
      } else {
        const accountValue = formData.get("account") || "current";
        if (accountValue === "__other__") {
          const accountName = String(formData.get("accountOther") || "").trim();
          if (!accountName) return;
          entry.account = "custom";
          entry.accountLabel = accountName;
        } else {
          entry.account = accountValue;
        }

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

    ensureMonthState(activeUser, formData);
    ensureMonthRollover(activeUser, formData, loadTransactions(activeUser));

    const data = buildMvpData(formData);
    lastRenderContext = { data, formData };
    renderHome(data, formData, activeUser);
    renderSmartSave(data, formData);
    renderActions(data, formData);
    renderFuture(data, formData);
    renderScore(data);
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
      "<span>Mes dépenses</span>";

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

  document.addEventListener("DOMContentLoaded", () => {
    ensureUserMenuExpensesLink();
    renderAll();
    setupUserMenu();
    setupHamburgerMenu();
    setupQuickActions();
    setupTransactionDeletes();
    setupFutureRangeToggle();
  });

  window.addEventListener("storage", (event) => {
    if (!event) return;
    if (event.key === STORAGE_KEY_FORM || event.key === PROFILE_UPDATE_KEY) {
      renderAll();
    }
  });

  window.addEventListener("pageshow", () => {
    renderAll();
  });

})();
