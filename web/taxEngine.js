(function (factory) {
  const engine = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = engine;
  }
  const globalRoot =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof self !== "undefined"
      ? self
      : this;
  globalRoot.SmartSaveTaxEngine = engine;
  globalRoot.TaxEngine = {
    calculateAnnualTax(taxUserData = {}) {
      const formState =
        typeof engine.mapTaxUserData === "function"
          ? engine.mapTaxUserData(taxUserData)
          : taxUserData;
      return engine.calculateAnnualTax(formState);
    },
  };
})(function () {
  const SOCIAL_CHARGE_RATE = 0.067;
  const TRANSPORT_DAYS = 220;
  const TRANSPORT_RATE_PER_KM = 0.68;
  const TRANSPORT_PUBLIC_CAP = 3000;
  const TRANSPORT_CAR_CAP = 7000;

  const MEAL_DEDUCTIONS = {
    "jamais": 0,
    "1 jour/semaine": 640,
    "2 jours/semaine": 1280,
    "3 jours/semaine": 1920,
    "4 jours/semaine": 2560,
    "5 jours/semaine": 3200,
  };

  const PROFESSIONAL_EXPENSES_FLAT = 2000;
  const INSURANCE_DEFAULT_PER_ADULT = 4800;
  const INSURANCE_DEFAULT_PER_CHILD = 1140;
  const CHILD_DEDUCTION_FR = 7100;
  const FEDERAL_CHILD_DEDUCTION = 6500;
  const FEDERAL_CHILD_CREDIT = 263;
  const THIRD_PILLAR_CAP_EMPLOYEE = 7056;
  const THIRD_PILLAR_CAP_SELF_EMPLOYED = 35280;
  const THIRD_PILLAR_RATE_SELF_EMPLOYED = 0.2;
  const DEFAULT_ADVANCE_PAYMENTS_KEY = "smartsaveTaxPayments";

  const STATUS_SINGLE = "single";
  const STATUS_MARRIED = "married";

  const MARRIED_KEYWORDS = ["marie", "marié", "mariée", "married", "partenariat"];
  function normalizeIncomeValue(amount, amountType) {
    const base = toNumber(amount);
    if (!base) return 0;
    const type = (amountType || "").toString().toLowerCase();
    return type === "brut" ? base * (1 - SOCIAL_CHARGE_RATE) : base;
  }

  function ensureArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }

  const CANTONAL_SEGMENTS_SINGLE = [
    { from: 0, to: 5200, startRate: 0, endRate: 0 },
    { from: 5200, to: 17500, startRate: 1.0, endRate: 4.1745 },
    { from: 17500, to: 48300, startRate: 4.1745, endRate: 8.0352 },
    { from: 48300, to: 77600, startRate: 8.0352, endRate: 9.9846 },
    { from: 77600, to: 145600, startRate: 9.9846, endRate: 12.2242 },
    { from: 145600, to: Infinity, startRate: 12.2242, endRate: 12.2242 },
  ];

  const CANTONAL_SEGMENTS_MARRIED = [
    { from: 0, to: 10500, startRate: 0, endRate: 0 },
    { from: 10500, to: 35000, startRate: 1.0, endRate: 4.1745 },
    { from: 35000, to: 96600, startRate: 4.1745, endRate: 8.0352 },
    { from: 96600, to: 155200, startRate: 8.0352, endRate: 9.9846 },
    { from: 155200, to: Infinity, startRate: 9.9846, endRate: 9.9846 },
  ];

  const WEALTH_TAX_BRACKETS_FR = [
    { limit: 50000, rate: 0.0005 },
    { limit: 100000, rate: 0.0011 },
    { limit: 200000, rate: 0.0018 },
    { limit: 400000, rate: 0.0025 },
    { limit: 700000, rate: 0.0031 },
    { limit: 1000000, rate: 0.0035 },
    { limit: 1200000, rate: 0.0037 },
    { limit: Infinity, rate: 0.0029 },
  ];

  function calculateAnnualTax(formState, context = {}) {
    const now = context.referenceDate ? new Date(context.referenceDate) : new Date();
    const taxYear = context.taxYear || now.getFullYear();

    const personal = formState?.personal || {};
    const incomes = formState?.incomes || {};
    const taxes = formState?.taxes || {};
    const assets = formState?.assets || {};
    const expenses = formState?.expenses || {};
    const credits = formState?.credits || {};
    const investments = formState?.investments || {};
    const realEstate = formState?.realEstate || formState?.immobilier || {};

    const paysTaxes = isYes(taxes.paysTaxes);

    const annualIncomePersonal = computeAnnualNetIncome(incomes.entries || []);
    const spouseNetIncome = toNumber(incomes.spouseNetIncome);
    const annualIncomeTotal = annualIncomePersonal + spouseNetIncome;

    const deductions = paysTaxes
      ? computeAllDeductions({
          personal,
          incomes,
          taxes,
          assets,
          credits,
          realEstate,
          annualIncomePersonal,
        })
      : { total: 0, breakdown: {} };

    const taxableAfterDeductions = Math.max(0, annualIncomeTotal - deductions.total);
    const childrenCount = toNumber(personal.childrenCount);
    const taxableAfterChildDeduction = Math.max(
      0,
      taxableAfterDeductions - childrenCount * CHILD_DEDUCTION_FR
    );

    const maritalStatus = resolveMaritalStatus(personal, incomes);
    const familyBareme = hasFamilyBareme(personal, incomes);

    let fribourgTax = 0;
    let federalTax = 0;
    let wealthTax = 0;

    if (paysTaxes) {
      fribourgTax = computeCantonalFribourgTax(taxableAfterChildDeduction, familyBareme);
      const federalTaxable = Math.max(
        0,
        taxableAfterChildDeduction - childrenCount * FEDERAL_CHILD_DEDUCTION
      );
      federalTax = computeFederalTax(federalTaxable, maritalStatus);
      if (childrenCount > 0) {
        federalTax = Math.max(0, federalTax - childrenCount * FEDERAL_CHILD_CREDIT);
      }
      wealthTax = computeWealthTax(computeNetWealth(formState), WEALTH_TAX_BRACKETS_FR);
    }

    const totalTaxAnnual = paysTaxes ? fribourgTax + federalTax + wealthTax : 0;
    const roundedFribourg = Math.round(fribourgTax);
    const roundedFederal = Math.round(federalTax);
    const roundedWealth = Math.round(wealthTax);
    const roundedTotal = Math.round(totalTaxAnnual);

    const advancePayments = resolveAdvancePayments(taxes, taxYear, context);
    const provisionPlan = buildProvisionPlan({
      totalTax: roundedTotal,
      alreadyPaid: advancePayments,
      formState,
      assets,
      expenses,
      fiscalYear: taxYear,
      now,
    });

    const netWealth = computeNetWealth(formState);
    const share = computeUserShare(annualIncomePersonal, spouseNetIncome, roundedTotal);

    if (!paysTaxes) {
      return {
        total: 0,
        annualGrossIncome: annualIncomeTotal,
        revenuImposable: 0,
        federalTax: 0,
        fribourgTax: 0,
        wealthTax: 0,
        totalDeductions: 0,
        netWealth,
        taxShare: share,
        monthlyProvision: provisionPlan,
        skipped: true,
      };
    }

    return {
      total: roundedTotal,
      annualGrossIncome: annualIncomeTotal,
      revenuImposable: taxableAfterChildDeduction,
      federalTax: roundedFederal,
      fribourgTax: roundedFribourg,
      wealthTax: roundedWealth,
      totalDeductions: deductions.total,
      netWealth,
      taxShare: share,
      monthlyProvision: provisionPlan,
      breakdown: {
        deductions: deductions.breakdown,
        taxableAfterDeductions,
        taxableAfterChildDeduction,
        wealth: computeWealthBreakdown(formState),
      },
    };
  }

  function computeAnnualNetIncome(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    return entries.reduce((sum, entry) => {
      const months = entry?.thirteenth === "oui" ? 13 : 12;
      const normalizedAmount = normalizeIncomeValue(entry?.amount, entry?.amountType);
      if (!normalizedAmount) return sum;
      return sum + normalizedAmount * months;
    }, 0);
  }

  function computeAllDeductions({
    personal,
    incomes,
    taxes,
    assets,
    credits,
    realEstate,
    annualIncomePersonal,
  }) {
    const breakdown = {};
    let total = 0;

    const transportUser = computeTransportDeduction(
      toNumber(taxes.commuteDistance),
      taxes.transportMode
    );
    total += transportUser;
    breakdown.transport = transportUser;

    const transportSpouse = isPartnered(personal, incomes)
      ? computeTransportDeduction(
          toNumber(taxes.spouseCommuteDistance),
          taxes.spouseTransportMode
        )
      : 0;
    if (transportSpouse) {
      total += transportSpouse;
      breakdown.transportSpouse = transportSpouse;
    }

    total += PROFESSIONAL_EXPENSES_FLAT;
    breakdown.professionalFlat = PROFESSIONAL_EXPENSES_FLAT;

    const mealUser = MEAL_DEDUCTIONS[String(taxes.mealsFrequency || "").trim()] || 0;
    total += mealUser;
    breakdown.meals = mealUser;

    if (isPartnered(personal, incomes)) {
      const mealSpouse =
        MEAL_DEDUCTIONS[String(taxes.spouseMealsFrequency || "").trim()] || 0;
      if (mealSpouse) {
        total += mealSpouse;
        breakdown.mealsSpouse = mealSpouse;
      }
    }

    const insuranceDeduction = computeInsuranceDeduction(
      taxes,
      personal.childrenCount,
      isPartnered(personal, incomes)
    );
    total += insuranceDeduction;
    breakdown.insurance = insuranceDeduction;

    const childcareDeduction = computeChildcareDeduction(
      personal.childrenCount,
      taxes.childcareCosts
    );
    total += childcareDeduction;
    breakdown.childcare = childcareDeduction;

    const thirdPillarUser = computeThirdPillarDeduction(
      assets.thirdPillarContribution,
      personal.employmentStatus,
      annualIncomePersonal
    );
    if (thirdPillarUser) {
      total += thirdPillarUser;
      breakdown.thirdPillar = thirdPillarUser;
    }

    const thirdPillarSpouse = isPartnered(personal, incomes)
      ? computeThirdPillarDeduction(
          assets.thirdPillarContributionSpouse,
          incomes.spouseEmploymentStatus,
          spouseAnnualIncome(incomes)
        )
      : 0;
    if (thirdPillarSpouse) {
      total += thirdPillarSpouse;
      breakdown.thirdPillarSpouse = thirdPillarSpouse;
    }

    const mortgageInterests = collectMortgageInterests(realEstate, assets);
    if (mortgageInterests) {
      total += mortgageInterests;
      breakdown.mortgageInterests = mortgageInterests;
    }

    return { total, breakdown };
  }

  function spouseAnnualIncome(incomes) {
    const entryAmount = toNumber(incomes.spouseNetIncome);
    return entryAmount > 0 ? entryAmount : 0;
  }

  function computeTransportDeduction(distanceKm, mode) {
    if (!distanceKm) return 0;
    const base = distanceKm * 2 * TRANSPORT_DAYS * TRANSPORT_RATE_PER_KM;
    const normalized = (mode || "").toLowerCase();
    if (normalized === "transport_public" || normalized === "public") {
      return Math.min(base, TRANSPORT_PUBLIC_CAP);
    }
    if (normalized === "voiture" || normalized === "car") {
      return Math.min(base, TRANSPORT_CAR_CAP);
    }
    return base;
  }

  function computeInsuranceDeduction(taxes, childrenCount = 0, hasSpouse = false) {
    const adultUser = toNumber(taxes.basicInsurance) || INSURANCE_DEFAULT_PER_ADULT;
    const adultSpouse = hasSpouse
      ? toNumber(taxes.basicInsuranceSpouse ?? taxes.spouseInsurance) || INSURANCE_DEFAULT_PER_ADULT
      : 0;
    const children = Math.max(0, toNumber(childrenCount)) * INSURANCE_DEFAULT_PER_CHILD;
    return adultUser + adultSpouse + children;
  }

  function computeChildcareDeduction(childrenCount, childcareCosts) {
    if (!childrenCount) return 0;
    return toNumber(childcareCosts) * 12;
  }

  function computeThirdPillarDeduction(monthlyContribution, employmentStatus, annualIncome) {
    const monthly = toNumber(monthlyContribution);
    if (!monthly) return 0;
    const annual = monthly * 12;
    const status = (employmentStatus || "").toLowerCase();
    if (status.includes("indep")) {
      const cap = Math.min(
        THIRD_PILLAR_CAP_SELF_EMPLOYED,
        annualIncome * THIRD_PILLAR_RATE_SELF_EMPLOYED
      );
      return Math.min(annual, cap);
    }
    return Math.min(annual, THIRD_PILLAR_CAP_EMPLOYEE);
  }

  function collectMortgageInterests(realEstate, assets) {
    let total = 0;
    const properties = Array.isArray(realEstate?.properties)
      ? realEstate.properties
      : Array.isArray(realEstate)
      ? realEstate
      : [];
    properties.forEach((property) => {
      const list =
        property?.interets_hypothecaires ||
        property?.interetsHypothecaires ||
        property?.mortgageInterests ||
        [];
      if (Array.isArray(list)) {
        total += list.reduce((sum, value) => sum + toNumber(value), 0);
      } else {
        total += toNumber(list);
      }
    });
    if (Array.isArray(assets?.mortgageInterests)) {
      total += assets.mortgageInterests.reduce((sum, value) => sum + toNumber(value), 0);
    } else {
      total += toNumber(assets?.mortgageInterestAnnual);
    }
    return total;
  }

  function computeDebtDeduction(loans) {
    if (!Array.isArray(loans) || loans.length === 0) return 0;
    return loans.reduce((sum, loan) => sum + toNumber(loan?.outstanding), 0);
  }

  function isDeclaredMarried(status = "") {
    const normalized = (status || "").toLowerCase();
    return MARRIED_KEYWORDS.some((keyword) => normalized.includes(keyword));
  }

  function resolveMaritalStatus(personal = {}, incomes = {}) {
    const marital = personal?.maritalStatus || "";
    if (isDeclaredMarried(marital)) return STATUS_MARRIED;
    if (toNumber(incomes?.spouseNetIncome) > 0) return STATUS_MARRIED;
    return STATUS_SINGLE;
  }

  function hasFamilyBareme(personal = {}, incomes = {}) {
    return (
      resolveMaritalStatus(personal, incomes) === STATUS_MARRIED ||
      toNumber(personal?.childrenCount) > 0
    );
  }

  function computeCantonalFribourgTax(income, useFamilyBareme) {
    if (!income) return 0;
    const segments = useFamilyBareme
      ? CANTONAL_SEGMENTS_MARRIED
      : CANTONAL_SEGMENTS_SINGLE;
    const taxBar = integrateLinearSegments(income, segments);
    return taxBar * 0.96;
  }

  function integrateLinearSegments(income, segments) {
    let remaining = income;
    let tax = 0;
    for (const segment of segments) {
      if (remaining <= 0) break;
      const span = segment.to - segment.from;
      if (span <= 0) continue;
      const taxableSpan = Math.min(span, remaining);
      const avgRate = (segment.startRate + segment.endRate) / 2 / 100;
      tax += taxableSpan * avgRate;
      remaining -= taxableSpan;
    }
    if (remaining > 0) {
      const last = segments[segments.length - 1];
      tax += remaining * (last.endRate / 100);
    }
    return tax;
  }

  function computeFederalTax(income, status) {
    if (!income) return 0;
    return status === STATUS_MARRIED
      ? computeFederalTaxMarried(income)
      : computeFederalTaxSingle(income);
  }

  function computeFederalTaxSingle(income) {
    let tax = 0;
    if (income <= 14700) {
      tax = 0;
    } else if (income <= 31500) {
      tax = ((income - 14700) * 0.77) / 100;
    } else if (income <= 41300) {
      tax = 131.21 + ((income - 31500) * 0.88) / 100;
    } else if (income <= 55000) {
      tax = 214.99 + ((income - 41300) * 2.64) / 100;
    } else if (income <= 74200) {
      tax = 564.46 + ((income - 55000) * 2.97) / 100;
    } else if (income <= 79000) {
      tax = 1140.16 + ((income - 74200) * 5.94) / 100;
    } else if (income <= 103100) {
      tax = 1436.82 + ((income - 79000) * 6.6) / 100;
    } else if (income <= 134600) {
      tax = 3032.31 + ((income - 103100) * 8.8) / 100;
    } else if (income <= 176000) {
      tax = 5947.82 + ((income - 134600) * 11.0) / 100;
    } else if (income <= 755200) {
      tax = 10822.19 + ((income - 176000) * 13.2) / 100;
    } else {
      tax = 92842.07 + ((income - 755200) * 11.5) / 100;
    }
    return Math.max(0, tax);
  }

  function computeFederalTaxMarried(income) {
    let tax = 0;
    if (income <= 28400) {
      tax = 0;
    } else if (income <= 50600) {
      tax = ((income - 28400) * 1.0) / 100;
    } else if (income <= 57700) {
      tax = 222 + ((income - 50600) * 2.0) / 100;
    } else if (income <= 71200) {
      tax = 363 + ((income - 57700) * 3.0) / 100;
    } else if (income <= 103600) {
      tax = 861 + ((income - 71200) * 4.0) / 100;
    } else if (income <= 134600) {
      tax = 1965 + ((income - 103600) * 5.0) / 100;
    } else if (income <= 176000) {
      tax = 3460 + ((income - 134600) * 6.0) / 100;
    } else if (income <= 221300) {
      tax = 5984 + ((income - 176000) * 7.0) / 100;
    } else if (income <= 752900) {
      tax = 9319 + ((income - 221300) * 8.0) / 100;
    } else {
      tax = 57159 + ((income - 752900) * 11.5) / 100;
    }
    return Math.max(0, tax);
  }

  function computeNetWealth(formState) {
    const assets = formState?.assets || {};
    const credits = formState?.credits || {};
    const investments = formState?.investments || {};
    const realEstate = formState?.realEstate || formState?.immobilier || {};

    const currentAccount = toNumber(assets.currentAccount);
    const savingsAccount = toNumber(assets.savingsAccount);
    const otherAssetsTotal = sumOtherAssets(assets);
    const investmentHoldings = sumInvestments(investments.items);

    const properties = Array.isArray(realEstate?.properties)
      ? realEstate.properties
      : Array.isArray(realEstate)
      ? realEstate
      : [];
    let propertyNet = 0;
    properties.forEach((property) => {
      const value = toNumber(property?.valeur || property?.valeur_estimee || property?.value);
      const mortgage = toNumber(property?.hypotheque || property?.hypotheque_actuelle);
      propertyNet += Math.max(0, value - mortgage);
    });

    if (!properties.length) {
      const propertyValue = toNumber(assets.propertyValue);
      const mortgageBalance = toNumber(assets.mortgageBalance);
      propertyNet += Math.max(0, propertyValue - mortgageBalance);
    }

    const vehicleValue = toNumber(assets.vehicleValue);
    const thirdPillarLiquid =
      assets.thirdPillarType && assets.thirdPillarType.toLowerCase() !== "a"
        ? toNumber(assets.thirdPillarAmount)
        : 0;

    const totalDebts = computeDebtDeduction(credits.loans || []);

    return Math.max(
      0,
      currentAccount +
        savingsAccount +
        otherAssetsTotal +
        investmentHoldings +
        propertyNet +
        vehicleValue +
        thirdPillarLiquid -
        totalDebts
    );
  }

  function computeWealthBreakdown(formState) {
    const assets = formState?.assets || {};
    const credits = formState?.credits || {};
    const investments = formState?.investments || {};

    const currentAccount = toNumber(assets.currentAccount);
    const savingsAccount = toNumber(assets.savingsAccount);
    const otherAssetsTotal = sumOtherAssets(assets);
    const investmentHoldings = sumInvestments(investments.items);
    const propertyValue = toNumber(assets.propertyValue);
    const mortgageBalance = toNumber(assets.mortgageBalance);
    const propertyNet = Math.max(0, propertyValue - mortgageBalance);
    const vehicleValue = toNumber(assets.vehicleValue);
    const thirdPillarLiquid =
      assets.thirdPillarType && assets.thirdPillarType.toLowerCase() !== "a"
        ? toNumber(assets.thirdPillarAmount)
        : 0;
    const debts = computeDebtDeduction(credits.loans || []);
    const netWealth =
      currentAccount +
      savingsAccount +
      otherAssetsTotal +
      investmentHoldings +
      propertyNet +
      vehicleValue +
      thirdPillarLiquid -
      debts;

    return {
      currentAccount,
      savingsAccount,
      otherAssets: otherAssetsTotal,
      investments: investmentHoldings,
      propertyNet,
      vehicles: vehicleValue,
      thirdPillarLiquid,
      debts,
      netWealth: Math.max(0, netWealth),
    };
  }

  function computeWealthTax(netWealth, brackets) {
    if (!netWealth) return 0;
    let remaining = netWealth;
    let previousLimit = 0;
    let total = 0;
    for (const bracket of brackets) {
      const span = Math.min(remaining, bracket.limit - previousLimit);
      if (span > 0) {
        total += span * bracket.rate;
        remaining -= span;
      }
      previousLimit = bracket.limit;
      if (remaining <= 0) break;
    }
    return total;
  }

  function resolveAdvancePayments(taxes, taxYear, context) {
    let total = 0;
    total += toNumber(taxes.advancePayments);
    total += toNumber(context.advancePayments);
    if (Array.isArray(context.advancePaymentsList)) {
      total += context.advancePaymentsList
        .filter((entry) => !entry.year || entry.year === taxYear)
        .reduce((sum, entry) => sum + toNumber(entry.amount), 0);
    }
    total += getStoredAdvancePayments(taxYear, context.paymentsStorageKey);
    return total;
  }

  function getStoredAdvancePayments(taxYear, storageKey = DEFAULT_ADVANCE_PAYMENTS_KEY) {
    if (typeof localStorage === "undefined") return 0;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry) => !entry.year || entry.year === taxYear)
          .reduce((sum, entry) => sum + toNumber(entry.amount || entry.value), 0);
      }
      if (typeof parsed === "object" && parsed !== null) {
        const amount = parsed[taxYear] || parsed.amount;
        return toNumber(amount);
      }
    } catch (_error) {
      return 0;
    }
    return 0;
  }

  function buildProvisionPlan({
    totalTax,
    alreadyPaid,
    formState,
    assets,
    expenses,
    fiscalYear,
    now,
  }) {
    const remaining = Math.max(0, totalTax - alreadyPaid);
    const monthsRemaining = monthsUntilFiscalDeadline(fiscalYear, now);
    const monthlyAmount = monthsRemaining > 0 ? remaining / monthsRemaining : remaining;

    const fixedMonthlyExpenses = computeFixedMonthlyExpenses(expenses);
    const liquidity = toNumber(assets.currentAccount) + toNumber(assets.savingsAccount);
    const safetyBuffer = fixedMonthlyExpenses * 2;
    const availableSurplus = Math.max(0, liquidity - safetyBuffer);

    let statusType = "ok";
    let situationMessage = "";

    if (remaining <= 0) {
      statusType = "success";
      situationMessage = "Vous avez déjà couvert vos impôts pour cette année fiscale.";
    } else if (availableSurplus >= remaining) {
      statusType = "success";
      situationMessage = "Votre trésorerie permet de régler immédiatement le solde restant.";
    } else if (monthlyAmount <= availableSurplus / Math.max(monthsRemaining, 1)) {
      statusType = "warning";
      situationMessage = "Votre épargne couvre partiellement le solde : planifiez des versements réguliers.";
    } else {
      statusType = "alert";
      situationMessage = "Provision insuffisante : augmentez vos versements ou libérez de la liquidité.";
    }

    return {
      remaining,
      remainingMonths: monthsRemaining,
      monthlyAmount,
      availableSurplus,
      fixedMonthlyExpenses,
      advancePayments: alreadyPaid,
      statusType,
      situationMessage,
      deadline: fiscalDeadlineISO(fiscalYear),
    };
  }

  function monthsUntilFiscalDeadline(fiscalYear, referenceDate) {
    const deadline = new Date(fiscalYear, 2, 31);
    if (Number.isNaN(deadline.getTime())) return 0;
    const now = referenceDate || new Date();
    if (now > deadline) return 0;
    let months = (deadline.getFullYear() - now.getFullYear()) * 12 + (deadline.getMonth() - now.getMonth());
    if (deadline.getDate() >= now.getDate()) months += 1;
    return Math.max(1, months);
  }

  function fiscalDeadlineISO(fiscalYear) {
    const deadline = new Date(fiscalYear, 2, 31);
    return Number.isNaN(deadline.getTime()) ? null : deadline.toISOString();
  }

  function computeFixedMonthlyExpenses(expenses) {
    if (!expenses || !Array.isArray(expenses.fixed)) return 0;
    return expenses.fixed.reduce((sum, expense) => {
      const amount = toNumber(expense?.amount);
      if (!amount) return sum;
      const frequency = (expense?.frequency || "mensuel").toLowerCase();
      if (frequency === "annuel") {
        return sum + amount / 12;
      }
      return sum + amount;
    }, 0);
  }

  function sumOtherAssets(assets) {
    if (Array.isArray(assets?.otherAssets) && assets.otherAssets.length) {
      return assets.otherAssets.reduce((sum, entry) => sum + toNumber(entry?.amount), 0);
    }
    return toNumber(assets?.otherAssetsAmount);
  }

  function sumInvestments(items) {
    if (!Array.isArray(items)) return 0;
    return items.reduce((sum, entry) => sum + toNumber(entry?.amount), 0);
  }

  function computeUserShare(annualIncomePersonal, spouseIncome, totalTax) {
    const totalIncome = annualIncomePersonal + spouseIncome;
    if (totalIncome <= 0) {
      return {
        user: 1,
        spouse: 0,
        userAmount: totalTax,
        spouseAmount: 0,
      };
    }
    const userShare = Math.min(1, Math.max(0, annualIncomePersonal / totalIncome));
    const spouseShare = 1 - userShare;
    return {
      user: userShare,
      spouse: spouseShare,
      userAmount: Math.round(totalTax * userShare),
      spouseAmount: Math.round(totalTax * spouseShare),
    };
  }

  function mapTaxUserData(taxUserData = {}) {
    const incomesSource = Array.isArray(taxUserData.incomes)
      ? { entries: taxUserData.incomes }
      : taxUserData.incomes || {};
    const incomesArray =
      incomesSource.entries ||
      taxUserData.incomeEntries ||
      taxUserData.incomeSources ||
      taxUserData.salaryEntries;
    const normalizedIncomes = ensureArray(incomesArray).map((entry = {}) => ({
      amount: entry.amount,
      amountType: entry.amountType,
      thirteenth: entry.thirteenth,
      sourceType: entry.sourceType,
      frequency: entry.frequency,
    }));
    const spouseIncomeRaw =
      taxUserData.spouseNetIncome ??
      incomesSource.spouseNetIncome ??
      taxUserData.spouseIncome ??
      incomesSource.spouseIncome ??
      0;
    const spouseIncomeFrequency =
      taxUserData.spouseIncomeFrequency ??
      taxUserData.spouseNetIncomeFrequency ??
      incomesSource.spouseIncomeFrequency ??
      incomesSource.spouseNetIncomeFrequency ??
      taxUserData.spouseIncomePeriod ??
      incomesSource.spouseIncomePeriod ??
      "mensuel";
    const spouseNetIncomeAnnual = annualizeIncomeValue(spouseIncomeRaw, spouseIncomeFrequency);
    const taxesData = taxUserData.taxes || {};
    const expensesData = taxUserData.expenses || {};
    const assetsData = taxUserData.assets || {};
    const creditsData = taxUserData.credits || {};
    const spouseInsuranceValue = toNumber(
      taxUserData.basicInsuranceSpouse ??
        taxesData.basicInsuranceSpouse ??
        taxUserData.spouseInsurance ??
        taxesData.spouseInsurance
    );
    return {
      personal: {
        maritalStatus: taxUserData.maritalStatus || taxUserData.civilStatus || "",
        childrenCount: toNumber(taxUserData.childrenCount),
        birthDate: taxUserData.birthDate,
      },
      incomes: {
        entries: normalizedIncomes,
        spouseNetIncome: spouseNetIncomeAnnual,
        spouseIncomeFrequency,
      },
      taxes: {
        paysTaxes: taxUserData.paysTaxes ?? taxesData.paysTaxes ?? "oui",
        commuteDistance: toNumber(taxUserData.commuteDistance || taxesData.commuteDistance),
        transportMode: taxUserData.transportMode || taxesData.transportMode,
        spouseCommuteDistance: toNumber(
          taxUserData.spouseCommuteDistance ?? taxesData.spouseCommuteDistance
        ),
        spouseTransportMode: taxUserData.spouseTransportMode || taxesData.spouseTransportMode,
        mealsFrequency: taxUserData.mealsFrequency || taxesData.mealsFrequency,
        spouseMealsFrequency: taxUserData.spouseMealsFrequency || taxesData.spouseMealsFrequency,
        basicInsurance: toNumber(taxUserData.basicInsurance || taxesData.basicInsurance),
        basicInsuranceSpouse: spouseInsuranceValue,
        spouseInsurance: spouseInsuranceValue,
        childcareCosts: toNumber(taxUserData.childcareCosts || taxesData.childcareCosts),
        taxProvision: toNumber(taxUserData.taxProvision || taxesData.taxProvision),
        advancePayments: toNumber(taxUserData.advancePayments || taxesData.advancePayments),
      },
      assets: {
        currentAccount: toNumber(assetsData.currentAccount || taxUserData.currentAccount),
        savingsAccount: toNumber(assetsData.savingsAccount || taxUserData.savingsAccount),
        savingsContribution: toNumber(assetsData.savingsContribution),
        securityBalance: toNumber(assetsData.securityBalance || assetsData.savingsSecurity),
        thirdPillarContribution: toNumber(assetsData.thirdPillarContribution),
        thirdPillarAmount: toNumber(assetsData.thirdPillarAmount || taxUserData.thirdPillarAmount),
        thirdPillarType: assetsData.thirdPillarType || taxUserData.thirdPillarType,
        mortgageInterestAnnual: toNumber(
          assetsData.mortgageInterestAnnual || taxUserData.mortgageInterestAnnual
        ),
        mortgageInterests: ensureArray(assetsData.mortgageInterests || taxUserData.mortgageInterests),
        otherAssets: ensureArray(assetsData.otherAssets || taxUserData.otherAssets),
        propertyValue: toNumber(assetsData.propertyValue || taxUserData.propertyValue),
        mortgageBalance: toNumber(assetsData.mortgageBalance || taxUserData.mortgageBalance),
        vehicleValue: toNumber(assetsData.vehicleValue || taxUserData.vehicleValue),
      },
      expenses: {
        fixed: ensureArray(expensesData.fixed || taxUserData.fixedExpenses),
        variable: ensureArray(expensesData.variable || taxUserData.variableExpenses),
        exceptional: ensureArray(expensesData.exceptional || taxUserData.exceptionalExpenses),
      },
      credits: {
        loans: ensureArray(creditsData.loans || taxUserData.loans),
      },
      investments: {
        items: ensureArray(taxUserData.investments || taxUserData.investmentEntries),
      },
      realEstate: taxUserData.realEstate || taxUserData.immobilier || {},
    };
  }

  function isPartnered(personal, incomes) {
    return resolveMaritalStatus(personal, incomes) === STATUS_MARRIED;
  }

  function annualizeIncomeValue(value, frequency) {
    const amount = toNumber(value);
    if (!amount) return 0;
    const normalized = (frequency ?? "mensuel").toString().toLowerCase().trim();
    if (!normalized) {
      return amount * 12;
    }
    const numericMatch = /^\d+$/.test(normalized) ? Number(normalized) : null;
    if (numericMatch) {
      return amount * numericMatch;
    }
    if (normalized.includes("ann")) {
      return amount;
    }
    if (normalized.includes("13")) {
      return amount * 13;
    }
    if (normalized.includes("hebdo") || normalized.includes("week")) {
      return amount * 52;
    }
    if (normalized.includes("jour") || normalized.includes("day")) {
      return amount * 220;
    }
    if (normalized.includes("mens") || normalized.includes("month") || normalized.includes("mois")) {
      return amount * 12;
    }
    return amount * 12;
  }

  function isYes(value) {
    if (typeof value === "boolean") return value;
    if (value == null) return true;
    const normalized = value.toString().trim().toLowerCase();
    const falsy = ["non", "no", "false", "0"];
    const truthy = ["oui", "yes", "true", "1"];
    if (falsy.includes(normalized)) return false;
    if (truthy.includes(normalized)) return true;
    return true;
  }

  function toNumber(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      let cleaned = trimmed.replace(/[\s'_]/g, "");
      const hasComma = cleaned.includes(",");
      const hasDot = cleaned.includes(".");
      if (hasComma && hasDot) {
        cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
      } else if (hasComma) {
        cleaned = cleaned.replace(/,/g, ".");
      }
      if (!cleaned) return 0;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return 0;
  }

  return {
    calculateAnnualTax,
    mapTaxUserData,
    toNumber,
  };
});
