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

  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
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

  const resolveBalancesFromAssets = (formData = {}) => {
    const assets = formData.assets || {};
    const pick = (...keys) =>
      keys.reduce((sum, key) => sum + Math.max(0, toNumber(assets[key])), 0);
    return {
      security: pick("securitySavings", "securityBalance", "savingsAccount", "savings", "epargne"),
      projects: pick("projects", "projectAccount", "shortTermAccount", "goalsAccount"),
      investments: pick("investments", "investmentAccount", "portfolio", "placements"),
      pillar3a: pick("pillar3a", "thirdPillarAmount", "pilier3a", "thirdPillar"),
      tax: pick("taxProvision", "impotsProvision", "provisionImpots", "impots", "taxesProvision"),
    };
  };

  const shouldPayTaxes = (formData = {}) => {
    const raw = formData?.taxes?.paysTaxes ?? formData?.paysTaxes;
    if (raw == null) return true;
    const normalized = String(raw).trim().toLowerCase();
    return !["non", "no", "false", "0"].includes(normalized);
  };

  const resolveTaxEngineTotal = (formData = {}) => {
    const engine = window.TaxEngine || window.SmartSaveTaxEngine;
    if (!engine || typeof engine.calculateAnnualTax !== "function") return 0;
    try {
      const taxData = engine.calculateAnnualTax(formData);
      return Math.max(0, toNumber(taxData?.total || 0));
    } catch (_error) {
      return 0;
    }
  };

  const getLongTermLabel = (type) => {
    const key = String(type || "").toLowerCase();
    if (key === "home") return "Achat immobilier";
    if (key === "invest") return "Investissement long terme";
    if (key === "retirement") return "Retraite";
    if (key === "children") return "Épargne enfants";
    if (key === "security") return "Sécurité financière";
    return "Objectif long terme";
  };

  const renderAllocationBlock = ({ flowState, allocations }) => {
    const pendingNode = document.querySelector("[data-plan-allocation-pending]");
    const ctaNode = document.querySelector("[data-plan-allocation-cta]");
    const listNode = document.querySelector("[data-plan-allocation-list]");
    if (!pendingNode || !ctaNode || !listNode) return;

    if (flowState === "BUDGET_FAIT_REPARTITION_NON_VUE") {
      pendingNode.hidden = false;
      ctaNode.hidden = false;
      listNode.innerHTML = "";
      return;
    }

    pendingNode.hidden = true;
    ctaNode.hidden = true;

    const rows = [
      { label: "Sécurité", amount: toNumber(allocations.securite) },
      {
        label: "Projets",
        amount: Math.max(0, toNumber(allocations.projetsCourtTerme) + toNumber(allocations.projets)),
      },
      {
        label: "Investissement",
        amount: Math.max(0, toNumber(allocations.investissements) + toNumber(allocations.pilier3a)),
      },
      { label: "Impôts", amount: toNumber(allocations.impots) },
    ].filter((row) => row.amount > 0);

    if (!rows.length) {
      listNode.innerHTML = '<p class="plan-allocation-empty">Aucune répartition validée pour ce mois.</p>';
      return;
    }

    listNode.innerHTML = rows
      .map(
        (row) => `
          <p class="plan-kpi-list__row">
            <span>${row.label}</span>
            <strong>${formatCurrency(row.amount)}</strong>
          </p>
        `
      )
      .join("");
  };

  const renderGoalsBlock = ({ formData, allocations, mvpData }) => {
    const listNode = document.querySelector("[data-plan-goals-list]");
    const emptyNode = document.querySelector("[data-plan-goals-empty]");
    const projectionNode = document.querySelector("[data-plan-projection-note]");
    if (!listNode || !emptyNode || !projectionNode) return;

    const balances = resolveBalancesFromAssets(formData);
    const plan = formData?.allocationPlan || {};
    const shortTerm = plan.shortTerm || {};
    const longTerm = plan.longTerm || {};
    const taxInfo = mvpData?.taxProvision || {};
    const securityTarget = Math.max(
      0,
      toNumber(mvpData?.allocation?.debug?.savingsTargets?.targetAmount || 0)
    );

    const goals = [];
    if (securityTarget > 0) {
      goals.push({
        name: "Sécurité financière",
        saved: balances.security,
        target: securityTarget,
        monthly: Math.max(0, toNumber(allocations.securite)),
      });
    }

    const shortTermTarget = Math.max(0, toNumber(shortTerm.amount));
    if (shortTerm.enabled && shortTermTarget > 0) {
      goals.push({
        name: shortTerm.label || shortTerm.name || "Objectif court terme",
        saved: balances.projects,
        target: shortTermTarget,
        monthly: Math.max(0, toNumber(allocations.projetsCourtTerme) + toNumber(allocations.projets)),
      });
    }

    const longTermTarget = Math.max(0, toNumber(longTerm.amount || longTerm.target));
    if (longTermTarget > 0) {
      goals.push({
        name: getLongTermLabel(longTerm.type),
        saved: Math.max(0, balances.investments + balances.pillar3a),
        target: longTermTarget,
        monthly: Math.max(0, toNumber(allocations.investissements) + toNumber(allocations.pilier3a)),
      });
    }

    if (shouldPayTaxes(formData)) {
      const taxSaved = Math.max(
        0,
        toNumber(
          taxInfo.currentProvision != null
            ? taxInfo.currentProvision
            : balances.tax
        )
      );
      const taxTotalEstimate = Math.max(
        0,
        toNumber(resolveTaxEngineTotal(formData) || taxInfo.totalTax || 0)
      );
      const taxRemaining = Math.max(0, toNumber(taxInfo.remaining || taxInfo.outstanding || 0));
      const taxTotal = taxTotalEstimate > 0 ? taxTotalEstimate : taxSaved + taxRemaining;
      if (taxTotal > 0) {
        goals.push({
          name: "Impôts futurs",
          saved: Math.min(taxSaved, taxTotal),
          target: taxTotal,
          monthly: Math.max(
            0,
            toNumber(
              allocations.impots ||
                taxInfo.monthlyAmount ||
                taxInfo.monthlyNeed ||
                0
            )
          ),
        });
      }
    }

    const visible = goals.slice(0, 4);
    emptyNode.hidden = visible.length > 0;
    if (!visible.length) {
      listNode.innerHTML = "";
      projectionNode.hidden = true;
      return;
    }

    listNode.innerHTML = visible
      .map((goal) => {
        const ratio = goal.target > 0 ? Math.max(0, Math.min(1, goal.saved / goal.target)) : 0;
        const percent = Math.round(ratio * 100);
        const isTaxGoal = String(goal.name || "").toLowerCase().includes("impôt");
        const projected = isTaxGoal
          ? Math.min(goal.target, Math.max(0, goal.saved + goal.monthly))
          : 0;
        const taxLines = isTaxGoal
          ? `
            <p class="plan-goal-item__meta">Estimation totale: ${formatCurrency(goal.target)}</p>
            <p class="plan-goal-item__meta">Provision actuelle: ${formatCurrency(goal.saved)}</p>
            <p class="plan-goal-item__meta">Provision après ce mois: ${formatCurrency(projected)}</p>
          `
          : "";
        return `
          <article class="plan-goal-item">
            <p class="plan-goal-item__name">${goal.name}</p>
            <p class="plan-goal-item__meta">+${formatCurrency(goal.monthly)} ce mois-ci</p>
            ${taxLines}
            <div class="progress-track"><span class="progress-fill" style="width:${percent}%"></span></div>
            <p class="plan-goal-item__progress">${percent}% (${formatCurrency(goal.saved)} / ${formatCurrency(goal.target)})</p>
          </article>
        `;
      })
      .join("");

    const primary = visible[0];
    const remaining = Math.max(0, primary.target - primary.saved);
    if (primary.monthly <= 0 || remaining <= 0) {
      projectionNode.hidden = true;
      return;
    }
    const months = Math.max(1, Math.ceil(remaining / primary.monthly));
    projectionNode.hidden = false;
    projectionNode.textContent = `À ce rythme, tu atteins ${primary.name} en ~${months} mois.`;
  };

  const init = () => {
    setupHamburgerMenu();
    const store = window.SmartSaveMonthlyStore;
    if (!store) return;

    const activeUser = loadActiveUser();
    if (!activeUser?.id) {
      window.location.href = "index.html";
      return;
    }

    const formData = loadUserForm(activeUser.id) || {};
    const mvpData = typeof window.buildMvpData === "function" ? window.buildMvpData(formData) : {};
    const context = store.ensureUserMonthContext({
      userId: activeUser.id,
      formData,
      mvpData,
      allTransactions: loadTransactions(),
      now: new Date(),
    });
    if (!context?.monthId) return;

    const monthId = context.monthId;
    const flow =
      store.getFlowStateForMonth({
        userId: activeUser.id,
        monthId,
        now: new Date(),
        monthlyPlan: context.monthlyPlan,
      }) || { state: "NOUVEAU_MOIS" };

    if (flow.state === "NOUVEAU_MOIS") {
      window.location.href = "budget.html";
      return;
    }

    const monthLabel = formatMonth(monthId);
    setText("[data-plan-title]", `Ton plan – ${monthLabel}`);

    const endBanner = document.querySelector("[data-plan-endmonth-banner]");
    if (endBanner) endBanner.hidden = flow.state !== "FIN_MOIS_A_CLOTURER";

    const budget =
      store.getMonthlyBudgetForMonth({
        userId: activeUser.id,
        monthId,
        formData,
      }) || {};

    const totalExpenses =
      Math.max(0, toNumber(budget.fixedTotal)) +
      Math.max(0, toNumber(budget.mandatoryTotal)) +
      Math.max(0, toNumber(budget.variablePlanned));
    const remaining = Math.max(0, toNumber(budget.remaining));

    setText("[data-plan-remaining]", formatCurrency(remaining));
    setText("[data-plan-income]", formatCurrency(budget.totalIncome));
    setText("[data-plan-expenses]", formatCurrency(totalExpenses));
    setText("[data-plan-variable]", formatCurrency(budget.variablePlanned));

    const allocations = context?.monthlyPlan?.allocationResultSnapshot?.allocations || {};
    renderAllocationBlock({
      flowState: flow.state,
      allocations,
    });
    const goalsCard = document.querySelector("[data-plan-goals-card]");
    if (goalsCard) {
      goalsCard.hidden = flow.state === "BUDGET_FAIT_REPARTITION_NON_VUE";
    }
    if (flow.state !== "BUDGET_FAIT_REPARTITION_NON_VUE") {
      renderGoalsBlock({ formData, allocations, mvpData });
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();
