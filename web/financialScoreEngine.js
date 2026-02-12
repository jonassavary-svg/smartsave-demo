(function (root) {
  const FinancialScoreEngine = (function () {
    const WEIGHTS = {
      security: 0.4,
      anticipation: 0.3,
      growth: 0.3,
    };

    const LEVELS = [
      { max: 35, label: "Critique" },
      { max: 55, label: "À risque" },
      { max: 75, label: "Perfectible" },
      { max: 88, label: "Sain" },
      { max: Infinity, label: "Optimal" },
    ];

    function calculateScore(formData = {}) {
      const personalIncome = computePersonalIncome(formData);
      const spouseIncome = computeSpouseIncome(formData);
      const householdAnnualIncome = personalIncome.annual + spouseIncome.annual;

      const expenseData = computeMonthlyExpenses(formData.expenses);
      const fallbackExpenses = personalIncome.monthly > 0 ? personalIncome.monthly * 0.7 : 0;
      const useFallbackExpenses = expenseData.total <= 0 && fallbackExpenses > 0;
      const monthlyExpenses = useFallbackExpenses ? fallbackExpenses : expenseData.total;
      const hasShortTermPlan =
        Boolean(formData?.allocationPlan?.shortTerm?.enabled) &&
        toNumber(formData?.allocationPlan?.shortTerm?.amount) > 0;
      const spendingRatio =
        personalIncome.monthly > 0 && Number.isFinite(monthlyExpenses)
          ? monthlyExpenses / personalIncome.monthly
          : null;

      const debtData = computeDebtData(formData.credits, formData.loans);
      const debtRatio =
        personalIncome.monthly > 0 && debtData.monthlyPayments >= 0
          ? debtData.monthlyPayments / personalIncome.monthly
          : null;

      const liquidAssets = computeLiquidAssets(formData.assets);
      const essentialMonthlyOutflow = Math.max(0, monthlyExpenses + debtData.monthlyPayments);
      const safetyMonths = essentialMonthlyOutflow > 0 ? liquidAssets.total / essentialMonthlyOutflow : 0;

      const autoSavingsMonthly = computeAutomaticSavings(formData.assets);
      const autoSavingsRatio =
        personalIncome.monthly > 0
          ? autoSavingsMonthly / personalIncome.monthly
          : null;

      const taxDetails = computeTaxMetrics(formData, {
        householdAnnualIncome,
        personalAnnualIncome: personalIncome.annual,
      });

      const investmentData = computeInvestmentMetrics(formData, {
        liquidAssets,
        personalAnnualIncome: personalIncome.annual,
        taxData: taxDetails.raw,
      });

      const securityPillar = evaluateSecurityPillar({
        spendingRatio,
        safetyMonths,
        debtRatio,
        autoSavingsRatio,
      });

      const anticipationPillar = evaluateAnticipationPillar({
        incomeStability: formData.personal?.incomeStability,
        incomeEntries: formData.incomes?.entries,
        monthlyIncome: personalIncome.monthly,
        taxMetrics: taxDetails.metrics,
        autoSavingsMonthly,
      });

      const growthPillar = evaluateGrowthPillar({
        investRatio: investmentData.ratio,
        thirdPillarAmount: investmentData.thirdPillarAmount,
        thirdPillarRecurring: investmentData.thirdPillarRecurring,
        recurringInvestment: investmentData.recurringInvestment,
        securityScore: securityPillar.score,
        monthlyIncome: personalIncome.monthly,
        fallbackApplied: investmentData.fallbackApplied,
      });

      const pillars = {
        securite: securityPillar,
        anticipation: anticipationPillar,
        croissance: growthPillar,
      };

      const globalScore = computeGeometricMean(pillars);
      const level = determineLevel(globalScore);
      const recommandations = buildRecommendations(pillars, taxDetails.metrics, {
        hasShortTermPlan,
      });

      return {
        score: globalScore,
        level,
        details: {
          revenus: scoreIncome(personalIncome.monthly, formData.personal),
          depenses: mapSpendingSubScore(spendingRatio),
          epargne: mapSafetySubScore(safetyMonths),
          dettes: mapDebtSubScore(debtRatio),
          impots: mapTaxSubScore(taxDetails.metrics.coverage, taxDetails.metrics.pressure),
          investissements: mapInvestmentSubScore(investmentData.ratio),
        },
        recommandations,
        pillars,
        metrics: {
          monthlyNetIncome: personalIncome.monthly,
          monthlyExpenses,
          monthlyEssentialOutflow: essentialMonthlyOutflow,
          expensesFallbackApplied: useFallbackExpenses,
          safetyMonths,
          debtRatio,
          monthlyDebtPayments: debtData.monthlyPayments,
          liquidAssets: liquidAssets.total,
          autoSavingsMonthly,
          autoSavingsRatio,
          taxAnnual: taxDetails.metrics.annualTax,
          taxProvisioned: taxDetails.metrics.provisioned,
          taxRemaining: taxDetails.metrics.remaining,
          taxCoverage: taxDetails.metrics.coverage,
          taxPressure: taxDetails.metrics.pressure,
          taxPlanMonthly: taxDetails.metrics.monthlyPlanAmount,
          taxPlanMonthsRemaining: taxDetails.metrics.remainingMonths,
          investRatio: investmentData.ratio,
          totalInvested: investmentData.totalInvested,
          totalPatrimony: investmentData.totalPatrimony,
        },
      };
    }

    /* ---------- Income / Expenses / Debts ---------- */

    function computePersonalIncome(formData) {
      const entries = Array.isArray(formData.incomes?.entries)
        ? formData.incomes.entries
        : formData.incomes?.entries
        ? [formData.incomes.entries]
        : [];

      const defaultStatus = String(
        formData.personal?.employmentStatus || ""
      ).toLowerCase();

      let monthly = 0;
      entries.forEach((entry = {}) => {
        const amount = toNumber(entry.amount);
        if (!amount) return;

        const type = String(entry.amountType || "net").toLowerCase();
        const status = String(entry.employmentStatus || defaultStatus);
        const isIndependent = status.includes("indep");
        const coefficient =
          type === "brut" ? (isIndependent ? 0.75 : 0.86) : 1;
        const netMonthly = amount * coefficient;
        const has13th = entry.thirteenth === true || entry.thirteenth === "oui";

        monthly += has13th ? netMonthly * (13 / 12) : netMonthly;
      });

      return { monthly, annual: monthly * 12 };
    }

    function computeSpouseIncome(formData) {
      const monthly = Math.max(
        0,
        toNumber(
          formData.incomes?.spouseNetIncome ??
            formData.incomes?.spouseIncome ??
            formData.spouseIncome
        )
      );
      return { monthly, annual: monthly * 12 };
    }

    function computeMonthlyExpenses(expenses = {}) {
      const fixed = sumMonthly(expenses.fixed);
      const variable = sumMonthly(expenses.variable);
      // Exceptional/CT are not part of score pressure in the new flow.
      const exceptional = 0;

      return {
        total: fixed + variable + exceptional,
        breakdown: { fixed, variable, exceptional },
      };
    }

    function computeDebtData(credits = {}, directLoans) {
      const loans = Array.isArray(credits.loans)
        ? credits.loans
        : Array.isArray(directLoans)
        ? directLoans
        : [];

      let monthlyPayments = 0;
      let outstanding = 0;
      loans.forEach((loan = {}) => {
        monthlyPayments += toNumber(
          loan.monthlyAmount || loan.monthlyPayment || loan.monthly || loan.mensualite
        );
        outstanding += toNumber(loan.outstanding);
      });

      return { monthlyPayments, outstanding };
    }

    /* ---------- Assets / Investments ---------- */

    function computeLiquidAssets(assets = {}) {
      const current =
        toNumber(assets.currentAccount) + toNumber(assets.paymentAccount);
      const savings =
        toNumber(assets.savingsAccount) +
        toNumber(assets.securitySavings) +
        toNumber(assets.emergencyFund);
      return { total: current + savings, current, savings };
    }

    function computeInvestmentMetrics(formData = {}, { liquidAssets, personalAnnualIncome, taxData }) {
      const assets = formData.assets || {};
      const investments = formData.investments || {};
      const wealthBreakdown = taxData?.breakdown?.wealth;

      const items = Array.isArray(investments.items) ? investments.items : [];
      const directItemsTotal = items.reduce((sum, item = {}) => sum + toNumber(item.amount), 0);

      let totalInvested = toNumber(wealthBreakdown?.investments);
      if (totalInvested <= 0) {
        totalInvested =
          directItemsTotal +
          toNumber(assets.investments) +
          toNumber(assets.investmentAccount) +
          toNumber(assets.portfolio) +
          toNumber(assets.portefeuille) +
          toNumber(assets.stockPortfolio) +
          toNumber(assets.etfHoldings);
      }

      const thirdPillarWealth = toNumber(wealthBreakdown?.thirdPillarLiquid);
      const thirdPillarCandidates = [
        assets.thirdPillarAmount,
        assets.thirdPillarValue,
        assets.thirdPillar,
        assets.pillar3,
        assets.pillar3a,
      ];
      const resolvedThirdPillar = thirdPillarCandidates.reduce((best, value) => {
        const numeric = toNumber(value);
        return numeric > best ? numeric : best;
      }, 0);
      const thirdPillarAmount = thirdPillarWealth > 0 ? thirdPillarWealth : resolvedThirdPillar;

      const thirdPillarRecurring = Math.max(
        0,
        toNumber(assets.thirdPillarContributionMonthly),
        toNumber(assets.thirdPillarContribution),
        toNumber(assets.thirdPillarMonthlyContribution),
        toNumber(assets.thirdPillarPlanMonthly)
      );

      const recurringInvestment = items.reduce((sum, item = {}) => {
        const hasPlan =
          item.hasMonthly === true ||
          item.hasMonthly === "oui" ||
          item.hasMonthlyPlan === true ||
          String(item.plan || "").toLowerCase() === "oui";
        if (!hasPlan) return sum;
        return sum + toNumber(item.monthlyAmount || item.planAmount || item.mensualite);
      }, 0);

      const propertyNet = Math.max(
        0,
        toNumber(wealthBreakdown?.propertyNet) || computeNetPropertyValue(formData)
      );

      const totalPatrimony =
        liquidAssets.total +
        thirdPillarAmount +
        Math.max(0, totalInvested) +
        propertyNet;

      const totalInvestedPositive = Math.max(0, totalInvested);
      let ratio = 0;
      let fallbackApplied = false;
      if (totalPatrimony > 0) {
        ratio = clamp(totalInvestedPositive / totalPatrimony, 0, 1);
      } else {
        fallbackApplied = true;
        const fallbackBase = Math.max(personalAnnualIncome, 1);
        ratio = clamp((totalInvestedPositive + thirdPillarAmount) / fallbackBase, 0, 1);
      }

      return {
        totalInvested: totalInvestedPositive,
        totalPatrimony,
        ratio,
        thirdPillarAmount,
        thirdPillarRecurring,
        recurringInvestment,
        fallbackApplied,
      };
    }

    function computeNetPropertyValue(formData = {}) {
      const assets = formData.assets || {};
      const rawRealEstate = formData.realEstate || formData.immobilier;
      const properties = Array.isArray(rawRealEstate?.properties)
        ? rawRealEstate.properties
        : Array.isArray(rawRealEstate)
        ? rawRealEstate
        : [];

      let total = 0;
      properties.forEach((property = {}) => {
        const value = toNumber(property.value || property.valeur || property.valeur_estimee);
        const mortgage = toNumber(property.mortgage || property.hypotheque || property.hypotheque_actuelle);
        total += Math.max(0, value - mortgage);
      });

      if (!properties.length) {
        const propertyValue = toNumber(assets.propertyValue || assets.realEstateValue);
        const mortgageBalance = toNumber(assets.mortgageBalance || assets.realEstateDebt);
        total += Math.max(0, propertyValue - mortgageBalance);
      }

      return total;
    }

    /* ---------- Tax / Savings ---------- */

    function computeTaxMetrics(formData, { householdAnnualIncome }) {
      const taxEngine = root.TaxEngine || root.SmartSaveTaxEngine;
      let taxData = null;

      if (taxEngine && typeof taxEngine.calculateAnnualTax === "function") {
        try {
          const result = taxEngine.calculateAnnualTax(formData) || null;
          if (result && typeof result === "object") {
            taxData = result;
          }
        } catch (_error) {
          taxData = null;
        }
      }

      const totalTax = toNumber(taxData?.total);
      let provisioned = toNumber(formData.assets?.taxProvision);
      if (provisioned <= 0) {
        provisioned = toNumber(taxData?.monthlyProvision?.advancePayments);
      }
      if (provisioned <= 0) {
        provisioned = toNumber(taxData?.monthlyProvision?.alreadyPaid);
      }

      const remaining = Math.max(0, totalTax - provisioned);
      const coverage = totalTax > 0 ? clamp(provisioned / totalTax, 0, 1) : 0;
      const pressure = householdAnnualIncome > 0 ? totalTax / householdAnnualIncome : 0;
      const monthlyPlanAmount = toNumber(taxData?.monthlyProvision?.monthlyAmount);
      const remainingMonthsRaw = toNumber(taxData?.monthlyProvision?.remainingMonths);
      const remainingMonths = remainingMonthsRaw > 0 ? remainingMonthsRaw : 0;
      const remainingMonthlyNeed = remainingMonths > 0 ? remaining / remainingMonths : remaining;
      const plannedCoverageAmount =
        monthlyPlanAmount > 0 && remainingMonths > 0
          ? monthlyPlanAmount * remainingMonths
          : 0;
      const planCoverageRatio =
        remaining > 0 ? clamp(plannedCoverageAmount / remaining, 0, 1) : 1;

      return {
        raw: taxData,
        metrics: {
          annualTax: totalTax,
          provisioned,
          remaining,
          coverage: clamp(coverage, 0, 1),
          pressure,
          monthlyPlanAmount,
          remainingMonths,
          remainingMonthlyNeed,
          planCoverageRatio,
          deadlineISO: taxData?.monthlyProvision?.deadline,
        },
      };
    }

    function computeAutomaticSavings(assets = {}) {
      const direct = toNumber(
        assets.savingsContributionAmount ||
          assets.savingsContributionMonthly ||
          assets.automaticSavingsMonthly
      );
      return Math.max(0, direct);
    }

    /* ---------- Pillar evaluations ---------- */

    function evaluateSecurityPillar({
      spendingRatio,
      safetyMonths,
      debtRatio,
      autoSavingsRatio,
    }) {
      const spendingScore = mapSpendingRatioToScore(spendingRatio);
      const savingsScore = mapSafetyMonthsToScore(safetyMonths);
      const debtScore = mapDebtRatioToScore(debtRatio);
      const autoSavingsScore = mapAutoSavingsToSecurityScore(autoSavingsRatio);

      let score =
        spendingScore * 0.3 +
        savingsScore * 0.4 +
        debtScore * 0.2 +
        autoSavingsScore * 0.1;

      if (safetyMonths <= 0) {
        score = Math.min(score, 25);
      } else if (safetyMonths < 0.5) {
        score = Math.min(score, 35);
      } else if (safetyMonths < 1) {
        score = Math.min(score, 45);
      } else if (safetyMonths < 2) {
        score = Math.min(score, 60);
      }

      return {
        score: clamp(score, 0, 100),
        breakdown: {
          spendingRatio,
          spendingScore,
          safetyMonths,
          savingsScore,
          debtRatio,
          debtScore,
          autoSavingsRatio,
          autoSavingsScore,
        },
      };
    }

    function evaluateAnticipationPillar({
      incomeStability,
      incomeEntries,
      taxMetrics,
      autoSavingsMonthly,
      monthlyIncome,
    }) {
      const incomeScore = mapIncomeStabilityToScore(
        incomeStability,
        incomeEntries,
        monthlyIncome
      );
      const coverageScore = mapTaxCoverageToScore(taxMetrics.coverage);
      const pressureScore = mapTaxPressureToScore(taxMetrics.pressure);
      const planningScore = mapPlanningSignalsToScore({
        autoSavingsMonthly,
        taxMonthlyPlan: taxMetrics.monthlyPlanAmount,
        remaining: taxMetrics.remaining,
        remainingMonthlyNeed: taxMetrics.remainingMonthlyNeed,
        remainingMonths: taxMetrics.remainingMonths,
        monthlyIncome,
        coverage: taxMetrics.coverage,
      });

      let score =
        incomeScore * 0.25 +
        coverageScore * 0.4 +
        pressureScore * 0.15 +
        planningScore * 0.2;

      if (taxMetrics.remaining > 0 && taxMetrics.coverage < 0.1) {
        score = Math.min(score, 50);
        if (taxMetrics.coverage === 0 && taxMetrics.remainingMonthlyNeed > monthlyIncome * 0.2) {
          score = Math.min(score, 40);
        }
      }

      return {
        score: clamp(score, 0, 100),
        breakdown: {
          incomeScore,
          taxCoverage: taxMetrics.coverage,
          coverageScore,
          taxPressure: taxMetrics.pressure,
          pressureScore,
          planningScore,
        },
      };
    }

    function evaluateGrowthPillar({
      investRatio,
      thirdPillarAmount,
      thirdPillarRecurring,
      recurringInvestment,
      securityScore,
      monthlyIncome,
      fallbackApplied,
    }) {
      const investmentScore = mapInvestmentRatioToScore(investRatio);
      const thirdPillarScore = mapThirdPillarToScore(
        thirdPillarAmount,
        thirdPillarRecurring
      );
      const combinedRecurring = recurringInvestment + thirdPillarRecurring;
      const recurringScore = mapRecurringInvestmentToScore(
        combinedRecurring,
        monthlyIncome
      );

      let score =
        investmentScore * 0.55 +
        thirdPillarScore * 0.25 +
        recurringScore * 0.2;

      if (fallbackApplied) {
        score = Math.min(score, 70);
      }

      if (securityScore < 30) {
        score = Math.min(score, 45);
      } else if (securityScore < 40) {
        score = Math.min(score, 55);
      } else if (securityScore < 50) {
        score = Math.min(score, 65);
      }

      return {
        score: clamp(score, 0, 100),
        breakdown: {
          investRatio,
          investmentScore,
          thirdPillarAmount,
          thirdPillarRecurring,
          thirdPillarScore,
          recurringInvestment,
          combinedRecurring,
          recurringScore,
          securityScore,
        },
      };
    }

    /* ---------- Pillar score helpers ---------- */

    function mapSpendingRatioToScore(ratio) {
      if (ratio == null) return 45;
      if (ratio <= 0.4) return 95;
      if (ratio <= 0.55) return 85;
      if (ratio <= 0.7) return 70;
      if (ratio <= 0.85) return 55;
      if (ratio <= 1) return 40;
      if (ratio <= 1.2) return 30;
      return 20;
    }

    function mapSafetyMonthsToScore(months) {
      if (months >= 6) return 95;
      if (months >= 4) return 85;
      if (months >= 3) return 75;
      if (months >= 2) return 60;
      if (months >= 1) return 45;
      if (months > 0) return 30;
      return 15;
    }

    function mapDebtRatioToScore(ratio) {
      if (ratio == null) return 50;
      if (ratio <= 0.08) return 95;
      if (ratio <= 0.15) return 85;
      if (ratio <= 0.25) return 65;
      if (ratio <= 0.35) return 45;
      if (ratio <= 0.5) return 30;
      return 20;
    }

    function mapAutoSavingsToSecurityScore(ratio) {
      if (ratio == null || ratio <= 0) return 25;
      if (ratio >= 0.12) return 85;
      if (ratio >= 0.08) return 70;
      if (ratio >= 0.04) return 55;
      return 40;
    }

    function mapIncomeStabilityToScore(stability, entries, monthlyIncome) {
      if (monthlyIncome <= 0) return 40;
      const norm = String(stability || "").toLowerCase();
      let base = 65;
      if (norm === "stable") base = 85;
      else if (norm === "variable") base = 55;

      const hasIndependent =
        Array.isArray(entries) &&
        entries.some((entry = {}) =>
          String(entry.employmentStatus || "").toLowerCase().includes("indep")
        );
      if (hasIndependent) base -= 8;

      return clamp(base, 30, 90);
    }

    function mapTaxCoverageToScore(coverage) {
      if (!Number.isFinite(coverage)) return 20;
      if (coverage >= 0.95) return 95;
      if (coverage >= 0.85) return 90;
      if (coverage >= 0.6) return 70;
      if (coverage >= 0.3) return 50;
      if (coverage > 0) return 30;
      return 15;
    }

    function mapTaxPressureToScore(pressure) {
      if (!Number.isFinite(pressure)) return 55;
      if (pressure <= 0.1) return 85;
      if (pressure <= 0.15) return 70;
      if (pressure <= 0.2) return 50;
      if (pressure <= 0.25) return 35;
      return 25;
    }

    function mapPlanningSignalsToScore({
      autoSavingsMonthly,
      taxMonthlyPlan,
      remaining,
      remainingMonthlyNeed,
      remainingMonths,
      monthlyIncome,
      coverage,
    }) {
      const income = Math.max(monthlyIncome, 1);
      const plan = Math.max(0, taxMonthlyPlan);
      const savings = Math.max(0, autoSavingsMonthly);
      const combinedPlan = plan + savings;

      let score = 25;

      if (remaining <= 0) {
        score += combinedPlan > 0 ? 20 : 10;
      } else if (combinedPlan <= 0) {
        score -= coverage < 0.2 ? 10 : 5;
      } else {
        const coverageRatio = remainingMonthlyNeed > 0 ? combinedPlan / remainingMonthlyNeed : 0;
        if (coverageRatio >= 1.1) score += 30;
        else if (coverageRatio >= 0.9) score += 22;
        else if (coverageRatio >= 0.6) score += 15;
        else if (coverageRatio >= 0.3) score += 8;
        else score += 3;

        if (remainingMonths > 0 && coverageRatio < 0.6 && remainingMonthlyNeed > income * 0.2) {
          score -= 8;
        }
      }

      const effortRatio = combinedPlan / income;
      if (effortRatio >= 0.15) score += 10;
      else if (effortRatio >= 0.1) score += 7;
      else if (effortRatio >= 0.05) score += 4;

      return clamp(score, 10, 95);
    }

    function mapInvestmentRatioToScore(ratio) {
      if (!Number.isFinite(ratio) || ratio <= 0) return 30;
      if (ratio >= 0.4) return 95;
      if (ratio >= 0.25) return 80;
      if (ratio >= 0.15) return 65;
      if (ratio >= 0.08) return 50;
      if (ratio >= 0.04) return 40;
      return 32;
    }

    function mapThirdPillarToScore(amount, recurring) {
      const annualRecurring = Math.max(0, recurring) * 12;
      const total = Math.max(0, amount) + annualRecurring;
      if (total <= 0) return 30;
      if (total >= 50000) return 95;
      if (total >= 20000) return 80;
      if (total >= 10000) return 65;
      if (total >= 5000) return 50;
      return 40;
    }

    function mapRecurringInvestmentToScore(value, monthlyIncome) {
      const amount = Math.max(0, value);
      if (amount <= 0) return 30;
      const income = Math.max(monthlyIncome, 1);
      const ratio = amount / income;
      if (ratio >= 0.15) return 90;
      if (ratio >= 0.1) return 75;
      if (ratio >= 0.06) return 60;
      if (ratio >= 0.03) return 45;
      return 35;
    }

    /* ---------- Sub-score helpers for details ---------- */

    function scoreIncome(monthly, personal) {
      if (monthly <= 0) return 6;
      const stability = String(personal?.incomeStability || "").toLowerCase();
      let base = 10;
      if (monthly >= 8000) base = 18;
      else if (monthly >= 5000) base = 15;
      else if (monthly >= 3500) base = 12;
      if (stability === "stable") base += 2;
      if (stability === "variable") base -= 2;
      return clamp(base, 4, 20);
    }

    function mapSpendingSubScore(ratio) {
      if (ratio == null) return 10;
      if (ratio <= 0.5) return 20;
      if (ratio <= 0.7) return 17;
      if (ratio <= 0.85) return 13;
      if (ratio <= 1) return 10;
      if (ratio <= 1.2) return 7;
      return 4;
    }

    function mapSafetySubScore(months) {
      if (months >= 6) return 20;
      if (months >= 3) return 16;
      if (months >= 1) return 10;
      if (months > 0) return 6;
      return 4;
    }

    function mapDebtSubScore(ratio) {
      if (ratio == null) return 8;
      if (ratio <= 0.1) return 15;
      if (ratio <= 0.2) return 12;
      if (ratio <= 0.3) return 9;
      if (ratio <= 0.45) return 6;
      return 3;
    }

    function mapTaxSubScore(coverage, pressure) {
      const covScore = mapTaxCoverageToScore(coverage);
      const pressureScore = mapTaxPressureToScore(pressure);
      return clamp(Math.round(covScore * 0.6 + pressureScore * 0.4) / 10, 0, 10);
    }

    function mapInvestmentSubScore(ratio) {
      if (!Number.isFinite(ratio) || ratio <= 0) return 3;
      if (ratio >= 0.4) return 15;
      if (ratio >= 0.25) return 12;
      if (ratio >= 0.15) return 10;
      if (ratio >= 0.08) return 7;
      return 5;
    }

    /* ---------- Aggregation & output ---------- */

    function computeGeometricMean(pillars) {
      const secure = Math.max(1, pillars.securite.score) / 100;
      const anticipate = Math.max(1, pillars.anticipation.score) / 100;
      const grow = Math.max(1, pillars.croissance.score) / 100;

      const raw =
        Math.pow(secure, WEIGHTS.security) *
        Math.pow(anticipate, WEIGHTS.anticipation) *
        Math.pow(grow, WEIGHTS.growth);

      return clamp(Math.round(raw * 1000) / 10, 0, 100);
    }

    function determineLevel(score) {
      const entry = LEVELS.find((level) => score < level.max) || LEVELS[LEVELS.length - 1];
      return entry.label;
    }

    function buildRecommendations(pillars, taxMetrics = {}, options = {}) {
      const recs = [];
      const hasShortTermPlan = Boolean(options?.hasShortTermPlan);

      const security = pillars.securite || {};
      const anticipation = pillars.anticipation || {};
      const growth = pillars.croissance || {};

      const safetyMonths = security.breakdown?.safetyMonths ?? 0;
      const spendingRatio = security.breakdown?.spendingRatio;
      const debtRatio = security.breakdown?.debtRatio;
      const autoSavingsRatio = security.breakdown?.autoSavingsRatio ?? 0;

      if (security.score < 55) {
        if (safetyMonths < 1) {
          recs.push("Constitue en priorité un mois de dépenses sur un compte facilement accessible.");
        } else if (Number.isFinite(spendingRatio) && spendingRatio > 0.9) {
          recs.push(
            hasShortTermPlan
              ? "Préserve ton plan court terme et ajuste d'abord les charges fixes/obligatoires pour rester sous 80 % du revenu net."
              : "Resserre tes dépenses récurrentes pour rester sous 80 % de ton revenu net."
          );
        } else if (Number.isFinite(debtRatio) && debtRatio > 0.25) {
          recs.push("Allège tes dettes pour ramener les mensualités sous 15 % de ton revenu.");
        } else if (autoSavingsRatio < 0.04) {
          recs.push("Automatise au moins 4 % de ton revenu vers une épargne de précaution.");
        }
      }

      if (anticipation.score < 55) {
        if ((taxMetrics.coverage ?? 0) < 0.5) {
          recs.push("Provisionne ton impôt annuel : vise une couverture proche de 100 % avant l'échéance fiscale.");
        } else if ((taxMetrics.remaining ?? 0) > 0 && (taxMetrics.monthlyPlanAmount ?? 0) <= 0) {
          recs.push("Planifie un versement automatique dédié aux impôts pour lisser la charge restante.");
        } else {
          recs.push("Sécurise ta trésorerie avec des versements programmés (impôts et épargne) adaptés à ton budget.");
        }
      }

      if (growth.score < 55) {
        if (security.score < 45) {
          recs.push("Renforce d'abord ton pilier Sécurité avant d'accélérer sur les placements.");
        } else if ((taxMetrics.coverage ?? 0) < 0.8) {
          recs.push("Ajuste ton plan d'impôts pour éviter que la croissance n'érode ta trésorerie.");
        } else if ((growth.breakdown?.thirdPillarAmount ?? 0) <= 0) {
          recs.push("Ouvre ou alimente un 3ᵉ pilier pour bénéficier du levier fiscal.");
        } else {
          recs.push("Augmente progressivement tes versements automatiques sur les placements long terme.");
        }
      }

      if (!recs.length) {
        recs.push(
          hasShortTermPlan
            ? "Ta structure financière est équilibrée et ton objectif court terme est planifié : continue sur cette lancée."
            : "Ta structure financière est équilibrée : continue sur cette lancée."
        );
      }

      return recs;
    }

    /* ---------- Utilities ---------- */

    function sumMonthly(list) {
      if (!Array.isArray(list)) return 0;
      return list.reduce((sum, item = {}) => {
        const amount = toNumber(item.amount);
        if (!amount) return sum;
        const freq = String(item.frequency || item.frequence || "mensuel").toLowerCase();
        if (freq.startsWith("annu")) return sum + amount / 12;
        if (freq.startsWith("trim")) return sum + amount / 3;
        if (freq.startsWith("hebdo")) return sum + (amount * 52) / 12;
        return sum + amount;
      }, 0);
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function toNumber(value) {
      if (typeof value === "number") return Number.isFinite(value) ? value : 0;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (value == null) return 0;
      if (typeof value === "string") {
        const original = value.trim();
        if (!original) return 0;
        const negative = /^-/.test(original.replace(/\s+/g, ""));
        let normalized = original
          .replace(/[^0-9,.-]+/gu, "")
          .replace(/(?!^)-/g, "");
        if (!normalized) return 0;
        const lastComma = normalized.lastIndexOf(",");
        const lastDot = normalized.lastIndexOf(".");
        let decimalIndex = Math.max(lastComma, lastDot);
        if (decimalIndex >= 0) {
          const decimals = normalized.length - decimalIndex - 1;
          if (decimals === 3 && original.indexOf(",") === -1) {
            normalized = normalized.replace(/\./, "");
            decimalIndex = -1;
          }
        }
        if (decimalIndex === -1) {
          const integerOnly = normalized.replace(/[^0-9-]/g, "");
          return Number(integerOnly) || 0;
        }
        const integerPart = normalized
          .slice(0, decimalIndex)
          .replace(/[^0-9-]/g, "");
        const decimalPart = normalized
          .slice(decimalIndex + 1)
          .replace(/[^0-9]/g, "");
        if (!integerPart && !decimalPart) return 0;
        const combined = `${integerPart || (negative ? "-0" : "0")}.${decimalPart}`;
        const parsed = Number(combined);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    }

    return {
      calculateScore,
    };
  })();

  root.FinancialScoreEngine = FinancialScoreEngine;
})(typeof window !== "undefined" ? window : globalThis);
