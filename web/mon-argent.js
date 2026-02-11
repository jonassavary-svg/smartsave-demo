(() => {
  // LocalStorage is scoped per origin (host+port). Changing the preview URL resets data visibility.
  const TRANSACTIONS_KEY = "transactions";
  const MONTH_STATE_KEY = "smartsaveMonthState";
  const ACCOUNT_LABELS = {
    current: "Compte courant",
    security: "Compte épargne",
    tax: "Provision impôts",
    investments: "Investissements",
    pillar3a: "3e pilier",
    growth: "Investissements",
  };

  const loadJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_error) {
      return fallback;
    }
  };

  const saveJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // ignore storage issues
    }
  };

  const toNumber = (value) => {
    if (typeof window.toNumber === "function") return window.toNumber(value);
    const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatCurrency = (value) => {
    if (typeof window.formatCurrency === "function") {
      return window.formatCurrency(value);
    }
    const amount = Number.isFinite(value) ? value : toNumber(value);
    return new Intl.NumberFormat("fr-CH", {
      style: "currency",
      currency: "CHF",
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  const formatChartCurrency = (value) => {
    const numeric = Number.isFinite(value) ? value : toNumber(value);
    const abs = Math.abs(numeric);
    if (abs >= 1000000) return `CHF ${(abs / 1000000).toFixed(1)}m`;
    if (abs >= 1000) return `CHF ${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
    return formatCurrency(abs);
  };

  const formatSignedCurrency = (value) => {
    const amount = Number.isFinite(value) ? value : toNumber(value);
    const formatted = formatCurrency(Math.abs(amount));
    return amount < 0 ? `-${formatted}` : `+${formatted}`;
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

  const getMonthKey = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return "";
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const parseMonthKey = (key) => {
    const parts = String(key || "").split("-");
    if (parts.length !== 2) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return new Date(year, month, 1);
  };

  const normalizeMonthKeyString = (key) => {
    const parts = String(key || "").split("-");
    if (parts.length !== 2) return key;
    const year = parts[0];
    const rawMonth = parts[1];
    const monthNumber = Number(rawMonth);
    if (!Number.isFinite(monthNumber)) return key;
    if (rawMonth.length === 1 || rawMonth === "00") {
      const fixed = String(monthNumber + 1).padStart(2, "0");
      return `${year}-${fixed}`;
    }
    return key;
  };

  const addMonths = (date, count) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return null;
    return new Date(target.getFullYear(), target.getMonth() + count, 1);
  };

  const formatMonthLabel = (monthKey) => {
    const date = parseMonthKey(monthKey);
    if (!date) return "—";
    return new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(date);
  };

  const normalizeLabel = (value) => String(value || "").trim().toLowerCase();

  const loadTransactions = () => {
    const list = Array.isArray(loadJson(TRANSACTIONS_KEY, []))
      ? loadJson(TRANSACTIONS_KEY, [])
      : [];
    if (!localStorage.getItem(TRANSACTIONS_KEY)) {
      saveJson(TRANSACTIONS_KEY, list);
    }
    return list;
  };

  const saveTransactions = (items) => saveJson(TRANSACTIONS_KEY, items);

  const loadActiveUser = () => {
    if (typeof window.loadActiveUser === "function") return window.loadActiveUser();
    const data = loadJson("smartsaveActiveUser", null);
    return data?.id ? data : null;
  };

  const loadUserForm = (userId) => {
    if (typeof window.loadUserForm === "function") return window.loadUserForm(userId);
    const data = loadJson("smartsaveFormData", null);
    return data?.[userId] || data?.__default || null;
  };

  const resolveBalancesFromAssets = (formData = {}) => {
    const assets = formData.assets || {};
    const sumKeys = (keys) =>
      keys.reduce((sum, key) => sum + Math.max(0, toNumber(assets[key])), 0);

    const current = sumKeys([
      "currentAccount",
      "compteCourant",
      "checking",
      "paymentAccount",
      "paymentBalance",
    ]);

    const security = sumKeys([
      "securitySavings",
      "securityBalance",
      "savingsAccount",
      "savings",
      "epargne",
      "blocked",
      "securityBlocked",
      "blockedAccounts",
      "blockedAccount",
      "compteBloque",
    ]);

    const tax = sumKeys([
      "taxProvision",
      "impotsProvision",
      "provisionImpots",
      "impots",
      "taxesProvision",
    ]);

    const investments = sumKeys([
      "investments",
      "investmentAccount",
      "portfolio",
      "portefeuille",
      "placements",
    ]);

    const pillar3a = sumKeys([
      "thirdPillarAmount",
      "thirdPillar",
      "pillar3",
      "pilier3a",
      "thirdPillarValue",
    ]);

    return { current, security, tax, investments, pillar3a };
  };

  const getAccountTargets = (data = {}) => {
    const allocations = data?.allocation?.allocations || {};
    const debug = data?.allocation?.debug || {};
    const savingsTargets = debug.savingsTargets || {};
    return {
      currentTarget: Math.max(0, toNumber(debug.currentTarget)),
      securityTarget: Math.max(0, toNumber(savingsTargets.targetAmount)),
      taxTarget: Math.max(
        0,
        toNumber(
          data?.taxProvision?.totalTax ||
            data?.taxProvision?.outstanding ||
            data?.taxProvision?.remaining
        )
      ),
      monthlyInvest: Math.max(0, toNumber(allocations.investissements)),
      monthlyPillar: Math.max(0, toNumber(allocations.pilier3a)),
      monthlyGrowth: Math.max(
        0,
        toNumber(allocations.investissements) + toNumber(allocations.pilier3a)
      ),
    };
  };

  const buildAccountModels = (balances = {}, data = {}) => {
    const targets = getAccountTargets(data);
    const accounts = [];

    accounts.push({
      key: "current",
      label: "Compte courant",
      type: "Courant",
      balance: balances.current,
      target: targets.currentTarget,
      targetLabel: "Cible SmartSave",
    });

    accounts.push({
      key: "security",
      label: "Compte épargne",
      type: "Épargne",
      balance: balances.security,
      target: targets.securityTarget,
      targetLabel: "Cible SmartSave",
    });

    accounts.push({
      key: "tax",
      label: "Provision impôts",
      type: "Impôts",
      balance: balances.tax,
      target: targets.taxTarget,
      targetLabel: "Cible SmartSave",
    });

    const hasInvestments = toNumber(balances.investments) > 0 || targets.monthlyInvest > 0;
    const hasPillar = toNumber(balances.pillar3a) > 0 || targets.monthlyPillar > 0;

    if (hasInvestments) {
      accounts.push({
        key: "investments",
        label: "Investissements",
        type: "Investissement",
        balance: balances.investments,
        target: targets.monthlyInvest,
        targetLabel: "Cible mensuelle",
      });
    }

    if (hasPillar) {
      accounts.push({
        key: "pillar3a",
        label: "3e pilier",
        type: "3e pilier",
        balance: balances.pillar3a,
        target: targets.monthlyPillar,
        targetLabel: "Cible mensuelle",
      });
    }

    if (!hasInvestments && !hasPillar) {
      accounts.push({
        key: "growth",
        label: "Investissements",
        type: "Investissement",
        balance: toNumber(balances.investments) + toNumber(balances.pillar3a),
        target: targets.monthlyGrowth,
        targetLabel: "Cible mensuelle",
      });
    }

    return accounts;
  };

  const renderAccountsOverview = (balances = {}, data = {}) => {
    const container = document.querySelector("[data-home-accounts]");
    if (!container) return;
    const accounts = buildAccountModels(balances, data);
    if (!accounts.length) {
      container.innerHTML = '<div class="mini-card">Aucun compte disponible.</div>';
      return;
    }

    container.innerHTML = accounts
      .map((account) => {
        const target = Math.max(0, toNumber(account.target));
        const balance = Math.max(0, toNumber(account.balance));
        const delta = target ? balance - target : null;
        const ratio = target ? Math.min(1.5, Math.max(0, balance / target)) : 0;
        let status = "—";
        let statusState = "";
        if (target) {
          if (delta >= 0 && delta / target <= 0.1) {
            status = "OK";
            statusState = "ok";
          } else if (delta > 0) {
            status = "Trop élevé";
            statusState = "warn";
          } else {
            status = "À compléter";
            statusState = "warn";
          }
        }
        const deltaLabel = delta == null ? "—" : `${delta >= 0 ? "+" : ""}${formatCurrency(delta)}`;
        const deltaClass = delta == null ? "" : delta >= 0 ? "delta-positive" : "delta-negative";
        return `
          <div class="account-card" data-account-key="${account.key}">
            <div class="account-card__head">
              <div>
                <h4>${account.label}</h4>
                <span class="account-badge">${account.type}</span>
              </div>
              <div class="account-delta ${deltaClass}">${deltaLabel}</div>
            </div>
            <div class="account-values">
              <div>
                <span>Actuel</span>
                <strong>${formatCurrency(balance)}</strong>
              </div>
              <div>
                <span>${account.targetLabel}</span>
                <strong>${target ? formatCurrency(target) : "—"}</strong>
              </div>
            </div>
            <div class="progress-inline">
              <span class="progress-inline__fill" style="width:${target ? Math.min(100, ratio * 100) : 0}%"></span>
            </div>
            <span class="account-status" data-state="${statusState}">${status}</span>
          </div>
        `;
      })
      .join("");
  };

  const normalizeBalances = (balances = {}) => ({
    current: toNumber(balances.current),
    security: toNumber(balances.security),
    tax: toNumber(balances.tax),
    investments: toNumber(balances.investments),
    pillar3a: toNumber(balances.pillar3a),
  });

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
        applyDelta(entry.account || "current", entry.accountLabel, amount);
      } else if (entry.type === "expense") {
        applyDelta(entry.account || "current", entry.accountLabel, -amount);
      } else if (entry.type === "transfer") {
        applyDelta(entry.from, entry.fromLabel, -amount);
        applyDelta(entry.to, entry.toLabel, amount);
      }
    });

    return { balances: updated, extras };
  };

  const loadMonthState = () => loadJson(MONTH_STATE_KEY, {});

  const saveMonthState = (state) => saveJson(MONTH_STATE_KEY, state);

  const migrateMonthState = (state) => {
    let changed = false;
    const nextState = { ...state };
    Object.keys(nextState).forEach((userId) => {
      const userState = nextState[userId];
      if (!userState || !userState.months) return;
      const normalizedActive = normalizeMonthKeyString(userState.activeMonthKey);
      const normalizedInitial = normalizeMonthKeyString(userState.initialMonthKey);
      if (normalizedActive !== userState.activeMonthKey) {
        userState.activeMonthKey = normalizedActive;
        changed = true;
      }
      if (normalizedInitial !== userState.initialMonthKey) {
        userState.initialMonthKey = normalizedInitial;
        changed = true;
      }
      const normalizedMonths = {};
      Object.keys(userState.months).forEach((key) => {
        const normalizedKey = normalizeMonthKeyString(key);
        if (normalizedKey !== key) changed = true;
        normalizedMonths[normalizedKey] = userState.months[key];
      });
      userState.months = normalizedMonths;
    });
    return { state: nextState, changed };
  };

  const migrateFixedMonthKeys = (transactions) => {
    let changed = false;
    const next = transactions.map((entry) => {
      if (!entry?.fixedMonthKey) return entry;
      const normalized = normalizeMonthKeyString(entry.fixedMonthKey);
      if (normalized === entry.fixedMonthKey) return entry;
      changed = true;
      return { ...entry, fixedMonthKey: normalized };
    });
    return { transactions: next, changed };
  };

  const ensureMonthState = (activeUser, formData) => {
    if (!activeUser?.id || !formData) return null;
    const storedState = loadMonthState();
    const migrated = migrateMonthState(storedState);
    const state = migrated.state;
    if (migrated.changed) {
      saveMonthState(state);
    }
    const userState = state[activeUser.id];
    if (userState?.activeMonthKey && userState?.months?.[userState.activeMonthKey]) {
      return userState;
    }

    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    const startingBalances = normalizeBalances(resolveBalancesFromAssets(formData));
    const monthEntry = {
      status: "open",
      openedAt: now.toISOString(),
      closedAt: null,
      startingBalances,
      closingBalances: null,
    };

    state[activeUser.id] = {
      activeMonthKey: currentMonthKey,
      initialMonthKey: currentMonthKey,
      months: {
        [currentMonthKey]: monthEntry,
      },
    };

    saveMonthState(state);
    return state[activeUser.id];
  };

  const getActiveMonthInfo = (activeUser, formData) => {
    const userState = ensureMonthState(activeUser, formData);
    if (!userState) return null;
    const activeKey = userState.activeMonthKey;
    const month = userState.months?.[activeKey];
    return { userState, activeKey, month };
  };

  const getMonthTransactions = (transactions, monthKey, userId) =>
    transactions.filter((entry) => {
      if (userId && entry?.userId && entry.userId !== userId) return false;
      if (!entry?.date) return false;
      return getMonthKey(entry.date) === monthKey;
    });

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
    ensureArray(entries).reduce((sum, entry) => sum + resolveMonthlyAmount(entry), 0);

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
        const amount = resolveMonthlyAmount(entry);
        if (!amount) return null;
        const label = entry?.label || entry?.name || `Charge fixe ${index + 1}`;
        return { label, amount: Math.max(0, toNumber(amount)) };
      })
      .filter(Boolean);

  const addFixedTransactionsForMonth = (activeUser, formData, monthKey) => {
    if (!activeUser?.id || !formData || !monthKey) return;
    const fixedIncomes = buildFixedIncomeEntries(formData);
    const fixedExpenses = buildFixedExpenseEntries(formData);
    if (!fixedIncomes.length && !fixedExpenses.length) return;

    const stored = loadTransactions();
    const hasFixed = stored.some(
      (entry) => entry?.userId === activeUser.id && entry?.isFixed && entry?.fixedMonthKey === monthKey
    );
    if (hasFixed) return;

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

    saveTransactions(stored);
  };

  const closeActiveMonth = (activeUser, formData, transactions = []) => {
    const state = loadMonthState();
    const userState = state?.[activeUser?.id];
    if (!userState) return null;
    const activeKey = userState.activeMonthKey;
    const activeMonth = userState.months?.[activeKey];
    if (!activeMonth || activeMonth.status === "closed") return null;

    const monthTransactions = getMonthTransactions(transactions, activeKey, activeUser.id);
    const applied = applyTransactionsToBalances(
      normalizeBalances(activeMonth.startingBalances),
      monthTransactions
    ).balances;
    const closingBalances = normalizeBalances(applied);

    activeMonth.status = "closed";
    activeMonth.closedAt = new Date().toISOString();
    activeMonth.closingBalances = closingBalances;

    const nextStart = addMonths(parseMonthKey(activeKey), 1);
    if (!nextStart) return null;
    const nextKey = getMonthKey(nextStart);
    userState.activeMonthKey = nextKey;
    userState.months[nextKey] = {
      status: "open",
      openedAt: new Date().toISOString(),
      closedAt: null,
      startingBalances: closingBalances,
      closingBalances: null,
    };

    state[activeUser.id] = userState;
    saveMonthState(state);
    addFixedTransactionsForMonth(activeUser, formData, nextKey);
    return { activeKey, nextKey };
  };

  const updateMonthHeader = (monthKey) => {
    const label = document.querySelector("[data-month-label]");
    if (!label) return;
    label.textContent = formatMonthLabel(monthKey);
  };

  const updateMonthBanner = (activeMonthKey) => {
    const banner = document.querySelector("[data-month-banner]");
    if (!banner) return;
    const currentKey = getMonthKey(new Date());
    const activeDate = parseMonthKey(activeMonthKey);
    const currentDate = parseMonthKey(currentKey);
    if (activeDate && currentDate && activeDate < currentDate) {
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  };

  const renderRealSection = (monthInfo, formData, transactions, activeUser) => {
    const startingBalances = normalizeBalances(
      monthInfo?.month?.startingBalances || resolveBalancesFromAssets(formData)
    );
    const monthTransactions = getMonthTransactions(
      transactions,
      monthInfo.activeKey,
      activeUser?.id
    );
    const applied = applyTransactionsToBalances(startingBalances, monthTransactions);
    const balances = applied.balances;

    let monthlyIncome = 0;
    let monthlyExpenses = 0;
    let transfersToTax = 0;

    monthTransactions.forEach((entry) => {
      const amount = Math.max(0, toNumber(entry.amount));
      if (!amount) return;
      if (entry.type === "income") monthlyIncome += amount;
      if (entry.type === "expense") monthlyExpenses += amount;
      if (entry.type === "transfer" && entry.to === "tax") transfersToTax += amount;
    });

    const saved = monthlyIncome - monthlyExpenses;

    const availableNode = document.querySelector("[data-home-available]");
    const incomeNode = document.querySelector("[data-home-income]");
    const expensesNode = document.querySelector("[data-home-expenses]");
    const savedNode = document.querySelector("[data-home-saved]");
    const savedDeltaNode = document.querySelector("[data-home-saved-delta]");

    if (availableNode) availableNode.textContent = formatCurrency(balances.current);
    if (incomeNode) incomeNode.textContent = formatCurrency(monthlyIncome);
    if (expensesNode) expensesNode.textContent = formatCurrency(monthlyExpenses);
    if (savedNode) savedNode.textContent = formatCurrency(saved);
    if (savedDeltaNode) savedDeltaNode.textContent = formatSignedCurrency(saved);

    renderRecentHistory(monthTransactions);
    renderChart(transactions);
    return { monthlyIncome, monthlyExpenses, transfersToTax, balances };
  };

  const renderChart = (transactions) => {
    const chart = document.querySelector("[data-home-chart]");
    if (!chart) return;
    const now = new Date();
    const monthKeys = [];
    for (let i = 5; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = getMonthKey(date);
      monthKeys.push({ key, date });
    }

    const buckets = monthKeys.reduce((acc, item) => {
      acc[item.key] = {
        label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(item.date),
        income: 0,
        expense: 0,
      };
      return acc;
    }, {});

    transactions.forEach((entry) => {
      if (!entry?.date) return;
      const key = getMonthKey(entry.date);
      if (!buckets[key]) return;
      const amount = Math.max(0, toNumber(entry.amount));
      if (entry.type === "income") buckets[key].income += amount;
      if (entry.type === "expense") buckets[key].expense += amount;
    });

    const series = monthKeys.map((item) => buckets[item.key]);
    const maxValue = Math.max(
      ...series.map((item) => item.income),
      ...series.map((item) => item.expense),
      1
    );

    chart.innerHTML = series
      .map((item) => {
        const incomeHeight = Math.round((item.income / maxValue) * 100);
        const expenseHeight = Math.round((item.expense / maxValue) * 100);
        return `
          <div class="chart-bar-group">
            <div class="chart-bars">
              <div class="chart-bar chart-bar--income" style="height:${incomeHeight}%">
                <span class="chart-value">${formatChartCurrency(item.income)}</span>
              </div>
              <div class="chart-bar chart-bar--expense" style="height:${expenseHeight}%">
                <span class="chart-value">${formatChartCurrency(item.expense)}</span>
              </div>
            </div>
            <span class="chart-label">${item.label}</span>
          </div>
        `;
      })
      .join("");
  };

  const renderRecentHistory = (transactions) => {
    const list = document.querySelector("[data-home-transactions]");
    if (!list) return;
    const recent = [...transactions]
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
      .slice(0, 5);
    if (!recent.length) {
      list.innerHTML = '<li class="activity-empty">Aucune transaction récente.</li>';
      return;
    }

    list.innerHTML = recent
      .map((entry) => {
        const amount = Math.max(0, toNumber(entry.amount));
        const signed = entry.type === "expense" ? -amount : amount;
        const amountLabel = entry.type === "expense" ? `-${formatCurrency(amount)}` : formatCurrency(amount);
        const dateLabel = entry.date
          ? new Date(entry.date).toLocaleDateString("fr-CH", { day: "2-digit", month: "short" })
          : "";
        const metaParts = [];
        if (entry.type === "transfer") {
          const fromLabel = ACCOUNT_LABELS[entry.from] || entry.from || "Compte";
          const toLabel = ACCOUNT_LABELS[entry.to] || entry.to || "Compte";
          metaParts.push(`${fromLabel} → ${toLabel}`);
        } else if (entry.account) {
          metaParts.push(ACCOUNT_LABELS[entry.account] || entry.account || "Compte");
        }
        if (entry.category) metaParts.push(entry.category);
        if (dateLabel) metaParts.push(dateLabel);
        return `
          <li class="activity-item">
            <div class="activity-item__main">
              <div class="activity-item__title">${
                entry.type === "income" ? "Revenu" : entry.type === "transfer" ? "Transfert" : "Dépense"
              }</div>
              <div class="activity-item__meta">${metaParts.join(" · ")}</div>
            </div>
            <div class="activity-item__amount ${signed < 0 ? "is-negative" : "is-positive"}">
              ${amountLabel}
            </div>
          </li>
        `;
      })
      .join("");
  };

  const renderPlanSection = (formData, data, realMetrics) => {
    const incomeEstimate = getMonthlyIncomeEstimate(formData);
    const fixedEstimate = getMonthlyExpenseTotal(formData.expenses?.fixed);
    const variableEstimate = getMonthlyExpenseTotal(formData.expenses?.variable);
    const taxProvision = Math.max(
      0,
      toNumber(
        data?.taxProvision?.monthlyAmount ||
          data?.taxProvision?.monthlyNeed ||
          data?.allocation?.allocations?.impots
      )
    );
    const forecastRest = incomeEstimate - fixedEstimate - variableEstimate - taxProvision;

    const realRest =
      realMetrics.monthlyIncome -
      realMetrics.monthlyExpenses -
      realMetrics.transfersToTax;
    const gap = realRest - forecastRest;

    const setText = (selector, value) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = value;
    };

    setText("[data-plan-income]", formatCurrency(incomeEstimate));
    setText("[data-plan-fixed]", formatCurrency(fixedEstimate));
    setText("[data-plan-variable]", formatCurrency(variableEstimate));
    setText("[data-plan-tax]", formatCurrency(taxProvision));
    setText("[data-plan-forecast]", formatCurrency(forecastRest));
    setText("[data-plan-real]", formatCurrency(realRest));
    setText("[data-plan-gap]", formatSignedCurrency(gap));
  };

  const computeRemainingToSpend = ({ incomeNet, totalFixes, allocations, variableExpenses }) => {
    const safeAllocations = allocations || {};
    const budgetVariablePrevu =
      toNumber(incomeNet) -
      toNumber(totalFixes) -
      Math.max(0, toNumber(safeAllocations.impots)) -
      Math.max(0, toNumber(safeAllocations.securite)) -
      Math.max(0, toNumber(safeAllocations.pilier3a)) -
      Math.max(0, toNumber(safeAllocations.dettes));

    const depensesVariables = Math.max(0, toNumber(variableExpenses));
    const resteADepenser = budgetVariablePrevu - depensesVariables;

    let state = "critical";
    if (budgetVariablePrevu > 0) {
      const ratio = resteADepenser / budgetVariablePrevu;
      if (ratio > 0.4) state = "ok";
      else if (ratio >= 0.1) state = "warning";
      else state = "critical";
    } else if (resteADepenser >= 0) {
      state = "warning";
    }

    return { budgetVariablePrevu, depensesVariables, resteADepenser, state };
  };

  const renderRemainingBudget = (formData, data, monthTransactions) => {
    const remainingNode = document.querySelector("[data-home-remaining]");
    const progressFill = document.querySelector("[data-home-progress-fill]");
    const progressBar = document.querySelector("[data-home-progress-bar]");
    const caption = document.querySelector("[data-home-progress-caption]");
    const detailNode = document.querySelector("[data-home-remaining-detail]");
    const investmentNote = document.querySelector("[data-home-investments-note]");
    if (!remainingNode || !progressFill || !progressBar || !caption) return;

    const incomeNet =
      toNumber(data?.metrics?.monthlyNetIncome) || getMonthlyIncomeEstimate(formData);
    const fixedCharges =
      toNumber(data?.spendingTotals?.fixed) || getMonthlyExpenseTotal(formData.expenses?.fixed);
    const allocations = data?.allocation?.allocations || {};

    const variableLabels = ensureArray(formData?.expenses?.variable)
      .map((entry) => normalizeLabel(entry?.label || entry?.name))
      .filter(Boolean);
    const hasVariableLabels = variableLabels.length > 0;
    const depensesVariables = ensureArray(monthTransactions)
      .filter((entry) => entry?.type === "expense" && !entry?.isFixed)
      .filter((entry) => {
        if (!hasVariableLabels) return true;
        const label = normalizeLabel(entry?.category || entry?.label);
        if (!label) return true;
        return variableLabels.includes(label);
      })
      .reduce((sum, entry) => sum + Math.max(0, toNumber(entry.amount)), 0);

    const result = computeRemainingToSpend({
      incomeNet,
      totalFixes: fixedCharges,
      allocations,
      variableExpenses: depensesVariables,
    });

    const remainingLabel =
      result.resteADepenser >= 0
        ? formatCurrency(result.resteADepenser)
        : `-${formatCurrency(Math.abs(result.resteADepenser))}`;
    remainingNode.textContent = remainingLabel;

    const spendRatio =
      result.budgetVariablePrevu > 0
        ? result.depensesVariables / result.budgetVariablePrevu
        : result.depensesVariables > 0
        ? 1
        : 0;
    const progressPercent = Math.max(0, Math.min(100, Math.round(spendRatio * 100)));
    progressFill.style.width = `${progressPercent}%`;
    caption.textContent = `${formatCurrency(result.depensesVariables)} / ${formatCurrency(result.budgetVariablePrevu)}`;

    const stateClass =
      result.state === "ok" ? "is-ok" : result.state === "warning" ? "is-warn" : "is-bad";
    remainingNode.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
    remainingNode.classList.add(stateClass);
    progressBar.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
    progressBar.classList.add(stateClass);

    if (detailNode) {
      const taxes = Math.max(0, toNumber(allocations.impots));
      const security = Math.max(0, toNumber(allocations.securite));
      const pillar3 = Math.max(0, toNumber(allocations.pilier3a));
      const debts = Math.max(0, toNumber(allocations.dettes));
      const prioritySavings = taxes + security + pillar3 + debts;
      detailNode.innerHTML = `
        <table class="remaining-table">
          <tbody>
            <tr>
              <td>Revenu net</td>
              <td class="is-positive">+ ${formatCurrency(incomeNet)}</td>
            </tr>
            <tr>
              <td>Charges fixes</td>
              <td class="is-negative">- ${formatCurrency(fixedCharges)}</td>
            </tr>
            <tr>
              <td>Épargne prioritaire</td>
              <td class="is-negative">- ${formatCurrency(prioritySavings)}</td>
            </tr>
            <tr class="is-total">
              <td>Budget variable prévu</td>
              <td>${formatCurrency(result.budgetVariablePrevu)}</td>
            </tr>
            <tr>
              <td>Dépenses variables</td>
              <td class="is-negative">- ${formatCurrency(result.depensesVariables)}</td>
            </tr>
            <tr class="is-total">
              <td>Reste</td>
              <td>${remainingLabel}</td>
            </tr>
          </tbody>
        </table>
      `;
    }
    if (investmentNote) {
      const investTarget = Math.max(0, toNumber(allocations.investissements));
      investmentNote.textContent = investTarget
        ? `Investissements (objectif SmartSave): ${formatCurrency(investTarget)}`
        : "Investissements (objectif SmartSave): —";
    }

    renderVariableProjection(result, depensesVariables);
  };

  const renderVariableProjection = (result, depensesVariables) => {
    const card = document.querySelector("[data-home-projection-card]");
    if (!card) return;

    const actualNode = card.querySelector("[data-home-projection-actual]");
    const forecastNode = card.querySelector("[data-home-projection-forecast]");
    const budgetNode = card.querySelector("[data-home-projection-budget]");
    const statusNode = card.querySelector("[data-home-projection-status]");
    const labelNode = card.querySelector("[data-home-projection-label]");
    const messageNode = card.querySelector("[data-home-projection-message]");
    const hintNode = card.querySelector("[data-home-projection-hint]");

    const now = new Date();
    const dayOfMonth = Math.max(1, now.getDate());
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const dailyPace = dayOfMonth > 0 ? depensesVariables / dayOfMonth : 0;
    const projectionFinMois = dailyPace * daysInMonth;
    const budgetVariablePrevu = result.budgetVariablePrevu;

    let status = "is-neutral";
    let label = "Budget non défini";
    let message = "Projection indisponible sans budget variable.";
    let hint = "Ajoute un budget pour activer la projection.";

    if (budgetVariablePrevu > 0) {
      const ratio = projectionFinMois / budgetVariablePrevu;
      message = `Si tu continues à ce rythme, tu dépenseras environ ${formatCurrency(
        projectionFinMois
      )} ce mois-ci.`;

      if (ratio < 0.9) {
        status = "is-ok";
        label = "Dans le budget";
        hint = "Tu peux garder ce rythme.";
      } else if (ratio <= 1.1) {
        status = "is-warn";
        label = "Limite";
        hint = "Surveille un peu tes dépenses.";
      } else {
        status = "is-bad";
        label = "Dépassement probable";
        hint = "Ralentir maintenant évite un mois serré.";
      }
    }

    if (actualNode) actualNode.textContent = formatCurrency(depensesVariables);
    if (forecastNode) forecastNode.textContent = formatCurrency(projectionFinMois);
    if (budgetNode) budgetNode.textContent = formatCurrency(budgetVariablePrevu);
    if (labelNode) labelNode.textContent = label;
    if (messageNode) messageNode.textContent = message;
    if (hintNode) hintNode.textContent = hint;
    if (statusNode) {
      statusNode.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
      statusNode.classList.add(status);
    }
  };

  const renderVariableBudgets = (formData, monthTransactions) => {
    const container = document.querySelector("[data-variable-budgets]");
    if (!container) return;
    const variableEntries = ensureArray(formData.expenses?.variable);
    if (!variableEntries.length) {
      container.innerHTML = '<div class="mini-card">Aucun budget variable renseigné.</div>';
      return;
    }

    const monthExpenses = monthTransactions.filter(
      (entry) => entry?.type === "expense" && entry?.category
    );

    container.innerHTML = variableEntries
      .map((entry, index) => {
        const label = entry?.label || entry?.name || `Budget ${index + 1}`;
        const budget = resolveMonthlyAmount(entry);
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
  };

  const updateBudgetCategories = (formData, select, type) => {
    if (!select) return;
    if (type === "income") {
      select.innerHTML = [
        '<option value="">Sélectionner</option>',
        '<option value="Salaire">Salaire</option>',
        '<option value="Bonus">Bonus</option>',
        '<option value="Autre">Autre</option>',
      ].join("");
      return;
    }
    const variableEntries = ensureArray(formData.expenses?.variable);
    const options = ['<option value="">Sélectionner</option>']
      .concat(
        variableEntries.map((entry) => {
          const label = entry?.label || entry?.name || "Budget";
          return `<option value="${label}">${label}</option>`;
        })
      )
      .concat('<option value="Autre">Autre</option>');
    select.innerHTML = options.join("");
  };

  const updateAccountOptions = (formData, selects) => {
    if (!selects) return;
    const baseOptions = [
      { value: "current", label: ACCOUNT_LABELS.current },
      { value: "security", label: ACCOUNT_LABELS.security },
      { value: "tax", label: ACCOUNT_LABELS.tax },
      { value: "investments", label: ACCOUNT_LABELS.investments },
      { value: "pillar3a", label: ACCOUNT_LABELS.pillar3a },
    ];
    const optionsMarkup = baseOptions
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join("");
    if (selects.accountSelect) {
      selects.accountSelect.innerHTML = `<option value="">Sélectionner</option>${optionsMarkup}<option value="__other__">Autre</option>`;
    }
    if (selects.fromSelect) {
      selects.fromSelect.innerHTML = optionsMarkup;
    }
    if (selects.toSelect) {
      selects.toSelect.innerHTML = optionsMarkup;
    }
  };

  const setupQuickActions = () => {
    const modal = document.querySelector("[data-quick-modal]");
    const form = document.querySelector("[data-quick-form]");
    if (!modal || !form) return;

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
      const activeUser = loadActiveUser();
      const formData = activeUser ? loadUserForm(activeUser.id) : null;
      if (!activeUser || !formData) return null;
      const info = getActiveMonthInfo(activeUser, formData);
      const monthDate = parseMonthKey(info?.activeKey);
      if (!monthDate) return null;
      const start = monthDate;
      const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      return { start, end, formData };
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

      const bounds = getActiveMonthBounds();
      if (dateInput && bounds) {
        dateInput.value = toISODate(bounds.start);
        dateInput.min = toISODate(bounds.start);
        dateInput.max = toISODate(bounds.end);
      }

      if (bounds?.formData) {
        updateBudgetCategories(bounds.formData, categorySelect, type);
      }
      if (bounds?.formData) {
        updateAccountOptions(bounds.formData, {
          accountSelect,
          fromSelect: form.querySelector("[name='from']"),
          toSelect: form.querySelector("[name='to']"),
        });
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
      const activeUser = loadActiveUser();
      if (!activeUser) return;
      const formData = new FormData(form);
      const amount = toNumber(formData.get("amount"));
      if (!amount) return;

      const type = modal.dataset.type || "expense";
      const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userId: activeUser.id,
        type,
        amount,
        date: formData.get("date") || toISODate(new Date()),
        note: String(formData.get("note") || "").trim(),
        createdAt: new Date().toISOString(),
        isFixed: false,
      };

      if (type === "transfer") {
        entry.from = formData.get("from") || "current";
        entry.to = formData.get("to") || "security";
        if (entry.from === entry.to) return;
      } else {
        const accountValue = formData.get("account") || "current";
        if (accountValue === "__other__") {
          const accountName = String(formData.get("accountOther") || "").trim();
          if (!accountName) return;
          entry.account = "custom-" + accountName;
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

      const stored = loadTransactions();
      stored.push(entry);
      saveTransactions(stored);
      closeModal();
      renderAll();
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

  const setupMonthClose = () => {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-close-month]");
      if (!button) return;
      const activeUser = loadActiveUser();
      if (!activeUser) return;
      const formData = loadUserForm(activeUser.id);
      if (!formData) return;
      closeActiveMonth(activeUser, formData, loadTransactions());
      renderAll();
    });
  };

  const setupRemainingDetailsToggle = () => {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remaining-toggle]");
      if (!button) return;
      const panel = button.closest(".remaining-details")?.querySelector("[data-remaining-panel]");
      if (!panel) return;
      const nextState = panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", !nextState);
      button.setAttribute("aria-expanded", String(nextState));
    });
  };

  const reconcileMonthWithProfile = (
    activeUser,
    formData,
    monthInfo,
    monthTransactions,
    allTransactions
  ) => {
    if (!monthInfo?.month || !activeUser?.id || !formData) {
      return { transactions: allTransactions, monthTransactions };
    }
    if (monthInfo.month.status !== "open") {
      return { transactions: allTransactions, monthTransactions };
    }

    const hasUserTransactions = monthTransactions.some((entry) => !entry?.isFixed);
    if (hasUserTransactions) {
      return { transactions: allTransactions, monthTransactions };
    }

    const state = loadMonthState();
    const userState = state?.[activeUser.id];
    if (!userState?.months?.[monthInfo.activeKey]) {
      return { transactions: allTransactions, monthTransactions };
    }

    userState.months[monthInfo.activeKey].startingBalances = normalizeBalances(
      resolveBalancesFromAssets(formData)
    );
    state[activeUser.id] = userState;
    saveMonthState(state);

    const shouldInjectFixed = userState.initialMonthKey !== monthInfo.activeKey;
    let nextTransactions = allTransactions;
    if (shouldInjectFixed) {
      nextTransactions = allTransactions.filter(
        (entry) =>
          !(
            entry?.userId === activeUser.id &&
            entry?.isFixed &&
            getMonthKey(entry.date) === monthInfo.activeKey
          )
      );
      saveTransactions(nextTransactions);
      addFixedTransactionsForMonth(activeUser, formData, monthInfo.activeKey);
      nextTransactions = loadTransactions();
    }

    const nextMonthTransactions = getMonthTransactions(
      nextTransactions,
      monthInfo.activeKey,
      activeUser.id
    );

    return { transactions: nextTransactions, monthTransactions: nextMonthTransactions };
  };

  const renderAll = () => {
    const activeUser = loadActiveUser();
    if (!activeUser) return;
    const formData = loadUserForm(activeUser.id);
    if (!formData) return;

    const monthInfo = getActiveMonthInfo(activeUser, formData);
    if (!monthInfo) return;

    updateMonthHeader(monthInfo.activeKey);
    updateMonthBanner(monthInfo.activeKey);

    let transactions = loadTransactions();
    const migratedTransactions = migrateFixedMonthKeys(transactions);
    if (migratedTransactions.changed) {
      transactions = migratedTransactions.transactions;
      saveTransactions(transactions);
    }
    let monthTransactions = getMonthTransactions(
      transactions,
      monthInfo.activeKey,
      activeUser.id
    );
    const reconciled = reconcileMonthWithProfile(
      activeUser,
      formData,
      monthInfo,
      monthTransactions,
      transactions
    );
    transactions = reconciled.transactions;
    monthTransactions = reconciled.monthTransactions;

    const data = typeof window.buildMvpData === "function" ? window.buildMvpData(formData) : {};
    const realMetrics = renderRealSection(monthInfo, formData, transactions, activeUser);
    renderPlanSection(formData, data, realMetrics);
    renderRemainingBudget(formData, data, monthTransactions);
    renderVariableBudgets(formData, monthTransactions);
    renderAccountsOverview(realMetrics.balances, data);
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderAll();
    setupHamburgerMenu();
    setupQuickActions();
    setupMonthClose();
    setupRemainingDetailsToggle();
  });

  window.addEventListener("storage", (event) => {
    if (!event) return;
    if (event.key === "smartsaveFormData" || event.key === "smartsaveProfileUpdated") {
      renderAll();
    }
  });

  window.addEventListener("pageshow", () => {
    renderAll();
  });
})();
