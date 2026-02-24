(function (root) {
  const ProjectionEngine = (function () {
    const DEFAULT_RETIREMENT_CONFIG = {
      inflation: 0.02,
      retirementAge: 65,
      annuitizationYears: 25,
      swr: 0.03,
      retirementSWR: 0.035,
      retirementInvestmentUtilizationShare: 0.6,
      retirementSavingsCapRate: 0.2,
      returns: {
        pillar3Nominal: 0.03,
        annuitizationNominal: 0.02,
        investNominal: 0.045,
        savingsNominal: 0.015,
      },
      fees: {
        pillar3: 0.01,
        annuitization: 0.012,
        etf: 0.008,
        lpp: 0.005,
      },
      avs: {
        minMonthly: 1225,
        maxMonthly: 2450,
        minIncomeThreshold: 14400,
        maxIncomeThreshold: 88200,
        salaryGrowthRate: 0.015,
        startWorkingAge: 21,
        maxCotisationYears: 44,
      },
      lpp: {
        deductionCoordination: 25725,
        maxInsurable: 88200,
        avgReturnNominal: 0.02,
        conversionRateOblig: 0.068,
        conversionRateSupra: 0.055,
        obligatoryThreshold: 70500,
        minAffiliationSalary: 22050,
        salaryGrowthRate: 0.015,
        contributionRatesByAge: [
          { maxAge: 34, rate: 0.085 },
          { maxAge: 44, rate: 0.125 },
          { maxAge: 54, rate: 0.175 },
          { maxAge: 65, rate: 0.22 },
        ],
      },
      swrCushions: {
        currentAccountMonths: 2,
        emergencyMinMonths: 3,
        emergencyMaxMonths: 6,
      },
    };
    function calculateProjection(formData = {}, options = {}) {
      const context = buildContext(formData, options);

      const incomeInfo = computeIncome(context);
      const expensesInfo = computeExpenses(context);

      const keepHistory = options.keepHistory === true;
      const captureFlows = options.captureFlows === true;
      const startDate = options.startDate ? new Date(options.startDate) : new Date();
      const taxMonth = sanitizeMonth(options.taxMonth, 3);
      const shortTermPayoutPlan = buildShortTermPayoutPlan(context, options);
      const currentScenario = createScenarioState(
        context,
        incomeInfo,
        expensesInfo,
        "current",
        keepHistory,
        captureFlows,
        taxMonth
      );
      const smartScenario = createScenarioState(
        context,
        incomeInfo,
        expensesInfo,
        "smartsave",
        keepHistory,
        captureFlows,
        taxMonth
      );

      const months = options.months || (options.years || 10) * 12;

      for (let i = 0; i < months; i++) {
        const iterationDate = addMonths(startDate, i);
        const monthNumber = iterationDate.getMonth() + 1;
        const projectionYearIndex = Math.floor(i / 12) + 1;

        if (captureFlows) {
          startMonthlyFlow(currentScenario, iterationDate);
          startMonthlyFlow(smartScenario, iterationDate);
        }

        applyMonthlyInterests(currentScenario, context, iterationDate);
        applyMonthlyInterests(smartScenario, context, iterationDate);

        simulateMonth(
          currentScenario,
          context,
          incomeInfo,
          expensesInfo,
          iterationDate,
          applyCurrentStrategy
        );

        simulateMonth(
          smartScenario,
          context,
          incomeInfo,
          expensesInfo,
          iterationDate,
          applySmartSaveStrategy
        );

        if (monthNumber === taxMonth) {
          settleAnnualTaxes(currentScenario, iterationDate);
          settleAnnualTaxes(smartScenario, iterationDate);
        }

        if (shouldSettleShortTermGoal(shortTermPayoutPlan, monthNumber, projectionYearIndex)) {
          settleShortTermGoal(currentScenario, shortTermPayoutPlan);
          settleShortTermGoal(smartScenario, shortTermPayoutPlan);
        }

        if (keepHistory) {
          recordHistory(currentScenario, iterationDate);
          recordHistory(smartScenario, iterationDate);
        }

        if (captureFlows) {
          finalizeMonthlyFlow(currentScenario);
          finalizeMonthlyFlow(smartScenario);
        }
      }

    return buildResult(currentScenario, smartScenario, keepHistory);
  }

    function calculateRetirement(formData = {}, options = {}) {
      const context = buildContext(formData, options);
      const config = buildRetirementConfig(options);
      return buildRetirementSnapshot(context, config);
    }

    function buildRetirementSnapshot(context, config) {
      const incomeInfo = computeIncome(context);
      const expenses = computeExpenses(context);
      const monthlyNeed = Math.max(
        3000,
        Math.max(0, expenses.fixed + expenses.variable),
        incomeInfo.monthlyNetIncome * 0.75
      );
      const retirementMeta = context.retirement || {};
      const yearsToRetirement = Math.max(0, retirementMeta.yearsToRetirement || 0);
      const age = Math.max(0, retirementMeta.age || 0);
      const retirementAge = retirementMeta.retirementAge || config.retirementAge;
      const inflationRate = Number.isFinite(config.inflation) ? config.inflation : 0;

      const contributions = collectRetirementContributions(context);
      const monthlyCapRate =
        typeof config.retirementSavingsCapRate === "number"
          ? config.retirementSavingsCapRate
          : DEFAULT_RETIREMENT_CONFIG.retirementSavingsCapRate;
      const monthlyCap = Math.max(0, incomeInfo.monthlyNetIncome * monthlyCapRate);
      const annualCap = monthlyCap * 12;
      const declaredAnnual = Math.max(0, contributions.totalMonthly * 12);
      const scale =
        declaredAnnual > 0 ? Math.min(1, annualCap / declaredAnnual) : 0;
      const scaledMonthlyPillar3 = contributions.monthlyPillar3 * scale;
      const scaledMonthlyInvestments = contributions.monthlyInvestments * scale;

      const existingPillar3 = Math.max(0, context.assets.pillar3 || 0);
      const pillar3NominalCapital = accumulateCapitalFromAnnualContributions(
        deflateValue(existingPillar3, inflationRate, yearsToRetirement),
        scaledMonthlyPillar3 * 12,
        realNetReturn(config.returns.pillar3Nominal, config.fees.pillar3, inflationRate),
        yearsToRetirement
      );
      const pillar3RealCapital = pillar3NominalCapital;
      const pillar3Income = projectPillar3IncomeFromCapital(pillar3RealCapital, config);

      const existingInvestNominal =
        Math.max(0, context.assets.savings || 0) +
        Math.max(0, context.assets.blocked || 0) +
        Math.max(0, context.assets.investments || 0);
      const existingInvestReal = deflateValue(existingInvestNominal, inflationRate, yearsToRetirement);
      const investNominalCapital = accumulateCapitalFromAnnualContributions(
        existingInvestReal,
        scaledMonthlyInvestments * 12,
        realNetReturn(config.returns.investNominal, config.fees.etf, inflationRate),
        yearsToRetirement
      );
      const investRealCapital = investNominalCapital;

      const savingsProjection = projectSavingsAndInvestments(
        investRealCapital,
        config,
        monthlyNeed,
        expenses,
        context.loans,
        incomeInfo
      );

      const inflationFactor = Math.pow(1 + inflationRate, yearsToRetirement);
      const avsIncome = deflateValue(
        projectAvsIncome(context, config, incomeInfo, { age, retirementAge, yearsToRetirement }),
        inflationRate,
        yearsToRetirement
      );
      const lppIncome = deflateValue(
        projectLppIncome(context, config, incomeInfo, {
          age,
          retirementAge,
          yearsToRetirement,
        }),
        inflationRate,
        yearsToRetirement
      );

      const otherIncome = projectOtherRetirementIncome(context, config, yearsToRetirement);

      const totalInstitutional = avsIncome + lppIncome;
      const totalPersonal = pillar3Income + savingsProjection.monthlyIncome + otherIncome;
      const totalMonthlyRetirementIncome = totalInstitutional + totalPersonal;
      const gap = totalMonthlyRetirementIncome - monthlyNeed;

      return {
        monthlyNeed,
        monthlyNetIncome: incomeInfo.monthlyNetIncome,
        yearsToRetirement,
        age,
        retirementAge,
        inflationFactor,
        avsIncome,
        lppIncome,
        pillar3Income,
        savingsIncome: savingsProjection.monthlyIncome,
        savingsDetails: savingsProjection,
        otherIncome,
        totalInstitutional,
        totalPersonal,
        totalMonthlyRetirementIncome,
        totalMonthlyGap: gap,
        status: gap >= 0 ? "surplus" : "deficit",
      };
    }

    function buildRetirementConfig(options = {}) {
      const globalConfig =
        (root && root.SMARTSAVE_RETIREMENT_CONFIG) ||
        (root && root.CONFIG && root.CONFIG.retirement) ||
        null;
      const runtime = options.retirement || options.retirementConfig || {};
      const mergedGlobal = mergeConfig(DEFAULT_RETIREMENT_CONFIG, globalConfig);
      return mergeConfig(mergedGlobal, runtime);
    }

    function deflateValue(value, inflation, years) {
      const nominal = Number.isFinite(value) ? value : toNumber(value);
      const rate = Number.isFinite(inflation) ? inflation : 0;
      const period = Math.max(0, Math.round(years));
      if (!period || rate === 0) return nominal;
      return nominal / Math.pow(1 + rate, period);
    }

    function accumulateCapitalFromAnnualContributions(capital, annualContribution, annualReturn, years) {
      const contribution = Math.max(0, annualContribution);
      let result = Math.max(0, capital);
      const growth = Number.isFinite(annualReturn) ? annualReturn : 0;
      if (years <= 0) return result;
      for (let i = 0; i < years; i++) {
        result = (result + contribution) * (1 + growth);
      }
      return result;
    }

    function collectRetirementContributions(context) {
      const raw = context.raw || {};
      const assets = raw.assets || {};
      const monthlyPillar3 =
        toNumber(assets.thirdPillarContributionMonthly) ||
        toNumber(assets.thirdPillarContribution) ||
        0;
      const investments = ensureArray(raw.investments?.items);
      const monthlyInvestments = investments.reduce((sum, item = {}) => {
        const hasMonthly = `${item.hasMonthly || ""}`.toLowerCase();
        if (hasMonthly === "oui" || hasMonthly === "true") {
          return sum + toNumber(item.monthlyAmount);
        }
        return sum;
      }, 0);
      return {
        monthlyPillar3,
        monthlyInvestments,
        totalMonthly: monthlyPillar3 + monthlyInvestments,
      };
    }

    function projectSavingsAndInvestments(capitalReal, config, monthlyNeed, expenses, loans, incomeInfo) {
      const totalRealCapital = Math.max(0, capitalReal);
      const monthlyDebt = sumLoanPayments(loans);
      const debtRatio =
        incomeInfo.monthlyNetIncome > 0 ? monthlyDebt / incomeInfo.monthlyNetIncome : 0;

      const fixedExpenses = Math.max(0, expenses.fixed + expenses.variable);
      const currentAccountCushion = Math.max(
        fixedExpenses * (config.swrCushions.currentAccountMonths || 2),
        5000
      );
      const coverageMonths = monthlyNeed > 0 ? totalRealCapital / monthlyNeed : 0;
      let emergencyMonths = Math.max(
        config.swrCushions.emergencyMinMonths,
        Math.min(
          config.swrCushions.emergencyMaxMonths,
          Math.round(Math.min(6, coverageMonths || 0))
        )
      );
      if (debtRatio > 0.4) {
        emergencyMonths = Math.min(
          config.swrCushions.emergencyMaxMonths,
          emergencyMonths + 1
        );
      }
      const emergencyCushion = Math.max(monthlyNeed * emergencyMonths, 15000);
      const totalCushions = currentAccountCushion + emergencyCushion;
      const investableCapital = Math.max(0, totalRealCapital - totalCushions);
      const swr = Number.isFinite(config.retirementSWR) ? config.retirementSWR : config.swr;
      const annualIncome = investableCapital * swr;
      const monthlyIncome = annualIncome / 12;
      return {
        monthlyIncome,
        totalRealCapital,
        investableCapital,
        monthlyDebt,
        debtRatio,
        currentAccountCushion,
        emergencyCushion,
        totalCushions,
        emergencyMonths,
        coverageMonths,
      };
    }

    function projectPillar3IncomeFromCapital(capital, config) {
      const adjustedCapital = Math.max(0, capital);
      const rRealAnnuitization = realNetReturn(
        config.returns.annuitizationNominal,
        config.fees.annuitization,
        config.inflation
      );
      return calculateAnnuity(adjustedCapital, rRealAnnuitization, config.annuitizationYears);
    }

    function projectAvsIncome(context, config, incomeInfo, meta = {}) {
      const user = context.retirementUserData || {};
      const userEstimate =
        toNumber(user.avs_estime_mensuel) ||
        toNumber(user.avsEstimate) ||
        toNumber(user.avs_estimatedMonthly) ||
        0;
      if (userEstimate > 0) {
        return clamp(userEstimate, config.avs.minMonthly, config.avs.maxMonthly);
      }
      const grossAnnual = Math.max(0, computeGrossAnnual(context));
      const annualNet =
        incomeInfo.monthlyNetIncome * 12 + Math.max(0, toNumber(incomeInfo.annualThirteenth || 0));
      const baseGross =
        grossAnnual > 0 ? grossAnnual : annualNet * approximateGrossCoefficient(context);
      const salaryGrowthRate = config.avs.salaryGrowthRate;
      const minIncome = config.avs.minIncomeThreshold;
      const maxIncome = config.avs.maxIncomeThreshold;
      const yearsCotisedSoFar = Math.min(
        config.avs.maxCotisationYears,
        Math.max(
          0,
          toNumber(user.annees_cotisees) ||
            Math.max(0, Math.floor((meta.age || 0) - config.avs.startWorkingAge))
        )
      );
      const yearsRemaining = Math.max(
        0,
        (meta.retirementAge || config.retirementAge) - (meta.age || 0)
      );
      const totalCoverageYears = Math.min(
        yearsCotisedSoFar + yearsRemaining,
        config.avs.maxCotisationYears
      );
      let totalLifetimeIncome = 0;
      let totalYearsWorked = 0;
      for (let year = 0; year < yearsCotisedSoFar; year++) {
        const salary = baseGross / Math.pow(1 + salaryGrowthRate, year);
        totalLifetimeIncome += Math.min(Math.max(0, salary), maxIncome);
        totalYearsWorked += 1;
      }
      for (let year = 0; year < yearsRemaining; year++) {
        const salary = baseGross * Math.pow(1 + salaryGrowthRate, year);
        totalLifetimeIncome += Math.min(Math.max(0, salary), maxIncome);
        totalYearsWorked += 1;
      }
      const averageIncome =
        totalYearsWorked > 0 ? totalLifetimeIncome / totalYearsWorked : baseGross;
      const cappedAvgIncome = Math.max(minIncome, Math.min(maxIncome, averageIncome));
      const incomeFactor =
        maxIncome > minIncome ? (cappedAvgIncome - minIncome) / (maxIncome - minIncome) : 0;
      const theoreticalFullRente =
        config.avs.minMonthly +
        (config.avs.maxMonthly - config.avs.minMonthly) *
          clamp(incomeFactor, 0, 1);
      const completeness = totalCoverageYears / config.avs.maxCotisationYears;
      const finalRente = theoreticalFullRente * Math.min(1, completeness);
      return finalRente;
    }

    function projectLppIncome(context, config, incomeInfo, meta = {}) {
      const lppConfig = config.lpp || {};
      const yearsToRetirement = Math.max(0, meta.yearsToRetirement || 0);
      if (yearsToRetirement <= 0) return 0;
      const user = context.retirementUserData || {};
      const occupationRate = Math.min(
        1,
        Math.max(
          0,
          toNumber(user.taux_occupation) / 100 ||
            toNumber(user.occupationRate) / 100 ||
            1
        )
      );
      const baseGrossAnnual = Math.max(0, computeGrossAnnual(context));
      const fallbackGross = Math.max(
        0,
        incomeInfo.monthlyNetIncome * 12 + Math.max(0, toNumber(incomeInfo.annualThirteenth || 0))
      );
      const startingGross = baseGrossAnnual > 0 ? baseGrossAnnual : fallbackGross;
      const minAffiliationSalary = lppConfig.minAffiliationSalary * occupationRate;
      const deduction = lppConfig.deductionCoordination * occupationRate;
      const salaryGrowthRate = lppConfig.salaryGrowthRate;
      const maxInsurable = lppConfig.maxInsurable;
      const conversionRate = lppConfig.conversionRateOblig;
      const supraConversionRate = lppConfig.conversionRateSupra;
      const rReal = realNetReturn(lppConfig.avgReturnNominal, config.fees.lpp, config.inflation);
      const contributionOverride = parseLppContributionRate(user.taux_cotisation_lpp);
      let obligatoryCapital = 0;
      let supraCapital = 0;
      for (let year = 0; year < yearsToRetirement; year++) {
        const ageInYear = Math.round((meta.age || 0) + year);
        const projectedGross = Math.min(
          maxInsurable,
          startingGross * Math.pow(1 + salaryGrowthRate, year)
        );
        const projectedEffective = projectedGross * occupationRate;
        if (projectedEffective <= minAffiliationSalary) {
          continue;
        }
        const insuredSalary = Math.max(0, projectedEffective - deduction);
        const obligatoryInsured = Math.min(insuredSalary, lppConfig.obligatoryThreshold);
        const supraInsured = Math.max(0, insuredSalary - lppConfig.obligatoryThreshold);
        const contributionRate =
          Number.isFinite(contributionOverride) && contributionOverride > 0
            ? contributionOverride
            : resolveLppContributionRate(ageInYear, lppConfig.contributionRatesByAge);
        const obligatoryContribution = obligatoryInsured * contributionRate;
        const supraContribution = supraInsured * contributionRate;
        obligatoryCapital = (obligatoryCapital + obligatoryContribution) * (1 + rReal);
        supraCapital = (supraCapital + supraContribution) * (1 + rReal);
      }
      const deflatedObligatory = deflateValue(
        obligatoryCapital,
        config.inflation,
        yearsToRetirement
      );
      const deflatedSupra = deflateValue(supraCapital, config.inflation, yearsToRetirement);
      const annualRente =
        deflatedObligatory * conversionRate +
        deflatedSupra * supraConversionRate;
      return Math.max(0, annualRente / 12);
    }

    function projectOtherRetirementIncome(context, config, yearsToRetirement) {
      const raw = context.raw || {};
      const rentalMonthly =
        toNumber(raw.revenu_locatif_mensuel) ||
        toNumber(raw.rentalIncomeMonthly) ||
        toNumber(raw.revenuLocatifMensuel);
      let monthly = rentalMonthly;
      if (!monthly) {
        const hasProperty =
          (raw.bien_immobilier || "").toString().toLowerCase() === "oui" ||
          (raw.credits?.isOwner || "").toString().toLowerCase() === "oui";
        const propertyValue =
          toNumber(raw.propertyValue) ||
          toNumber(raw.credits?.propertyValue) ||
          toNumber(raw.valeur_bien);
        if (hasProperty && propertyValue > 0) {
          const annual = propertyValue * 0.04;
          monthly = annual / 12;
        }
      }
      return deflateValue(monthly, config.inflation, yearsToRetirement);
    }

    function mergeConfig(base, override) {
      if (!override) return base;
      const result = Array.isArray(base) ? base.slice() : { ...base };
      Object.keys(override).forEach((key) => {
        const value = override[key];
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          base &&
          typeof base[key] === "object" &&
          !Array.isArray(base[key])
        ) {
          result[key] = mergeConfig(base[key], value);
        } else {
          result[key] = value;
        }
      });
      return result;
    }

    function resolveLppContributionRate(age, segments = []) {
      if (!Array.isArray(segments) || !segments.length) return 0.12;
      for (const segment of segments) {
        if (segment && Number.isFinite(segment.maxAge) && age <= segment.maxAge) {
          return segment.rate || 0.12;
        }
      }
      const last = segments[segments.length - 1];
      return last?.rate ?? 0.12;
    }

    function parseLppContributionRate(value) {
      if (value === undefined || value === null || value === "") return null;
      const numeric = toNumber(value);
      if (!Number.isFinite(numeric)) return null;
      return numeric > 1 ? numeric / 100 : numeric;
    }

    function normalizeAnnualRate(value) {
      if (value === undefined || value === null || value === "") return null;
      const numeric = toNumber(value);
      if (!Number.isFinite(numeric)) return null;
      return numeric > 1 ? numeric / 100 : numeric;
    }

    function buildContext(formData, options) {
      const startDate = options.startDate ? new Date(options.startDate) : new Date();
      const formRates = formData.rates || {};
      const optionRates = options.rates || {};
      const investmentItems = ensureArray(formData.investments?.items);
      const investmentItemsTotal = investmentItems.reduce(
        (sum, item = {}) => sum + Math.max(0, toNumber(item.amount ?? item.montant)),
        0
      );
      const weightedInvestmentRate = (() => {
        let weightedSum = 0;
        let total = 0;
        investmentItems.forEach((item = {}) => {
          const amount = Math.max(0, toNumber(item.amount ?? item.montant));
          if (!amount) return;
          const rate =
            normalizeAnnualRate(
              item.annualReturnPct ??
                item.annualReturn ??
                item.expectedReturn ??
                item.rate
            ) ?? null;
          if (rate === null) return;
          weightedSum += amount * rate;
          total += amount;
        });
        if (!total) return null;
        return weightedSum / total;
      })();
      const defaultRates = {
        savings: resolveFallbackRate(formRates.savings, 0.018),
        blocked: resolveFallbackRate(formRates.blocked, 0.02),
        pillar3: resolveFallbackRate(formRates.pillar3, 0.03),
        investments: resolveFallbackRate(
          formRates.investments,
          weightedInvestmentRate ?? 0.05
        ),
      };

      const rates = {
        savings: normaliseRate(
          Object.prototype.hasOwnProperty.call(optionRates, "savings")
            ? optionRates.savings
            : formRates.savings ?? defaultRates.savings,
          defaultRates.savings
        ),
        blocked: normaliseRate(
          Object.prototype.hasOwnProperty.call(optionRates, "blocked")
            ? optionRates.blocked
            : formRates.blocked ?? defaultRates.blocked,
          defaultRates.blocked
        ),
        pillar3: normaliseRate(
          Object.prototype.hasOwnProperty.call(optionRates, "pillar3")
            ? optionRates.pillar3
            : formRates.pillar3 ?? defaultRates.pillar3,
          defaultRates.pillar3
        ),
        investments: normaliseRate(
          Object.prototype.hasOwnProperty.call(optionRates, "investments")
            ? optionRates.investments
            : formRates.investments ?? defaultRates.investments,
          defaultRates.investments
        ),
      };

      const personal = formData.personal || {};
      const retirementInputs = formData.retirementUserData || formData.retirement || {};
      const birthDate = parseDate(personal.birthDate || formData.birthDate);
      const age = calculateAge(birthDate, startDate);
      const retirementAge =
        resolveRetirementAge(retirementInputs) || DEFAULT_RETIREMENT_CONFIG.retirementAge;
      const yearsToRetirement = Math.max(0, retirementAge - age);

      return {
        raw: formData,
        incomes: ensureArray(formData.incomes?.entries),
        spouseIncome: toNumber(
          formData.incomes?.spouseNetIncome ??
            formData.incomes?.spouseIncome ??
            formData.spouseIncome ??
            0
        ),
        spouseIncomeFrequency:
          formData.incomes?.spouseIncomeFrequency ??
          formData.incomes?.spouseNetIncomeFrequency ??
          formData.incomes?.spouseIncomePeriod ??
          formData.spouseIncomeFrequency ??
          "mensuel",
        personal: formData.personal || {},
        expenses: {
          fixed: ensureArray(formData.expenses?.fixed),
          variable: ensureArray(formData.expenses?.variable),
          exceptional: ensureArray(formData.expenses?.exceptional),
        },
        exceptionalAnnual: ensureArray(formData.exceptionalAnnual || formData.expenses?.annualExtra),
        loans: ensureArray(
          Array.isArray(formData.credits?.loans) ? formData.credits.loans : formData.loans
        ),
        assets: {
          current: toNumber(
            formData.assets?.currentAccount ||
              formData.assets?.checking ||
              formData.assets?.paymentAccount ||
              formData.assets?.paymentBalance ||
              0
          ),
          savings: toNumber(
            formData.assets?.savingsAccount ||
              formData.assets?.securitySavings ||
              formData.assets?.savings ||
              formData.assets?.epargne ||
              0
          ),
          blocked: toNumber(
            formData.assets?.blockedAccount ||
              formData.assets?.blockedAccounts ||
              formData.assets?.securityBlocked ||
              formData.assets?.compteBloque ||
              0
          ),
          pillar3: toNumber(
            formData.assets?.thirdPillarAmount ||
              formData.assets?.pillar3 ||
              formData.assets?.pillar3a ||
              formData.assets?.pilier3a ||
              formData.assets?.troisiemePiliers ||
              0
          ),
          investments: toNumber(
            formData.assets?.investments ||
              formData.assets?.portefeuille ||
              formData.assets?.investmentAccount ||
              formData.assets?.portfolio ||
              formData.investments?.initial ||
              investmentItemsTotal ||
              0
          ),
          taxes: toNumber(
            formData.assets?.taxProvision ||
              formData.taxes?.provision ||
              formData.taxes?.alreadySaved ||
              0
          ),
          thirdPillarYTD: toNumber(
            formData.assets?.thirdPillarPaidYTD || formData.taxes?.thirdPillarPaidYTD || 0
          ),
          thirdPillarYTDYear: toNumber(
            formData.assets?.thirdPillarPaidYTDYear || formData.taxes?.thirdPillarPaidYTDYear || 0
          ),
          hasThirdPillarYTD:
            formData.assets?.thirdPillarPaidYTD != null ||
            formData.taxes?.thirdPillarPaidYTD != null,
        },
        goals: ensureArray(formData.goals),
        manualPlan: normaliseManualPlan(
          formData.currentPlan || formData.manualContributions,
          formData.assets || {},
          formData.investments || {}
        ),
        profile:
          formData.profile ||
          formData.personal?.priorityProfile ||
          formData.personal?.profilAllocation ||
          "equilibre",
        rates,
        defaultRates,
        startDate,
        retirementUserData: retirementInputs,
        retirement: {
          birthDate,
          age,
          retirementAge,
          yearsToRetirement,
        },
      };
    }

    function computeIncome(context) {
      let monthlyNet = 0;
      let thirteenthBase = 0;
      const thirteenthPayments = [];
      const personalStatus = (context.personal.employmentStatus || "").toLowerCase();

      context.incomes.forEach((income = {}) => {
        const amount = toNumber(income.amount);
        if (!amount) return;
        const type = String(income.amountType || "net").toLowerCase();
        const status = (income.employmentStatus || personalStatus).toLowerCase();
        const hasThirteenth = income.thirteenth === true || income.thirteenth === "oui";

        const coefficient =
          type === "brut"
            ? status.includes("indep") || status.includes("indépend")
              ? 0.75
              : 0.86
            : 1;

        const netMonthly = amount * coefficient;
        if (hasThirteenth) {
          monthlyNet += netMonthly;
          thirteenthBase += netMonthly;
          const rawMonth =
            income?.thirteenthMonth ??
            income?.thirteenthSalaryMonth ??
            income?.salary13Month ??
            income?.month13 ??
            12;
          const month = Math.max(1, Math.min(12, Number(rawMonth) || 12));
          thirteenthPayments.push({ month, amount: netMonthly });
        } else {
          monthlyNet += netMonthly;
        }
      });
      const spouseMonthlyIncome = resolveSpouseMonthlyIncome(context);
      monthlyNet += spouseMonthlyIncome;

      return {
        monthlyNetIncome: monthlyNet,
        spouseMonthlyIncome,
        spouseAnnualIncome: spouseMonthlyIncome * 12,
        annualThirteenth: thirteenthBase,
        thirteenthReference: thirteenthBase,
        thirteenthPayments,
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

    function computeThirteenthForMonth(incomeInfo = {}, iterationDate = new Date()) {
      const month = (iterationDate instanceof Date ? iterationDate : new Date(iterationDate)).getMonth() + 1;
      const payments = Array.isArray(incomeInfo.thirteenthPayments)
        ? incomeInfo.thirteenthPayments
        : [];
      return payments.reduce((sum, item) => {
        const paymentMonth = Math.max(1, Math.min(12, Number(item?.month) || 12));
        if (paymentMonth !== month) return sum;
        return sum + Math.max(0, toNumber(item?.amount));
      }, 0);
    }

    function computeExpenses(context) {
      const fixed = sumMonthly(context.expenses.fixed);
      const variable = sumMonthly(context.expenses.variable);
      const exceptional =
        sumMonthly(context.expenses.exceptional) + sumMonthly(context.exceptionalAnnual);
      const debts = context.loans.reduce((sum, loan) => {        const amount = toNumber(loan?.monthlyAmount || loan?.monthly || loan?.mensualite);
        return sum + amount;
      }, 0);

      return {
        fixed,
        variable,
        exceptional,
        debts,
        total: fixed + variable + exceptional + debts,
      };
    }

    function createScenarioState(
      context,
      incomeInfo,
      expensesInfo,
      label,
      keepHistory,
      captureFlows,
      taxMonth
    ) {
      const startDate =
        context.startDate instanceof Date && !Number.isNaN(context.startDate.getTime())
          ? context.startDate
          : new Date();
      const startYear = startDate.getFullYear();
      const thirdPillarYTDYearRaw = toNumber(context.assets.thirdPillarYTDYear);
      const thirdPillarYTDYear = Math.round(thirdPillarYTDYearRaw) || startYear;
      const accounts = {
        current: context.assets.current,
        savings: context.assets.savings,
        blocked: context.assets.blocked,
        pillar3: context.assets.pillar3,
        investments: context.assets.investments,
        taxes: context.assets.taxes,
        thirdPillarYTD: context.assets.thirdPillarYTD || 0,
        thirdPillarYTDYear,
        hasThirdPillarYTD: Boolean(context.assets.hasThirdPillarYTD),
      };

      const fiscal = initialiseFiscalState(context, accounts, incomeInfo, taxMonth);

      return {
        label,
        accounts,
        incomeInfo,
        expensesInfo,
        fiscal,
        shortTerm: {
          paid: 0,
          shortage: 0,
        },
        contributions: {
          current: 0,
          savings: 0,
          blocked: 0,
          pillar3: 0,
          investments: 0,
          taxes: 0,
          debts: 0,
          goals: 0,
        },
        interestEarned: {
          savings: 0,
          blocked: 0,
          pillar3: 0,
          investments: 0,
        },
        debtActions: [],
        history: keepHistory ? [] : null,
        captureFlows: captureFlows === true,
        flowHistory: captureFlows ? [] : null,
        currentFlow: null,
      };
    }

    function initialiseFiscalState(context, accounts, incomeInfo, taxMonth) {
      const taxEngine = root.TaxEngine || root.SmartSaveTaxEngine;
      let taxData = null;
      if (taxEngine && typeof taxEngine.calculateAnnualTax === "function") {
        taxData = taxEngine.calculateAnnualTax(context.raw || {});
      }
      const annualIncome = incomeInfo.monthlyNetIncome * 12 + Math.max(0, toNumber(incomeInfo.annualThirteenth || 0));
      const householdTax =
        toNumber(taxData?.total) ||
        estimateAnnualTaxByBracket(
          annualIncome,
          context.personal
        );
      const personalAnnualIncome = annualIncome;
      const spouseAnnualIncome = Math.max(
        0,
        toNumber(incomeInfo?.spouseAnnualIncome || resolveSpouseMonthlyIncome(context) * 12)
      );
      const totalHouseholdIncome = personalAnnualIncome + spouseAnnualIncome;

      let annualTax = householdTax;
      if (taxData?.taxShare && taxData.taxShare.userAmount != null) {
        annualTax = toNumber(taxData.taxShare.userAmount);
      } else if (totalHouseholdIncome > 0) {
        const userShare = personalAnnualIncome / totalHouseholdIncome;
        annualTax = householdTax * userShare;
      }

      const already = accounts.taxes;
      const today = context.startDate || new Date();
      const safeTaxMonth = sanitizeMonth(taxMonth, 3);
      const monthsRemaining = monthsUntilTaxDate(today, safeTaxMonth);
      const remaining = Math.max(0, annualTax - already);

      return {
        annualTax,
        baseAnnualTax: annualTax,
        remainingProvision: remaining,
        monthlyNeed: remaining / monthsRemaining,
        nextPaymentDate: nextTaxDate(today, safeTaxMonth),
        taxMonth: safeTaxMonth,
        shortage: 0,
        totalPaid: 0,
        householdTax,
      };
    }

    function simulateMonth(
      scenario,
      context,
      incomeInfo,
      expensesInfo,
      iterationDate,
      strategyCallback
    ) {
      syncThirdPillarYtdForYear(scenario, iterationDate);
      const thirteenthIncome = computeThirteenthForMonth(incomeInfo, iterationDate);
      trackThirteenth(scenario, thirteenthIncome);
      const grossAvailable =
        incomeInfo.monthlyNetIncome +
        thirteenthIncome -
        expensesInfo.total +
        computeAdditionalSavings(context, iterationDate);
      const leisureDeduction = resolveLeisureDeduction(context, grossAvailable);
      const available = grossAvailable - leisureDeduction;
      trackLeisureDeduction(scenario, leisureDeduction);
      noteMonthlyAvailable(scenario, available);

      scenario.fiscal.remainingProvision = Math.max(
        0,
        scenario.fiscal.annualTax - scenario.accounts.taxes
      );
      scenario.fiscal.monthlyNeed =
        scenario.fiscal.remainingProvision /
        monthsUntilTaxDate(iterationDate, scenario.fiscal.taxMonth);

      strategyCallback(
        scenario,
        context,
        available,
        iterationDate
      );
    }

    function resolveLeisureDeduction(context = {}, grossAvailable = 0) {
      const safeAvailable = Math.max(0, toNumber(grossAvailable));
      const leisureTarget = Math.max(
        0,
        toNumber(
          context?.raw?.allocationPlan?.leisureMonthly ||
            context?.raw?.allocationPlan?.budgetVariable ||
            0
        )
      );
      return Math.min(safeAvailable, leisureTarget);
    }

    function syncThirdPillarYtdForYear(scenario, iterationDate) {
      const date = iterationDate instanceof Date ? iterationDate : new Date(iterationDate);
      const fiscalYear = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
      const trackedYearRaw = toNumber(scenario?.accounts?.thirdPillarYTDYear);
      const trackedYear = Math.round(trackedYearRaw) || fiscalYear;
      if (trackedYear === fiscalYear) return;
      scenario.accounts.thirdPillarYTD = 0;
      scenario.accounts.thirdPillarYTDYear = fiscalYear;
    }

    function applyCurrentStrategy(scenario, context, available, iterationDate) {
      if (available <= 0) {
        scenario.accounts.current = Math.max(
          0,
          scenario.accounts.current + available
        );
        return;
      }

      const taxNeed = Math.max(0, Math.min(available, scenario.fiscal.monthlyNeed || 0));
      if (taxNeed > 0) {
        scenario.accounts.taxes += taxNeed;
        scenario.contributions.taxes += taxNeed;
        trackContribution(scenario, "impots", taxNeed);
        available -= taxNeed;
      }

      let surplus = available;
      const plan = context.manualPlan;

      ['taxes', 'savings', 'pillar3', 'investments', 'blocked'].forEach((key) => {
        const target = toNumber(plan[key]);
        if (!target || surplus <= 0) return;
        const amount = Math.min(target, surplus);
        applyContribution(scenario, key, amount);
        surplus -= amount;
      });

      const goalAmount = toNumber(plan.goals);
      if (goalAmount && surplus > 0 && Array.isArray(context.goals) && context.goals.length) {
        const allocated = Math.min(goalAmount, surplus);
        allocateToGoals(context.goals, scenario, allocated, iterationDate);
        surplus -= allocated;
      }

      if (surplus > 0) {
        scenario.accounts.current += surplus;
        scenario.contributions.current += surplus;
        trackContribution(scenario, "compteCourant", surplus);
      }

      scenario.fiscal.remainingProvision = Math.max(
        0,
        scenario.fiscal.annualTax - scenario.accounts.taxes
      );
    }

    function applySmartSaveStrategy(scenario, context, available, iterationDate) {
      if (available <= 0) {
        scenario.accounts.current = Math.max(
          0,
          scenario.accounts.current + available
        );
        return;
      }

      const dynamicData = buildDynamicSmartData(context, scenario, iterationDate, available);
      const allocationEngine = root.AllocationEngine;
      if (!allocationEngine || typeof allocationEngine.calculateAllocation !== "function") {
        scenario.accounts.current += available;
        scenario.contributions.current += available;
        return;
      }

      const allocation = allocationEngine.calculateAllocation(dynamicData);

      applyAllocationResult(scenario, allocation, iterationDate);
    }

    function buildDynamicSmartData(context, scenario, iterationDate, available) {
      const clone = JSON.parse(JSON.stringify(context.raw || {}));
      clone.assets = clone.assets || {};
      clone.assets.currentAccount = scenario.accounts.current;
      clone.assets.paymentBalance = scenario.accounts.current;
      clone.assets.securitySavings = scenario.accounts.savings;
      clone.assets.securityBalance = scenario.accounts.savings;
      clone.assets.savingsAccount = scenario.accounts.savings;
      clone.assets.taxProvision = scenario.accounts.taxes;
      clone.assets.pillar3a = scenario.accounts.pillar3;
      clone.assets.pilier3a = scenario.accounts.pillar3;
      clone.assets.pillar3 = scenario.accounts.pillar3;
      clone.assets.thirdPillarAmount = scenario.accounts.pillar3;
      clone.assets.thirdPillar = scenario.accounts.pillar3;
      clone.assets.thirdPillarValue = scenario.accounts.pillar3;
      const referenceDate = iterationDate instanceof Date ? iterationDate : new Date(iterationDate);
      const fiscalYear = Number.isNaN(referenceDate.getTime())
        ? new Date().getFullYear()
        : referenceDate.getFullYear();
      const hasThirdPillarYTD = Boolean(scenario.accounts.hasThirdPillarYTD);
      const trackedYtdYearRaw = toNumber(scenario.accounts.thirdPillarYTDYear);
      const trackedYtdYear = Math.round(trackedYtdYearRaw) || fiscalYear;
      if (hasThirdPillarYTD) {
        clone.assets.thirdPillarPaidYTD = scenario.accounts.thirdPillarYTD || 0;
        clone.assets.thirdPillarPaidYTDYear = trackedYtdYear;
      } else {
        delete clone.assets.thirdPillarPaidYTD;
        delete clone.assets.thirdPillarPaidYTDYear;
      }
      clone.referenceDate = iterationDate.toISOString();
      clone.taxes = clone.taxes || {};
      if (hasThirdPillarYTD) {
        clone.taxes.thirdPillarPaidYTD = scenario.accounts.thirdPillarYTD || 0;
        clone.taxes.thirdPillarPaidYTDYear = trackedYtdYear;
      } else {
        delete clone.taxes.thirdPillarPaidYTD;
        delete clone.taxes.thirdPillarPaidYTDYear;
      }
      clone.taxes.overrideAnnualTax = scenario.fiscal.annualTax;
      clone.taxes.overrideMonthlyNeed = scenario.fiscal.monthlyNeed;
      clone.taxes.overrideRemaining = scenario.fiscal.remainingProvision;
      clone.overrideMonthlyAvailable = available;
      return clone;
    }

    function applyAllocationResult(scenario, allocation, iterationDate) {
      const apply = (key, handler) => {
        const amount = toNumber(allocation.allocations[key]);
        if (!amount) return;
        trackContribution(scenario, key, amount);
        handler(amount);
      };

      apply("impots", (value) => {
        scenario.accounts.taxes += value;
        scenario.contributions.taxes += value;
      });
      apply("compteCourant", (value) => {
        scenario.accounts.current += value;
        scenario.contributions.current += value;
      });
      apply("securite", (value) => {
        scenario.accounts.savings += value;
        scenario.contributions.savings += value;
      });
      apply("pilier3a", (value) => {
        scenario.accounts.pillar3 += value;
        scenario.accounts.thirdPillarYTD += value;
        scenario.accounts.hasThirdPillarYTD = true;
        scenario.contributions.pillar3 += value;
      });
      apply("investissements", (value) => {
        scenario.accounts.investments += value;
        scenario.contributions.investments += value;
      });
      apply("dettes", (value) => {
        scenario.contributions.debts += value;
      });
      apply("projetsCourtTerme", (value) => {
        scenario.accounts.current += value;
        scenario.contributions.goals += value;
      });
      apply("projetsLongTerme", (value) => {
        scenario.accounts.current += value;
        scenario.contributions.goals += value;
      });
      apply("projets", (value) => {
        scenario.accounts.current += value;
        scenario.contributions.goals += value;
      });
      const rest = toNumber(allocation.reste);
if (rest > 0) {
  const currentTarget = toNumber(allocation.debug?.currentTarget);
  const hasTarget = currentTarget > 0;

  const currentCapacity = hasTarget
    ? Math.max(0, currentTarget - scenario.accounts.current)
    : rest;

  const depositToCurrent = hasTarget
    ? Math.min(rest, currentCapacity)
    : rest;

  if (depositToCurrent > 0) {
    scenario.accounts.current += depositToCurrent;
    scenario.contributions.current += depositToCurrent;
    trackContribution(scenario, "compteCourant", depositToCurrent);
  }

  const overflow = rest - depositToCurrent;
  if (overflow > 0) {
    scenario.accounts.savings += overflow;
    scenario.contributions.savings += overflow;
    trackContribution(scenario, "securite", overflow);
  }
}

      if (Array.isArray(allocation.dettesDetail)) {
        allocation.dettesDetail.forEach((item) => {
          scenario.debtActions.push({
            amount: item.amount,
            loans: item.loans,
          });
        });
      }
      if (
        Array.isArray(allocation.objectifsFinances) &&
        Array.isArray(scenario.history)
      ) {
        allocation.objectifsFinances.forEach((goal) => {
          const amount = toNumber(goal?.allocated || goal?.amount || goal?.value);
          if (!amount) return;
          scenario.history.push({
            date: iterationDate.toISOString(),
            goal: goal.name || goal.label || "Objectif",
            amount,
          });
        });
      }
      scenario.fiscal.remainingProvision = Math.max(
        0,
        scenario.fiscal.annualTax - scenario.accounts.taxes
      );
    }

    function allocateToGoals(goals, scenario, amount, iterationDate) {
      let remaining = amount;
      const sorted = goals.slice().sort((a, b) => {
        const aDate = goalPriorityKey(a, iterationDate);
        const bDate = goalPriorityKey(b, iterationDate);
        if (aDate !== bDate) return aDate - bDate;
        const priorityA = toNumber(a.priority || 0);
        const priorityB = toNumber(b.priority || 0);
        return priorityA - priorityB;
      });

      sorted.forEach((goal) => {
        if (remaining <= 0) return;
        const target = toNumber(goal.target || goal.amount);
        const saved = toNumber(goal.saved || goal.current || 0);
        const gap = Math.max(0, target - saved);
        if (gap <= 0) return;
        const allocation = Math.min(gap, remaining);
        const type = (goal.type || goal.category || "").toLowerCase();
        if (type === "croissance") {
          scenario.accounts.investments += allocation;
          scenario.contributions.investments += allocation;
        } else if (type === "securite") {
          scenario.accounts.savings += allocation;
          scenario.contributions.savings += allocation;
        } else {
          scenario.accounts.current += allocation;
          scenario.contributions.goals += allocation;
        }
        remaining -= allocation;
        if (Array.isArray(scenario.history)) {
          scenario.history.push({
            date: iterationDate.toISOString(),
            goal: goal.name || goal.titre || "Objectif",
            amount: allocation,
          });
        }
      });

      if (remaining > 0) {
        scenario.accounts.current += remaining;
        scenario.contributions.current += remaining;
      }
    }

    function applyContribution(scenario, key, amount) {
      if (amount <= 0) return;
      if (key === "taxes") {
        scenario.accounts.taxes += amount;
        scenario.contributions.taxes += amount;
        trackContribution(scenario, "impots", amount);
      } else if (key === "savings") {
        scenario.accounts.savings += amount;
        scenario.contributions.savings += amount;
        trackContribution(scenario, "securite", amount);
      } else if (key === "pillar3") {
        scenario.accounts.pillar3 += amount;
        scenario.accounts.thirdPillarYTD += amount;
        scenario.accounts.hasThirdPillarYTD = true;
        scenario.contributions.pillar3 += amount;
        trackContribution(scenario, "pilier3a", amount);
      } else if (key === "investments") {
        scenario.accounts.investments += amount;
        scenario.contributions.investments += amount;
        trackContribution(scenario, "investissements", amount);
      } else if (key === "blocked") {
        scenario.accounts.blocked += amount;
        scenario.contributions.blocked += amount;
        trackContribution(scenario, "epargneBloquee", amount);
      } else {
        scenario.accounts.current += amount;
        scenario.contributions.current += amount;
        trackContribution(scenario, "compteCourant", amount);
      }
    }

    function applyMonthlyInterests(scenario, context, date) {
      const rateContext = {
        scenario,
        date,
        profile: context.profile,
        profileKey: String(context.profile || "").toLowerCase(),
        defaults: context.defaultRates,
      };
      const savingsRate = resolveRate(
        context.rates.savings,
        rateContext,
        context.defaultRates.savings
      );
      const blockedRate = resolveRate(
        context.rates.blocked,
        rateContext,
        context.defaultRates.blocked
      );
      const pillar3Rate = resolveRate(
        context.rates.pillar3,
        rateContext,
        context.defaultRates.pillar3
      );
      const investmentsRate = resolveRate(
        context.rates.investments,
        rateContext,
        context.defaultRates.investments
      );

      const savingsInterest = scenario.accounts.savings * (savingsRate / 12);
      scenario.accounts.savings += savingsInterest;
      scenario.interestEarned.savings += savingsInterest;
      trackInterest(scenario, "savings", savingsInterest);

      const blockedInterest = scenario.accounts.blocked * (blockedRate / 12);
      scenario.accounts.blocked += blockedInterest;
      scenario.interestEarned.blocked += blockedInterest;
      trackInterest(scenario, "blocked", blockedInterest);

      const pillar3Interest = scenario.accounts.pillar3 * (pillar3Rate / 12);
      scenario.accounts.pillar3 += pillar3Interest;
      scenario.interestEarned.pillar3 += pillar3Interest;
      trackInterest(scenario, "pillar3", pillar3Interest);

      const investmentInterest = scenario.accounts.investments * (investmentsRate / 12);
      scenario.accounts.investments += investmentInterest;
      scenario.interestEarned.investments += investmentInterest;
      trackInterest(scenario, "investments", investmentInterest);
    }

    function settleAnnualTaxes(scenario, date) {
      let remaining = scenario.fiscal.annualTax;

      const payFrom = (accountKey) => {
        const available = scenario.accounts[accountKey];
        const used = Math.min(available, remaining);
        scenario.accounts[accountKey] -= used;
        remaining -= used;
      };

      payFrom("taxes");
      payFrom("current");
      payFrom("savings");

      const paidAmount = scenario.fiscal.annualTax - remaining;

      if (remaining > 0) {
        scenario.fiscal.shortage += remaining;
      }
      scenario.fiscal.totalPaid += paidAmount;
      trackTaxPayment(scenario, paidAmount);
      scenario.fiscal.annualTax = scenario.fiscal.baseAnnualTax;
      scenario.fiscal.remainingProvision = scenario.fiscal.annualTax;
      scenario.fiscal.monthlyNeed = scenario.fiscal.remainingProvision / 12;
      scenario.fiscal.nextPaymentDate = nextTaxDate(date, scenario.fiscal.taxMonth);
      scenario.accounts.taxes = 0;
    }

    function recordHistory(scenario, date) {
      if (Array.isArray(scenario.history)) {
        scenario.history.push({
          date: date.toISOString(),
          accounts: { ...scenario.accounts },
        });
      }
    }

    function buildResult(currentScenario, smartScenario, keepHistory) {
      const compose = (scenario) => ({
        label: scenario.label,
        finalAccounts: mapRound(scenario.accounts),
        contributions: mapRound(scenario.contributions),
        interestEarned: mapRound(scenario.interestEarned),
        debtActions: scenario.debtActions.map((item) => ({
          amount: round2(item.amount),
          loans: item.loans,
        })),
        fiscal: {
          shortage: round2(scenario.fiscal.shortage),
          totalPaid: round2(scenario.fiscal.totalPaid),
        },
        shortTerm: {
          paid: round2(scenario.shortTerm?.paid || 0),
          shortage: round2(scenario.shortTerm?.shortage || 0),
        },
        history: keepHistory ? scenario.history : undefined,
        flows: scenario.flowHistory || undefined,
        netWorth:
          scenario.accounts.current +
          scenario.accounts.savings +
          scenario.accounts.blocked +
          scenario.accounts.pillar3 +
          scenario.accounts.investments,
      });

      const currentResult = compose(currentScenario);
      const smartResult = compose(smartScenario);

      return {
        current: currentResult,
        smartSave: smartResult,
        deltaNetWorth: round2(smartResult.netWorth - currentResult.netWorth),
      };
    }

    function normaliseManualPlan(plan = {}, assets = {}, investments = {}) {
      const source = plan || {};
      const normalized = {
        taxes: toNumber(source.taxes || source.impots || 0),
        savings: toNumber(source.savings || source.securite || 0),
        pillar3: toNumber(source.pillar3 || source.pilier3a || 0),
        investments: toNumber(source.investments || source.croissance || 0),
        blocked: toNumber(source.blocked || source.epargneBloquee || 0),
        goals: toNumber(source.goals || source.projets || 0),
      };

      const savingsAuto = toNumber(assets.savingsContributionAmount);
      if (!normalized.savings && savingsAuto > 0) {
        normalized.savings = savingsAuto;
      }

      const pillar3Auto =
        toNumber(assets.thirdPillarContributionMonthly) ||
        toNumber(assets.thirdPillarContribution) ||
        toNumber(assets.thirdPillarContributionSpouse);
      if (!normalized.pillar3 && pillar3Auto > 0) {
        normalized.pillar3 = pillar3Auto;
      }

      if (!normalized.investments && Array.isArray(investments.items)) {
        const monthlyInvest = investments.items.reduce((sum, item = {}) => {
          const hasMonthly = String(item.hasMonthly || "").toLowerCase();
          if (hasMonthly === "oui" || hasMonthly === "true") {
            return sum + toNumber(item.monthlyAmount);
          }
          return sum;
        }, 0);
        if (monthlyInvest > 0) {
          normalized.investments = monthlyInvest;
        }
      }

      return normalized;
    }

    function ensureArray(value) {
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
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

    function applyThirteenthSalary(scenario, amount) {
      if (!amount) return;
      scenario.accounts.current += amount;
      trackThirteenth(scenario, amount);
    }

    function computeAdditionalSavings(context, date) {
      return 0;
    }

    function buildShortTermPayoutPlan(context = {}, options = {}) {
      const source =
        context?.raw?.allocationPlan?.shortTerm &&
        typeof context.raw.allocationPlan.shortTerm === "object"
          ? context.raw.allocationPlan.shortTerm
          : {};
      const fallback =
        context?.raw?.shortTermGoal && typeof context.raw.shortTermGoal === "object"
          ? context.raw.shortTermGoal
          : {};
      const amount = Math.max(
        0,
        toNumber(
          source.amount ||
            source.targetAmount ||
            source.target ||
            source.goal ||
            fallback.amount ||
            fallback.targetAmount ||
            fallback.target ||
            fallback.goal ||
            0
        )
      );
      const horizonYearsRaw =
        toNumber(source.horizonYears || source.horizon || source.years || 0) ||
        toNumber(fallback.horizonYears || fallback.horizon || fallback.years || 0) ||
        1;
      const horizonYears = Math.min(3, Math.max(1, Math.round(horizonYearsRaw)));
      const explicitEnabled =
        source.enabled !== undefined
          ? source.enabled
          : fallback.enabled !== undefined
          ? fallback.enabled
          : null;
      const enabled =
        explicitEnabled === null ? amount > 0 : Boolean(explicitEnabled) && amount > 0;
      return {
        enabled,
        amount,
        horizonYears,
        payoutMonth: sanitizeMonth(options.shortTermPayoutMonth, 8),
      };
    }

    function shouldSettleShortTermGoal(plan = {}, monthNumber, projectionYearIndex) {
      if (!plan?.enabled) return false;
      if (Math.max(0, toNumber(plan.amount)) <= 0) return false;
      const payoutMonth = sanitizeMonth(plan.payoutMonth, 8);
      if (monthNumber !== payoutMonth) return false;
      const horizonYears = Math.min(3, Math.max(1, Math.round(toNumber(plan.horizonYears || 1))));
      return projectionYearIndex % horizonYears === 0;
    }

    function settleShortTermGoal(scenario, plan = {}) {
      const target = Math.max(0, toNumber(plan.amount));
      if (!target) return;
      let remaining = target;
      const payFrom = (accountKey) => {
        const available = Math.max(0, toNumber(scenario.accounts[accountKey]));
        const used = Math.min(available, remaining);
        scenario.accounts[accountKey] -= used;
        remaining -= used;
      };

      payFrom("current");
      payFrom("savings");
      payFrom("investments");
      payFrom("blocked");

      const paid = target - remaining;
      scenario.shortTerm.paid += paid;
      if (remaining > 0) {
        scenario.shortTerm.shortage += remaining;
      }
      trackShortTermPayment(scenario, paid);
    }

    function monthsUntilTaxDate(date, taxMonth) {
      const target = nextTaxDate(date, taxMonth);
      const years = target.getFullYear() - date.getFullYear();
      const months = years * 12 + (target.getMonth() - date.getMonth());
      const adjust = target.getDate() >= date.getDate() ? 1 : 0;
      return Math.max(1, months + adjust);
    }

    function nextTaxDate(date, taxMonth) {
      const safeTaxMonth = sanitizeMonth(taxMonth, 3);
      const monthIndex = safeTaxMonth - 1;
      const year = date.getMonth() >= monthIndex ? date.getFullYear() + 1 : date.getFullYear();
      return new Date(year, monthIndex + 1, 0);
    }

    function addMonths(date, count) {
      const result = new Date(date);
      result.setMonth(result.getMonth() + count);
      return result;
    }

    function estimateAnnualTaxByBracket(annualIncome) {
      if (annualIncome <= 0) return 0;
      if (annualIncome < 50000) return annualIncome * 0.08;
      if (annualIncome < 80000) return annualIncome * 0.11;
      if (annualIncome < 120000) return annualIncome * 0.14;
      return annualIncome * 0.17;
    }

    function goalPriorityKey(goal, referenceDate) {
      const months = monthsUntil(goal.deadline || goal.date, referenceDate);
      const type = (goal.type || goal.category || "").toLowerCase();
      let weight = 0;
      if (type === "securite") weight = -2;
      else if (type === "projet") weight = -1;
      return months * 10 + weight;
    }

    function monthsUntil(deadline, referenceDate) {
      if (!deadline) return 12;
      const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
      const end = new Date(deadline);
      if (Number.isNaN(end.getTime())) return 12;
      const years = end.getFullYear() - ref.getFullYear();
      const months = years * 12 + (end.getMonth() - ref.getMonth());
      return Math.max(1, months);
    }

    function resolveRetirementAge(source = {}) {
      const keys = [
        "retirementAge",
        "targetRetirementAge",
        "targetAge",
        "ageRetraite",
        "age_retraite",
        "ageRetirement",
        "ageVisee",
        "age_visee",
      ];
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const value = toNumber(source[key]);
        if (Number.isFinite(value) && value > 0) {
          return value;
        }
      }
      return null;
    }

    function parseDate(value) {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function calculateAge(birthDate, referenceDate = new Date()) {
      if (!(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) return 0;
      const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
      let age = ref.getFullYear() - birthDate.getFullYear();
      const monthDiff = ref.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birthDate.getDate())) {
        age -= 1;
      }
      return Math.max(age, 0);
    }

    function resolveRate(resolver, rateContext, fallback) {
      if (typeof resolver === "function") {
        const value = resolver(rateContext);
        if (value === undefined || value === null) return fallback;
        const numeric = toNumber(value);
        return Number.isFinite(numeric) ? numeric : fallback;
      }
      if (resolver === undefined || resolver === null) {
        return fallback;
      }
      const numeric = toNumber(resolver);
      return Number.isFinite(numeric) ? numeric : fallback;
    }

    function normaliseRate(input, fallback) {
      if (typeof input === "function") {
        return (ctx) => {
          const value = input(ctx);
          if (value === undefined || value === null) return fallback;
          const numeric = toNumber(value);
          return Number.isFinite(numeric) ? numeric : fallback;
        };
      }
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const config = input;
        const defaultValue =
          config.default !== undefined && config.default !== null
            ? toNumber(config.default)
            : fallback;
        return (ctx) => {
          let rate = Number.isFinite(defaultValue) ? defaultValue : fallback;
          if (config.byProfile) {
            const profileValue = pickProfileValue(config.byProfile, ctx.profile, ctx.profileKey);
            if (profileValue !== undefined && profileValue !== null) {
              const numeric = toNumber(profileValue);
              if (Number.isFinite(numeric)) {
                rate = numeric;
              }
            }
          }
          const yearMap = config.byYear || config.yearly;
          if (yearMap) {
            const yearEntry = yearMap[ctx.date.getFullYear()];
            if (yearEntry !== undefined && yearEntry !== null) {
              if (typeof yearEntry === "object" && !Array.isArray(yearEntry)) {
                const yearDefault =
                  yearEntry.default !== undefined && yearEntry.default !== null
                    ? toNumber(yearEntry.default)
                    : rate;
                let candidate = Number.isFinite(yearDefault) ? yearDefault : rate;
                if (yearEntry.byProfile) {
                  const profileValue = pickProfileValue(
                    yearEntry.byProfile,
                    ctx.profile,
                    ctx.profileKey
                  );
                  if (profileValue !== undefined && profileValue !== null) {
                    const numeric = toNumber(profileValue);
                    if (Number.isFinite(numeric)) {
                      candidate = numeric;
                    }
                  }
                }
                rate = candidate;
              } else {
                const numeric = toNumber(yearEntry);
                if (Number.isFinite(numeric)) {
                  rate = numeric;
                }
              }
            }
          }
          return Number.isFinite(rate) ? rate : fallback;
        };
      }
      if (input === undefined || input === null) {
        return () => fallback;
      }
      const numeric = toNumber(input);
      if (!Number.isFinite(numeric)) {
        return () => fallback;
      }
      return () => numeric;
    }

    function pickProfileValue(map, profile, profileKey) {
      if (!map) return undefined;
      const candidates = [];
      if (profile !== undefined && profile !== null) {
        candidates.push(profile);
      }
      if (profileKey) {
        candidates.push(profileKey);
        candidates.push(profileKey.toUpperCase());
      }
      for (const key of candidates) {
        if (key === undefined || key === null) continue;
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          return map[key];
        }
      }
      return undefined;
    }

    function resolveFallbackRate(rate, fallback) {
      if (rate === undefined || rate === null) return fallback;
      if (typeof rate === "number" || typeof rate === "string") {
        const numeric = toNumber(rate);
        return Number.isFinite(numeric) ? numeric : fallback;
      }
      if (typeof rate === "object" && !Array.isArray(rate)) {
        if (rate.default !== undefined && rate.default !== null) {
          const numeric = toNumber(rate.default);
          if (Number.isFinite(numeric)) {
            return numeric;
          }
        }
      }
      return fallback;
    }

    function clamp(value, min, max) {
      const numeric = typeof value === "number" ? value : toNumber(value);
      if (!Number.isFinite(numeric)) return 0;
      if (min != null && numeric < min) return min;
      if (max != null && numeric > max) return max;
      return numeric;
    }

    function sanitizeMonth(value, fallback = 1) {
      const month = Math.round(toNumber(value));
      if (month >= 1 && month <= 12) return month;
      const safeFallback = Math.round(toNumber(fallback));
      return safeFallback >= 1 && safeFallback <= 12 ? safeFallback : 1;
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

    function mapRound(object) {
      const result = {};
      Object.keys(object).forEach((key) => {
        result[key] = round2(object[key]);
      });
      return result;
    }

    function startMonthlyFlow(scenario, date) {
      if (!scenario?.captureFlows || !scenario.flowHistory) return;
      scenario.currentFlow = {
        date: date.toISOString(),
        available: 0,
        leisureDeduction: 0,
        allocations: {},
        interest: {},
        taxesPaid: 0,
        taxProvisioned: 0,
        shortTermPaid: 0,
        thirteenth: 0,
      };
    }

    function finalizeMonthlyFlow(scenario) {
      if (!scenario?.captureFlows || !scenario.flowHistory || !scenario.currentFlow) return;
      scenario.currentFlow.accounts = snapshotAccounts(scenario.accounts);
      scenario.flowHistory.push(scenario.currentFlow);
      scenario.currentFlow = null;
    }

    function normalizeFlowKey(key) {
      switch (key) {
        case "taxes":
        case "impots":
          return "impots";
        case "savings":
        case "securite":
          return "securite";
        case "pillar3":
        case "pilier3a":
          return "pilier3a";
        case "investments":
        case "investissements":
          return "investissements";
        case "blocked":
        case "epargneBloquee":
          return "bloque";
        case "dettes":
          return "dettes";
        case "projetsCourtTerme":
        case "projetsLongTerme":
        case "projets":
          return "projets";
        case "compteCourant":
        case "current":
          return "compteCourant";
        default:
          return key || null;
      }
    }

    function trackContribution(scenario, key, amount) {
      if (!scenario?.captureFlows || !scenario.currentFlow || amount <= 0) return;
      const flowKey = normalizeFlowKey(key);
      if (!flowKey) return;
      const map = scenario.currentFlow.allocations;
      map[flowKey] = (map[flowKey] || 0) + amount;
      if (flowKey === "impots") {
        scenario.currentFlow.taxProvisioned += amount;
      }
    }

    function trackInterest(scenario, key, amount) {
      if (!scenario?.captureFlows || !scenario.currentFlow || amount <= 0) return;
      const map = scenario.currentFlow.interest;
      map[key] = (map[key] || 0) + amount;
    }

    function trackThirteenth(scenario, amount) {
      if (!scenario?.captureFlows || !scenario.currentFlow || amount <= 0) return;
      scenario.currentFlow.thirteenth += amount;
    }

    function trackTaxPayment(scenario, amount) {
      if (!scenario?.captureFlows || !scenario.currentFlow || amount <= 0) return;
      scenario.currentFlow.taxesPaid += amount;
    }

    function trackShortTermPayment(scenario, amount) {
      if (!scenario?.captureFlows || !scenario.currentFlow || amount <= 0) return;
      scenario.currentFlow.shortTermPaid += amount;
    }

    function noteMonthlyAvailable(scenario, amount) {
      if (!scenario?.captureFlows || !scenario.currentFlow) return;
      scenario.currentFlow.available = amount;
    }

    function trackLeisureDeduction(scenario, amount) {
      if (!scenario?.captureFlows || !scenario.currentFlow || amount <= 0) return;
      scenario.currentFlow.leisureDeduction += amount;
    }

    function snapshotAccounts(accounts = {}) {
      return {
        current: round2(accounts.current || 0),
        savings: round2(accounts.savings || 0),
        blocked: round2(accounts.blocked || 0),
        pillar3: round2(accounts.pillar3 || 0),
        investments: round2(accounts.investments || 0),
        taxes: round2(accounts.taxes || 0),
      };
    }

    return {
      calculateProjection,
      calculateRetirement,
    };
  })();

  root.ProjectionEngine = ProjectionEngine;
  if (typeof module === "object" && module.exports) {
    module.exports = ProjectionEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
