(() => {
  // LocalStorage is scoped per origin (host+port). Changing the preview URL resets data visibility.
  const TRANSACTIONS_KEY = "transactions";
  const MONTH_STATE_KEY = "smartsaveMonthState";
  const ACTIONS_STORAGE_KEY = "smartsaveHubActionState";
  const VARIABLE_BUDGET_SETTINGS_KEY = "smartsaveVariableBudgetSettings";
  const PENDING_MON_ARGENT_ACTION_KEY = "smartsavePendingMonArgentAction";
  const ACCOUNT_LABELS = {
    current: "Compte courant",
    security: "Compte épargne",
    tax: "Provision impôts",
    projects: "Compte pour projets",
    investments: "Investissements",
    pillar3a: "3e pilier",
    growth: "Investissements",
  };
  const OVERVIEW_PRIMARY_METRIC_KEY = "smartsaveOverviewPrimaryMetric";
  const OVERVIEW_METRIC_CONFIG = {
    available: {
      label: "Total disponible",
      note: "Compte courant en temps réel",
    },
    networth: {
      label: "Patrimoine total",
      note: "Somme de tous tes comptes",
    },
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

  const readOverviewPrimaryMetric = () => {
    try {
      const raw = String(localStorage.getItem(OVERVIEW_PRIMARY_METRIC_KEY) || "").trim();
      if (raw === "networth") return "networth";
      return "available";
    } catch (_error) {
      return "available";
    }
  };

  const saveOverviewPrimaryMetric = (metric) => {
    const safeMetric = metric === "networth" ? "networth" : "available";
    try {
      localStorage.setItem(OVERVIEW_PRIMARY_METRIC_KEY, safeMetric);
    } catch (_error) {
      // ignore storage issues
    }
  };

  let overviewPrimaryMetric = readOverviewPrimaryMetric();

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

  const formatChfSuffix = (value) => {
    const amount = Number.isFinite(value) ? value : toNumber(value);
    const rounded = Math.round(amount || 0);
    return `${new Intl.NumberFormat("fr-CH", {
      maximumFractionDigits: 0,
    }).format(rounded)} CHF`;
  };

  const formatNumberCompact = (value) => {
    const amount = Number.isFinite(value) ? value : toNumber(value);
    return new Intl.NumberFormat("fr-CH", {
      maximumFractionDigits: 0,
    }).format(Math.round(amount || 0));
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

  const loadVariableBudgetSettings = () => {
    const settings = loadJson(VARIABLE_BUDGET_SETTINGS_KEY, {});
    return settings && typeof settings === "object" ? settings : {};
  };

  const getUserVariableBudgetSetting = (userId) => {
    const key = String(userId || "").trim();
    if (!key) return { mode: "recommended", customAmount: null };
    const settings = loadVariableBudgetSettings();
    const value = settings[key];
    if (!value || typeof value !== "object") {
      return { mode: "recommended", customAmount: null };
    }
    return {
      mode: ["recommended", "eco", "comfort", "custom"].includes(String(value.mode))
        ? String(value.mode)
        : "recommended",
      customAmount:
        value.customAmount == null ? null : Math.max(0, toNumber(value.customAmount)),
    };
  };

  const saveUserVariableBudgetSetting = (userId, nextValue = {}) => {
    const key = String(userId || "").trim();
    if (!key) return;
    const settings = loadVariableBudgetSettings();
    settings[key] = {
      mode: ["recommended", "eco", "comfort", "custom"].includes(String(nextValue.mode))
        ? String(nextValue.mode)
        : "recommended",
      customAmount:
        nextValue.customAmount == null ? null : Math.max(0, toNumber(nextValue.customAmount)),
    };
    saveJson(VARIABLE_BUDGET_SETTINGS_KEY, settings);
  };

  const resolveVariableBudgetChoice = (recommendedBudget, setting = {}) => {
    const safeRecommended = Math.max(0, toNumber(recommendedBudget));
    const ecoBudget = Math.max(0, Math.round(safeRecommended * 0.88));
    const comfortBudget = Math.max(0, Math.round(safeRecommended * 1.12));
    const customAmount = setting.customAmount == null ? null : Math.max(0, toNumber(setting.customAmount));
    const mode = ["recommended", "eco", "comfort", "custom"].includes(String(setting.mode))
      ? String(setting.mode)
      : "recommended";

    let selectedBudget = safeRecommended;
    if (mode === "eco") selectedBudget = ecoBudget;
    if (mode === "comfort") selectedBudget = comfortBudget;
    if (mode === "custom") selectedBudget = customAmount == null ? safeRecommended : customAmount;

    return {
      mode,
      selectedBudget: Math.max(0, toNumber(selectedBudget)),
      recommendedBudget: safeRecommended,
      ecoBudget,
      comfortBudget,
      customAmount,
    };
  };

  const normalizeLabel = (value) => String(value || "").trim().toLowerCase();

  const getCategoryEmoji = (label) => {
    const value = normalizeLabel(label);
    if (!value) return "💸";
    if (value.includes("resto") || value.includes("restaurant") || value.includes("cafe")) return "🍔";
    if (value.includes("transport") || value.includes("uber") || value.includes("taxi")) return "🚕";
    if (value.includes("shopping") || value.includes("mode") || value.includes("vetement")) return "🛍️";
    if (value.includes("supermar") || value.includes("courses") || value.includes("epicerie"))
      return "🛒";
    if (value.includes("sante") || value.includes("santé") || value.includes("pharma"))
      return "💊";
    if (value.includes("loisir") || value.includes("sortie") || value.includes("cinema"))
      return "🎟️";
    if (value.includes("abonnement") || value.includes("subscription")) return "📺";
    if (value.includes("voyage") || value.includes("vacance")) return "✈️";
    if (value.includes("sport") || value.includes("fitness")) return "🏋️";
    if (value.includes("enfant") || value.includes("ecole") || value.includes("école"))
      return "🎒";
    return "💸";
  };

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

  const PROFILE_VERSION_KEY = "smartsaveProfileVersion";

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
      targetLabel: "Objectif SmartSave",
    });

    accounts.push({
      key: "security",
      label: "Compte épargne",
      type: "Épargne",
      balance: balances.security,
      target: targets.securityTarget,
      targetLabel: "Objectif SmartSave",
    });

    accounts.push({
      key: "tax",
      label: "Provision impôts",
      type: "Impôts",
      balance: balances.tax,
      target: targets.taxTarget,
      targetLabel: "Objectif SmartSave",
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
        targetLabel: "Objectif SmartSave",
      });
    }

    if (hasPillar) {
      accounts.push({
        key: "pillar3a",
        label: "3e pilier",
        type: "3e pilier",
        balance: balances.pillar3a,
        target: targets.monthlyPillar,
        targetLabel: "Objectif SmartSave",
      });
    }

    if (!hasInvestments && !hasPillar) {
      accounts.push({
        key: "growth",
        label: "Investissements",
        type: "Investissement",
        balance: toNumber(balances.investments) + toNumber(balances.pillar3a),
        target: targets.monthlyGrowth,
        targetLabel: "Objectif SmartSave",
      });
    }

    return accounts;
  };

  const renderOverviewMetrics = (availableTotal, netWorthTotal) => {
    const primaryLabelNode = document.querySelector("[data-home-overview-primary-label]");
    const primaryValueNode = document.querySelector("[data-home-overview-primary-value]");
    const primaryNoteNode = document.querySelector("[data-home-overview-primary-note]");
    const secondaryLabelNode = document.querySelector("[data-home-overview-secondary-label]");
    const secondaryValueNode = document.querySelector("[data-home-overview-secondary-value]");
    const toggleButton = document.querySelector("[data-home-overview-toggle]");

    if (
      !primaryLabelNode ||
      !primaryValueNode ||
      !primaryNoteNode ||
      !secondaryLabelNode ||
      !secondaryValueNode
    ) {
      return;
    }

    const primaryKey = overviewPrimaryMetric === "networth" ? "networth" : "available";
    const secondaryKey = primaryKey === "available" ? "networth" : "available";
    const primaryConfig = OVERVIEW_METRIC_CONFIG[primaryKey];
    const secondaryConfig = OVERVIEW_METRIC_CONFIG[secondaryKey];
    const primaryValue = primaryKey === "available" ? availableTotal : netWorthTotal;
    const secondaryValue = secondaryKey === "available" ? availableTotal : netWorthTotal;

    primaryLabelNode.textContent = primaryConfig.label;
    primaryValueNode.textContent = formatCurrency(primaryValue);
    primaryNoteNode.textContent = primaryConfig.note;
    secondaryLabelNode.textContent = secondaryConfig.label;
    secondaryValueNode.textContent = formatCurrency(secondaryValue);

    if (toggleButton) {
      toggleButton.setAttribute(
        "aria-label",
        primaryKey === "available"
          ? "Afficher patrimoine total en principal"
          : "Afficher total disponible en principal"
      );
    }
  };

  const renderAccountsOverview = (balances = {}, data = {}, extras = {}) => {
    const container = document.querySelector("[data-home-accounts]");
    const safeBalances = normalizeBalances(balances);
    const extrasTotal = Object.values(extras || {}).reduce(
      (sum, value) => sum + toNumber(value),
      0
    );
    const totalNetWorth =
      safeBalances.current +
      safeBalances.security +
      safeBalances.tax +
      safeBalances.investments +
      safeBalances.pillar3a +
      extrasTotal;

    renderOverviewMetrics(safeBalances.current, totalNetWorth);
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
        const deltaClass = delta == null ? "" : delta >= 0 ? "delta-positive" : "delta-negative";
        let deltaText = "Objectif non défini";
        if (delta != null) {
          if (delta > 0) {
            deltaText = `+${formatCurrency(Math.abs(delta))} au-dessus de l’objectif`;
          } else if (delta < 0) {
            deltaText = `-${formatCurrency(Math.abs(delta))} en-dessous de l’objectif`;
          } else {
            deltaText = "Tu es exactement à l’objectif";
          }
        }
        return `
          <div class="account-card" data-account-key="${account.key}">
            <h4>${account.label}</h4>
            <p class="account-card__line">
              <span>Solde actuel :</span>
              <strong>${formatCurrency(balance)}</strong>
            </p>
            <p class="account-card__line">
              <span>${account.targetLabel} :</span>
              <strong>${target ? formatCurrency(target) : "—"}</strong>
            </p>
            <p class="account-delta ${deltaClass}">${deltaText}</p>
          </div>
        `;
      })
      .join("");
  };

  const setupOverviewMetricToggle = () => {
    const button = document.querySelector("[data-home-overview-toggle]");
    if (!button || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      overviewPrimaryMetric = overviewPrimaryMetric === "available" ? "networth" : "available";
      saveOverviewPrimaryMetric(overviewPrimaryMetric);
      renderAll();
    });
  };

  const getAccountLabel = (key, fallbackLabel) => {
    const raw = String(key || "").trim();
    if (fallbackLabel) return String(fallbackLabel).trim();
    if (!raw) return "Compte";
    if (ACCOUNT_LABELS[raw]) return ACCOUNT_LABELS[raw];
    if (raw.startsWith("custom-")) return raw.slice("custom-".length) || "Compte personnalisé";
    return raw;
  };

  const renderTransferHistory = (transactions = [], activeUser = null) => {
    const listNode = document.querySelector("[data-home-transfer-history]");
    const emptyNode = document.querySelector("[data-home-transfer-history-empty]");
    if (!listNode || !emptyNode) return;

    const userId = String(activeUser?.id || "").trim();
    const items = ensureArray(transactions)
      .filter((entry) => entry?.type === "transfer")
      .filter((entry) => !userId || String(entry?.userId || "").trim() === userId)
      .sort((a, b) => {
        const aDate = new Date(a?.date || a?.createdAt || 0).getTime();
        const bDate = new Date(b?.date || b?.createdAt || 0).getTime();
        return bDate - aDate;
      })
      .slice(0, 20);

    if (!items.length) {
      listNode.innerHTML = "";
      emptyNode.hidden = false;
      return;
    }

    emptyNode.hidden = true;
    listNode.innerHTML = items
      .map((entry) => {
        const amount = Math.max(0, toNumber(entry.amount));
        const fromLabel = getAccountLabel(entry.from, entry.fromLabel);
        const toLabel = getAccountLabel(entry.to, entry.toLabel);
        const date = new Date(entry.date || entry.createdAt || Date.now());
        const dateLabel = Number.isNaN(date.getTime())
          ? "Date inconnue"
          : new Intl.DateTimeFormat("fr-CH", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            }).format(date);
        return `
          <li class="transfer-history-item">
            <div class="transfer-history-item__head">
              <strong>${formatCurrency(amount)}</strong>
              <span>${dateLabel}</span>
            </div>
            <p>${fromLabel} → ${toLabel}</p>
            <button
              class="transfer-history-item__cancel"
              type="button"
              data-transfer-cancel="${String(entry.id || "")}"
            >
              Annuler
            </button>
          </li>
        `;
      })
      .join("");
  };

  const setupTransferHistoryActions = () => {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-transfer-cancel]");
      if (!button) return;

      const transferId = String(button.dataset.transferCancel || "").trim();
      if (!transferId) return;
      const activeUser = loadActiveUser();
      if (!activeUser?.id) return;

      const transactions = loadTransactions();
      const index = transactions.findIndex(
        (entry) =>
          String(entry?.id || "").trim() === transferId &&
          entry?.type === "transfer" &&
          String(entry?.userId || "").trim() === String(activeUser.id)
      );
      if (index < 0) return;

      const transfer = transactions[index];
      const confirmed = window.confirm(
        "Annuler ce transfert ? Les soldes seront mis à jour partout dans l’app."
      );
      if (!confirmed) return;

      transactions.splice(index, 1);
      saveTransactions(transactions);

      if (typeof window.syncTransactionToProfile === "function") {
        const reverseEntry = {
          type: "transfer",
          amount: Math.max(0, toNumber(transfer.amount)),
          from: transfer.to || "",
          to: transfer.from || "",
        };
        window.syncTransactionToProfile(reverseEntry, activeUser.id);
      }

      renderAll();
    });
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
        const from = entry.from || "";
        const to = entry.to || "";
        if (!from || !to || from === to) return;
        applyDelta(from, entry.fromLabel, -amount);
        applyDelta(to, entry.toLabel, amount);
      }
    });

    return { balances: updated, extras };
  };

  const loadMonthState = () => loadJson(MONTH_STATE_KEY, {});

  const saveMonthState = (state) => saveJson(MONTH_STATE_KEY, state);

  const isInMonthTransitionWindow = (date = new Date()) => {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return false;
    const day = target.getDate();
    return day >= 25 || day <= 5;
  };

  const loadMonthActionState = (userId, monthKey) => {
    const raw = loadJson(ACTIONS_STORAGE_KEY, {});
    const userMap = raw?.[userId];
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
      const month = userState.months[userState.activeMonthKey];
      if (month.status === "open") {
        month.status = "active";
        saveMonthState(state);
      }
      return userState;
    }

    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    const startingBalances = normalizeBalances(resolveBalancesFromAssets(formData));
    const monthEntry = {
      status: "active",
      openedAt: now.toISOString(),
      startedAt: now.toISOString(),
      closedAt: null,
      fixedApplied: false,
      isFirstMonth: true,
      startingBalances,
      closingBalances: null,
      archive: null,
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
    if (!activeMonth || activeMonth.status !== "active") return null;
    if (!isInMonthTransitionWindow(new Date())) return null;

    const monthTransactions = getMonthTransactions(transactions, activeKey, activeUser.id);
    const applied = applyTransactionsToBalances(
      normalizeBalances(activeMonth.startingBalances),
      monthTransactions
    ).balances;
    const closingBalances = normalizeBalances(applied);

    activeMonth.status = "closed";
    activeMonth.closedAt = new Date().toISOString();
    activeMonth.closingBalances = closingBalances;
    activeMonth.archive = {
      archivedAt: new Date().toISOString(),
      transactions: monthTransactions.map((entry) => ({ ...entry })),
      actions: loadMonthActionState(activeUser.id, activeKey),
      balances: closingBalances,
    };

    const nextStart = addMonths(parseMonthKey(activeKey), 1);
    if (!nextStart) return null;
    const nextKey = getMonthKey(nextStart);
    userState.activeMonthKey = nextKey;
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
    return { activeKey, nextKey };
  };

  const startActiveMonth = (activeUser, formData) => {
    const state = loadMonthState();
    const userState = state?.[activeUser?.id];
    if (!userState) return null;
    const activeKey = userState.activeMonthKey;
    const activeMonth = userState.months?.[activeKey];
    if (!activeMonth || activeMonth.status !== "ready_to_start") return null;
    if (!isInMonthTransitionWindow(new Date())) return null;

    if (!activeMonth.fixedApplied) {
      addFixedTransactionsForMonth(activeUser, formData, activeKey);
      activeMonth.fixedApplied = true;
    }
    activeMonth.status = "active";
    activeMonth.startedAt = new Date().toISOString();
    activeMonth.closedAt = null;
    activeMonth.isFirstMonth = false;
    userState.months[activeKey] = activeMonth;
    state[activeUser.id] = userState;
    saveMonthState(state);
    return { activeKey };
  };

  const updateMonthHeader = (monthKey) => {
    const monthLabel = formatMonthLabel(monthKey);
    const titleNode = document.querySelector("#home-month-title");
    if (titleNode) {
      const normalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
      titleNode.textContent = `Suivi mois ${normalized}`;
    }
    const label = document.querySelector("[data-month-label]");
    if (label && label !== titleNode) {
      label.textContent = monthLabel;
    }
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

  const renderMonthControls = (monthInfo) => {
    const wrapper = document.querySelector("[data-month-controls]");
    const closeButton = document.querySelector("[data-close-month]");
    const startButton = document.querySelector("[data-start-month]");
    if (!wrapper || !closeButton || !startButton) return;

    const month = monthInfo?.month || {};
    const isFirstMonth = Boolean(month.isFirstMonth) && month.status === "active";
    const inWindow = isInMonthTransitionWindow(new Date());
    const showClose = inWindow && month.status === "active";
    const showStart = !isFirstMonth && inWindow && month.status === "ready_to_start";
    const showAny = showClose || showStart;

    wrapper.hidden = !showAny;
    closeButton.hidden = !showClose;
    startButton.hidden = !showStart;
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
    const extraBalances = applied.extras;

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
    return { monthlyIncome, monthlyExpenses, transfersToTax, balances, extraBalances };
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

  const computeRemainingToSpend = ({
    incomeNet,
    totalFixes,
    allocations,
    variableExpenses,
    budgetOverride,
  }) => {
    const safeAllocations = allocations || {};
    const smartSaveBudget =
      toNumber(incomeNet) -
      toNumber(totalFixes) -
      Math.max(0, toNumber(safeAllocations.impots)) -
      Math.max(0, toNumber(safeAllocations.securite)) -
      Math.max(0, toNumber(safeAllocations.pilier3a)) -
      Math.max(0, toNumber(safeAllocations.dettes));
    const budgetVariablePrevu =
      budgetOverride == null
        ? smartSaveBudget
        : Math.max(0, toNumber(budgetOverride));

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

    return { budgetVariablePrevu, smartSaveBudget, depensesVariables, resteADepenser, state };
  };

  const renderRemainingBudget = (formData, data, monthTransactions) => {
    const variableTitle = document.querySelector("[data-home-variable-title]");
    const remainingNode = document.querySelector("[data-home-remaining]");
    const progressFill = document.querySelector("[data-home-progress-fill]");
    const progressBar = document.querySelector("[data-home-progress-bar]");
    const caption = document.querySelector("[data-home-progress-caption]");
    const detailNode = document.querySelector("[data-home-remaining-detail]");
    const investmentNote = document.querySelector("[data-home-investments-note]");
    const optionRecommendedNode = document.querySelector('[data-variable-budget-option="recommended"]');
    const optionEcoNode = document.querySelector('[data-variable-budget-option="eco"]');
    const optionComfortNode = document.querySelector('[data-variable-budget-option="comfort"]');
    const optionCustomNode = document.querySelector('[data-variable-budget-option="custom"]');
    const customWrap = document.querySelector("[data-variable-budget-custom]");
    const customInput = document.querySelector("[data-variable-budget-custom-input]");
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

    const recommendedResult = computeRemainingToSpend({
      incomeNet,
      totalFixes: fixedCharges,
      allocations,
      variableExpenses: depensesVariables,
    });
    const activeUser = loadActiveUser();
    const setting = getUserVariableBudgetSetting(activeUser?.id);
    const budgetChoice = resolveVariableBudgetChoice(recommendedResult.budgetVariablePrevu, setting);
    const result = computeRemainingToSpend({
      incomeNet,
      totalFixes: fixedCharges,
      allocations,
      variableExpenses: depensesVariables,
      budgetOverride: budgetChoice.selectedBudget,
    });

    if (variableTitle) {
      const month = new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date());
      const monthLabel = month.charAt(0).toUpperCase() + month.slice(1);
      variableTitle.textContent = `Dépenses variables - ${monthLabel}`;
    }

    const stateClass =
      result.state === "ok" ? "is-ok" : result.state === "warning" ? "is-warn" : "is-bad";
    remainingNode.innerHTML = `
      <span class="remaining-amount__spent ${stateClass}">${formatNumberCompact(
      result.depensesVariables
    )}</span><span class="remaining-amount__total"> / ${formatNumberCompact(
      result.budgetVariablePrevu
    )} CHF</span>
    `;
    const remainingLabel =
      result.resteADepenser >= 0
        ? formatCurrency(result.resteADepenser)
        : `-${formatCurrency(Math.abs(result.resteADepenser))}`;

    if (optionRecommendedNode) {
      optionRecommendedNode.textContent = `${formatNumberCompact(budgetChoice.recommendedBudget)} CHF`;
    }
    if (optionEcoNode) {
      optionEcoNode.textContent = `${formatNumberCompact(budgetChoice.ecoBudget)} CHF`;
    }
    if (optionComfortNode) {
      optionComfortNode.textContent = `${formatNumberCompact(budgetChoice.comfortBudget)} CHF`;
    }
    if (optionCustomNode) {
      optionCustomNode.textContent =
        budgetChoice.customAmount == null
          ? "Montant libre"
          : `${formatNumberCompact(budgetChoice.customAmount)} CHF`;
    }
    if (customInput) {
      customInput.value =
        budgetChoice.customAmount == null
          ? ""
          : String(Math.round(budgetChoice.customAmount));
    }
    if (customWrap) {
      customWrap.hidden = budgetChoice.mode !== "custom";
    }
    document
      .querySelectorAll('input[name="variable-budget-mode"]')
      .forEach((input) => {
        input.checked = input.value === budgetChoice.mode;
      });

    const spendRatio =
      result.budgetVariablePrevu > 0
        ? result.depensesVariables / result.budgetVariablePrevu
        : result.depensesVariables > 0
        ? 1
        : 0;
    const progressPercent = Math.max(0, Math.min(100, Math.round(spendRatio * 100)));
    progressFill.style.width = `${progressPercent}%`;
    if (result.resteADepenser >= 0) {
      caption.textContent = `Il te reste ${formatChfSuffix(
        result.resteADepenser
      )} à dépenser ce mois-ci.`;
    } else {
      caption.textContent = `Tu dépasses de ${formatChfSuffix(
        Math.abs(result.resteADepenser)
      )} ce mois-ci.`;
    }

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
    const subtitleNode = card.querySelector("[data-home-projection-subtitle]");
    const paceNode = card.querySelector("[data-home-projection-pace]");
    const deltaNode = card.querySelector("[data-home-projection-delta]");
    const barNode = card.querySelector("[data-home-projection-bar]");
    const barFillNode = card.querySelector("[data-home-projection-bar-fill]");
    const captionNode = card.querySelector("[data-home-projection-caption]");
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
    const daysLeft = Math.max(0, daysInMonth - dayOfMonth);

    let status = "is-neutral";
    let label = "Budget non défini";
    let message = "Projection indisponible sans budget variable.";
    let hint = "Ajoute un budget pour activer la projection.";
    let caption = "Budget non défini";
    let deltaLabel = "—";

    if (budgetVariablePrevu > 0) {
      const ratio = projectionFinMois / budgetVariablePrevu;
      const delta = projectionFinMois - budgetVariablePrevu;
      deltaLabel = formatSignedCurrency(delta);
      message = `Projection fin de mois : ${formatCurrency(projectionFinMois)} (${deltaLabel} vs budget).`;
      caption = `Projection = ${Math.round(ratio * 100)}% du budget`;

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

      if (daysLeft > 0) {
        const remaining = budgetVariablePrevu - depensesVariables;
        if (remaining >= 0) {
          const perDay = remaining / daysLeft;
          hint = `Il reste ${formatCurrency(remaining)} pour ${daysLeft} jour${
            daysLeft > 1 ? "s" : ""
          } (≈${formatCurrency(perDay)} / jour).`;
        } else {
          hint = `Tu dépasses déjà le budget de ${formatCurrency(Math.abs(remaining))}.`;
        }
      } else {
        hint = "Dernier jour du mois : ajuste si besoin.";
      }

      if (barFillNode) {
        const capped = Math.min(150, Math.max(0, ratio * 100));
        barFillNode.style.width = `${capped}%`;
      }
    } else if (barFillNode) {
      barFillNode.style.width = "0%";
    }

    if (actualNode) actualNode.textContent = formatCurrency(depensesVariables);
    if (forecastNode) forecastNode.textContent = formatCurrency(projectionFinMois);
    if (budgetNode) budgetNode.textContent = formatCurrency(budgetVariablePrevu);
    if (subtitleNode) {
      subtitleNode.textContent = `Basé sur ${dayOfMonth} jour${
        dayOfMonth > 1 ? "s" : ""
      } · ${daysLeft} jour${daysLeft > 1 ? "s" : ""} restant${daysLeft > 1 ? "s" : ""}`;
    }
    if (paceNode) paceNode.textContent = formatCurrency(dailyPace);
    if (deltaNode) {
      deltaNode.textContent = deltaLabel;
      deltaNode.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
      deltaNode.classList.add(status);
    }
    if (captionNode) captionNode.textContent = caption;
    if (labelNode) labelNode.textContent = label;
    if (messageNode) messageNode.textContent = message;
    if (hintNode) hintNode.textContent = hint;
    if (statusNode) {
      statusNode.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
      statusNode.classList.add(status);
    }
    if (barNode) {
      barNode.classList.remove("is-ok", "is-warn", "is-bad", "is-neutral");
      barNode.classList.add(status);
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

  const renderTopVariableCategories = (monthTransactions) => {
    const card = document.querySelector("[data-top-categories-card]");
    if (!card) return;
    const listNode = card.querySelector("[data-top-categories-list]");
    const emptyNode = card.querySelector("[data-top-categories-empty]");
    if (!listNode || !emptyNode) return;

    const grouped = monthTransactions
      .filter((entry) => entry?.type === "expense" && entry?.category)
      .reduce((acc, entry) => {
        const label = String(entry.category || "").trim();
        if (!label) return acc;
        const key = normalizeLabel(label);
        const amount = Math.max(0, toNumber(entry.amount));
        if (!acc[key]) acc[key] = { label, total: 0 };
        acc[key].total += amount;
        return acc;
      }, {});

    const entries = Object.values(grouped)
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total);

    if (!entries.length) {
      listNode.innerHTML = "";
      emptyNode.hidden = false;
      return;
    }

    const renderItems = (items) =>
      items
        .map(
          (entry) => `
        <li class="top-category-item">
          <span class="top-category-item__label">
            <span class="top-category-item__emoji">${getCategoryEmoji(entry.label)}</span>
            ${entry.label}
          </span>
          <span class="top-category-item__amount">${formatCurrency(entry.total)}</span>
        </li>
      `
        )
        .join("");

    const topFour = entries.slice(0, 4);
    listNode.innerHTML = renderItems(topFour);
    emptyNode.hidden = true;
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
      { value: "projects", label: ACCOUNT_LABELS.projects },
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
    const fromSelect = form.querySelector("[name='from']");
    const toSelect = form.querySelector("[name='to']");

    const syncOtherField = (select, input, triggerValue) => {
      if (!select || !input) return;
      const isOther = select.value === triggerValue;
      input.hidden = !isOther;
      if (!isOther) input.value = "";
    };

    const keepTransferAccountsDistinct = (changedField) => {
      if (!fromSelect || !toSelect) return;
      const fromValue = String(fromSelect.value || "");
      const toValue = String(toSelect.value || "");
      if (!fromValue || !toValue || fromValue !== toValue) return;

      const pickAlternative = (select, blockedValue) =>
        Array.from(select.options).find((option) => option.value && option.value !== blockedValue)?.value ||
        "";

      if (changedField === "from") {
        const replacement = pickAlternative(toSelect, fromValue);
        if (replacement) toSelect.value = replacement;
        return;
      }
      const replacement = pickAlternative(fromSelect, toValue);
      if (replacement) fromSelect.value = replacement;
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
      return { start, end, formData, monthStatus: info?.month?.status || "active" };
    };

    const openModal = (type) => {
      modal.classList.add("is-open");
      modal.dataset.type = type;
      const bounds = getActiveMonthBounds();
      if (bounds?.monthStatus === "ready_to_start") {
        modal.classList.remove("is-open");
        window.alert("Démarre le nouveau mois pour ajouter des opérations.");
        return;
      }
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
          fromSelect,
          toSelect,
        });
        keepTransferAccountsDistinct("from");
      }
    };

    const consumePendingMonArgentAction = () => {
      const pending = loadJson(PENDING_MON_ARGENT_ACTION_KEY, null);
      if (!pending || typeof pending !== "object") return;
      try {
        localStorage.removeItem(PENDING_MON_ARGENT_ACTION_KEY);
      } catch (_error) {
        // ignore storage issues
      }
      if (pending.type !== "transfer" || !pending.openTransferModal) return;

      const transfer = pending.transfer || {};
      const from = String(transfer.from || "").trim();
      const to = String(transfer.to || "").trim();
      const amount = Math.max(0, toNumber(transfer.amount));

      const comptesTab = document.querySelector('.tab-nav [data-tab-target="comptes"]');
      if (comptesTab) comptesTab.click();

      openModal("transfer");
      if (fromSelect && from && Array.from(fromSelect.options).some((opt) => opt.value === from)) {
        fromSelect.value = from;
      }
      if (toSelect && to && Array.from(toSelect.options).some((opt) => opt.value === to)) {
        toSelect.value = to;
      }
      keepTransferAccountsDistinct("from");

      const amountInput = form.querySelector("#quick-amount");
      if (amountInput && amount > 0) {
        amountInput.value = String(Math.round(amount));
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
    if (fromSelect) {
      fromSelect.addEventListener("change", () => keepTransferAccountsDistinct("from"));
    }
    if (toSelect) {
      toSelect.addEventListener("change", () => keepTransferAccountsDistinct("to"));
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
        entry.account = "current";
        entry.accountLabel = ACCOUNT_LABELS.current;

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
      if (typeof window.syncTransactionToProfile === "function" && activeUser?.id) {
        window.syncTransactionToProfile(entry, activeUser.id);
      }
      closeModal();
      renderAll();
    });

    consumePendingMonArgentAction();
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
      const startButton = event.target.closest("[data-start-month]");
      if (!button && !startButton) return;

      const activeUser = loadActiveUser();
      if (!activeUser?.id) return;
      const formData = loadUserForm(activeUser.id);
      if (!formData) return;

      if (button) {
        const confirmed = window.confirm(
          "Clôturer ce mois ? Les soldes et actions du mois seront archivés sans mouvement automatique."
        );
        if (!confirmed) return;
        closeActiveMonth(activeUser, formData, loadTransactions());
        renderAll();
        return;
      }

      const confirmed = window.confirm(
        "Démarrer le nouveau mois ? Le revenu et les charges fixes seront appliqués une seule fois."
      );
      if (!confirmed) return;
      startActiveMonth(activeUser, formData);
      renderAll();
    });
  };

  const setupVariableBudgetEditor = () => {
    document.addEventListener("click", (event) => {
      const toggleButton = event.target.closest("[data-variable-budget-toggle]");
      if (!toggleButton) return;
      const panel = document.querySelector("[data-variable-budget-panel]");
      if (!panel) return;
      const nextState = panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", !nextState);
      toggleButton.setAttribute("aria-expanded", String(nextState));
    });

    document.addEventListener("change", (event) => {
      const modeInput = event.target.closest('input[name="variable-budget-mode"]');
      if (modeInput) {
        const activeUser = loadActiveUser();
        if (!activeUser?.id) return;
        const current = getUserVariableBudgetSetting(activeUser.id);
        saveUserVariableBudgetSetting(activeUser.id, {
          ...current,
          mode: modeInput.value,
        });
        renderAll();
        return;
      }

      const customInput = event.target.closest("[data-variable-budget-custom-input]");
      if (!customInput) return;
      const activeUser = loadActiveUser();
      if (!activeUser?.id) return;
      const current = getUserVariableBudgetSetting(activeUser.id);
      saveUserVariableBudgetSetting(activeUser.id, {
        ...current,
        mode: "custom",
        customAmount: Math.max(0, toNumber(customInput.value)),
      });
      renderAll();
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
    if (monthInfo.month.status !== "active") {
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

    const nextTransactions = allTransactions;
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
    renderMonthControls(monthInfo);

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
    renderTopVariableCategories(monthTransactions);
    renderAccountsOverview(realMetrics.balances, data, realMetrics.extraBalances);
    renderTransferHistory(transactions, activeUser);
  };

  let lastProfileVersion = null;

  const readProfileVersion = () => {
    try {
      const raw = localStorage.getItem(PROFILE_VERSION_KEY);
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
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

  const setupUserMenuInteractions = () => {
    const pill = document.querySelector(".user-pill--account");
    const menu = document.querySelector(".user-menu");
    if (!pill || !menu) return;

    let isOpen = false;
    const outsideClick = (event) => {
      if (menu.contains(event.target) || pill.contains(event.target)) return;
      closeMenu();
    };
    const updateMenuState = (open) => {
      isOpen = open;
      menu.classList.toggle("active", open);
      pill.setAttribute("aria-expanded", String(open));
      if (open) {
        document.addEventListener("click", outsideClick);
      } else {
        document.removeEventListener("click", outsideClick);
      }
    };

    const closeMenu = () => {
      if (isOpen) updateMenuState(false);
    };

    const toggleMenu = () => updateMenuState(!isOpen);

    const handleAction = (action) => {
      if (!action) return;
      if (action === "edit") window.location.href = "profil.html";
      if (action === "logout") {
        try {
          localStorage.setItem("smartsaveActiveUser", "{}");
        } catch (_error) {
          // ignore
        }
        window.location.href = "index.html";
      }
      if (action === "close") closeMenu();
    };

    const actionTarget = (target) => {
      const action = target.dataset.userAction;
      if (action) {
        handleAction(action);
      }
    };

    pill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener("click", (event) => {
      const target = event.target.closest("[data-user-action]");
      if (target) {
        actionTarget(target);
        closeMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    });
  };

  const setupProfileSync = () => {
    lastProfileVersion = readProfileVersion();
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        ensureProfileVersion();
        renderAll();
      }
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("focus", () => {
      ensureProfileVersion();
      renderAll();
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderAll();
    setupOverviewMetricToggle();
    setupHamburgerMenu();
    setupQuickActions();
    setupMonthClose();
    setupVariableBudgetEditor();
    setupTransferHistoryActions();
    setupProfileSync();
    setupUserMenuInteractions();
  });

  window.addEventListener("storage", (event) => {
    if (!event) return;
    if (event.key === PROFILE_VERSION_KEY) {
      ensureProfileVersion();
      return;
    }
    if (event.key === "smartsaveFormData" || event.key === "smartsaveProfileUpdated") {
      renderAll();
    }
  });

  window.addEventListener("pageshow", () => {
    ensureProfileVersion();
    renderAll();
  });

  window.addEventListener("smartsaveProfileUpdated", () => {
    lastProfileVersion = readProfileVersion();
    renderAll();
  });

})();
