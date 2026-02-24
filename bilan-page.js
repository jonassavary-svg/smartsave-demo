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
    }).format(toNumber(value));

  const loadActiveUser = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIVE_USER) || "{}");
      return parsed?.id ? parsed : null;
    } catch (_error) {
      return null;
    }
  };

  const loadUserForm = (userId) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_FORM) || "{}");
      return parsed?.[userId] || parsed?.__default || null;
    } catch (_error) {
      return null;
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

  const getMonthId = (dateLike) => {
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  };

  const formatMonth = (monthId) => {
    const [y, m] = String(monthId || "").split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    if (Number.isNaN(d.getTime())) return "—";
    const label = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(d);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const sumRealForMonth = (transactions, userId, monthId) => {
    let income = 0;
    let expense = 0;
    (Array.isArray(transactions) ? transactions : []).forEach((entry) => {
      if (!entry || String(entry.userId || "").trim() !== String(userId || "").trim()) return;
      const entryMonth = getMonthId(entry.date || entry.createdAt || new Date());
      if (entryMonth !== monthId) return;
      const amount = Math.max(0, toNumber(entry.amount));
      if (!amount) return;
      if (entry.type === "income") income += amount;
      if (entry.type === "expense") expense += amount;
    });
    return { income, expense };
  };

  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
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
    const transactions = loadTransactions();
    const ctx = store.ensureUserMonthContext({
      userId: activeUser.id,
      formData,
      mvpData: {},
      allTransactions: transactions,
      now: new Date(),
    });
    if (!ctx?.monthId) return;

    const monthId = ctx.monthId;
    const monthLabel = formatMonth(monthId);
    setText("[data-bilan-month-label]", monthLabel);

    const budget = store.getMonthlyBudgetForMonth({ userId: activeUser.id, monthId, formData }) || {};
    const plannedIncome = toNumber(budget.totalIncome);
    const plannedExpenses =
      toNumber(budget.fixedTotal) + toNumber(budget.mandatoryTotal) + toNumber(budget.variablePlanned);

    const real = sumRealForMonth(transactions, activeUser.id, monthId);
    const plannedNet = plannedIncome - plannedExpenses;
    const realNet = real.income - real.expense;
    const delta = realNet - plannedNet;

    setText("[data-bilan-planned-income]", formatCurrency(plannedIncome));
    setText("[data-bilan-planned-expenses]", formatCurrency(plannedExpenses));
    setText("[data-bilan-real-income]", formatCurrency(real.income));
    setText("[data-bilan-real-expenses]", formatCurrency(real.expense));
    setText("[data-bilan-delta]", `${delta >= 0 ? "+" : "-"}${formatCurrency(Math.abs(delta))}`);

    const nextMonthId = store.addMonths(monthId, 1) || monthId;
    const nextMonthLabel = formatMonth(nextMonthId);
    const closeBtn = document.querySelector("[data-bilan-close-next]");
    if (closeBtn) {
      closeBtn.textContent = `Faire mon budget pour ${nextMonthLabel}`;
      closeBtn.addEventListener("click", () => {
        closeBtn.disabled = true;
        closeBtn.textContent = "Clôture...";
        const result = store.closeMonthWithReview({
          userId: activeUser.id,
          monthId,
          formData,
          mvpData: {},
          allTransactions: transactions,
        });
        if (!result?.ok) {
          closeBtn.disabled = false;
          closeBtn.textContent = `Faire mon budget pour ${nextMonthLabel}`;
          return;
        }
        window.location.href = "budget.html";
      });
    }

    const fullLink = document.querySelector("[data-bilan-full-link]");
    if (fullLink) {
      fullLink.href = `mes-depenses.html?month=${encodeURIComponent(monthId)}`;
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();
