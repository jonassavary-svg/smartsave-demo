(function (root) {
  const AllocationEngine = (function () {
    const THIRD_PILLAR_CAP_EMPLOYEE = 7056;
    const THIRD_PILLAR_CAP_SELF_EMPLOYED = 35280;
    const GROWTH_PILLAR_SHARE = 0.6;
    const SECURITY_MIN_FLOOR_CHF = 10000;
    const SECURITY_INCOME_FLOOR_MULTIPLIER = 2;

    const LOW_CAPACITY_THRESHOLD = 300;
    const SHORT_TERM_LABELS = {
      vacances: "Vacances",
      cadeaux: "Cadeaux",
      voiture: "Voiture",
      mariage: "Mariage",
      autre: "Projet court terme",
    };
    const LONG_TERM_LABELS = {
      security: "sécurité financière",
      home: "achat immobilier",
      invest: "investissement long terme",
      children: "épargne pour enfants",
      retirement: "retraite",
    };

    function calculateAllocation(userData = {}) {
    const context = normaliseInput(userData);
    context.rawData = userData;

    const monthlyNetIncome = computeMonthlyNetIncome(context);
    const monthlyExpenses = computeMonthlyExpenses(context);
    const allocationPlan = normaliseAllocationPlan(context.allocationPlan);
    const monthlyAvailableBeforePlan =
      monthlyNetIncome -
      (monthlyExpenses.fixed +
        monthlyExpenses.variable +
        monthlyExpenses.debts);
    const leisureDeduction = Math.min(
      Math.max(0, monthlyAvailableBeforePlan),
      Math.max(0, toNumber(allocationPlan.leisureMonthly))
    );
    const shortTermPlan = buildShortTermPlan(allocationPlan.shortTerm);
    const shortTermDeduction = Math.min(
      Math.max(0, monthlyAvailableBeforePlan - leisureDeduction),
      shortTermPlan.monthlyAmount
    );
    context.debug = {
      monthlyNetIncome,
      monthlyExpenses,
      monthlyAvailableBeforePlan: round2(monthlyAvailableBeforePlan),
      leisureDeduction: round2(leisureDeduction),
      shortTermDeduction: round2(shortTermDeduction),
    };

      let monthlyAvailable =
        monthlyAvailableBeforePlan - leisureDeduction - shortTermDeduction;
      if (context.overrideMonthlyAvailable != null) {
        monthlyAvailable = context.overrideMonthlyAvailable;
      }

      const allocation = initialiseAllocation(monthlyAvailable);
      const state = {
        surplus: monthlyAvailable,
        accountBalance: context.assets.paymentBalance,
        securityBalance: context.assets.securityBalance,
        taxBalance: context.assets.taxProvision || 0,
        impotsProvisioned: 0,
        investments: 0,
        longTermProjects: 0,
        thirdPillar: 0,
        securityAdded: 0,
        debtsRepaid: 0,
        debtActions: [],
        goalsFunded: [],
        taxFulfilled: false,
        pillarCapReached: false,
      };

      const fiscalInfo = computeFiscalNeeds(context, monthlyNetIncome);

      if (monthlyAvailable <= 0 || monthlyAvailable < LOW_CAPACITY_THRESHOLD) {
        runLowCapacityPlan(
          context,
          monthlyExpenses,
          fiscalInfo,
          state,
          allocation,
          monthlyNetIncome
        );
      } else {
        runStandardPlan(
          context,
          monthlyExpenses,
          fiscalInfo,
          state,
          allocation,
          monthlyNetIncome
        );
      }

      allocation.allocations.compteCourant = round2(state.accountBalance - context.assets.paymentBalance);
      allocation.allocations.securite = round2(state.securityAdded);
      allocation.allocations.impots = round2(state.impotsProvisioned);
      allocation.allocations.investissements = round2(state.investments);
      allocation.allocations.projetsLongTerme = round2(state.longTermProjects);
      allocation.allocations.pilier3a = round2(state.thirdPillar);
      allocation.allocations.dettes = round2(state.debtsRepaid);
      allocation.allocations.projetsCourtTerme = round2(shortTermDeduction);
      allocation.objectifsFinances = state.goalsFunded;
      allocation.dettesDetail = state.debtActions;
      allocation.reste = round2(state.surplus);
      allocation.shortTermAccount = {
        key: "projetsCourtTerme",
        name: shortTermPlan.name,
        label: `Compte ${shortTermPlan.name}`,
        amount: round2(shortTermDeduction),
      };
      allocation.longTermDiagnostic = buildLongTermDiagnostic(
        allocationPlan.longTerm,
        allocation.allocations
      );
      context.debug.shortTermAccount = allocation.shortTermAccount;
      context.debug.longTermDiagnostic = allocation.longTermDiagnostic;
      allocation.debug = context.debug || {};
      root.SmartSaveDebug = allocation.debug;

      return allocation;
    }

    function normaliseInput(data) {
      const hasOverride = Object.prototype.hasOwnProperty.call(
        data,
        "overrideMonthlyAvailable"
      );
      return {
        incomes: Array.isArray(data.incomes?.entries)
          ? data.incomes.entries
          : data.incomes?.entries
          ? [data.incomes.entries]
          : [],
        spouseIncome: toNumber(
          data.incomes?.spouseNetIncome ??
            data.incomes?.spouseIncome ??
            data.spouseIncome ??
            0
        ),
        personal: data.personal || {},
        expenses: {
          fixed: ensureArray(data.expenses?.fixed),
          variable: ensureArray(data.expenses?.variable),
          exceptional: ensureArray(data.expenses?.exceptional),
        },
        loans: ensureArray(
          Array.isArray(data.credits?.loans) ? data.credits.loans : data.loans
        ),
        exceptionalAnnual: ensureArray(data.exceptionalAnnual || data.expenses?.annualExtra),
        taxes: data.taxes || {},
        assets: {
          paymentBalance: toNumber(
            data.assets?.currentAccount ||
              data.assets?.paymentAccount ||
              data.assets?.checking ||
              0
          ),
          securityBalance: toNumber(
            data.assets?.securitySavings ||
              data.assets?.safetySavings ||
              data.assets?.emergencyFund ||
              data.assets?.savingsSecurity ||
              data.assets?.savingsAccount ||
              0
          ),
          savingsAccount: toNumber(
            data.assets?.savingsAccount ||
              data.assets?.savings ||
              data.assets?.epargne ||
              0
          ),
          taxProvision: toNumber(
            data.assets?.taxProvision || data.taxes?.provision || data.taxes?.alreadySaved
          ),
          thirdPillarPaidYTD: toNumber(
            data.assets?.thirdPillarPaidYTD || data.taxes?.thirdPillarPaidYTD
          ),
          savingsContributionAmount: toNumber(data.assets?.savingsContributionAmount),
          thirdPillarContributionMonthly: toNumber(
            data.assets?.thirdPillarContributionMonthly ||
              data.assets?.thirdPillarContribution ||
              0
          ),
        },
        investments: data.investments || {},
        goals: ensureArray(data.goals),
        allocationPlan: data.allocationPlan || {},
        profile:
          data.profile ||
          data.personal?.priorityProfile ||
          data.personal?.profilAllocation ||
          "equilibre",
        referenceDate: data.referenceDate || new Date(),
        overrideMonthlyAvailable: hasOverride
          ? toNumber(data.overrideMonthlyAvailable)
          : null,
      };
    }

    function computeMonthlyNetIncome(context) {
      const personalStatus = (context.personal.employmentStatus || "").toLowerCase();
      return (
        context.incomes.reduce((sum, income) => {
          const raw = toNumber(income?.amount);
          if (!raw) return sum;
          const type = String(income?.amountType || "net").toLowerCase();
          const status = (income?.employmentStatus || personalStatus).toLowerCase();
          const coefficient =
            type === "brut"
              ? status.includes("indep") || status.includes("indépendent")
                ? 0.75
                : 0.86
              : 1;
          // Base SmartSave: revenu mensuel net, sans prise en compte du 13e.
          const netMonthly = raw * coefficient;
          return sum + netMonthly;
        }, 0) + context.spouseIncome / 12
      );
    }

    function computeMonthlyExpenses(context) {
      const fixed = sumMonthly(context.expenses.fixed);
      const variable = sumMonthly(context.expenses.variable);
      const exceptional = sumMonthly(context.expenses.exceptional) + sumMonthly(context.exceptionalAnnual);
      const debts = context.loans.reduce((sum, loan) => {
        const amount = toNumber(
          loan?.monthlyAmount || loan?.monthlyPayment || loan?.monthly || loan?.mensualite
        );
        return sum + amount;
      }, 0);
      return { fixed, variable, exceptional, debts };
    }

    function normaliseAllocationPlan(plan) {
      const source = plan && typeof plan === "object" ? plan : {};
      const shortSource = source.shortTerm && typeof source.shortTerm === "object"
        ? source.shortTerm
        : {};
      const longSource = source.longTerm && typeof source.longTerm === "object"
        ? source.longTerm
        : {};
      return {
        leisureMonthly: Math.max(0, toNumber(source.leisureMonthly || 0)),
        shortTerm: {
          enabled: Boolean(shortSource.enabled),
          type: String(shortSource.type || "vacances").toLowerCase(),
          horizonYears: Math.min(3, Math.max(1, toNumber(shortSource.horizonYears || 1))),
          amount: Math.max(0, toNumber(shortSource.amount || 0)),
          name: String(shortSource.name || shortSource.label || "").trim(),
        },
        longTerm: {
          enabled: Boolean(longSource.enabled),
          type: String(longSource.type || "security").toLowerCase(),
          horizonYears: Math.min(30, Math.max(3, toNumber(longSource.horizonYears || 10))),
          amount: Math.max(0, toNumber(longSource.amount || 0)),
        },
      };
    }

    function buildShortTermPlan(shortTerm = {}) {
      const enabled = Boolean(shortTerm.enabled);
      if (!enabled) {
        return { enabled: false, name: "Objectif court terme", monthlyAmount: 0 };
      }
      const type = String(shortTerm.type || "vacances").toLowerCase();
      const name = String(shortTerm.name || SHORT_TERM_LABELS[type] || "Objectif court terme");
      const years = Math.max(1, toNumber(shortTerm.horizonYears || 1));
      const target = Math.max(0, toNumber(shortTerm.amount || 0));
      const monthlyAmount = target > 0 ? target / (years * 12) : 0;
      return {
        enabled: true,
        name,
        monthlyAmount: Math.max(0, monthlyAmount),
      };
    }

    function buildLongTermDiagnostic(longTerm = {}, allocations = {}) {
      const enabled = Boolean(longTerm?.enabled);
      const type = String(longTerm?.type || "security").toLowerCase();
      const targetAmount = Math.max(0, toNumber(longTerm?.amount || 0));
      const horizonYears = Math.max(3, toNumber(longTerm?.horizonYears || 10));
      if (!enabled || targetAmount <= 0) {
        return {
          enabled: false,
          type,
          targetAmount,
          horizonYears,
          monthlyContribution: 0,
          estimatedYears: null,
          onTrack: null,
          message: "Aucun objectif long terme actif.",
        };
      }

      const monthlyContribution = resolveLongTermMonthlyContribution(type, allocations);
      const label = LONG_TERM_LABELS[type] || "objectif long terme";
      if (monthlyContribution <= 0) {
        return {
          enabled: true,
          type,
          targetAmount,
          horizonYears,
          monthlyContribution: 0,
          estimatedYears: null,
          onTrack: false,
          message: `A ce rythme, l'objectif ${label} n'est pas finançable.`,
        };
      }

      const estimatedYears = targetAmount / monthlyContribution / 12;
      const roundedYears = round2(estimatedYears);
      const onTrack = estimatedYears <= horizonYears + 1e-6;
      return {
        enabled: true,
        type,
        targetAmount: round2(targetAmount),
        horizonYears: round2(horizonYears),
        monthlyContribution: round2(monthlyContribution),
        estimatedYears: roundedYears,
        onTrack,
        message: `A ce rythme, l'objectif ${label} sera atteint en ${roundedYears} ans.`,
      };
    }

    function resolveLongTermMonthlyContribution(type, allocations = {}) {
      const safe = (key) => Math.max(0, toNumber(allocations?.[key] || 0));
      if (type === "security") return safe("securite");
      if (type === "home" || type === "children") {
        return safe("projetsLongTerme") || safe("projets");
      }
      if (type === "invest") return safe("investissements");
      if (type === "retirement") return safe("investissements") + safe("pilier3a");
      return safe("investissements") + (safe("projetsLongTerme") || safe("projets"));
    }

    function sumMonthly(list) {
      if (!Array.isArray(list)) return 0;
      return list.reduce((sum, item) => {
        const amount = toNumber(item?.amount || item?.montant);
        if (!amount) return sum;
        const freq = (item?.frequency || item?.frequence || "mensuel").toLowerCase();
        if (freq.startsWith("annu")) return sum + amount / 12;
        if (freq.startsWith("trim")) return sum + amount / 3;
        if (freq.startsWith("hebdo")) return sum + (amount * 52) / 12;
        return sum + amount;
      }, 0);
    }

    function computeFiscalNeeds(context, monthlyNetIncome) {
      const taxEngine = root.TaxEngine || root.SmartSaveTaxEngine;
      let taxData = null;
      if (taxEngine && typeof taxEngine.calculateAnnualTax === "function") {
        taxData = taxEngine.calculateAnnualTax(context.rawData || context);
      }
      const paysTaxesRaw = context.taxes?.paysTaxes;
      const paysTaxes =
        paysTaxesRaw == null
          ? true
          : String(paysTaxesRaw).trim().toLowerCase() !== "non";
      if (!paysTaxes) {
        return {
          annualTax: 0,
          already: 0,
          remaining: 0,
          monthlyNeed: 0,
          monthsRemaining: 0,
          data: taxData || {},
        };
      }
      const annualIncome = monthlyNetIncome * 12;
      let annualTax =
        toNumber(context.taxes?.overrideAnnualTax) ||
        toNumber(taxData?.total) ||
        estimateAnnualTaxByBracket(annualIncome, context.personal, context.spouseIncome);
      const already = toNumber(
        taxData?.monthlyProvision?.advancePayments ||
          taxData?.monthlyProvision?.alreadyPaid ||
          taxData?.monthlyProvision?.advance ||
          context.assets.taxProvision
      );

      const monthsRemaining = Math.max(1, monthsUntilFiscalDeadline(context.referenceDate));
      const remaining = Math.max(0, annualTax - already);
      let monthlyNeed = remaining / monthsRemaining;

      if (context.taxes && context.taxes.overrideMonthlyNeed != null) {
        monthlyNeed = toNumber(context.taxes.overrideMonthlyNeed);
      }

      if (context.taxes && context.taxes.overrideRemaining != null) {
        return {
          annualTax,
          already,
          remaining: toNumber(context.taxes.overrideRemaining),
          monthlyNeed,
          monthsRemaining,
          data: taxData || {},
        };
      }

      return {
        annualTax,
        already,
        remaining,
        monthlyNeed,
        monthsRemaining,
        data: taxData || {},
      };
    }

    function estimateAnnualTaxByBracket(annualIncome) {
      if (annualIncome <= 0) return 0;
      if (annualIncome < 50000) return annualIncome * 0.08;
      if (annualIncome < 80000) return annualIncome * 0.11;
      if (annualIncome < 120000) return annualIncome * 0.14;
      return annualIncome * 0.17;
    }

    function runLowCapacityPlan(context, monthlyExpenses, fiscalInfo, state, allocation, monthlyNetIncome) {
      const fixedMonthly = monthlyExpenses.fixed;
      const obligatoryMonthly = monthlyExpenses.variable;
      const currentTarget = Math.max(0, fixedMonthly + obligatoryMonthly * 0.5);
      const totalMonthlyOutflow =
        monthlyExpenses.fixed +
        monthlyExpenses.variable +
        monthlyExpenses.debts;
      const savingsTargets = computeSavingsTargets(
        context,
        monthlyExpenses,
        monthlyNetIncome,
        totalMonthlyOutflow
      );
      if (!context.debug) context.debug = {};
      context.debug.savingsTargets = savingsTargets;
      context.debug.currentTarget = currentTarget;
      context.debug.securityBalance = context.assets.securityBalance;

      if (!allocateMonthlyTaxes(fiscalInfo, state, allocation)) {
        return;
      }
      if (state.surplus <= 0) return;

      fillCurrentAccount(state, allocation, currentTarget);
      if (state.surplus <= 0) return;

      fillSavingsAccount(state, allocation, savingsTargets);
      const lowPillarStatus = buildThirdPillarStatus(context, state, monthlyNetIncome);
      flushSurplus(state, allocation, savingsTargets, currentTarget, lowPillarStatus, context, monthlyNetIncome);
    }

    function runStandardPlan(
      context,
      monthlyExpenses,
      fiscalInfo,
      state,
      allocation,
      monthlyNetIncome
    ) {
      const fixedMonthly = monthlyExpenses.fixed;
      const obligatoryMonthly = monthlyExpenses.variable;
      const currentTarget = Math.max(0, fixedMonthly + obligatoryMonthly * 0.5);
      const totalMonthlyOutflow =
        monthlyExpenses.fixed +
        monthlyExpenses.variable +
        monthlyExpenses.debts;
      const savingsTargets = computeSavingsTargets(
        context,
        monthlyExpenses,
        monthlyNetIncome,
        totalMonthlyOutflow
      );
      if (!context.debug) context.debug = {};
      context.debug.savingsTargets = savingsTargets;
      context.debug.currentTarget = currentTarget;
      context.debug.securityBalance = context.assets.securityBalance;

      if (!allocateMonthlyTaxes(fiscalInfo, state, allocation)) {
        return;
      }
      if (state.surplus <= 0) return;

      fillCurrentAccount(state, allocation, currentTarget);
      if (state.surplus <= 0) return;

      fillSavingsAccount(state, allocation, savingsTargets);
      if (state.surplus <= 0) return;

      const pillarStatus = investThirdPillar(context, state, allocation, monthlyNetIncome);
      if (state.surplus <= 0) return;

      allocateInvestments(
        state,
        allocation,
        savingsTargets,
        currentTarget,
        pillarStatus
      );
      if (state.surplus <= 0) return;

      distributeBonusRemainder(
        state,
        allocation,
        savingsTargets,
        currentTarget,
        pillarStatus
      );
      flushSurplus(state, allocation, savingsTargets, currentTarget, pillarStatus, context, monthlyNetIncome);
    }

    function allocateMonthlyTaxes(fiscalInfo, state, allocation) {
      const annualTax = Math.max(0, fiscalInfo.annualTax || 0);
      if (annualTax <= 0) {
        state.taxFulfilled = true;
        return true;
      }
      const monthlyInstallment = annualTax / 12;
      const remainingNeed = Math.max(0, annualTax - state.taxBalance);
      if (remainingNeed <= 0) {
        state.taxFulfilled = true;
        return true;
      }
      const desired = Math.min(monthlyInstallment, remainingNeed);
      const amount = Math.min(state.surplus, desired);
      if (amount <= 0) {
        state.taxFulfilled = false;
        return false;
      }
      allocateAmount(amount, "impots", state, allocation, (value) => {
        state.impotsProvisioned += value;
        state.surplus -= value;
        state.taxBalance = (state.taxBalance || 0) + value;
      });
      if (amount + 1e-6 < desired) {
        state.taxFulfilled = false;
        state.surplus = 0;
        return false;
      }
      state.taxFulfilled = true;
      return true;
    }

    function fillCurrentAccount(state, allocation, target) {
      if (target <= 0 || state.surplus <= 0) return;
      const neededEstimate = target - state.accountBalance;
      const needed = neededEstimate > 1e-6 ? neededEstimate : 0;
      if (needed <= 0) return;
      const ratio = target > 0 ? state.accountBalance / target : 1;
      let factor = 0;
      if (ratio < 0.5) factor = 0.8;
      else if (ratio < 0.9) factor = 0.3;
      else factor = 0.15;
      const amount = Math.min(needed, state.surplus * factor);
      if (amount <= 0) return;
      allocateAmount(amount, "compteCourant", state, allocation, (value) => {
        state.accountBalance += value;
        state.surplus -= value;
      });
    }

    function fillSavingsAccount(state, allocation, targets) {
      if (state.surplus <= 0) return;
      const targetAmount = targets.targetAmount || 0;
      const hardStopAmount = targets.hardStopAmount || targetAmount;
      if (targetAmount <= 0) return;
      if (state.securityBalance >= targetAmount) return;
      if (state.securityBalance >= hardStopAmount) return;
      const ratio = targetAmount > 0 ? state.securityBalance / targetAmount : 1;
      let factor = 0;
      if (ratio < 0.5) factor = 0.6;
      else if (ratio < 0.9) factor = 0.3;
      else factor = 0.1;
      const needed = Math.min(
        Math.max(0, targetAmount - state.securityBalance),
        Math.max(0, hardStopAmount - state.securityBalance)
      );
      const amount = Math.min(needed, state.surplus * factor);
      if (amount <= 0) return;
      allocateAmount(amount, "securite", state, allocation, (value) => {
        state.securityBalance += value;
        state.securityAdded += value;
        state.surplus -= value;
      });
    }

    function computeSavingsTargets(context, monthlyExpenses, monthlyNetIncome, totalMonthlyOutflow) {
      let months = 3;
      const personalStatus = (context.personal.employmentStatus || "").toLowerCase();
      const hasThirteenth = context.incomes.some(
        (income) => income?.thirteenth === "oui" || income?.thirteenth === true
      );
      if (personalStatus.includes("indep") || personalStatus.includes("indépend")) months += 0.5;
      if (!hasThirteenth) months += 0.5;
      const debtMonthly = monthlyExpenses.debts;
      const debtRatio = monthlyNetIncome > 0 ? debtMonthly / monthlyNetIncome : 0;
      if (debtRatio > 0.15) months += 0.5;
      months = Math.min(6, months);
      const baseTargetAmount = totalMonthlyOutflow * months;
      const floorByIncome = Math.max(
        0,
        monthlyNetIncome * SECURITY_INCOME_FLOOR_MULTIPLIER
      );
      const securityFloor = Math.max(SECURITY_MIN_FLOOR_CHF, floorByIncome);
      const targetAmount = Math.max(baseTargetAmount, securityFloor);
      const hardStopAmount = totalMonthlyOutflow * 8;

      return {
        targetMonths: months,
        baseTargetAmount,
        securityFloor,
        targetAmount,
        hardStopAmount,
      };
    }

    function payHighCostDebts(loans, state, allocation, monthlyTaxNeed) {
      if (!Array.isArray(loans) || state.surplus <= 0) return;
      const targets = loans.filter((loan) => {
        const outstanding =
          toNumber(loan?.outstanding || loan?.balance || loan?.montant || loan?.remaining) || 0;
        const monthlyPayment =
          toNumber(loan?.monthlyPayment || loan?.monthly || loan?.mensualite || loan?.payment) || 0;
        if (outstanding <= 0 && monthlyPayment <= 0) return false;
        const rate = toNumber(loan?.interestRate || loan?.taux);
        const type = (loan?.type || loan?.creditType || "").toLowerCase();
        const isHypo = type.includes("hypothe") || type.includes("hypoth");
        if (isHypo) return false;
        if (rate && rate > 0.055) return true;
        return (
          type.includes("consom") ||
          type.includes("carte") ||
          type.includes("leasing") ||
          type.includes("credit") ||
          type.includes("découvert") ||
          type.includes("decouvert")
        );
      });
      if (!targets.length) return;

      const share = state.surplus >= monthlyTaxNeed ? 0.4 : 0.3;
      const amount = Math.min(state.surplus * share, state.surplus);
      if (amount <= 0) return;
      allocateAmount(amount, "dettes", state, allocation, (value) => {
        state.debtsRepaid += value;
        state.debtActions.push({
          amount: round2(value),
          loans: targets.map((loan) => ({
            id: loan.id || loan.name || loan.type || "credit",
            type: loan.type || loan.creditType || "",
            interestRate: loan.interestRate || loan.taux || null,
          })),
        });
        state.surplus -= value;
      });
    }

    function buildThirdPillarStatus(context, state, monthlyNetIncome) {
      const status = (context.personal.employmentStatus || "").toLowerCase();
      const annualIncome = Math.max(0, monthlyNetIncome * 12);
      const selfEmployedCap = Math.min(annualIncome * 0.2, THIRD_PILLAR_CAP_SELF_EMPLOYED);
      const baseCap = status.includes("indep")
        ? Math.max(THIRD_PILLAR_CAP_EMPLOYEE, selfEmployedCap)
        : THIRD_PILLAR_CAP_EMPLOYEE;
      const cap = Math.max(0, baseCap);
      const maxAllowed = cap * 1.2;
      const historical = toNumber(context.assets.thirdPillarPaidYTD);
      const contributed = historical + state.thirdPillar;
      return {
        reachedCap: contributed >= cap - 1e-6,
        reachedMax: contributed >= maxAllowed - 1e-6,
        cap,
        maxAllowed,
        totalContributed: contributed,
      };
    }

    function investThirdPillar(context, state, allocation, monthlyNetIncome) {
      const statusInfo = buildThirdPillarStatus(context, state, monthlyNetIncome);
      if (state.surplus <= 0 || statusInfo.cap <= 0 || statusInfo.reachedMax) {
        state.pillarCapReached = statusInfo.reachedCap;
        return statusInfo;
      }

      const coverage = statusInfo.cap > 0 ? statusInfo.totalContributed / statusInfo.cap : 0;
      let factor = 0;
      if (coverage < 0.2) factor = 0.4;
      else if (coverage < 0.6) factor = 0.55;
      else if (coverage < 1.2) factor = 0.65;
      else factor = 0;

      if (factor > 0) {
        const remainingToCap = Math.max(0, statusInfo.cap - statusInfo.totalContributed);
        const remainingToMax = Math.max(0, statusInfo.maxAllowed - statusInfo.totalContributed);
        const eligibleTarget = remainingToCap > 0 ? remainingToCap : remainingToMax;
        const floorTarget = Math.min(
          eligibleTarget,
          Math.max(0, Math.min(300, state.surplus * 0.2))
        );
        const amount = Math.min(
          eligibleTarget,
          Math.max(floorTarget, state.surplus * factor)
        );
        if (amount > 0) {
          allocateAmount(amount, "pilier3a", state, allocation, (value) => {
            state.thirdPillar += value;
            state.surplus -= value;
          });
          statusInfo.totalContributed += amount;
          statusInfo.reachedCap = statusInfo.totalContributed >= statusInfo.cap - 1e-6;
          statusInfo.reachedMax = statusInfo.totalContributed >= statusInfo.maxAllowed - 1e-6;
        }
      }

      state.pillarCapReached = statusInfo.reachedCap;
      return statusInfo;
    }

    function allocateGrowthSplit(
      state,
      allocation,
      pillarStatusInfo,
      totalAmount,
      pillarShare = GROWTH_PILLAR_SHARE
    ) {
      const chunk = Math.min(Math.max(0, toNumber(totalAmount)), state.surplus);
      if (chunk <= 0) return;

      const share = Math.max(0, Math.min(1, toNumber(pillarShare)));
      let pillarAllocated = 0;
      const canAllocatePillar =
        pillarStatusInfo &&
        toNumber(pillarStatusInfo.maxAllowed) > 0 &&
        !pillarStatusInfo.reachedMax;

      if (canAllocatePillar && share > 0) {
        const pillarCapacity = Math.max(
          0,
          toNumber(pillarStatusInfo.maxAllowed) - toNumber(pillarStatusInfo.totalContributed)
        );
        const pillarTarget = Math.min(chunk * share, pillarCapacity);
        if (pillarTarget > 0) {
          allocateAmount(pillarTarget, "pilier3a", state, allocation, (value) => {
            state.thirdPillar += value;
            state.surplus -= value;
          });
          pillarAllocated = pillarTarget;
          pillarStatusInfo.totalContributed += pillarTarget;
          pillarStatusInfo.reachedCap =
            pillarStatusInfo.totalContributed >= (pillarStatusInfo.cap || 0) - 1e-6;
          pillarStatusInfo.reachedMax =
            pillarStatusInfo.totalContributed >= (pillarStatusInfo.maxAllowed || 0) - 1e-6;
          state.pillarCapReached = pillarStatusInfo.reachedCap;
        }
      }

      const investAmount = Math.min(chunk - pillarAllocated, state.surplus);
      if (investAmount > 0) {
        allocateAmount(investAmount, "investissements", state, allocation, (value) => {
          state.investments += value;
          state.surplus -= value;
        });
      }
    }

    function allocateInvestments(state, allocation, savingsTargets, currentTarget, pillarStatusInfo) {
      if (state.surplus <= 0) return;
      const currentCoverage = currentTarget > 0 ? state.accountBalance / currentTarget : 1;
      const savingsCoverage = savingsTargets.targetAmount > 0
        ? state.securityBalance / savingsTargets.targetAmount
        : 1;
      const activationScore = [
        state.taxFulfilled,
        currentCoverage >= 0.6,
        savingsCoverage >= 0.35,
      ].filter(Boolean).length;
      if (activationScore < 2) return;

      const safetyIndex =
        (Math.min(1, currentCoverage) +
          Math.min(1, savingsCoverage) +
          (state.taxFulfilled ? 1 : 0)) /
        3;

      let factor = 0;
      if (safetyIndex >= 0.7) factor = 0.5;
      else if (safetyIndex >= 0.5) factor = 0.35;
      else if (safetyIndex >= 0.3) factor = 0.17;
      else factor = 0;

      if (factor <= 0) return;

      const amount = Math.min(state.surplus * factor, state.surplus);
      if (amount <= 0) return;
      allocateGrowthSplit(state, allocation, pillarStatusInfo, amount);
    }

    function distributeBonusRemainder(
      state,
      allocation,
      savingsTargets,
      currentTarget,
      pillarStatus
    ) {
      if (state.surplus <= 0) return;
      if (!state.taxFulfilled) return;
      if (currentTarget > 0 && state.accountBalance < currentTarget - 1e-6) return;
      if (savingsTargets.targetAmount > 0 && state.securityBalance < savingsTargets.targetAmount - 1e-6) return;
      if (!pillarStatus?.reachedCap) return;

      const baseRemainder = state.surplus;
      const pillarShare = baseRemainder * 0.4;
      const savingsShare = baseRemainder * 0.1;
      const investmentShare = baseRemainder * 0.5;

      let pillarContribution = 0;
      if (!pillarStatus.reachedMax) {
        const capacity = Math.max(0, pillarStatus.maxAllowed - pillarStatus.totalContributed);
        const target = Math.min(pillarShare, capacity);
        if (target > 0) {
          allocateAmount(target, "pilier3a", state, allocation, (value) => {
            state.thirdPillar += value;
            state.surplus -= value;
          });
          pillarContribution = target;
          pillarStatus.totalContributed += target;
          pillarStatus.reachedCap = pillarStatus.totalContributed >= pillarStatus.cap - 1e-6;
          pillarStatus.reachedMax = pillarStatus.totalContributed >= pillarStatus.maxAllowed - 1e-6;
          state.pillarCapReached = pillarStatus.reachedCap;
        }
      }

      let savingsContribution = 0;
      const savingsRoom = Math.max(0, savingsTargets.hardStopAmount - state.securityBalance);
      const targetSavings = Math.min(savingsShare, savingsRoom);
      if (targetSavings > 0) {
        allocateAmount(targetSavings, "securite", state, allocation, (value) => {
          state.securityBalance += value;
          state.securityAdded += value;
          state.surplus -= value;
        });
        savingsContribution = targetSavings;
      }

      const deferredPillar = Math.max(0, pillarShare - pillarContribution);
      const deferredSavings = Math.max(0, savingsShare - savingsContribution);
      const investTarget = investmentShare + deferredPillar + deferredSavings;
      const investAmount = Math.min(investTarget, state.surplus);
      if (investAmount > 0) {
        allocateAmount(investAmount, "investissements", state, allocation, (value) => {
          state.investments += value;
          state.surplus -= value;
        });
      }

      if (state.surplus < 0) {
        state.surplus = 0;
      }
    }

    function flushSurplus(
      state,
      allocation,
      savingsTargets,
      currentTarget,
      pillarStatus,
      context,
      monthlyNetIncome
    ) {
      if (state.surplus <= 0) return;
      let iteration = 0;
      while (state.surplus > 1e-6 && iteration < 20) {
        iteration += 1;
        const currentCapacity = Math.max(0, currentTarget - state.accountBalance - 1e-6);
        if (currentTarget > 0 && currentCapacity > 1e-6) {
          const amount = Math.min(currentCapacity, state.surplus);
          allocateAmount(amount, "compteCourant", state, allocation, (value) => {
            state.accountBalance += value;
            state.surplus -= value;
          });
          continue;
        }

        const savingsCapacity = Math.max(0, savingsTargets.hardStopAmount - state.securityBalance);
        if (savingsTargets.targetAmount > 0 && savingsCapacity > 1e-6) {
          const amount = Math.min(savingsCapacity, state.surplus);
          allocateAmount(amount, "securite", state, allocation, (value) => {
            state.securityBalance += value;
            state.securityAdded += value;
            state.surplus -= value;
          });
          continue;
        }

        const pillarStatusInfo =
          pillarStatus || buildThirdPillarStatus(context, state, monthlyNetIncome);
        allocateGrowthSplit(state, allocation, pillarStatusInfo, state.surplus);
        break;
      }
      state.surplus = Math.max(0, state.surplus);
    }

    function fundGoals(context, state, allocation) {
      const goals = Array.isArray(context.goals) ? context.goals.slice() : [];
      if (!goals.length || state.surplus <= 0) return;

      const now = context.referenceDate instanceof Date ? context.referenceDate : new Date();
      goals.sort((a, b) => {
        const diff = goalPriorityKey(a, now) - goalPriorityKey(b, now);
        if (diff !== 0) return diff;
        const priorityA = toNumber(a?.priority || 0);
        const priorityB = toNumber(b?.priority || 0);
        if (priorityA !== priorityB) return priorityA - priorityB;
        const fundingA = fundingGapRatio(a);
        const fundingB = fundingGapRatio(b);
        return fundingB - fundingA;
      });

      goals.forEach((goal) => {
        if (state.surplus <= 0) return;
        const remaining = Math.max(0, toNumber(goal.target || goal.amount) - toNumber(goal.saved || goal.current || 0));
        if (remaining <= 0) return;
        const months = Math.max(1, monthsUntil(goal.deadline || goal.date, now));
        const monthlyNeed = remaining / months;
        const amount = Math.min(monthlyNeed, remaining, state.surplus);
        if (amount <= 0) return;

        const type = (goal.type || goal.category || "").toLowerCase();
        allocateAmount(amount, goalAllocationKey(type), state, allocation, (value) => {
          if (type === "securite") {
            state.securityBalance += value;
            state.securityAdded += value;
          } else if (type === "croissance") {
            state.investments += value;
          } else {
            state.longTermProjects += value;
          }
          state.surplus -= value;
        });

        state.goalsFunded.push({
          name: goal.name || goal.titre || "Objectif",
          allocated: round2(amount),
          remaining: round2(remaining - amount),
        });
      });
    }

    function ensureMinimumGrowth(
      state,
      allocation,
      fiscalInfo,
      baseLiquidityNeed,
      securityTargetAmount
    ) {
      if (state.surplus <= 0) return;
      const taxCovered = fiscalInfo.remaining <= state.impotsProvisioned + 1;
      const liquidityOk = state.accountBalance >= baseLiquidityNeed * 0.9;
      const securityOk = state.securityBalance >= securityTargetAmount;
      if (!taxCovered || !liquidityOk || !securityOk) return;

      const minimum = Math.min(state.surplus * 0.15, state.surplus);
      if (minimum <= 0) return;
      allocateAmount(minimum, "investissements", state, allocation, (value) => {
        state.investments += value;
        state.surplus -= value;
      });
    }

    function applyProfilePriority(profile, state, allocation) {
      if (state.surplus <= 0) return;
      const available = state.surplus;
      const normalized = profile.toLowerCase();
      if (normalized.includes("secur")) {
        allocateAmount(available, "securite", state, allocation, (value) => {
          state.securityBalance += value;
          state.securityAdded += value;
          state.surplus -= value;
        });
      } else if (normalized.includes("projet")) {
        allocateAmount(available, "projetsLongTerme", state, allocation, (value) => {
          state.longTermProjects += value;
          state.surplus -= value;
        });
      } else if (normalized.includes("croiss")) {
        const investAmount = available * 0.65;
        allocateAmount(investAmount, "investissements", state, allocation, (value) => {
          state.investments += value;
          state.surplus -= value;
        });
        if (state.surplus > 0) {
          allocateAmount(state.surplus, "securite", state, allocation, (value) => {
            state.securityBalance += value;
            state.securityAdded += value;
            state.surplus -= value;
          });
        }
      } else {
        const half = available / 2;
        allocateAmount(half, "securite", state, allocation, (value) => {
          state.securityBalance += value;
          state.securityAdded += value;
          state.surplus -= value;
        });
        if (state.surplus > 0) {
          allocateAmount(state.surplus, "investissements", state, allocation, (value) => {
            state.investments += value;
            state.surplus -= value;
          });
        }
      }
    }

    function sweepRemainder(state, allocation, fiscalInfo, securityTargetAmount, context) {
      if (state.surplus <= 0) return;
      const amount = state.surplus;

      const needs = [];
      const fiscalRemaining = Math.max(0, fiscalInfo.remaining - state.impotsProvisioned);
      if (fiscalRemaining > 0) {
        needs.push({ key: "impots", amount: fiscalRemaining, handler: (value) => (state.impotsProvisioned += value) });
      }

      const accountNeeded = Math.max(0, securityTargetAmount / 2 - state.accountBalance);
      if (accountNeeded > 0) {
        needs.push({
          key: "compteCourant",
          amount: accountNeeded,
          handler: (value) => (state.accountBalance += value),
        });
      }

      const securityNeeded = Math.max(0, securityTargetAmount - state.securityBalance);
      if (securityNeeded > 0) {
        needs.push({
          key: "securite",
          amount: securityNeeded,
          handler: (value) => {
            state.securityBalance += value;
            state.securityAdded += value;
          },
        });
      }

      needs.forEach((need) => {
        if (state.surplus <= 0) return;
        const value = Math.min(state.surplus, need.amount);
        if (value <= 0) return;
        allocateAmount(value, need.key, state, allocation, (val) => {
          need.handler(val);
          state.surplus -= val;
        });
      });

      if (state.surplus > 0) {
        applyProfilePriority(context.profile, state, allocation);
      }
    }

    function recycleCurrentExcess(state, cap) {
      if (cap <= 0) return;
      const excess = Math.max(0, state.accountBalance - cap);
      if (excess <= 0) return;
      state.accountBalance -= excess;
      state.surplus += excess;
    }

    function allocateAmount(amount, key, state, allocation, callback) {
      if (amount <= 0) return;
      if (!allocation.allocations[key]) allocation.allocations[key] = 0;
      allocation.allocations[key] += amount;
      if (typeof callback === "function") callback(amount);
    }

    function initialiseAllocation(initialAvailable) {
      return {
        disponibleInitial: round2(initialAvailable),
        allocations: {
          compteCourant: 0,
          impots: 0,
          securite: 0,
          pilier3a: 0,
          projetsLongTerme: 0,
          investissements: 0,
          dettes: 0,
        },
        objectifsFinances: [],
        reste: 0,
      };
    }

    function ensureArray(value) {
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    }

    function goalPriorityKey(goal, now) {
      const deadline = goal.deadline || goal.date;
      const months = monthsUntil(deadline, now);
      return months;
    }

    function fundingGapRatio(goal) {
      const target = toNumber(goal?.target || goal?.amount);
      const saved = toNumber(goal?.saved || goal?.current);
      if (!target) return 0;
      return (target - saved) / target;
    }

    function goalAllocationKey(type) {
      if (type === "securite") return "securite";
      if (type === "croissance") return "investissements";
      return "projetsLongTerme";
    }

    function monthsUntilFiscalDeadline(referenceDate) {
      const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
      const deadline = new Date(now.getFullYear(), 2, 31);
      if (now > deadline) {
        deadline.setFullYear(deadline.getFullYear() + 1);
      }
      const years = deadline.getFullYear() - now.getFullYear();
      let months = years * 12 + (deadline.getMonth() - now.getMonth());
      if (deadline.getDate() >= now.getDate()) months += 1;
      return Math.max(1, months);
    }

    function monthsUntil(deadline, referenceDate) {
      if (!deadline) return 12;
      const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
      const end = new Date(deadline);
      if (Number.isNaN(end.getTime())) return 12;
      const years = end.getFullYear() - now.getFullYear();
      const months = years * 12 + (end.getMonth() - now.getMonth());
      return Math.max(1, months);
    }

    function toNumber(value) {
      if (typeof value === "number") return Number.isFinite(value) ? value : 0;
      if (typeof value === "string") {
        const parsed = parseFloat(value.replace(/[\s'_,]/g, "."));
        return Number.isFinite(parsed) ? parsed : 0;
      }
      if (typeof value === "boolean") return value ? 1 : 0;
      return 0;
    }

    function round2(value) {
      return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    return {
      calculateAllocation,
    };
  })();

  root.AllocationEngine = AllocationEngine;
})(typeof window !== "undefined" ? window : globalThis);
