const path = require("path");
const { calculateAnnualTax, mapTaxUserData, toNumber } = require(path.join(__dirname, "taxEngine.js"));

const baseFormState = (overrides = {}) => ({
  personal: {
    maritalStatus: "single",
    childrenCount: 0,
  },
  incomes: {
    entries: [
      {
        amount: 6000,
        amountType: "net",
        thirteenth: "oui",
      },
    ],
    spouseNetIncome: 0,
  },
  taxes: {
    paysTaxes: "oui",
  },
  assets: {
    currentAccount: 12000,
    savingsAccount: 5000,
  },
  expenses: {
    fixed: [{ amount: 2500 }],
    variable: [{ amount: 800 }],
    exceptional: [],
  },
  credits: {
    loans: [],
  },
  investments: {
    items: [],
  },
});

const scenarios = [
  { label: "Single / no kids", formState: baseFormState() },
  {
    label: "Single / 1 kid",
    formState: {
      ...baseFormState(),
      personal: { maritalStatus: "single", childrenCount: 1 },
    },
  },
  {
    label: "Married / 2 kids",
    formState: {
      ...baseFormState(),
      personal: { maritalStatus: "marie", childrenCount: 2 },
      incomes: {
        entries: [
          {
            amount: 5000,
            amountType: "net",
          },
        ],
        spouseNetIncome: 4000,
      },
    },
  },
  {
    label: "Married / with debts",
    formState: {
      ...baseFormState(),
      personal: { maritalStatus: "marie", childrenCount: 2 },
      incomes: {
        entries: [
          { amount: 7000, amountType: "net" },
          { amount: 3000, amountType: "net" },
        ],
        spouseNetIncome: 3000,
      },
      credits: {
        loans: [{ outstanding: 40000, monthlyAmount: 1200 }],
      },
      assets: {
        currentAccount: 5000,
        savingsAccount: 25000,
      },
    },
  },
];

scenarios.forEach((scenario) => {
  const result = calculateAnnualTax(scenario.formState, { taxYear: 2024 });
  console.log(
    `${scenario.label}: total=${result.total} monthlyNeed=${result.monthlyProvision.monthlyAmount.toFixed(
      2
    )} remaining=${result.monthlyProvision.remaining}`
  );
});

console.log(`toNumber("12'000") === 12000:`, toNumber("12'000") === 12000);
console.log(`toNumber("1'234.50") === 1234.5:`, toNumber("1'234.50") === 1234.5);

const spouseBaseTaxes = {
  paysTaxes: "oui",
  commuteDistance: 10,
  transportMode: "car",
  mealsFrequency: "1 jour/semaine",
};
const spouseBaseInput = {
  maritalStatus: "marie",
  spouseNetIncome: 4000,
  spouseIncomeFrequency: "mensuel",
  incomes: [
    {
      amount: 6000,
      amountType: "net",
      thirteenth: "oui",
    },
  ],
  taxes: spouseBaseTaxes,
};
const spouseExtrasInput = {
  ...spouseBaseInput,
  basicInsuranceSpouse: 5200,
  taxes: {
    ...spouseBaseTaxes,
    spouseCommuteDistance: 12,
    spouseTransportMode: "car",
    spouseMealsFrequency: "2 jours/semaine",
  },
};
const spouseBaseResult = calculateAnnualTax(mapTaxUserData(spouseBaseInput), { taxYear: 2024 });
const spouseExtrasResult = calculateAnnualTax(
  mapTaxUserData(spouseExtrasInput),
  { taxYear: 2024 }
);
console.log(
  "Spouse deductions increase when extras provided:",
  spouseExtrasResult.totalDeductions > spouseBaseResult.totalDeductions
);

["Non", false].forEach((variant) => {
  const formState = mapTaxUserData({
    incomes: [{ amount: 4000, amountType: "net" }],
    taxes: { paysTaxes: variant },
  });
  const result = calculateAnnualTax(formState, { taxYear: 2024 });
  console.log(
    `paysTaxes=${JSON.stringify(variant)} => total=${result.total} skipped=${result.skipped}`
  );
});
