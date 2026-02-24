(() => {
  const TRANSACTIONS_KEY = "transactions";

  const toNumber = (value) => {
    if (typeof window.toNumber === "function") return window.toNumber(value);
    const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatCurrency = (value) => {
    const amount = Number.isFinite(value) ? value : toNumber(value);
    return new Intl.NumberFormat("fr-CH", {
      style: "currency",
      currency: "CHF",
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  const toISODate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatMonthLabel = (monthId) => {
    const [yearRaw, monthRaw] = String(monthId || "").split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "Mois —";
    const date = new Date(year, month - 1, 1);
    return new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(date);
  };

  const formatDateLabel = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  };

  const readTransactions = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_error) {
      return [];
    }
  };

  const getTransactionsForMonth = (allTransactions, userId, monthId) =>
    allTransactions
      .filter((entry) => {
        if (!entry) return false;
        if (userId && entry.userId && String(entry.userId) !== String(userId)) return false;
        const sourceDate = entry.date || entry.createdAt || "";
        return String(sourceDate).slice(0, 7) === monthId;
      })
      .sort((a, b) => {
        const aTime = new Date(a.date || a.createdAt || 0).getTime();
        const bTime = new Date(b.date || b.createdAt || 0).getTime();
        return bTime - aTime;
      });

  const getTypeLabel = (entry) => {
    if (entry?.type === "income") return "Revenu";
    if (entry?.type === "transfer") return "Transfert";
    return "Dépense";
  };

  const getAccountLabel = (entry) => {
    if (entry?.type === "transfer") {
      const from = String(entry.fromLabel || entry.from || "").trim() || "Compte";
      const to = String(entry.toLabel || entry.to || "").trim() || "Compte";
      return `${from} → ${to}`;
    }
    return String(entry?.accountLabel || entry?.account || "Compte courant").trim();
  };

  const getEntryLabel = (entry) =>
    String(entry?.category || entry?.note || (entry?.type === "income" ? "Revenu" : "Dépense")).trim() ||
    "Transaction";

  const buildKpis = (plan = {}, tracking = {}, transactions = []) => {
    const variableBudget = Math.max(0, toNumber(tracking.variableBudget));
    const variableSpent = Math.max(0, toNumber(tracking.variableSpent));
    const remaining = Math.max(0, variableBudget - variableSpent);
    const income = transactions
      .filter((entry) => entry.type === "income")
      .reduce((sum, entry) => sum + Math.max(0, toNumber(entry.amount)), 0);
    const expenses = transactions
      .filter((entry) => entry.type === "expense")
      .reduce((sum, entry) => sum + Math.max(0, toNumber(entry.amount)), 0);
    const transfers = transactions
      .filter((entry) => entry.type === "transfer")
      .reduce((sum, entry) => sum + Math.max(0, toNumber(entry.amount)), 0);
    const appliedAt = plan?.flags?.planAppliedAt || null;

    return [
      {
        label: "Plan appliqué",
        value: appliedAt ? formatDateLabel(appliedAt) : "Non appliqué",
      },
      {
        label: "Budget variable",
        value: `${formatCurrency(variableSpent)} / ${formatCurrency(variableBudget)}`,
        note: `${formatCurrency(remaining)} restant`,
      },
      {
        label: "Revenus enregistrés",
        value: formatCurrency(income),
      },
      {
        label: "Dépenses enregistrées",
        value: formatCurrency(expenses),
      },
      {
        label: "Transferts du mois",
        value: formatCurrency(transfers),
      },
    ];
  };

  const buildPlanItems = (plan = {}) => {
    const allocations = plan?.allocationResultSnapshot?.allocations || {};
    const items = [
      { label: "Sécurité", amount: toNumber(allocations.securite) },
      { label: "Impôts", amount: toNumber(allocations.impots) },
      { label: "3e pilier", amount: toNumber(allocations.pilier3a) },
      { label: "Investissements", amount: toNumber(allocations.investissements) },
      {
        label: "Total SmartSave",
        amount: toNumber(plan?.allocationResultSnapshot?.totalSmartSave || 0),
      },
    ];
    return items;
  };

  const buildInterestItems = (transactions = []) => {
    const labels = {
      security: "Épargne",
      tax: "Impôts",
      projects: "Objectif CT",
      pillar3a: "3e pilier",
      investments: "Investissements",
    };
    const sums = {
      security: 0,
      tax: 0,
      projects: 0,
      pillar3a: 0,
      investments: 0,
    };
    transactions.forEach((entry) => {
      if (entry?.type !== "income") return;
      const isInterest =
        String(entry?.autoApplyKind || "").toLowerCase() === "interest" ||
        /int[eé]r[eê]ts/i.test(String(entry?.category || "")) ||
        /int[eé]r[eê]ts/i.test(String(entry?.note || ""));
      if (!isInterest) return;
      const key = String(entry?.account || "").trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(sums, key)) return;
      sums[key] += Math.max(0, toNumber(entry.amount));
    });
    const items = Object.keys(sums).map((key) => ({
      key,
      label: labels[key] || key,
      amount: Math.max(0, sums[key]),
    }));
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return { items, total };
  };

  const normalizeAccountKey = (value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    if (["current", "comptecourant", "checking", "paymentaccount"].includes(key)) return "current";
    if (["security", "securite", "savings", "epargne"].includes(key)) return "security";
    if (["tax", "impots", "provisionimpots"].includes(key)) return "tax";
    if (["projects", "projets", "projetscourtterme", "shortterm"].includes(key)) return "projects";
    if (["pillar3a", "pilier3a", "thirdpillar", "pillar3"].includes(key)) return "pillar3a";
    if (["investments", "investissement", "investissements"].includes(key)) return "investments";
    return key;
  };

  const buildEstimatedInterestFromBalances = (plan = {}, transactions = []) => {
    const labels = {
      security: "Épargne",
      tax: "Impôts",
      projects: "Objectif CT",
      pillar3a: "3e pilier",
      investments: "Investissements",
    };
    const keys = Object.keys(labels);
    const starting = plan?.flags?.startingBalances || {};
    const closing = plan?.flags?.closingBalances || {};
    const flow = { current: 0, security: 0, tax: 0, projects: 0, pillar3a: 0, investments: 0 };

    transactions.forEach((entry) => {
      const amount = Math.max(0, toNumber(entry?.amount));
      if (!amount) return;
      const isInterest =
        String(entry?.autoApplyKind || "").toLowerCase() === "interest" ||
        /int[eé]r[eê]ts/i.test(String(entry?.category || "")) ||
        /int[eé]r[eê]ts/i.test(String(entry?.note || ""));
      if (isInterest) return;

      if (entry.type === "income") {
        const account = normalizeAccountKey(entry.account || "current");
        if (Object.prototype.hasOwnProperty.call(flow, account)) flow[account] += amount;
      } else if (entry.type === "expense") {
        const account = normalizeAccountKey(entry.account || "current");
        if (Object.prototype.hasOwnProperty.call(flow, account)) flow[account] -= amount;
      } else if (entry.type === "transfer") {
        const from = normalizeAccountKey(entry.from || "");
        const to = normalizeAccountKey(entry.to || "");
        if (Object.prototype.hasOwnProperty.call(flow, from)) flow[from] -= amount;
        if (Object.prototype.hasOwnProperty.call(flow, to)) flow[to] += amount;
      }
    });

    const items = keys.map((key) => {
      const startAmount = Math.max(0, toNumber(starting[key]));
      const closeAmount = Math.max(0, toNumber(closing[key]));
      const interest = Math.max(0, closeAmount - startAmount - toNumber(flow[key]));
      return { key, label: labels[key], amount: interest };
    });
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return { items, total };
  };

  const toRateDecimal = (value, fallback = 0) => {
    if (value === undefined || value === null || value === "") return fallback;
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric) || numeric === 0) return fallback;
    return numeric > 1 ? numeric / 100 : numeric;
  };

  const buildRateFallbackInterest = (plan = {}, formData = {}) => {
    const labels = {
      security: "Épargne",
      tax: "Impôts",
      projects: "Objectif CT",
      pillar3a: "3e pilier",
      investments: "Investissements",
    };
    const rates = formData?.rates || {};
    const monthlyRates = {
      security: toRateDecimal(rates.savings, 0.018) / 12,
      tax: toRateDecimal(rates.savings, 0.018) / 12,
      projects: toRateDecimal(rates.blocked, 0.02) / 12,
      pillar3a: toRateDecimal(rates.pillar3, 0.03) / 12,
      investments: toRateDecimal(rates.investments, 0.05) / 12,
    };
    const starting = plan?.flags?.startingBalances || {};
    const closing = plan?.flags?.closingBalances || {};
    const keys = Object.keys(labels);
    const items = keys.map((key) => {
      const startAmount = Math.max(0, toNumber(starting[key]));
      const closeAmount = Math.max(0, toNumber(closing[key]));
      const base = closeAmount > 0 ? closeAmount : startAmount;
      const amount = Math.max(0, base * Math.max(0, toNumber(monthlyRates[key] || 0)));
      return {
        key,
        label: labels[key],
        amount: Math.round(amount * 100) / 100,
      };
    });
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return { items, total };
  };

  const renderMonthSelect = (root, monthIds, selectedMonthId, onSelect) => {
    if (!root) return;
    root.innerHTML = monthIds
      .map((monthId) => {
        const selected = monthId === selectedMonthId ? " selected" : "";
        return `<option value="${monthId}"${selected}>${formatMonthLabel(monthId)} (${monthId})</option>`;
      })
      .join("");
    root.onchange = () => {
      const monthId = String(root.value || "").trim();
      if (!monthId) return;
      onSelect(monthId);
    };
  };

  const renderTransactionsTable = (tbody, emptyNode, transactions) => {
    if (!tbody || !emptyNode) return;
    if (!transactions.length) {
      tbody.innerHTML = "";
      emptyNode.hidden = false;
      return;
    }

    emptyNode.hidden = true;
    tbody.innerHTML = transactions
      .map((entry) => {
        const amount = Math.max(0, toNumber(entry.amount));
        return `
          <tr>
            <td>${formatDateLabel(entry.date || entry.createdAt)}</td>
            <td>${getEntryLabel(entry)}</td>
            <td>${getTypeLabel(entry)}</td>
            <td>${getAccountLabel(entry)}</td>
            <td class="is-amount">${formatCurrency(amount)}</td>
          </tr>
        `;
      })
      .join("");
  };

  const initHistoryPage = () => {
    if (document.body?.dataset.page !== "expenses-history") return;

    const activeUser = typeof window.loadActiveUser === "function" ? window.loadActiveUser() : null;
    const store = window.SmartSaveMonthlyStore;
    if (!activeUser?.id || !store?.getStateForUser) return;

    const state = store.getStateForUser(activeUser.id);
    if (!state) return;
    const formData = typeof window.loadUserForm === "function" ? window.loadUserForm(activeUser.id) || {} : {};

    const monthSelectNode = document.querySelector("[data-history-month-select]");
    const monthTitleNode = document.querySelector("[data-history-month-title]");
    const monthSubtitleNode = document.querySelector("[data-history-month-subtitle]");
    const kpisNode = document.querySelector("[data-history-kpis]");
    const planGridNode = document.querySelector("[data-history-plan-grid]");
    const interestGridNode = document.querySelector("[data-history-interest-grid]");
    const interestTotalNode = document.querySelector("[data-history-interest-total]");
    const transactionsNode = document.querySelector("[data-history-transactions]");
    const transactionsEmptyNode = document.querySelector("[data-history-transactions-empty]");
    const emptyNode = document.querySelector("[data-history-empty]");
    const layoutNode = document.querySelector("[data-history-layout]");
    if (!monthSelectNode || !monthTitleNode || !monthSubtitleNode || !kpisNode || !planGridNode) return;

    const allClosedMonths = Object.keys(state.monthlyPlan || {})
      .filter((monthId) => state.monthlyPlan?.[monthId]?.flags?.monthStatus === "closed")
      .sort((a, b) => b.localeCompare(a));

    if (!allClosedMonths.length) {
      if (emptyNode) emptyNode.hidden = false;
      if (layoutNode) layoutNode.hidden = true;
      return;
    }

    if (emptyNode) emptyNode.hidden = true;
    if (layoutNode) layoutNode.hidden = false;

    const allTransactions = readTransactions();
    let selectedMonthId = allClosedMonths[0];

    const renderMonth = (monthId) => {
      selectedMonthId = monthId;
      const plan = state.monthlyPlan?.[monthId] || {};
      const tracking = state.monthlyTracking?.[monthId] || {};
      const monthTransactions = getTransactionsForMonth(allTransactions, activeUser.id, monthId);
      const kpis = buildKpis(plan, tracking, monthTransactions);
      const planItems = buildPlanItems(plan);
      let interest = buildInterestItems(monthTransactions);
      if (interest.total <= 0.01) {
        const estimated = buildEstimatedInterestFromBalances(plan, monthTransactions);
        if (estimated.total > 0.01) interest = estimated;
        else {
          const byRate = buildRateFallbackInterest(plan, formData);
          if (byRate.total > 0.01) interest = byRate;
        }
      }

      monthTitleNode.textContent = formatMonthLabel(monthId);
      monthSubtitleNode.textContent = `Mois ${monthId} · lecture seule`;

      kpisNode.innerHTML = kpis
        .map(
          (item) => `
          <article class="history-kpi-card">
            <p>${item.label}</p>
            <strong>${item.value}</strong>
            ${item.note ? `<small>${item.note}</small>` : ""}
          </article>
        `
        )
        .join("");

      planGridNode.innerHTML = planItems
        .map(
          (item) => `
          <article class="history-plan-item">
            <span>${item.label}</span>
            <strong>${formatCurrency(item.amount)}</strong>
          </article>
        `
        )
        .join("");

      if (interestGridNode) {
        interestGridNode.innerHTML = interest.items
          .map(
            (item) => `
            <article class="history-interest-item">
              <span>${item.label}</span>
              <strong>${formatCurrency(item.amount)}</strong>
            </article>
          `
          )
          .join("");
      }
      if (interestTotalNode) {
        interestTotalNode.textContent = `Total intérêts crédités: ${formatCurrency(interest.total)}`;
      }

      renderTransactionsTable(transactionsNode, transactionsEmptyNode, monthTransactions);
      renderMonthSelect(monthSelectNode, allClosedMonths, selectedMonthId, renderMonth);
    };

    renderMonth(selectedMonthId);
  };

  document.addEventListener("DOMContentLoaded", initHistoryPage);
})();
