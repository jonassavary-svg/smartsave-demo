(() => {
  const STORAGE_KEY_FORM = "smartsaveFormData";
  const STORAGE_KEY_ACTIVE_USER = "smartsaveActiveUser";
  const TRANSACTIONS_KEY = "transactions";

  const toNumber = (value) => {
    const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat("fr-CH", {
      style: "currency",
      currency: "CHF",
      maximumFractionDigits: 0,
    }).format(Math.max(0, toNumber(value)));

  const formatSignedCurrency = (value) => {
    const numeric = toNumber(value);
    const abs = formatCurrency(Math.abs(numeric));
    if (numeric > 0) return `+${abs}`;
    if (numeric < 0) return `-${abs}`;
    return abs;
  };

  const formatCountLabel = (count) => {
    const safe = Math.max(0, Math.round(toNumber(count)));
    return `${safe} ${safe > 1 ? "postes" : "poste"}`;
  };

  const EXPENSE_EMOJI_RULES = [
    { emoji: "🏠", keywords: ["loyer", "hypotheque", "hypothec", "locat", "rent"] },
    { emoji: "🧾", keywords: ["impot", "taxe", "fiscal", "contribution"] },
    { emoji: "🛡️", keywords: ["assurance", "prime", "rc", "lamal"] },
    { emoji: "💡", keywords: ["electric", "courant", "energie"] },
    { emoji: "🔥", keywords: ["gaz", "chauffage", "mazout"] },
    { emoji: "🚰", keywords: ["eau"] },
    { emoji: "📶", keywords: ["internet", "wifi", "box"] },
    { emoji: "📱", keywords: ["telephone", "mobile", "forfait"] },
    { emoji: "🚗", keywords: ["transport", "voiture", "essence", "parking", "bus", "train", "tram"] },
    { emoji: "🛒", keywords: ["course", "supermarche", "nourriture", "alimentaire"] },
    { emoji: "🍽️", keywords: ["restaurant", "resto", "sortie", "repas"] },
    { emoji: "🎉", keywords: ["loisir", "vacance", "voyage", "cinema"] },
    { emoji: "💊", keywords: ["sante", "medecin", "pharma", "hopital", "dentiste"] },
    { emoji: "👶", keywords: ["enfant", "creche", "garde", "ecole", "scolar"] },
    { emoji: "🐾", keywords: ["animal", "chien", "chat", "veterinaire"] },
    { emoji: "🏋️", keywords: ["sport", "fitness", "salle"] },
    { emoji: "👕", keywords: ["vetement", "habit", "shopping"] },
    { emoji: "💳", keywords: ["credit", "emprunt", "dette", "leasing"] },
  ];

  const normalizeSearchText = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const hasLeadingEmoji = (value) =>
    /^[\s]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(String(value || ""));

  const withExpenseEmoji = (label) => {
    const raw = String(label || "").trim();
    if (!raw) return "💸 Dépense";
    if (hasLeadingEmoji(raw)) return raw;
    const normalized = normalizeSearchText(raw);
    const match = EXPENSE_EMOJI_RULES.find((rule) =>
      rule.keywords.some((keyword) => normalized.includes(keyword))
    );
    return `${match?.emoji || "💸"} ${raw}`;
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

  const toMonthlyAmount = (amount, period) => {
    const safe = Math.max(0, toNumber(amount));
    if (period === "week") return (safe * 52) / 12;
    if (period === "year") return safe / 12;
    return safe;
  };

  const formatPeriod = (period) => {
    if (period === "week") return "hebdo";
    if (period === "year") return "annuel";
    return "mensuel";
  };

  const normalizeLineItems = (items = [], kind = "fixed") =>
    (Array.isArray(items) ? items : []).map((item, index) => ({
      id: String(item?.id || `${kind}-${index + 1}`),
      label: String(item?.label || `${kind === "fixed" ? "Charge fixe" : "Charge obligatoire"} ${index + 1}`),
      amount: Math.max(0, toNumber(item?.amount)),
    }));

  const normalizeIncomeItems = (budget = {}) => {
    const explicit = Array.isArray(budget?.incomeItems) ? budget.incomeItems : [];
    const normalized = explicit
      .map((item, index) => ({
        id: String(item?.id || `income-${index + 1}`),
        label: String(item?.label || `Revenu ${index + 1}`),
        amount: Math.max(0, toNumber(item?.amount)),
      }))
      .filter((item) => item.label.trim().length > 0 || item.amount > 0);
    if (normalized.length) return normalized;

    const incomeMain = Math.max(0, toNumber(budget?.incomeMain));
    const incomeOther = Math.max(0, toNumber(budget?.incomeOther));
    const fallback = [];
    if (incomeMain > 0) fallback.push({ id: "income-main", label: "Revenu principal", amount: incomeMain });
    if (incomeOther > 0) fallback.push({ id: "income-other", label: "Autre revenu", amount: incomeOther });
    if (fallback.length) return fallback;

    return [{ id: uid("income"), label: "Revenu principal", amount: 0 }];
  };

  const normalizeVariableCategories = (items = [], legacySplit = {}) => {
    const rows = (Array.isArray(items) ? items : [])
      .map((item, index) => {
        const period = ["week", "month", "year"].includes(item?.period) ? item.period : "month";
        const amount = Math.max(0, toNumber(item?.amount));
        return {
          id: String(item?.id || `variable-${index + 1}`),
          label: String(item?.label || `Catégorie ${index + 1}`),
          period,
          amount,
          monthlyAmount: Math.max(0, toMonthlyAmount(amount, period)),
        };
      })
      .filter((item) => item.label.trim().length > 0 || item.amount > 0);

    if (rows.length) return rows;

    const legacy = [
      { label: "Nourriture", amount: Math.max(0, toNumber(legacySplit?.food)) },
      { label: "Loisirs / sorties", amount: Math.max(0, toNumber(legacySplit?.leisure)) },
      { label: "Divers", amount: Math.max(0, toNumber(legacySplit?.misc)) },
    ].filter((entry) => entry.amount > 0);

    return legacy.map((entry, index) => ({
      id: `variable-legacy-${index + 1}`,
      label: entry.label,
      period: "month",
      amount: entry.amount,
      monthlyAmount: entry.amount,
    }));
  };

  const buildLegacySplitFromCategories = (categories = []) => {
    const split = { food: 0, leisure: 0, misc: 0 };
    categories.forEach((item) => {
      const label = String(item?.label || "").toLowerCase();
      const monthly = Math.max(0, toNumber(item?.monthlyAmount));
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

  const loadActiveUser = () => {
    if (typeof window.loadActiveUser === "function") return window.loadActiveUser();
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIVE_USER) || "{}");
      return parsed?.id ? parsed : null;
    } catch (_error) {
      return null;
    }
  };

  const loadUserForm = (userId) => {
    if (typeof window.loadUserForm === "function") return window.loadUserForm(userId);
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_FORM) || "{}");
      return parsed?.[userId] || parsed?.__default || null;
    } catch (_error) {
      return null;
    }
  };

  const saveUserForm = (userId, formData) => {
    if (!userId || !formData) return;
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_FORM) || "{}");
      parsed[userId] = formData;
      localStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(parsed));
      localStorage.setItem("smartsaveProfileUpdated", String(Date.now()));
    } catch (_error) {
      // ignore storage issues
    }
  };

  const loadTransactions = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  };

  const formatMonth = (monthId, fallback = new Date()) => {
    const parts = String(monthId || "").split("-");
    if (parts.length !== 2) {
      return new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(fallback);
    }
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const date = new Date(year, month, 1);
    if (Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(fallback);
    }
    const label = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const enableZeroClearOnFocus = (root) => {
    if (!root || root.dataset.zeroClearBound === "1") return;
    root.dataset.zeroClearBound = "1";

    const isClearableNumberInput = (node) =>
      node instanceof HTMLInputElement &&
      node.type === "number" &&
      !node.readOnly &&
      !node.disabled;

    root.addEventListener("focusin", (event) => {
      const input = event.target;
      if (!isClearableNumberInput(input)) return;
      const raw = String(input.value ?? "").trim();
      if (!raw) return;
      const numeric = Number(raw.replace(",", "."));
      if (!Number.isFinite(numeric) || numeric !== 0) return;
      input.value = "";
    });
  };

  const renderExpenseRows = (container, items = [], kind = "fixed", options = {}) => {
    if (!container) return;
    const inputClass = options.amountWithCurrency ? "budget-line-amount budget-line-amount--money" : "budget-line-amount";
    const rows = items.length
      ? items
      : [
          {
            id: uid(kind),
            label: kind === "income" ? "Revenu principal" : kind === "fixed" ? "Loyer" : "Courses",
            amount: 0,
          },
        ];

    container.innerHTML = rows
      .map(
        (item) => `
        <div class="budget-line-row" data-line-row="${kind}" data-line-id="${escapeHtml(item.id)}">
          <input
            type="text"
            class="budget-line-input"
            data-line-label
            value="${escapeHtml(item.label)}"
            placeholder="Nom"
          />
          <input
            type="number"
            class="${inputClass}"
            data-line-amount
            min="0"
            step="1"
            value="${Math.round(Math.max(0, toNumber(item.amount)))}"
            placeholder="CHF"
          />
          <button type="button" class="budget-line-remove" data-line-remove aria-label="Supprimer">×</button>
        </div>
      `
      )
      .join("");

    const removeButtons = container.querySelectorAll("[data-line-remove]");
    if (rows.length <= 1) {
      removeButtons.forEach((button) => {
        button.disabled = true;
      });
    }
  };

  const renderVariableRows = (container, items = []) => {
    if (!container) return;
    const rows = items.length
      ? items
      : [{ id: uid("variable"), label: "Restaurant", period: "month", amount: 0, monthlyAmount: 0 }];

    container.innerHTML = rows
      .map((item) => {
        const period = ["week", "month", "year"].includes(item.period) ? item.period : "month";
        const amount = Math.max(0, toNumber(item.amount));
        const monthly = Math.max(0, toMonthlyAmount(amount, period));
        return `
          <div class="budget-variable-row" data-variable-row data-variable-id="${escapeHtml(item.id)}">
            <input
              type="text"
              class="budget-line-input"
              data-variable-label
              value="${escapeHtml(item.label)}"
              placeholder="Ex: Restaurants"
            />
            <div class="budget-variable-controls">
              <select data-variable-period>
                <option value="week" ${period === "week" ? "selected" : ""}>Semaine</option>
                <option value="month" ${period === "month" ? "selected" : ""}>Mois</option>
                <option value="year" ${period === "year" ? "selected" : ""}>Année</option>
              </select>
              <input type="number" min="0" step="1" data-variable-amount value="${Math.round(amount)}" />
              <button type="button" class="budget-line-remove" data-variable-remove aria-label="Supprimer">×</button>
            </div>
            <p class="budget-variable-monthly">Équiv. mensuel: <strong data-variable-monthly>${formatCurrency(monthly)}</strong></p>
          </div>
        `;
      })
      .join("");

    const removeButtons = container.querySelectorAll("[data-variable-remove]");
    if (rows.length <= 1) {
      removeButtons.forEach((button) => {
        button.disabled = true;
      });
    }
  };

  const readExpenseRows = (container, kind = "fixed") => {
    const rows = Array.from(container?.querySelectorAll(`[data-line-row="${kind}"]`) || []);
    return rows
      .map((row, index) => ({
        id: String(row.dataset.lineId || uid(kind)),
        label:
          String(row.querySelector("[data-line-label]")?.value || "").trim() ||
          `${
            kind === "income"
              ? "Revenu"
              : kind === "fixed"
                ? "Charge fixe"
                : "Charge obligatoire"
          } ${index + 1}`,
        amount: Math.max(0, toNumber(row.querySelector("[data-line-amount]")?.value)),
      }))
      .filter((item) => item.label || item.amount > 0);
  };

  const readVariableRows = (container) => {
    const rows = Array.from(container?.querySelectorAll("[data-variable-row]") || []);
    return rows
      .map((row, index) => {
        const periodRaw = String(row.querySelector("[data-variable-period]")?.value || "month");
        const period = ["week", "month", "year"].includes(periodRaw) ? periodRaw : "month";
        const amount = Math.max(0, toNumber(row.querySelector("[data-variable-amount]")?.value));
        const monthlyAmount = Math.max(0, toMonthlyAmount(amount, period));
        return {
          id: String(row.dataset.variableId || uid("variable")),
          label: String(row.querySelector("[data-variable-label]")?.value || "").trim() || `Catégorie ${index + 1}`,
          period,
          amount,
          monthlyAmount,
        };
      })
      .filter((item) => item.label || item.amount > 0);
  };

  const buildBudgetFromForm = (formEl, currentBudget) => {
    const incomeItems = readExpenseRows(formEl.querySelector("[data-budget-income-list]"), "income");
    const fixedItems = readExpenseRows(formEl.querySelector("[data-budget-fixed-list]"), "fixed");
    const mandatoryItems = readExpenseRows(formEl.querySelector("[data-budget-mandatory-list]"), "mandatory");

    const totalIncome = incomeItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    const incomeMain = Math.max(0, toNumber(incomeItems[0]?.amount || 0));
    const incomeOther = Math.max(0, totalIncome - incomeMain);
    const variablePlanned = Math.max(0, toNumber(formEl.querySelector("#budget-variable-planned")?.value));

    const splitEnabled = Boolean(formEl.querySelector("#budget-split-enabled")?.checked);
    const variableCategories = splitEnabled
      ? readVariableRows(formEl.querySelector("[data-budget-variable-list]"))
      : normalizeVariableCategories(currentBudget?.variableCategories, currentBudget?.variableSplit);

    const variableSplit = buildLegacySplitFromCategories(variableCategories);

    const fixedTotal = fixedItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    const mandatoryTotal = mandatoryItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    const remaining = totalIncome - fixedTotal - mandatoryTotal - variablePlanned;

    return {
      incomeMain,
      incomeOther,
      incomeItems,
      totalIncome,
      fixedItems,
      fixedTotal,
      mandatoryItems,
      mandatoryTotal,
      variablePlanned,
      variableSplitEnabled: splitEnabled,
      variableSplit,
      variableCategories,
      remaining,
    };
  };

  const computeVariableCapacity = (formEl) => {
    const incomeItems = readExpenseRows(formEl.querySelector("[data-budget-income-list]"), "income");
    const fixedItems = readExpenseRows(formEl.querySelector("[data-budget-fixed-list]"), "fixed");
    const mandatoryItems = readExpenseRows(formEl.querySelector("[data-budget-mandatory-list]"), "mandatory");
    const totalIncome = incomeItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    const fixedTotal = fixedItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    const mandatoryTotal = mandatoryItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0);
    return Math.max(0, totalIncome - fixedTotal - mandatoryTotal);
  };

  const setFructifierMessage = ({
    container,
    incomeNode,
    expensesNode,
    remainingNode,
    income = 0,
    expenses = 0,
    remaining = 0,
  }) => {
    if (!container) return;
    const safeIncome = Math.max(0, toNumber(income));
    const safeExpenses = Math.max(0, toNumber(expenses));
    const safeRemaining = toNumber(remaining);

    if (incomeNode) incomeNode.textContent = formatCurrency(safeIncome);
    if (expensesNode) expensesNode.textContent = formatCurrency(safeExpenses);
    if (remainingNode) {
      remainingNode.textContent = formatSignedCurrency(safeRemaining);
      remainingNode.classList.toggle("is-positive", safeRemaining > 0);
      remainingNode.classList.toggle("is-negative", safeRemaining < 0);
    }

    container.classList.remove("is-positive", "is-negative", "is-neutral");
    if (safeRemaining > 0) {
      container.classList.add("is-positive");
      return;
    }
    if (safeRemaining < 0) {
      container.classList.add("is-negative");
      return;
    }
    container.classList.add("is-neutral");
  };

  const updateSummary = (budget, nodes) => {
    if (!nodes) return;
    const totalIncome = Math.max(0, toNumber(budget.totalIncome));
    const fixedTotal = Math.max(0, toNumber(budget.fixedTotal));
    const mandatoryTotal = Math.max(0, toNumber(budget.mandatoryTotal));
    const variableTotal = Math.max(0, toNumber(budget.variablePlanned));
    const totalExpenses = Math.max(0, fixedTotal + mandatoryTotal + variableTotal);
    const remaining = toNumber(budget.remaining);

    if (nodes.income) nodes.income.textContent = formatCurrency(totalIncome);
    if (nodes.fixed) nodes.fixed.textContent = formatCurrency(fixedTotal);
    if (nodes.mandatory) nodes.mandatory.textContent = formatCurrency(mandatoryTotal);
    if (nodes.variable) nodes.variable.textContent = formatCurrency(variableTotal);
    if (nodes.expensesTotal) nodes.expensesTotal.textContent = formatCurrency(totalExpenses);
    if (nodes.expensesTotalBottom) nodes.expensesTotalBottom.textContent = formatCurrency(totalExpenses);

    if (nodes.remaining) {
      nodes.remaining.textContent = formatSignedCurrency(remaining);
      nodes.remaining.classList.toggle("is-negative", remaining < 0);
      nodes.remaining.classList.toggle("is-positive", remaining > 0);
    }

    if (nodes.warning) nodes.warning.hidden = remaining >= 0;

    const fixedCount = Array.isArray(budget.fixedItems) ? budget.fixedItems.length : 0;
    const mandatoryCount = Array.isArray(budget.mandatoryItems) ? budget.mandatoryItems.length : 0;
    const variableCount = normalizeVariableCategories(
      budget.variableCategories,
      budget.variableSplit
    ).length;
    if (nodes.fixedCount) nodes.fixedCount.textContent = formatCountLabel(fixedCount);
    if (nodes.mandatoryCount) nodes.mandatoryCount.textContent = formatCountLabel(mandatoryCount);
    if (nodes.variableCount) nodes.variableCount.textContent = formatCountLabel(variableCount);

    setFructifierMessage({
      container: nodes.fructifier,
      incomeNode: nodes.fructifierIncome,
      expensesNode: nodes.fructifierExpenses,
      remainingNode: nodes.fructifierRemaining,
      income: totalIncome,
      expenses: totalExpenses,
      remaining,
    });

    const denominator = Math.max(1, totalIncome, totalExpenses);
    const setGauge = (node, value) => {
      if (!node) return;
      const ratio = Math.max(0, Math.min(100, (Math.max(0, value) / denominator) * 100));
      node.style.width = `${ratio.toFixed(1)}%`;
    };

    setGauge(nodes.gaugeFixed, fixedTotal);
    setGauge(nodes.gaugeMandatory, mandatoryTotal);
    setGauge(nodes.gaugeVariable, variableTotal);
  };

  const renderReadList = (container, items = []) => {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="budget-read-empty">Aucune donnée</p>';
      return;
    }
    container.innerHTML = items
      .map(
        (item) => `
          <p class="budget-read-line">
            <span>${escapeHtml(item.label)}</span>
            <strong>${formatCurrency(item.amount)}</strong>
          </p>
        `
      )
      .join("");
  };

  const renderSummaryDetails = (container, items = []) => {
    if (!container) return;
    const safeItems = Array.isArray(items) ? items : [];
    const subtotal = safeItems.reduce((sum, item) => sum + Math.max(0, toNumber(item?.amount)), 0);
    const subtotalLabel = String(container.dataset.subtotalLabel || "Sous-total").trim() || "Sous-total";
    const emptyLabel =
      String(container.dataset.emptyLabel || "Aucune donnée disponible").trim() || "Aucune donnée disponible";
    const withEmoji = container.dataset.emojiExpense === "1";
    const hideSubtotalWhenEmpty = container.dataset.hideSubtotalWhenEmpty === "1";
    const lines = safeItems.length
      ? safeItems
      .map(
        (item) => `
          <p class="budget-summary-details__line">
            <span>${escapeHtml(withEmoji ? withExpenseEmoji(item.label) : item.label)}</span>
            <strong>${formatCurrency(item.amount)}</strong>
          </p>
        `
      )
      .join("")
      : `<p class="budget-summary-details__empty">${escapeHtml(emptyLabel)}</p>`;
    const subtotalBlock =
      !safeItems.length && hideSubtotalWhenEmpty
        ? ""
        : `
      <p class="budget-summary-details__subtotal">
        <span>${escapeHtml(subtotalLabel)}</span>
        <strong>${formatCurrency(subtotal)}</strong>
      </p>
    `;
    container.innerHTML = `${lines}${subtotalBlock}`;
  };

  const renderReadOnly = ({ monthLabel, budget, flowState }) => {
    const readSection = document.querySelector("[data-budget-mode-read]");
    const editSection = document.querySelector("[data-budget-mode-edit]");
    const readTitle = document.querySelector("[data-budget-read-title]");
    if (!readSection || !editSection) return;

    editSection.hidden = true;
    readSection.hidden = false;
    if (readTitle) readTitle.textContent = `Ton budget de ${monthLabel}`;

    const setText = (selector, value) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = formatCurrency(value);
    };
    setText("[data-budget-read-income]", budget.totalIncome);
    setText("[data-budget-read-fixed]", budget.fixedTotal);
    setText("[data-budget-read-mandatory]", budget.mandatoryTotal);
    setText("[data-budget-read-variable]", budget.variablePlanned);
    const totalExpenses = Math.max(0, budget.fixedTotal + budget.mandatoryTotal + budget.variablePlanned);
    setText("[data-budget-read-expenses-total]", totalExpenses);
    setText("[data-budget-read-expenses-total-bottom]", totalExpenses);

    const remainingValue = toNumber(budget.remaining);
    const remainingNode = document.querySelector("[data-budget-read-remaining]");
    if (remainingNode) {
      remainingNode.textContent = formatSignedCurrency(remainingValue);
      remainingNode.classList.toggle("is-negative", remainingValue < 0);
      remainingNode.classList.toggle("is-positive", remainingValue > 0);
    }

    const fixedItems = normalizeLineItems(budget.fixedItems, "fixed");
    const mandatoryItems = normalizeLineItems(budget.mandatoryItems, "mandatory");
    const variableItems = normalizeVariableCategories(
      budget.variableCategories,
      budget.variableSplit
    ).map((entry) => ({
      label: `${entry.label} (${formatPeriod(entry.period)})`,
      amount: entry.monthlyAmount,
    }));

    const fixedCountNode = document.querySelector("[data-budget-read-fixed-count]");
    const mandatoryCountNode = document.querySelector("[data-budget-read-mandatory-count]");
    const variableCountNode = document.querySelector("[data-budget-read-variable-count]");
    if (fixedCountNode) fixedCountNode.textContent = formatCountLabel(fixedItems.length);
    if (mandatoryCountNode) mandatoryCountNode.textContent = formatCountLabel(mandatoryItems.length);
    if (variableCountNode) variableCountNode.textContent = formatCountLabel(variableItems.length);

    const fixedDetails = document.querySelector("[data-budget-read-fixed-details]");
    if (fixedDetails) {
      fixedDetails.dataset.emptyLabel = "Aucune dépense fixe";
      fixedDetails.dataset.subtotalLabel = "Sous-total dépenses fixes";
      fixedDetails.dataset.emojiExpense = "1";
    }
    const mandatoryDetails = document.querySelector("[data-budget-read-mandatory-details]");
    if (mandatoryDetails) {
      mandatoryDetails.dataset.emptyLabel = "Aucune dépense obligatoire";
      mandatoryDetails.dataset.subtotalLabel = "Sous-total dépenses obligatoires";
      mandatoryDetails.dataset.emojiExpense = "1";
    }
    const variableDetailsNode = document.querySelector("[data-budget-read-variable-details]");
    if (variableDetailsNode) {
      variableDetailsNode.dataset.emptyLabel = "Aucun descriptif des dépenses variables";
      variableDetailsNode.dataset.subtotalLabel = "Sous-total dépenses variables";
      variableDetailsNode.dataset.hideSubtotalWhenEmpty = "1";
      variableDetailsNode.dataset.emojiExpense = "1";
    }

    renderSummaryDetails(fixedDetails, fixedItems);
    renderSummaryDetails(mandatoryDetails, mandatoryItems);
    renderSummaryDetails(variableDetailsNode, variableItems);

    const bindToggle = (key) => {
      const btn = document.querySelector(`[data-budget-read-${key}-toggle]`);
      const details = document.querySelector(`[data-budget-read-${key}-details]`);
      if (!btn || !details || btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(open));
        btn.classList.toggle("is-open", open);
        details.hidden = !open;
      });
    };
    bindToggle("fixed");
    bindToggle("mandatory");
    bindToggle("variable");

    setFructifierMessage({
      container: document.querySelector("[data-budget-read-fructifier]"),
      incomeNode: document.querySelector("[data-budget-read-fructifier-income]"),
      expensesNode: document.querySelector("[data-budget-read-fructifier-expenses]"),
      remainingNode: document.querySelector("[data-budget-read-fructifier-remaining]"),
      income: budget.totalIncome,
      expenses: totalExpenses,
      remaining: remainingValue,
    });

    const primaryBtn = document.querySelector("[data-budget-read-primary]");
    if (primaryBtn) {
      if (flowState === "FIN_MOIS_A_CLOTURER") {
        primaryBtn.textContent = "Faire le bilan";
        primaryBtn.setAttribute("href", "bilan.html");
      } else {
        primaryBtn.textContent = "Voir la Répartition";
        primaryBtn.setAttribute("href", "smartsave.html");
      }
    }
  };

  const renderEditable = ({ budget, onSubmit }) => {
    const editSection = document.querySelector("[data-budget-mode-edit]");
    const readSection = document.querySelector("[data-budget-mode-read]");
    const formEl = document.querySelector("[data-budget-form]");
    const incomeList = document.querySelector("[data-budget-income-list]");
    const fixedList = document.querySelector("[data-budget-fixed-list]");
    const mandatoryList = document.querySelector("[data-budget-mandatory-list]");
    const variableList = document.querySelector("[data-budget-variable-list]");
    const addIncomeBtn = document.querySelector("[data-budget-add-income]");
    const addFixedBtn = document.querySelector("[data-budget-add-fixed]");
    const addMandatoryBtn = document.querySelector("[data-budget-add-mandatory]");
    const addVariableBtn = document.querySelector("[data-budget-add-variable]");
    const splitToggle = document.querySelector("#budget-split-enabled");
    const variableInput = formEl.querySelector("#budget-variable-planned");
    const variableSlider = document.querySelector("[data-budget-variable-slider]");
    const variableCap = document.querySelector("[data-budget-variable-cap]");
    const splitFields = document.querySelector("[data-budget-split-fields]");
    const splitHint = document.querySelector("[data-budget-split-hint]");
    const stepPanels = Array.from(document.querySelectorAll("[data-budget-step-panel]"));
    const stepItems = Array.from(document.querySelectorAll("[data-budget-step-index]"));
    const prevBtn = document.querySelector("[data-budget-prev]");
    const nextBtn = document.querySelector("[data-budget-next]");
    const submitBtn = document.querySelector("[data-budget-submit]");
    const summaryToggles = {
      income: document.querySelector("[data-budget-summary-income-toggle]"),
      fixed: document.querySelector("[data-budget-summary-fixed-toggle]"),
      mandatory: document.querySelector("[data-budget-summary-mandatory-toggle]"),
      variable: document.querySelector("[data-budget-summary-variable-toggle]"),
    };
    const summaryDetails = {
      income: document.querySelector("[data-budget-summary-income-details]"),
      fixed: document.querySelector("[data-budget-summary-fixed-details]"),
      mandatory: document.querySelector("[data-budget-summary-mandatory-details]"),
      variable: document.querySelector("[data-budget-summary-variable-details]"),
    };

    if (
      !editSection ||
      !readSection ||
      !formEl ||
      !incomeList ||
      !fixedList ||
      !mandatoryList ||
      !variableList ||
      !addIncomeBtn ||
      !addFixedBtn ||
      !addMandatoryBtn ||
      !addVariableBtn ||
      !splitToggle ||
      !variableInput ||
      !variableSlider ||
      !variableCap ||
      !splitFields ||
      !splitHint ||
      !stepPanels.length ||
      !stepItems.length ||
      !prevBtn ||
      !nextBtn ||
      !summaryToggles.fixed ||
      !summaryToggles.mandatory ||
      !summaryToggles.variable ||
      !summaryDetails.fixed ||
      !summaryDetails.mandatory ||
      !summaryDetails.variable ||
      !submitBtn
    ) {
      return;
    }

    readSection.hidden = true;
    editSection.hidden = false;
    enableZeroClearOnFocus(formEl);

    formEl.querySelector("#budget-variable-planned").value = String(Math.round(Math.max(0, budget.variablePlanned)));
    splitToggle.checked = Boolean(budget.variableSplitEnabled);

    renderExpenseRows(incomeList, normalizeIncomeItems(budget), "income", { amountWithCurrency: true });
    renderExpenseRows(fixedList, normalizeLineItems(budget.fixedItems, "fixed"), "fixed");
    renderExpenseRows(mandatoryList, normalizeLineItems(budget.mandatoryItems, "mandatory"), "mandatory");
    renderVariableRows(variableList, normalizeVariableCategories(budget.variableCategories, budget.variableSplit));

    const summaryNodes = {
      income: document.querySelector("[data-budget-summary-income]"),
      fixed: document.querySelector("[data-budget-summary-fixed]"),
      mandatory: document.querySelector("[data-budget-summary-mandatory]"),
      variable: document.querySelector("[data-budget-summary-variable]"),
      remaining: document.querySelector("[data-budget-summary-remaining]"),
      expensesTotal: document.querySelector("[data-budget-summary-expenses-total]"),
      expensesTotalBottom: document.querySelector("[data-budget-summary-expenses-total-bottom]"),
      fixedCount: document.querySelector("[data-budget-summary-fixed-count]"),
      mandatoryCount: document.querySelector("[data-budget-summary-mandatory-count]"),
      variableCount: document.querySelector("[data-budget-summary-variable-count]"),
      fructifier: document.querySelector("[data-budget-summary-fructifier]"),
      fructifierIncome: document.querySelector("[data-budget-summary-fructifier-income]"),
      fructifierExpenses: document.querySelector("[data-budget-summary-fructifier-expenses]"),
      fructifierRemaining: document.querySelector("[data-budget-summary-fructifier-remaining]"),
      warning: document.querySelector("[data-budget-warning]"),
      gaugeFixed: document.querySelector("[data-budget-gauge-fixed]"),
      gaugeMandatory: document.querySelector("[data-budget-gauge-mandatory]"),
      gaugeVariable: document.querySelector("[data-budget-gauge-variable]"),
    };
    const guidanceNodes = {
      incomeTotal: document.querySelector("[data-budget-step-income-total]"),
      afterFixed: document.querySelector("[data-budget-after-fixed]"),
      afterMandatory: document.querySelector("[data-budget-after-mandatory]"),
      afterVariable: document.querySelector("[data-budget-after-variable]"),
    };
    const summaryOpen = {
      fixed: false,
      mandatory: false,
      variable: false,
    };

    const refresh = () => {
      const capacity = Math.max(0, Math.round(computeVariableCapacity(formEl)));
      const currentVariable = Math.max(0, Math.round(toNumber(variableInput.value)));
      const clampedVariable = Math.min(capacity, currentVariable);
      if (clampedVariable !== currentVariable) {
        variableInput.value = String(clampedVariable);
      }
      variableSlider.max = String(capacity);
      variableSlider.value = String(clampedVariable);
      variableCap.textContent = formatCurrency(capacity);

      splitFields.hidden = !splitToggle.checked;
      const nextBudget = buildBudgetFromForm(formEl, budget);

      if (splitToggle.checked) {
        const splitTotal = nextBudget.variableCategories.reduce(
          (sum, item) => sum + Math.max(0, toNumber(item.monthlyAmount)),
          0
        );
        const isValid = Math.round(splitTotal) === Math.round(nextBudget.variablePlanned);
        splitHint.textContent = isValid
          ? "Répartition OK."
          : "La somme mensuelle des catégories doit égaler le total des dépenses variables.";
        splitHint.classList.toggle("is-error", !isValid);

        variableList.querySelectorAll("[data-variable-row]").forEach((row) => {
          const period = String(row.querySelector("[data-variable-period]")?.value || "month");
          const amount = Math.max(0, toNumber(row.querySelector("[data-variable-amount]")?.value));
          const monthly = toMonthlyAmount(amount, period);
          const monthlyNode = row.querySelector("[data-variable-monthly]");
          if (monthlyNode) monthlyNode.textContent = formatCurrency(monthly);
        });
      } else {
        splitHint.textContent = "La somme doit égaler le total des dépenses variables.";
        splitHint.classList.remove("is-error");
      }

      updateSummary(nextBudget, summaryNodes);
      if (guidanceNodes.incomeTotal) {
        guidanceNodes.incomeTotal.textContent = formatCurrency(nextBudget.totalIncome);
      }
      if (guidanceNodes.afterFixed) {
        guidanceNodes.afterFixed.textContent = formatCurrency(
          Math.max(0, nextBudget.totalIncome - nextBudget.fixedTotal)
        );
      }
      if (guidanceNodes.afterMandatory) {
        guidanceNodes.afterMandatory.textContent = formatCurrency(
          Math.max(0, nextBudget.totalIncome - nextBudget.fixedTotal - nextBudget.mandatoryTotal)
        );
      }
      if (guidanceNodes.afterVariable) {
        guidanceNodes.afterVariable.textContent = formatCurrency(Math.max(0, nextBudget.remaining));
      }
      if (summaryDetails.income) {
        summaryDetails.income.dataset.emptyLabel = "Aucun revenu";
        summaryDetails.income.dataset.subtotalLabel = "Sous-total revenus";
        summaryDetails.income.dataset.emojiExpense = "0";
        renderSummaryDetails(summaryDetails.income, nextBudget.incomeItems || []);
      }
      summaryDetails.fixed.dataset.emptyLabel = "Aucune dépense fixe";
      summaryDetails.fixed.dataset.subtotalLabel = "Sous-total dépenses fixes";
      summaryDetails.fixed.dataset.emojiExpense = "1";
      summaryDetails.mandatory.dataset.emptyLabel = "Aucune dépense obligatoire";
      summaryDetails.mandatory.dataset.subtotalLabel = "Sous-total dépenses obligatoires";
      summaryDetails.mandatory.dataset.emojiExpense = "1";
      renderSummaryDetails(summaryDetails.fixed, nextBudget.fixedItems || []);
      renderSummaryDetails(summaryDetails.mandatory, nextBudget.mandatoryItems || []);
      const variableDetails = normalizeVariableCategories(
        nextBudget.variableCategories,
        nextBudget.variableSplit
      ).map((item) => ({
        label: `${item.label} (${formatPeriod(item.period)})`,
        amount: item.monthlyAmount,
      }));
      summaryDetails.variable.dataset.emptyLabel = "Aucun descriptif des dépenses variables";
      summaryDetails.variable.dataset.subtotalLabel = "Sous-total dépenses variables";
      summaryDetails.variable.dataset.hideSubtotalWhenEmpty = "1";
      summaryDetails.variable.dataset.emojiExpense = "1";
      renderSummaryDetails(summaryDetails.variable, variableDetails);
      return nextBudget;
    };

    let currentStep = 0;
    const setStep = (index) => {
      const nextIndex = Math.max(0, Math.min(stepPanels.length - 1, Number(index) || 0));
      currentStep = nextIndex;
      stepPanels.forEach((panel, panelIndex) => {
        panel.hidden = panelIndex !== currentStep;
      });
      stepItems.forEach((item, itemIndex) => {
        item.classList.toggle("is-active", itemIndex === currentStep);
        item.classList.toggle("is-done", itemIndex < currentStep);
      });
      prevBtn.hidden = currentStep === 0;
      nextBtn.hidden = currentStep === stepPanels.length - 1;
      submitBtn.hidden = currentStep !== stepPanels.length - 1;
    };

    const mutateExpenseRows = (container, kind, mutate) => {
      const current = readExpenseRows(container, kind);
      const next = mutate(current.slice()) || current;
      renderExpenseRows(container, next, kind);
      refresh();
    };

    const mutateVariableRows = (mutate) => {
      const current = readVariableRows(variableList);
      const next = mutate(current.slice()) || current;
      renderVariableRows(variableList, next);
      refresh();
    };

    addIncomeBtn.addEventListener("click", () => {
      mutateExpenseRows(incomeList, "income", (rows) => {
        rows.push({ id: uid("income"), label: "Nouveau revenu", amount: 0 });
        return rows;
      });
    });

    addFixedBtn.addEventListener("click", () => {
      mutateExpenseRows(fixedList, "fixed", (rows) => {
        rows.push({ id: uid("fixed"), label: "Nouvelle charge fixe", amount: 0 });
        return rows;
      });
    });

    addMandatoryBtn.addEventListener("click", () => {
      mutateExpenseRows(mandatoryList, "mandatory", (rows) => {
        rows.push({ id: uid("mandatory"), label: "Nouvelle charge obligatoire", amount: 0 });
        return rows;
      });
    });

    addVariableBtn.addEventListener("click", () => {
      mutateVariableRows((rows) => {
        rows.push({ id: uid("variable"), label: "Nouvelle catégorie", period: "month", amount: 0 });
        return rows;
      });
    });

    fixedList.addEventListener("click", (event) => {
      const removeBtn = event.target.closest("[data-line-remove]");
      if (!removeBtn) return;
      const row = removeBtn.closest("[data-line-row]");
      if (!row) return;
      const id = String(row.dataset.lineId || "");
      mutateExpenseRows(fixedList, "fixed", (rows) => rows.filter((entry) => entry.id !== id));
    });

    mandatoryList.addEventListener("click", (event) => {
      const removeBtn = event.target.closest("[data-line-remove]");
      if (!removeBtn) return;
      const row = removeBtn.closest("[data-line-row]");
      if (!row) return;
      const id = String(row.dataset.lineId || "");
      mutateExpenseRows(mandatoryList, "mandatory", (rows) => rows.filter((entry) => entry.id !== id));
    });

    incomeList.addEventListener("click", (event) => {
      const removeBtn = event.target.closest("[data-line-remove]");
      if (!removeBtn) return;
      const row = removeBtn.closest("[data-line-row]");
      if (!row) return;
      const id = String(row.dataset.lineId || "");
      mutateExpenseRows(incomeList, "income", (rows) => rows.filter((entry) => entry.id !== id));
    });

    variableList.addEventListener("click", (event) => {
      const removeBtn = event.target.closest("[data-variable-remove]");
      if (!removeBtn) return;
      const row = removeBtn.closest("[data-variable-row]");
      if (!row) return;
      const id = String(row.dataset.variableId || "");
      mutateVariableRows((rows) => rows.filter((entry) => entry.id !== id));
    });

    formEl.addEventListener("input", refresh);
    formEl.addEventListener("change", refresh);
    splitToggle.addEventListener("change", refresh);
    variableSlider.addEventListener("input", () => {
      variableInput.value = String(Math.max(0, Math.round(toNumber(variableSlider.value))));
      refresh();
    });
    const bindSummaryToggle = (key) => {
      const toggle = summaryToggles[key];
      const details = summaryDetails[key];
      if (!toggle || !details) return;
      toggle.addEventListener("click", () => {
        summaryOpen[key] = !summaryOpen[key];
        details.hidden = !summaryOpen[key];
        toggle.setAttribute("aria-expanded", String(summaryOpen[key]));
        toggle.classList.toggle("is-open", summaryOpen[key]);
      });
    };
    bindSummaryToggle("fixed");
    bindSummaryToggle("mandatory");
    bindSummaryToggle("variable");
    prevBtn.addEventListener("click", () => setStep(currentStep - 1));
    nextBtn.addEventListener("click", () => setStep(currentStep + 1));
    stepItems.forEach((item) => {
      item.addEventListener("click", () => {
        const index = Number(item.dataset.budgetStepIndex);
        if (Number.isFinite(index)) setStep(index);
      });
    });

    refresh();
    setStep(0);

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nextBudget = refresh();

      if (nextBudget.variableSplitEnabled) {
        const splitTotal = nextBudget.variableCategories.reduce(
          (sum, item) => sum + Math.max(0, toNumber(item.monthlyAmount)),
          0
        );
        if (Math.round(splitTotal) !== Math.round(nextBudget.variablePlanned)) {
          splitHint.textContent = "La somme mensuelle des catégories doit égaler le total des dépenses variables.";
          splitHint.classList.add("is-error");
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Enregistrement...";
      try {
        await onSubmit(nextBudget);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Valider mon budget";
      }
    });
  };

  const init = () => {
    const store = window.SmartSaveMonthlyStore;
    if (!store) return;

    const activeUser = loadActiveUser();
    if (!activeUser?.id) {
      window.location.href = "index.html";
      return;
    }

    const formData = loadUserForm(activeUser.id) || {};
    const context = store.ensureUserMonthContext({
      userId: activeUser.id,
      formData,
      mvpData: {},
      allTransactions: loadTransactions(),
      now: new Date(),
    });
    if (!context?.monthId) return;

    const monthId = context.monthId;
    const monthLabel = formatMonth(monthId);
    const editTitle = document.querySelector("[data-budget-edit-title]");
    const readTitle = document.querySelector("[data-budget-read-title]");
    if (editTitle) editTitle.textContent = `Ton budget de ${monthLabel}`;
    if (readTitle) readTitle.textContent = `Ton budget de ${monthLabel}`;

    const flow =
      store.getFlowStateForMonth({
        userId: activeUser.id,
        monthId,
        now: new Date(),
        monthlyPlan: context.monthlyPlan,
      }) || { state: "NOUVEAU_MOIS" };

    const banner = document.querySelector("[data-budget-endmonth-banner]");
    if (banner) {
      banner.hidden = flow.state !== "FIN_MOIS_A_CLOTURER";
    }

    const budget = store.getMonthlyBudgetForMonth({
      userId: activeUser.id,
      monthId,
      formData,
    });
    if (!budget) return;

    const flowFlags =
      context.monthlyPlan?.flags?.flow && typeof context.monthlyPlan.flags.flow === "object"
        ? context.monthlyPlan.flags.flow
        : {};
    const hasAllocationValidated = Boolean(
      flowFlags.allocationValidatedAt ||
        context.monthlyPlan?.flags?.allocationValidatedAt ||
        context.monthlyPlan?.flags?.planAppliedAt ||
        context.monthlyPlan?.flags?.monthlyPlanAppliedAt
    );
    const budgetSource = String(budget?.source || "").trim().toLowerCase();
    const isAutoSyncedBudget = budgetSource === "auto-form-sync" && !budget?.savedAt;
    const isEditable =
      flow.state === "NOUVEAU_MOIS" ||
      (flow.state === "BUDGET_FAIT_REPARTITION_NON_VUE" &&
        isAutoSyncedBudget &&
        !hasAllocationValidated);
    if (!isEditable) {
      renderReadOnly({ monthLabel, budget, flowState: flow.state });
      return;
    }

    renderEditable({
      budget,
      onSubmit: async (nextBudget) => {
        const saved = store.saveMonthlyBudgetForMonth({
          userId: activeUser.id,
          monthId,
          budget: nextBudget,
          formData,
        });
        if (!saved) return;

        const nextFormData = JSON.parse(JSON.stringify(formData || {}));
        nextFormData.allocationPlan =
          nextFormData.allocationPlan && typeof nextFormData.allocationPlan === "object"
            ? nextFormData.allocationPlan
            : {};
        nextFormData.allocationPlan.leisureMonthly = Math.max(0, toNumber(saved.variablePlanned));
        saveUserForm(activeUser.id, nextFormData);

        store.markBudgetValidatedForMonth({ userId: activeUser.id, monthId });
        window.location.href = "mon-argent.html";
      },
    });
  };

  const setupHamburgerMenu = () => {
    const button = document.querySelector(".menu-button");
    const menu = document.querySelector(".hamburger-menu");
    if (!button || !menu) return;

    const toggleMenu = (force) => {
      const open = force == null ? !menu.classList.contains("is-open") : Boolean(force);
      menu.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
    };

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) toggleMenu(false);
    });

    document.addEventListener("click", (event) => {
      if (!menu.classList.contains("is-open")) return;
      if (!menu.contains(event.target) && !button.contains(event.target)) {
        toggleMenu(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") toggleMenu(false);
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    init();
    setupHamburgerMenu();
  });
})();
