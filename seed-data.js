(function () {
  const STORAGE_KEYS = {
    user: "smartsaveActiveUser",
    form: "smartsaveFormData",
    transactions: "transactions",
    month: "smartsaveMonthState",
  };

  const SAMPLE_USER = {
    id: "sample-user",
    displayName: "Jonas Savary",
  };

  const SAMPLE_FORM_DATA = {
    __default: {
      personal: {
        displayName: "Jonas Savary",
        firstName: "Jonas",
        lastName: "Savary",
        canton: "FR",
        maritalStatus: "celibataire",
        employmentStatus: "employe",
        childrenCount: 0,
      },
      assets: {
        currentAccount: 4200,
        savingsAccount: 8600,
        liquidAssetsTotal: 12800,
        investments: 26000,
        investmentsTotal: 26000,
        blockedAccounts: 0,
      },
      incomes: {
        entries: [
          {
            amount: 5200,
            amountType: "net",
            frequency: "mensuel",
          },
        ],
        spouseNetIncome: 0,
      },
      expenses: {
        fixed: [
          {
            amount: 1200,
            frequency: "mensuel",
          },
        ],
        variable: [
          {
            amount: 700,
            frequency: "mensuel",
          },
        ],
      },
      credits: {
        assetsTotal: 39000,
        debtsTotal: 7500,
      },
      taxes: {
        taxes: 3500,
        paysTaxes: "oui",
      },
      investments: {
        portfolio: 26000,
      },
      vision: {
        objectives: ["Épargne projet"],
      },
    },
  };

  const SAMPLE_TRANSACTIONS = [
    { id: "t1", amount: -125, category: "Courses", date: "2026-01-10" },
    { id: "t2", amount: -260, category: "Loyer", date: "2026-01-02" },
    { id: "t3", amount: -75, category: "Transports", date: "2026-01-14" },
    { id: "t4", amount: 5200, category: "Salaire", date: "2026-01-01" },
  ];

  const SAMPLE_MONTH_STATE = {
    currentMonth: "2026-01",
  };

  const ensureStorage = (key, value) => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  };

  if (typeof window === "undefined" || !window.localStorage) return;

  // Seed only when explicitly enabled.
  // Enable by setting localStorage.smartsaveSeedData = "1"
  // or opening URL with ?seed=1
  const params = new URLSearchParams(window.location.search || "");
  const seedEnabled =
    localStorage.getItem("smartsaveSeedData") === "1" || params.get("seed") === "1";
  if (!seedEnabled) return;

  ensureStorage(STORAGE_KEYS.user, SAMPLE_USER);
  ensureStorage(STORAGE_KEYS.form, SAMPLE_FORM_DATA);
  ensureStorage(STORAGE_KEYS.transactions, SAMPLE_TRANSACTIONS);
  ensureStorage(STORAGE_KEYS.month, SAMPLE_MONTH_STATE);
})();
