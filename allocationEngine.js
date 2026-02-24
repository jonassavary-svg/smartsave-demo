(function (root) {
  const AllocationEngine = (function () {
    const THIRD_PILLAR_CAP_EMPLOYEE = 7056;
    const THIRD_PILLAR_CAP_SELF_EMPLOYED = 35280;
    const GROWTH_PILLAR_SHARE = 0.6;
    const SAVINGS_ALWAYS_MIN_RATE = 0.15;
    const SECURITY_MIN_FLOOR_CHF = 1000;
    const SECURITY_RECOMMENDED_FLOOR_CHF = 10000;
    const SECURITY_INCOME_FLOOR_MULTIPLIER = 2;
    const TAX_CAP_PCT_DEFAULT = 0.35;
    const TAX_URGENCY_MONTHS_DEFAULT = 2;
    const TAX_EMERGENCY_MIN_MONTHS_DEFAULT = 2;
    const TAX_PRESSURE_TRIGGER_DEFAULT = 0.3;
    const TAX_SOFT_URGENCY_MONTHS_DEFAULT = 4;
    const TAX_AFFORDABLE_RATE_NEAR_DUE_DEFAULT = 0.4;
    const TAX_AFFORDABLE_RATE_NORMAL_DEFAULT = 0.3;
    const TAX_MODE_AUTO_PROVISION = "AUTO_PROVISION";
    const TAX_MODE_PAY_LATER = "PAY_LATER";
    const DEFAULT_SMARTSAVE_SETTINGS = Object.freeze({
      allocationPriority: { order: "security_tax_invest" },
      taxes: { enabled: true, provisionMode: "smoothed", priority: "normal" },
      limits: {
        minCurrentMonths: 1,
        precautionIncomeMonths: 3,
        investMaxSurplusPct: 25,
        scoreInfluenceEnabled: true,
      },
      savings: {
        strategy: "equilibre",
      },
      investments: {
        strategy: "equilibre",
      },
    });
    const DEFAULT_ADVANCED_SETTINGS = Object.freeze({
      savingsUsage: {
        savingsFloor: 0,
        pullOrder: "current_first",
      },
      exceptions: {
        urgentTaxBoostOneMonth: false,
      },
      overrides: {
        skipCurrentMonth: false,
        forceRecompute: false,
      },
      investmentAdvanced: {
        maxInvestPerMonth: 0,
        maxInvestPct: 40,
        progressiveInvest: false,
        stopOnHardMonth: true,
      },
    });

    const LOW_CAPACITY_THRESHOLD = 300;
    const SHORT_TERM_LABELS = {
      vacances: "Vacances",
      cadeaux: "Cadeaux",
      voiture: "Voiture",
      mariage: "Mariage",
      autre: "Projet court terme",
    };
    const SAVINGS_PRESETS = Object.freeze({
      prudent: { lt50: 0.75, lt90: 0.45, lt100: 0.3, gte100: 0.2 },
      equilibre: { lt50: 0.6, lt90: 0.3, lt100: 0.2, gte100: 0.15 },
      aggressif: { lt50: 0.5, lt90: 0.25, lt100: 0.15, gte100: 0.1 },
    });
    const INVEST_PRESETS = Object.freeze({
      securite: {
        activation: { minSurplus: 1, minCurrentFill: 0.8, minSavingsFill: 0.3 },
        brackets: [
          { minSec: 0.8, pct: 0.3 },
          { minSec: 0.6, pct: 0.2 },
          { minSec: 0.4, pct: 0.1 },
          { minSec: 0, pct: 0 },
        ],
      },
      equilibre: {
        activation: { minSurplus: 1, minCurrentFill: 0.5 },
        brackets: [
          { minSec: 0.7, pct: 0.4 },
          { minSec: 0.5, pct: 0.3 },
          { minSec: 0.3, pct: 0.17 },
          { minSec: 0, pct: 0 },
        ],
      },
      aggressif: {
        activation: { minSurplus: 1, minCurrentFill: 0.3 },
        brackets: [
          { minSec: 0.6, pct: 0.5 },
          { minSec: 0.4, pct: 0.35 },
          { minSec: 0.25, pct: 0.2 },
          { minSec: 0, pct: 0 },
        ],
      },
    });
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

      const incomeProfile = computeMonthlyIncomeProfile(context);
      const monthlyExpenses = computeMonthlyExpenses(context);
      const allocationPlan = normaliseAllocationPlan(context.allocationPlan);
      const monthlyAvailableBeforePlan =
        incomeProfile.monthlyNetIncome -
        (monthlyExpenses.fixed + monthlyExpenses.variable + monthlyExpenses.debts);
      const leisureDeduction = Math.min(
        Math.max(0, monthlyAvailableBeforePlan),
        Math.max(0, toNumber(allocationPlan.leisureMonthly))
      );
      const shortTermPlan = buildShortTermPlan(allocationPlan.shortTerm);
      const shortTermPlanned = Math.max(0, toNumber(shortTermPlan.monthlyAmount));

      let monthlyAvailable = monthlyAvailableBeforePlan - leisureDeduction;
      if (context.overrideMonthlyAvailable != null) {
        monthlyAvailable = toNumber(context.overrideMonthlyAvailable);
      }

      const allocation = initialiseAllocation(monthlyAvailable);
      const monthlySurplusEnvelope = Math.max(0, toNumber(monthlyAvailable));
      const state = {
        surplus: monthlyAvailable,
        accountBalance: context.assets.paymentBalance,
        securityBalance: context.assets.securityBalance,
        taxBalance: context.assets.taxProvision || 0,
        impotsProvisioned: 0,
        currentAdded: 0,
        investments: 0,
        longTermProjects: 0,
        shortTermAdded: 0,
        thirdPillar: 0,
        securityAdded: 0,
        debtsRepaid: 0,
        debtActions: [],
        goalsFunded: [],
        taxFulfilled: false,
        taxMonthlyNeed: 0,
        taxMonthlyTarget: 0,
        taxShortfall: 0,
        taxMonthsRemaining: 0,
        taxTotalEstimate: 0,
        taxRemainingEstimate: 0,
        taxGapToNeed: 0,
        taxReason: "",
        taxMode: TAX_MODE_AUTO_PROVISION,
        taxTopUpFromCurrent: 0,
        taxTopUpFromSecurity: 0,
        taxEligibleFromCurrent: 0,
        taxEligibleFromSecurity: 0,
        taxPressureRatio: 0,
        taxSoftTrigger: false,
        taxPreTopUpNeeded: 0,
        taxPreTopUpApplied: 0,
        pillarCapReached: false,
        monthlySurplusEnvelope,
        growthCap: 0,
        growthAllocated: 0,
      };

      const fiscalInfo = computeFiscalNeeds(context, incomeProfile.taxReferenceMonthlyIncome);
      const currentTarget = computeCurrentTarget(context, monthlyExpenses);
      const savingsTargets = computeSavingsTargets(
        context,
        monthlyExpenses,
        incomeProfile.monthlyNetBase
      );

      context.debug = {
        monthlyNetIncomeBase: round2(incomeProfile.monthlyNetBase),
        thirteenthIncome: round2(incomeProfile.thirteenthForMonth),
        monthlyNetIncome: round2(incomeProfile.monthlyNetIncome),
        monthlyExpenses,
        monthlyAvailableBeforePlan: round2(monthlyAvailableBeforePlan),
        leisureDeduction: round2(leisureDeduction),
        shortTermPlanned: round2(shortTermPlanned),
        shortTermDeduction: 0,
        currentTarget: round2(currentTarget),
        savingsTargets,
        savingsStrategy: context?.smartSaveSettings?.savings?.strategy || "equilibre",
        investmentStrategy: context?.smartSaveSettings?.investments?.strategy || "equilibre",
        securityBalance: round2(context.assets.securityBalance),
      };

      if (context?.advancedSettings?.overrides?.skipCurrentMonth) {
        context.debug.skipCurrentMonth = true;
      } else if (monthlyAvailable > 0) {
          const canContinue = allocateMonthlyTaxes(
          fiscalInfo,
          state,
          allocation,
          context,
          monthlyAvailable,
          currentTarget,
          savingsTargets,
          monthlyExpenses
          );
          if (canContinue) {
            fillCurrentAccount(state, allocation, currentTarget);
            fillShortTermAccount(state, allocation, shortTermPlan);
            fillSavingsAccount(state, allocation, savingsTargets, context);
            const pillarStatus = investThirdPillar(
              context,
              state,
              allocation,
              incomeProfile.taxReferenceMonthlyIncome
            );
            allocateInvestments(state, allocation, savingsTargets, currentTarget, pillarStatus, context);
          distributeBonusRemainder(
            state,
            allocation,
            savingsTargets,
            currentTarget,
            pillarStatus
          );
          if (state.surplus > 0) {
            flushSurplus(
              state,
              allocation,
              savingsTargets,
              currentTarget,
              pillarStatus,
              context,
              incomeProfile.taxReferenceMonthlyIncome
            );
          }
        }
      }

      allocation.allocations.compteCourant = round2(state.currentAdded);
      allocation.allocations.securite = round2(state.securityAdded);
      allocation.allocations.impots = round2(state.impotsProvisioned);
      allocation.allocations.investissements = round2(state.investments);
      allocation.allocations.projetsLongTerme = round2(state.longTermProjects);
      allocation.allocations.pilier3a = round2(state.thirdPillar);
      allocation.allocations.dettes = round2(state.debtsRepaid);
      allocation.allocations.projetsCourtTerme = round2(state.shortTermAdded);
      allocation.objectifsFinances = state.goalsFunded;
      allocation.dettesDetail = state.debtActions;
      allocation.reste = round2(Math.max(0, state.surplus));
      allocation.shortTermDeduction = round2(state.shortTermAdded);
      allocation.shortTermAccount = {
        key: "projetsCourtTerme",
        name: shortTermPlan.name,
        label: `Compte ${shortTermPlan.name}`,
        amount: round2(state.shortTermAdded),
      };
      allocation.longTermDiagnostic = buildLongTermDiagnostic(
        allocationPlan.longTerm,
        allocation.allocations
      );
      context.debug.taxFunding = {
        mode: state.taxMode || TAX_MODE_AUTO_PROVISION,
        totalEstimate: round2(state.taxTotalEstimate || 0),
        remainingEstimate: round2(state.taxRemainingEstimate || 0),
        monthsRemaining: Math.max(0, Math.round(toNumber(state.taxMonthsRemaining || 0))),
        monthlyNeed: round2(state.taxMonthlyNeed),
        monthlyTarget: round2(state.taxMonthlyTarget),
        shortfall: round2(state.taxShortfall),
        gapToNeed: round2(state.taxGapToNeed || 0),
        reason: state.taxReason || "",
        topUpFromCurrent: round2(state.taxTopUpFromCurrent || 0),
        topUpFromSecurity: round2(state.taxTopUpFromSecurity || 0),
        eligibleFromCurrent: round2(state.taxEligibleFromCurrent || 0),
        eligibleFromSecurity: round2(state.taxEligibleFromSecurity || 0),
        pressureRatio: round2((state.taxPressureRatio || 0) * 100),
        softTrigger: !!state.taxSoftTrigger,
        preTopUpNeeded: round2(state.taxPreTopUpNeeded || 0),
        preTopUpApplied: round2(state.taxPreTopUpApplied || 0),
      };
      context.debug.shortTermAccount = allocation.shortTermAccount;
      context.debug.shortTermAllocated = round2(state.shortTermAdded);
      context.debug.shortTermDeduction = 0;
      context.debug.longTermDiagnostic = allocation.longTermDiagnostic;
      context.debug.allocationTrace = Array.isArray(allocation.allocationTrace)
        ? allocation.allocationTrace.slice()
        : [];
      context.debug.growth = {
        cap: 0,
        allocated: 0,
        remaining: 0,
      };
      allocation.debug = context.debug || {};
      root.SmartSaveDebug = allocation.debug;

      return allocation;
    }

    function resolveReferenceDate(data = {}) {
      if (data?.referenceDate) return data.referenceDate;
      const monthKey =
        String(data?.centralFinance?.monthId || data?.monthId || "")
          .trim();
      const parts = monthKey.split("-");
      if (parts.length === 2) {
        const year = Number(parts[0]);
        const month = Number(parts[1]) - 1;
        if (Number.isFinite(year) && Number.isFinite(month) && month >= 0 && month <= 11) {
          return new Date(year, month, 1);
        }
      }
      return new Date();
    }

    function normaliseInput(data) {
      const hasOverride = Object.prototype.hasOwnProperty.call(
        data,
        "overrideMonthlyAvailable"
      );
      const settings = resolveSettingsFromData(data);
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
        spouseIncomeFrequency:
          data.incomes?.spouseIncomeFrequency ??
          data.incomes?.spouseNetIncomeFrequency ??
          data.incomes?.spouseIncomePeriod ??
          data.spouseIncomeFrequency ??
          "mensuel",
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
          thirdPillarPaidYTDYear: toNumber(
            data.assets?.thirdPillarPaidYTDYear || data.taxes?.thirdPillarPaidYTDYear
          ),
          hasThirdPillarPaidYTD:
            data.assets?.thirdPillarPaidYTD != null ||
            data.taxes?.thirdPillarPaidYTD != null,
          pillar3aBalance: toNumber(
            data.assets?.pillar3a ??
              data.assets?.pilier3a ??
              data.assets?.thirdPillarAmount ??
              data.assets?.thirdPillar ??
              data.assets?.pillar3 ??
              data.assets?.thirdPillarValue ??
              0
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
        smartSaveSettings: settings.smartSaveSettings,
        advancedSettings: settings.advancedSettings,
        referenceDate: resolveReferenceDate(data),
        overrideMonthlyAvailable: hasOverride
          ? toNumber(data.overrideMonthlyAvailable)
          : null,
      };
    }

    function mergePlainObjects(base = {}, patch = {}) {
      const safeBase = base && typeof base === "object" && !Array.isArray(base) ? base : {};
      const safePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
      const output = { ...safeBase };
      Object.keys(safePatch).forEach((key) => {
        const patchValue = safePatch[key];
        if (Array.isArray(patchValue)) {
          output[key] = patchValue.slice();
          return;
        }
        if (patchValue && typeof patchValue === "object") {
          const baseValue =
            output[key] && typeof output[key] === "object" && !Array.isArray(output[key])
              ? output[key]
              : {};
          output[key] = mergePlainObjects(baseValue, patchValue);
          return;
        }
        output[key] = patchValue;
      });
      return output;
    }

    function normaliseSmartSaveSettings(raw = {}) {
      const merged = mergePlainObjects(DEFAULT_SMARTSAVE_SETTINGS, raw || {});
      merged.allocationPriority = merged.allocationPriority || {};
      merged.allocationPriority.order = String(
        merged?.allocationPriority?.order || "security_tax_invest"
      );
      if (!["security_tax_invest", "security_invest_tax"].includes(merged.allocationPriority.order)) {
        merged.allocationPriority.order = "security_tax_invest";
      }
      merged.taxes = merged.taxes || {};
      merged.taxes.enabled = merged?.taxes?.enabled !== false;
      merged.taxes.provisionMode = String(merged?.taxes?.provisionMode || "smoothed").toLowerCase();
      if (!["smoothed", "recommendations"].includes(merged.taxes.provisionMode)) {
        merged.taxes.provisionMode = "smoothed";
      }
      merged.taxes.priority = String(merged?.taxes?.priority || "normal").toLowerCase();
      if (!["normal", "high", "critical"].includes(merged.taxes.priority)) {
        merged.taxes.priority = "normal";
      }
      merged.limits = merged.limits || {};
      merged.limits.minCurrentMonths = Math.max(
        1,
        Math.min(3, toNumber(merged?.limits?.minCurrentMonths || 1))
      );
      merged.limits.precautionIncomeMonths = Math.max(
        1,
        Math.min(12, toNumber(merged?.limits?.precautionIncomeMonths || 3))
      );
      merged.limits.investMaxSurplusPct = Math.max(
        0,
        Math.min(100, toNumber(merged?.limits?.investMaxSurplusPct || 25))
      );
      merged.limits.scoreInfluenceEnabled = merged?.limits?.scoreInfluenceEnabled !== false;
      merged.savings = merged.savings || {};
      merged.savings.strategy = normalizeSavingsStrategy(merged?.savings?.strategy);
      merged.investments = merged.investments || {};
      merged.investments.strategy = normalizeInvestmentStrategy(merged?.investments?.strategy);
      return merged;
    }

    function normaliseAdvancedSettings(raw = {}) {
      const merged = mergePlainObjects(DEFAULT_ADVANCED_SETTINGS, raw || {});
      merged.savingsUsage = merged.savingsUsage || {};
      if (Object.prototype.hasOwnProperty.call(merged.savingsUsage, "allowUseExistingSavings")) {
        delete merged.savingsUsage.allowUseExistingSavings;
      }
      merged.savingsUsage.savingsFloor = Math.max(
        0,
        toNumber(merged?.savingsUsage?.savingsFloor || 0)
      );
      merged.savingsUsage.pullOrder =
        String(merged?.savingsUsage?.pullOrder || "current_first") === "savings_first"
          ? "savings_first"
          : "current_first";
      merged.exceptions = merged.exceptions || {};
      merged.exceptions.urgentTaxBoostOneMonth = Boolean(
        merged?.exceptions?.urgentTaxBoostOneMonth
      );
      merged.overrides = merged.overrides || {};
      merged.overrides.skipCurrentMonth = Boolean(merged?.overrides?.skipCurrentMonth);
      merged.overrides.forceRecompute = Boolean(merged?.overrides?.forceRecompute);
      merged.investmentAdvanced = merged.investmentAdvanced || {};
      merged.investmentAdvanced.maxInvestPerMonth = Math.max(
        0,
        toNumber(merged?.investmentAdvanced?.maxInvestPerMonth || 0)
      );
      merged.investmentAdvanced.maxInvestPct = Math.max(
        0,
        Math.min(100, toNumber(merged?.investmentAdvanced?.maxInvestPct || 40))
      );
      merged.investmentAdvanced.progressiveInvest = Boolean(
        merged?.investmentAdvanced?.progressiveInvest
      );
      merged.investmentAdvanced.stopOnHardMonth = merged?.investmentAdvanced?.stopOnHardMonth !== false;
      return merged;
    }

    function resolveSettingsFromData(data = {}) {
      const userSettings =
        data?.userSettings && typeof data.userSettings === "object" ? data.userSettings : {};
      const smartRaw =
        data?.smartSaveSettings && typeof data.smartSaveSettings === "object"
          ? data.smartSaveSettings
          : userSettings?.smartSaveSettings || {};
      const advancedRaw =
        data?.advancedSettings && typeof data.advancedSettings === "object"
          ? data.advancedSettings
          : userSettings?.advancedSettings || {};
      return {
        smartSaveSettings: normaliseSmartSaveSettings(smartRaw),
        advancedSettings: normaliseAdvancedSettings(advancedRaw),
      };
    }

    function normalizeSavingsStrategy(value) {
      const raw = String(value || "").trim().toLowerCase();
      if (raw === "prudent") return "prudent";
      if (["agressif", "aggressive", "aggressif"].includes(raw)) return "aggressif";
      if (["equilibre", "équilibré", "equilibré", "balanced"].includes(raw)) return "equilibre";
      return "equilibre";
    }

    function normalizeInvestmentStrategy(value) {
      const raw = String(value || "").trim().toLowerCase();
      if (["securite", "sécurité", "secure", "safety"].includes(raw)) return "securite";
      if (["agressif", "aggressive", "aggressif"].includes(raw)) return "aggressif";
      if (["equilibre", "équilibré", "equilibré", "balanced"].includes(raw)) return "equilibre";
      return "equilibre";
    }

    function computeMonthlyNetIncome(context) {
      const personalStatus = (context.personal.employmentStatus || "").toLowerCase();
      const spouseMonthlyIncome = resolveSpouseMonthlyIncome(context);
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
        }, 0) + spouseMonthlyIncome
      );
    }

    function computeMonthlyIncomeProfile(context = {}) {
      const monthlyNetBase = Math.max(0, computeMonthlyNetIncome(context));
      const refDate =
        context.referenceDate instanceof Date
          ? context.referenceDate
          : new Date(context.referenceDate);
      const currentMonth = Number.isNaN(refDate.getTime()) ? 1 : refDate.getMonth() + 1;
      const personalStatus = (context.personal?.employmentStatus || "").toLowerCase();

      let annualThirteenth = 0;
      let thirteenthForMonth = 0;
      let hasThirteenth = false;

      ensureArray(context.incomes).forEach((income = {}) => {
        const raw = toNumber(income?.amount);
        if (!raw) return;
        const has13 = income?.thirteenth === true || income?.thirteenth === "oui";
        if (!has13) return;
        hasThirteenth = true;
        const type = String(income?.amountType || "net").toLowerCase();
        const status = (income?.employmentStatus || personalStatus).toLowerCase();
        const coefficient =
          type === "brut"
            ? status.includes("indep") || status.includes("indépendent")
              ? 0.75
              : 0.86
            : 1;
        const netMonthly = Math.max(0, raw * coefficient);
        annualThirteenth += netMonthly;
        const rawMonth =
          income?.thirteenthMonth ??
          income?.thirteenthSalaryMonth ??
          income?.salary13Month ??
          income?.month13 ??
          12;
        const month = Math.max(1, Math.min(12, Number(rawMonth) || 12));
        if (month === currentMonth) {
          thirteenthForMonth += netMonthly;
        }
      });

      return {
        monthlyNetBase: round2(monthlyNetBase),
        monthlyNetIncome: round2(monthlyNetBase + thirteenthForMonth),
        thirteenthForMonth: round2(thirteenthForMonth),
        annualThirteenth: round2(annualThirteenth),
        hasThirteenth,
        taxReferenceMonthlyIncome: round2(monthlyNetBase + annualThirteenth / 12),
      };
    }

    function resolveSpouseMonthlyIncome(context = {}) {
      const spouseIncome = Math.max(0, toNumber(context.spouseIncome));
      if (!spouseIncome) return 0;
      const frequency = String(context.spouseIncomeFrequency || "mensuel")
        .trim()
        .toLowerCase();
      if (frequency.startsWith("annu") || frequency.startsWith("year")) {
        return spouseIncome / 12;
      }
      if (frequency.startsWith("trim")) {
        return spouseIncome / 3;
      }
      if (frequency.startsWith("hebdo") || frequency.startsWith("week")) {
        return (spouseIncome * 52) / 12;
      }
      return spouseIncome;
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

    function runLowCapacityPlan(context, monthlyExpenses, fiscalInfo, state, allocation, monthlyAvailable, monthlyNetIncome) {
      const currentTarget = computeCurrentTarget(
        context,
        monthlyExpenses
      );
      const savingsTargets = computeSavingsTargets(
        context,
        monthlyExpenses,
        monthlyNetIncome
      );
      if (!context.debug) context.debug = {};
      context.debug.savingsTargets = savingsTargets;
      context.debug.currentTarget = currentTarget;
      context.debug.securityBalance = context.assets.securityBalance;
      const currentExcessBefore = Math.max(0, state.accountBalance - currentTarget);

      if (
        !allocateMonthlyTaxes(
          fiscalInfo,
          state,
          allocation,
          context,
          monthlyAvailable,
          currentTarget,
          savingsTargets,
          monthlyExpenses
        )
      ) {
        return;
      }
      context.debug.currentExcessBeforeTax = round2(currentExcessBefore);
      context.debug.currentExcessRecycled = 0;
      if (state.surplus <= 0) return;

      fillCurrentAccount(state, allocation, currentTarget);
      if (state.surplus <= 0) return;

      fillShortTermAccount(
        state,
        allocation,
        buildShortTermPlan(context?.allocationPlan?.shortTerm || {})
      );
      if (state.surplus <= 0) return;

      fillSavingsAccount(state, allocation, savingsTargets, context);
      const lowPillarStatus = buildThirdPillarStatus(context, state, monthlyNetIncome);
      flushSurplus(state, allocation, savingsTargets, currentTarget, lowPillarStatus, context, monthlyNetIncome);
    }

    function runStandardPlan(
      context,
      monthlyExpenses,
      fiscalInfo,
      state,
      allocation,
      monthlyAvailable,
      monthlyNetIncome
    ) {
      const currentTarget = computeCurrentTarget(
        context,
        monthlyExpenses
      );
      const savingsTargets = computeSavingsTargets(
        context,
        monthlyExpenses,
        monthlyNetIncome
      );
      if (!context.debug) context.debug = {};
      context.debug.savingsTargets = savingsTargets;
      context.debug.currentTarget = currentTarget;
      context.debug.securityBalance = context.assets.securityBalance;
      const currentExcessBefore = Math.max(0, state.accountBalance - currentTarget);

      if (
        !allocateMonthlyTaxes(
          fiscalInfo,
          state,
          allocation,
          context,
          monthlyAvailable,
          currentTarget,
          savingsTargets,
          monthlyExpenses
        )
      ) {
        return;
      }
      context.debug.currentExcessBeforeTax = round2(currentExcessBefore);
      context.debug.currentExcessRecycled = 0;
      if (state.surplus <= 0) return;

      fillCurrentAccount(state, allocation, currentTarget);
      if (state.surplus <= 0) return;

      fillShortTermAccount(
        state,
        allocation,
        buildShortTermPlan(context?.allocationPlan?.shortTerm || {})
      );
      if (state.surplus <= 0) return;

      fillSavingsAccount(state, allocation, savingsTargets, context);
      if (state.surplus <= 0) return;

      const pillarStatus = investThirdPillar(context, state, allocation, monthlyNetIncome);
      if (state.surplus <= 0) return;

      allocateInvestments(
        state,
        allocation,
        savingsTargets,
        currentTarget,
        pillarStatus,
        context
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

    function allocateMonthlyTaxes(
      fiscalInfo,
      state,
      allocation,
      context,
      monthlyAvailable,
      currentTarget,
      savingsTargets,
      monthlyExpenses
    ) {
      const taxConfig = resolveTaxConfig(context);
      state.taxMode = taxConfig.mode;
      const annualTax = Math.max(0, fiscalInfo.annualTax || 0);
      state.taxTotalEstimate = annualTax;
      if (annualTax <= 0) {
        state.taxFulfilled = true;
        state.taxMonthlyNeed = 0;
        state.taxMonthlyTarget = 0;
        state.taxShortfall = 0;
        state.taxGapToNeed = 0;
        state.taxMonthsRemaining = 0;
        state.taxRemainingEstimate = 0;
        state.taxEligibleFromCurrent = 0;
        state.taxEligibleFromSecurity = 0;
        state.taxPressureRatio = 0;
        state.taxSoftTrigger = false;
        state.taxPreTopUpNeeded = 0;
        state.taxPreTopUpApplied = 0;
        state.taxReason = "no_tax";
        return true;
      }

      const remainingNeed = Math.max(0, annualTax - state.taxBalance);
      state.taxRemainingEstimate = remainingNeed;
      if (remainingNeed <= 0) {
        state.taxFulfilled = true;
        state.taxMonthlyNeed = 0;
        state.taxMonthlyTarget = 0;
        state.taxShortfall = 0;
        state.taxGapToNeed = 0;
        state.taxMonthsRemaining = 0;
        state.taxEligibleFromCurrent = 0;
        state.taxEligibleFromSecurity = 0;
        state.taxPressureRatio = 0;
        state.taxSoftTrigger = false;
        state.taxPreTopUpNeeded = 0;
        state.taxPreTopUpApplied = 0;
        state.taxReason = "already_funded";
        return true;
      }

      const monthlyProvision = fiscalInfo?.data?.monthlyProvision || {};
      const planRemainingMonths = Math.max(0, toNumber(monthlyProvision.remainingMonths || 0));
      const monthsRemaining = Math.max(
        1,
        planRemainingMonths > 0 ? planRemainingMonths : toNumber(fiscalInfo.monthsRemaining || 1)
      );
      state.taxMonthsRemaining = monthsRemaining;
      const theoreticalNeed = Math.max(
        0,
        Math.min(
          remainingNeed,
          toNumber(fiscalInfo.monthlyNeed) > 0
            ? toNumber(fiscalInfo.monthlyNeed)
            : remainingNeed / monthsRemaining
        )
      );
      if (taxConfig.mode === TAX_MODE_PAY_LATER) {
        state.taxFulfilled = true;
        state.taxMonthlyNeed = round2(theoreticalNeed);
        state.taxMonthlyTarget = 0;
        state.taxShortfall = round2(theoreticalNeed);
        state.taxGapToNeed = round2(theoreticalNeed);
        state.taxEligibleFromCurrent = 0;
        state.taxEligibleFromSecurity = 0;
        state.taxPressureRatio = 0;
        state.taxSoftTrigger = false;
        state.taxPreTopUpNeeded = 0;
        state.taxPreTopUpApplied = 0;
        state.taxReason = "pay_later_mode";
        return true;
      }
      const baseAvailable = Math.max(0, toNumber(monthlyAvailable));
      const pressureRatio = baseAvailable > 1e-6 ? theoreticalNeed / baseAvailable : theoreticalNeed > 0 ? 1 : 0;
      state.taxPressureRatio = pressureRatio;
      const capByReste = Math.max(0, baseAvailable * taxConfig.capPct);
      const capByHard =
        taxConfig.maxMonthly > 0 ? taxConfig.maxMonthly : Number.POSITIVE_INFINITY;
      const urgentThreshold = Math.max(2, taxConfig.urgentMonths);
      const urgent = monthsRemaining <= urgentThreshold;
      const softUrgent = monthsRemaining <= taxConfig.softUrgentMonths;
      const softTriggered = pressureRatio >= taxConfig.pressureTrigger || softUrgent;
      state.taxSoftTrigger = softTriggered;
      const affordableRate = softUrgent
        ? taxConfig.affordableRateNearDue
        : taxConfig.affordableRateNormal;
      const monthlyAffordable = Math.max(0, baseAvailable * affordableRate);
      const preTopUpNeeded = softTriggered
        ? Math.max(0, remainingNeed - monthlyAffordable * monthsRemaining)
        : 0;
      state.taxPreTopUpNeeded = round2(preTopUpNeeded);
      state.taxPreTopUpApplied = 0;
      const desired = Math.max(
        0,
        urgent
          ? Math.min(theoreticalNeed, capByHard, remainingNeed)
          : Math.min(theoreticalNeed, capByReste, capByHard, remainingNeed)
      );
      let amount = Math.min(state.surplus, desired);
      const gapToNeed = Math.max(0, theoreticalNeed - amount);
      state.taxGapToNeed = gapToNeed;
      state.taxEligibleFromCurrent = 0;
      state.taxEligibleFromSecurity = 0;
      if (gapToNeed > 1e-6) {
        const topUp = pullTaxTopUpFromBalances({
          state,
          gap: gapToNeed,
          currentTarget,
          savingsTargets,
          monthlyExpenses,
          taxConfig,
        });
        state.taxEligibleFromCurrent = topUp.eligibleCurrent;
        state.taxEligibleFromSecurity = topUp.eligibleSecurity;
        if (topUp.current > 0 || topUp.security > 0) {
          state.taxTopUpFromCurrent += topUp.current;
          state.taxTopUpFromSecurity += topUp.security;
          amount = Math.min(state.surplus, theoreticalNeed);
        }
      }

      if (preTopUpNeeded > 1e-6) {
        const remainingAfterMonthNeed = Math.max(0, remainingNeed - Math.max(0, amount));
        const proactiveNeed = Math.min(preTopUpNeeded, remainingAfterMonthNeed);
        if (proactiveNeed > 1e-6) {
          const proactiveTopUp = pullTaxTopUpFromBalances({
            state,
            gap: proactiveNeed,
            currentTarget,
            savingsTargets,
            monthlyExpenses,
            taxConfig,
          });
          if (proactiveTopUp.current > 0 || proactiveTopUp.security > 0) {
            const proactiveApplied = proactiveTopUp.current + proactiveTopUp.security;
            state.taxTopUpFromCurrent += proactiveTopUp.current;
            state.taxTopUpFromSecurity += proactiveTopUp.security;
            state.taxPreTopUpApplied = round2(proactiveApplied);
            const withProactiveTarget = Math.min(
              remainingNeed,
              Math.max(0, theoreticalNeed + proactiveApplied)
            );
            amount = Math.min(state.surplus, withProactiveTarget);
          }
        }
      }

      state.taxMonthlyNeed = round2(theoreticalNeed);
      state.taxMonthlyTarget = round2(desired);
      state.taxShortfall = round2(Math.max(0, theoreticalNeed - amount));

      if (amount + 1e-6 < theoreticalNeed) {
        const urgentContext = monthsRemaining <= urgentThreshold;
        const cappedByPct = desired + 1e-6 < theoreticalNeed && desired + 1e-6 <= capByReste;
        const cappedByHard =
          Number.isFinite(capByHard) &&
          desired + 1e-6 < theoreticalNeed &&
          desired + 1e-6 <= capByHard;
        if (amount <= 0) {
          state.taxReason = "no_capacity";
        } else if (cappedByHard) {
          state.taxReason = urgentContext ? "urgent_capped_by_hard_limit" : "capped_by_hard_limit";
        } else if (cappedByPct) {
          state.taxReason = urgentContext ? "urgent_capped_by_reste_pct" : "capped_by_reste_pct";
        } else {
          state.taxReason = "partial_funding";
        }
      } else {
        const usedTopUp = state.taxTopUpFromCurrent > 0 || state.taxTopUpFromSecurity > 0;
        state.taxReason = usedTopUp
          ? urgent
            ? "urgent_on_track_with_balance_topup"
            : "on_track_with_balance_topup"
          : urgent
          ? "urgent_on_track"
          : "on_track";
        if (state.taxPreTopUpApplied > 0) {
          state.taxReason = "on_track_with_preemptive_topup";
        }
      }

      if (amount <= 0) {
        state.taxFulfilled = false;
        return false;
      }
      allocateAmount(amount, "impots", state, allocation, (value) => {
        state.impotsProvisioned += value;
        state.surplus -= value;
        state.taxBalance = (state.taxBalance || 0) + value;
      });
      if (amount + 1e-6 < theoreticalNeed) {
        state.taxFulfilled = false;
        return true;
      }
      state.taxFulfilled = true;
      return true;
    }

    function resolveTaxConfig(context) {
      const taxes = context?.taxes || {};
      const rawMode = String(
        taxes.taxMode != null
          ? taxes.taxMode
          : taxes.impotsMode != null
          ? taxes.impotsMode
          : ""
      )
        .trim()
        .toUpperCase();
      const mode =
        rawMode === TAX_MODE_PAY_LATER || rawMode === "PAYER_PLUS_TARD"
          ? TAX_MODE_PAY_LATER
          : TAX_MODE_AUTO_PROVISION;
      let priority = String(
        taxes.taxPriority != null ? taxes.taxPriority : "normal"
      )
        .trim()
        .toLowerCase();
      if (!["normal", "high", "critical"].includes(priority)) priority = "normal";
      const defaultCapPct = priority === "critical" ? 0.65 : priority === "high" ? 0.45 : TAX_CAP_PCT_DEFAULT;
      const capPct = Math.min(
        1,
        Math.max(
          0,
          toNumber(
            taxes.capTaxPct != null
              ? taxes.capTaxPct
              : taxes.taxCapPct != null
              ? taxes.taxCapPct
              : defaultCapPct
          )
        )
      );
      const maxMonthly = Math.max(
        0,
        toNumber(
          taxes.taxMaxMonthly != null
            ? taxes.taxMaxMonthly
            : taxes.maxMonthlyTax != null
            ? taxes.maxMonthlyTax
            : 0
        )
      );
      let urgentMonths = Math.max(
        1,
        Math.round(
          toNumber(
            taxes.taxUrgentMonths != null
              ? taxes.taxUrgentMonths
              : taxes.urgentTaxMonths != null
              ? taxes.urgentTaxMonths
              : TAX_URGENCY_MONTHS_DEFAULT
          )
        )
      );
      if (priority === "high") urgentMonths = Math.max(urgentMonths, TAX_URGENCY_MONTHS_DEFAULT + 1);
      if (priority === "critical") urgentMonths = Math.max(urgentMonths, TAX_URGENCY_MONTHS_DEFAULT + 2);
      const defaultEpargneMinMonths = TAX_EMERGENCY_MIN_MONTHS_DEFAULT;
      const epargneMinMonths = Math.max(
        0,
        toNumber(
          taxes.epargneMinMonths != null
            ? taxes.epargneMinMonths
            : taxes.securityMinMonths != null
            ? taxes.securityMinMonths
            : defaultEpargneMinMonths
        )
      );
      const allowBalanceTopUp = false;
      const pullOrder =
        String(
          taxes.taxPullOrder != null ? taxes.taxPullOrder : "current_first"
        ).toLowerCase() === "savings_first"
          ? "savings_first"
          : "current_first";
      const savingsFloor = Math.max(
        0,
        toNumber(
          taxes.taxSavingsFloor != null
            ? taxes.taxSavingsFloor
            : taxes.savingsFloor != null
            ? taxes.savingsFloor
            : 0
        )
      );
      const defaultPressureTrigger =
        priority === "critical" ? 0.12 : priority === "high" ? 0.22 : TAX_PRESSURE_TRIGGER_DEFAULT;
      const pressureTrigger = Math.min(
        1,
        Math.max(
          0,
          toNumber(
            taxes.taxPressureTrigger != null
              ? taxes.taxPressureTrigger
              : taxes.impotsPressureTrigger != null
              ? taxes.impotsPressureTrigger
              : defaultPressureTrigger
          )
        )
      );
      const defaultSoftUrgent = Math.max(TAX_SOFT_URGENCY_MONTHS_DEFAULT, urgentMonths + 1);
      const softUrgentMonths = Math.max(
        1,
        Math.round(
          toNumber(
            taxes.taxSoftUrgentMonths != null
              ? taxes.taxSoftUrgentMonths
              : taxes.impotsSoftUrgentMonths != null
              ? taxes.impotsSoftUrgentMonths
              : defaultSoftUrgent
          )
        )
      );
      const defaultAffordableRateNearDue =
        priority === "critical"
          ? Math.max(TAX_AFFORDABLE_RATE_NEAR_DUE_DEFAULT, 0.65)
          : priority === "high"
          ? Math.max(TAX_AFFORDABLE_RATE_NEAR_DUE_DEFAULT, 0.5)
          : TAX_AFFORDABLE_RATE_NEAR_DUE_DEFAULT;
      const affordableRateNearDue = Math.min(
        1,
        Math.max(
          0,
          toNumber(
            taxes.taxAffordableRateNearDue != null
              ? taxes.taxAffordableRateNearDue
              : taxes.impotsAffordableRateNearDue != null
              ? taxes.impotsAffordableRateNearDue
              : defaultAffordableRateNearDue
          )
        )
      );
      const defaultAffordableRateNormal =
        priority === "critical"
          ? Math.max(TAX_AFFORDABLE_RATE_NORMAL_DEFAULT, 0.55)
          : priority === "high"
          ? Math.max(TAX_AFFORDABLE_RATE_NORMAL_DEFAULT, 0.4)
          : TAX_AFFORDABLE_RATE_NORMAL_DEFAULT;
      const affordableRateNormal = Math.min(
        1,
        Math.max(
          0,
          toNumber(
            taxes.taxAffordableRateNormal != null
              ? taxes.taxAffordableRateNormal
              : taxes.impotsAffordableRateNormal != null
              ? taxes.impotsAffordableRateNormal
              : defaultAffordableRateNormal
          )
        )
      );
      return {
        mode,
        priority,
        capPct,
        maxMonthly,
        urgentMonths,
        epargneMinMonths,
        allowBalanceTopUp,
        pullOrder,
        savingsFloor,
        pressureTrigger,
        softUrgentMonths,
        affordableRateNearDue,
        affordableRateNormal,
      };
    }

    function pullTaxTopUpFromBalances({
      state,
      gap,
      currentTarget,
      monthlyExpenses,
      taxConfig,
    }) {
      if (!taxConfig?.allowBalanceTopUp) {
        return { current: 0, security: 0, eligibleCurrent: 0, eligibleSecurity: 0 };
      }
      let remaining = Math.max(0, toNumber(gap));
      if (remaining <= 0) {
        return { current: 0, security: 0, eligibleCurrent: 0, eligibleSecurity: 0 };
      }

      const currentFloor = Math.max(0, toNumber(currentTarget || 0));
      const currentSurplus = Math.max(0, toNumber(state.accountBalance || 0) - currentFloor);
      const essentialMonthly =
        Math.max(0, toNumber(monthlyExpenses?.fixed || 0)) +
        Math.max(0, toNumber(monthlyExpenses?.variable || 0));
      const securityFloor = Math.max(
        essentialMonthly * Math.max(0, toNumber(taxConfig.epargneMinMonths || 0)),
        Math.max(0, toNumber(taxConfig.savingsFloor || 0))
      );
      const securitySurplus = Math.max(0, toNumber(state.securityBalance || 0) - securityFloor);
      const order =
        String(taxConfig?.pullOrder || "current_first").toLowerCase() === "savings_first"
          ? ["security", "current"]
          : ["current", "security"];
      let fromCurrent = 0;
      let fromSecurity = 0;
      order.forEach((sourceKey) => {
        if (remaining <= 0) return;
        if (sourceKey === "security" && !taxConfig?.allowBalanceTopUp) return;
        const available = sourceKey === "security" ? securitySurplus - fromSecurity : currentSurplus - fromCurrent;
        if (available <= 0) return;
        const taken = Math.min(remaining, Math.max(0, available));
        if (taken <= 0) return;
        if (sourceKey === "security") {
          fromSecurity += taken;
          state.securityBalance -= taken;
        } else {
          fromCurrent += taken;
          state.accountBalance -= taken;
        }
        state.surplus += taken;
        remaining -= taken;
      });

      return {
        current: round2(fromCurrent),
        security: round2(fromSecurity),
        eligibleCurrent: round2(currentSurplus),
        eligibleSecurity: round2(securitySurplus),
      };
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
        state.currentAdded += value;
        state.surplus -= value;
      });
    }

    function fillShortTermAccount(state, allocation, shortTermPlan = {}) {
      if (state.surplus <= 0) return;
      if (!shortTermPlan || shortTermPlan.enabled !== true) return;
      const monthlyNeed = Math.max(0, toNumber(shortTermPlan.monthlyAmount || 0));
      if (monthlyNeed <= 0) return;
      const amount = Math.min(monthlyNeed, state.surplus);
      if (amount <= 0) return;
      allocateAmount(amount, "projetsCourtTerme", state, allocation, (value) => {
        state.shortTermAdded += value;
        state.surplus -= value;
      });
    }

    function resolveSavingsPreset(context = {}) {
      const strategy = normalizeSavingsStrategy(
        context?.smartSaveSettings?.savings?.strategy ||
          context?.smartSaveSettings?.savingsStrategy ||
          "equilibre"
      );
      return SAVINGS_PRESETS[strategy] || SAVINGS_PRESETS.equilibre;
    }

    function fillSavingsAccount(state, allocation, targets, context) {
      if (state.surplus <= 0) return;
      const targetAmount = targets.targetAmount || 0;
      const ratio = targetAmount > 0 ? state.securityBalance / targetAmount : 1;
      const preset = resolveSavingsPreset(context);
      let factor = 0;
      if (ratio < 0.5) factor = preset.lt50;
      else if (ratio < 0.9) factor = preset.lt90;
      else if (ratio < 1) factor = preset.lt100;
      else factor = preset.gte100;
      const amount = Math.min(state.surplus, state.surplus * factor);
      if (amount <= 0) return;
      allocateAmount(amount, "securite", state, allocation, (value) => {
        state.securityBalance += value;
        state.securityAdded += value;
        state.surplus -= value;
      });
    }

    function computeCurrentTarget(context, monthlyExpenses) {
      const mandatoryMonthlyNeed = Math.max(0, toNumber(monthlyExpenses?.variable || 0));
      const months = Math.max(
        1,
        Math.min(
          3,
          toNumber(context?.smartSaveSettings?.limits?.minCurrentMonths || 1)
        )
      );
      return Math.max(0, mandatoryMonthlyNeed * months);
    }

    function computeSavingsTargets(context, monthlyExpenses, monthlyNetIncome) {
      let months = 3;
      const personalStatus = (context.personal.employmentStatus || "").toLowerCase();
      const hasThirteenth = context.incomes.some(
        (income) => income?.thirteenth === "oui" || income?.thirteenth === true
      );
      const isIndependent =
        personalStatus.includes("indep") || personalStatus.includes("indépend");
      if (isIndependent) months += 0.5;
      if (!hasThirteenth) months += 0.5;
      const currentSavings = Math.max(0, toNumber(context?.assets?.securityBalance || 0));
      const lowSavings = currentSavings < Math.max(0, toNumber(monthlyNetIncome || 0));
      if (lowSavings) months += 0.5;
      const debtMonthly = monthlyExpenses.debts;
      const debtRatio = monthlyNetIncome > 0 ? debtMonthly / monthlyNetIncome : 0;
      if (debtRatio > 0.15) months += 0.5;
      months = Math.min(6, months);
      const totalMonthlyNeed = Math.max(
        0,
        toNumber(monthlyExpenses?.fixed || 0) +
          toNumber(monthlyExpenses?.variable || 0) +
          toNumber(monthlyExpenses?.debts || 0)
      );
      const targetAmount = totalMonthlyNeed * months;
      const hardStopAmount = targetAmount;

      return {
        targetMonths: round2(months),
        baseTargetAmount: round2(targetAmount),
        securityFloor: 0,
        targetAmount: round2(targetAmount),
        hardStopAmount,
        debtRatio: round2(debtRatio),
        isIndependent,
        hasThirteenth,
        lowSavings,
      };
    }

    function resolveGrowthCap(context, monthlyAvailable) {
      const safeAvailable = Math.max(0, toNumber(monthlyAvailable));
      const smartLimits =
        context?.smartSaveSettings?.limits && typeof context.smartSaveSettings.limits === "object"
          ? context.smartSaveSettings.limits
          : {};
      const advancedInvest =
        context?.advancedSettings?.investmentAdvanced &&
        typeof context.advancedSettings.investmentAdvanced === "object"
          ? context.advancedSettings.investmentAdvanced
          : {};
      const smartPct = Math.max(0, Math.min(100, toNumber(smartLimits.investMaxSurplusPct || 0)));
      const advancedPctRaw = Math.max(0, Math.min(100, toNumber(advancedInvest.maxInvestPct || 0)));
      const effectivePct = advancedPctRaw > 0 ? Math.min(smartPct, advancedPctRaw) : smartPct;
      let cap = safeAvailable * (effectivePct / 100);
      const maxByAbsolute = Math.max(0, toNumber(advancedInvest.maxInvestPerMonth || 0));
      if (maxByAbsolute > 0) cap = Math.min(cap, maxByAbsolute);
      if (advancedInvest.progressiveInvest) cap *= 0.7;
      if (advancedInvest.stopOnHardMonth !== false && safeAvailable <= 0) cap = 0;
      return Math.max(0, round2(cap));
    }

    function getGrowthRemainingRoom(state) {
      const cap = Math.max(0, toNumber(state?.growthCap || 0));
      const allocated = Math.max(0, toNumber(state?.growthAllocated || 0));
      return Math.max(0, cap - allocated);
    }

    function allocateGrowthAmount(state, allocation, key, amount, callback) {
      const requested = Math.max(0, toNumber(amount));
      if (requested <= 0) return 0;
      const room = getGrowthRemainingRoom(state);
      const allowed = Math.min(requested, room, Math.max(0, toNumber(state?.surplus || 0)));
      if (allowed <= 0) return 0;
      let applied = 0;
      allocateAmount(allowed, key, state, allocation, (value) => {
        applied = value;
        state.growthAllocated = round2(
          Math.max(0, toNumber(state.growthAllocated || 0)) + Math.max(0, toNumber(value))
        );
        if (typeof callback === "function") callback(value);
      });
      return applied;
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
      const selfEmployedCap = Math.min(
        annualIncome * 0.2,
        THIRD_PILLAR_CAP_SELF_EMPLOYED
      );
      const baseCap = status.includes("indep")
        ? selfEmployedCap
        : THIRD_PILLAR_CAP_EMPLOYEE;
      const cap = Math.max(0, baseCap);
      const referenceDateRaw = context?.referenceDate;
      const referenceDate =
        referenceDateRaw instanceof Date
          ? referenceDateRaw
          : new Date(referenceDateRaw || Date.now());
      const fiscalYear = Number.isNaN(referenceDate.getTime())
        ? new Date().getFullYear()
        : referenceDate.getFullYear();
      const hasExplicitYtd = Boolean(context.assets.hasThirdPillarPaidYTD);
      const ytdYearRaw = toNumber(context.assets.thirdPillarPaidYTDYear);
      const ytdYear = Math.round(ytdYearRaw) || fiscalYear;
      const storedYtd = Math.max(0, toNumber(context.assets.thirdPillarPaidYTD));
      const pillar3aBalance = Math.max(0, toNumber(context.assets.pillar3aBalance));
      let historical = hasExplicitYtd
        ? ytdYear === fiscalYear
          ? storedYtd
          : 0
        : storedYtd;
      if (!hasExplicitYtd && pillar3aBalance >= cap - 1e-6) {
        historical = cap;
      }
      const contributed = Math.max(0, historical + state.thirdPillar);
      const reachedCap = cap <= 0 || contributed >= cap - 1e-6;
      return {
        reachedCap,
        reachedMax: reachedCap,
        cap,
        maxAllowed: cap,
        historicalYtd: historical,
        totalContributed: contributed,
      };
    }

    function investThirdPillar(context, state, allocation, monthlyNetIncome) {
      const statusInfo = buildThirdPillarStatus(context, state, monthlyNetIncome);
      if (state.surplus <= 0 || statusInfo.cap <= 0 || statusInfo.reachedCap) {
        state.pillarCapReached = statusInfo.reachedCap;
        return statusInfo;
      }

      const coverage = statusInfo.cap > 0 ? statusInfo.totalContributed / statusInfo.cap : 0;
      let factor = 0;
      if (coverage < 0.2) factor = 0.15;
      else if (coverage < 0.3) factor = 0.25;
      else if (coverage < 1) factor = 0.4;

      if (factor > 0) {
        const remainingToCap = Math.max(0, statusInfo.cap - statusInfo.totalContributed);
        const amount = Math.min(remainingToCap, state.surplus * factor, state.surplus);
        if (amount > 0) {
          allocateAmount(amount, "pilier3a", state, allocation, (value) => {
            state.thirdPillar += value;
            state.surplus -= value;
          });
          statusInfo.totalContributed = state.thirdPillar + Math.max(0, toNumber(statusInfo.historicalYtd || 0));
          statusInfo.reachedCap = statusInfo.totalContributed >= statusInfo.cap - 1e-6;
          statusInfo.reachedMax = statusInfo.reachedCap;
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
          const applied = allocateGrowthAmount(state, allocation, "pilier3a", pillarTarget, (value) => {
            state.thirdPillar += value;
            state.surplus -= value;
          });
          pillarAllocated = applied;
          pillarStatusInfo.totalContributed += applied;
          pillarStatusInfo.reachedCap =
            pillarStatusInfo.totalContributed >= (pillarStatusInfo.cap || 0) - 1e-6;
          pillarStatusInfo.reachedMax =
            pillarStatusInfo.totalContributed >= (pillarStatusInfo.maxAllowed || 0) - 1e-6;
          state.pillarCapReached = pillarStatusInfo.reachedCap;
        }
      }

      const investAmount = Math.min(chunk - pillarAllocated, state.surplus);
      if (investAmount > 0) {
        allocateGrowthAmount(state, allocation, "investissements", investAmount, (value) => {
          state.investments += value;
          state.surplus -= value;
        });
      }
    }

    function resolveInvestmentPreset(context = {}) {
      const strategy = normalizeInvestmentStrategy(
        context?.smartSaveSettings?.investments?.strategy ||
          context?.smartSaveSettings?.investmentStrategy ||
          "equilibre"
      );
      return INVEST_PRESETS[strategy] || INVEST_PRESETS.equilibre;
    }

    function allocateInvestments(
      state,
      allocation,
      savingsTargets,
      currentTarget,
      pillarStatusInfo,
      context
    ) {
      if (state.surplus <= 0) return;
      const preset = resolveInvestmentPreset(context);
      const activation = preset.activation || {};
      if (state.surplus < Math.max(0, toNumber(activation.minSurplus || 0))) return;
      const currentCoverage = currentTarget > 0 ? state.accountBalance / currentTarget : 1;
      if (currentCoverage < Math.max(0, toNumber(activation.minCurrentFill || 0.5))) return;
      const savingsCoverage = savingsTargets.targetAmount > 0
        ? state.securityBalance / savingsTargets.targetAmount
        : 1;
      if (activation.minSavingsFill != null) {
        if (savingsCoverage < Math.max(0, toNumber(activation.minSavingsFill || 0))) return;
      }
      const taxCoverage =
        state.taxTotalEstimate > 0 ? state.taxBalance / state.taxTotalEstimate : 1;

      const safetyIndex =
        (Math.min(1, currentCoverage) +
          Math.min(1, savingsCoverage) +
          Math.min(1, taxCoverage)) /
        3;

      const brackets = Array.isArray(preset.brackets) ? preset.brackets : [];
      let factor = 0;
      for (let i = 0; i < brackets.length; i += 1) {
        const bracket = brackets[i] || {};
        if (safetyIndex >= Math.max(0, toNumber(bracket.minSec || 0))) {
          factor = Math.max(0, Math.min(1, toNumber(bracket.pct || 0)));
          break;
        }
      }

      if (factor <= 0) return;

      const amount = Math.min(state.surplus * factor, state.surplus);
      if (amount <= 0) return;
      allocateAmount(amount, "investissements", state, allocation, (value) => {
        state.investments += value;
        state.surplus -= value;
      });
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
      const pillarInfo = pillarStatus || { reachedCap: true, cap: 0, totalContributed: 0 };

      const baseRemainder = state.surplus;
      const pillarShare = baseRemainder * 0.4;
      const savingsShare = baseRemainder * 0.2;
      const investmentShare = baseRemainder * 0.4;

      let effectiveSavingsShare = savingsShare;
      if (pillarInfo.reachedCap) {
        effectiveSavingsShare += pillarShare;
      } else if (pillarShare > 0) {
        const remaining = Math.max(0, pillarInfo.cap - pillarInfo.totalContributed);
        const pillarAmount = Math.min(pillarShare, remaining, state.surplus);
        const pillarUnallocated = Math.max(0, pillarShare - pillarAmount);
        if (pillarUnallocated > 0) {
          effectiveSavingsShare += pillarUnallocated;
        }
        if (pillarAmount > 0) {
          allocateAmount(pillarAmount, "pilier3a", state, allocation, (value) => {
            state.thirdPillar += value;
            state.surplus -= value;
            pillarInfo.totalContributed += value;
          });
        }
      }

      if (effectiveSavingsShare > 0 && state.surplus > 0) {
        const amount = Math.min(effectiveSavingsShare, state.surplus);
        allocateAmount(amount, "securite", state, allocation, (value) => {
          state.securityBalance += value;
          state.securityAdded += value;
          state.surplus -= value;
        });
      }

      if (investmentShare > 0 && state.surplus > 0) {
        const amount = Math.min(investmentShare, state.surplus);
        allocateAmount(amount, "investissements", state, allocation, (value) => {
          state.investments += value;
          state.surplus -= value;
        });
      }

      if (state.surplus > 0) {
        allocateAmount(state.surplus, "investissements", state, allocation, (value) => {
          state.investments += value;
          state.surplus -= value;
        });
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
        if (state.surplus < 1) break;
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
      if (state.surplus > 0) {
        // Safety fallback: keep no unallocated remainder, route to savings (no absolute cap).
        allocateAmount(state.surplus, "securite", state, allocation, (value) => {
          state.securityBalance += value;
          state.securityAdded += value;
          state.surplus -= value;
        });
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
        const targetKey = goalAllocationKey(type);
        let allocatedNow = 0;
        if (targetKey === "investissements" || targetKey === "pilier3a") {
          allocatedNow = allocateGrowthAmount(state, allocation, targetKey, amount, (value) => {
            if (type === "croissance") state.investments += value;
            state.surplus -= value;
          });
        } else {
          allocateAmount(amount, targetKey, state, allocation, (value) => {
            allocatedNow = value;
            if (type === "securite") {
              state.securityBalance += value;
              state.securityAdded += value;
            } else {
              state.longTermProjects += value;
            }
            state.surplus -= value;
          });
        }

        state.goalsFunded.push({
          name: goal.name || goal.titre || "Objectif",
          allocated: round2(allocatedNow),
          remaining: round2(remaining - allocatedNow),
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
      allocateGrowthAmount(state, allocation, "investissements", minimum, (value) => {
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
        allocateGrowthAmount(state, allocation, "investissements", investAmount, (value) => {
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
          allocateGrowthAmount(state, allocation, "investissements", state.surplus, (value) => {
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

    function absorbResidualSurplus(state, allocation, context) {
      if (state.surplus <= 0) return;
      const remainder = Math.max(0, toNumber(state.surplus));
      if (remainder <= 0) return;

      let absorbedOnSecurity = 0;
      let absorbedOnCurrent = 0;

      allocateAmount(state.surplus, "securite", state, allocation, (value) => {
        absorbedOnSecurity += value;
        state.securityBalance += value;
        state.securityAdded += value;
        state.surplus -= value;
      });
      if (state.surplus > 0) {
        allocateAmount(state.surplus, "compteCourant", state, allocation, (value) => {
          absorbedOnCurrent += value;
          state.accountBalance += value;
          state.surplus -= value;
        });
      }
      if (state.surplus > 0 && state.surplus < 1) {
        state.surplus = 0;
      }
      if (!context.debug) context.debug = {};
      context.debug.remainderAbsorbed = {
        initial: round2(remainder),
        securite: round2(absorbedOnSecurity),
        compteCourant: round2(absorbedOnCurrent),
        residual: round2(state.surplus),
      };
    }

    function allocateAmount(amount, key, state, allocation, callback) {
      const rounded = Math.max(0, round2(toNumber(amount)));
      if (rounded <= 0) return;
      if (!allocation.allocations[key]) allocation.allocations[key] = 0;
      allocation.allocations[key] += rounded;
      if (!Array.isArray(allocation.allocationTrace)) allocation.allocationTrace = [];
      allocation.allocationTrace.push({
        key,
        amount: rounded,
      });
      if (typeof callback === "function") callback(rounded);
    }

    function initialiseAllocation(initialAvailable) {
      return {
        disponibleInitial: round2(initialAvailable),
        allocations: {
          compteCourant: 0,
          impots: 0,
          securite: 0,
          pilier3a: 0,
          projetsCourtTerme: 0,
          projetsLongTerme: 0,
          investissements: 0,
        dettes: 0,
      },
      allocationTrace: [],
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
