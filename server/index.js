const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { LRUCache } = require("lru-cache");
const crypto = require("crypto");
const { fetch } = require("undici");

const PORT = process.env.PORT || 3000;
const PAYLOAD_KEY = process.env.AI_PAYLOAD_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const RATE_LIMIT = Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 15);
const CACHE_TTL_MINUTES = Number(process.env.AI_CACHE_TTL_MINUTES || 5);
const USE_OPENAI_RESPONSES = process.env.OPENAI_USE_RESPONSES === "true";
const N8N_COACH_WEBHOOK =
  process.env.N8N_COACH_URL || "https://jonasavary.app.n8n.cloud/webhook/smartsave-ai-coach";

const AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    diagnostic: { type: "string" },
    priorityDecision: { type: "string" },
    whyThisPriority: { type: "string" },
    concreteAction: { type: "string" },
    notNowExplanation: { type: "string" },
    nextStepSignal: { type: "string" },
    toneCheck: { type: "string" },
  },
  required: [
    "diagnostic",
    "priorityDecision",
    "whyThisPriority",
    "concreteAction",
    "notNowExplanation",
    "nextStepSignal",
    "toneCheck",
  ],
};
const AI_JSON_SCHEMA_STR = JSON.stringify(AI_JSON_SCHEMA, null, 2);

const app = express();
app.use(express.json({ limit: "128kb" }));
app.use(express.static(path.join(__dirname, "..")));

const limiter = rateLimit({
  windowMs: 60_000,
  max: RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: "Trop de requêtes IA, réessaie dans quelques instants." }),
});
app.use("/api/ai/insights", limiter);

const cache = new LRUCache({
  max: 400,
  ttl: CACHE_TTL_MINUTES * 60_000,
});

app.post("/api/ai/insights", async (req, res) => {
  if (!PAYLOAD_KEY) {
    return res.status(500).json({ error: "AI_PAYLOAD_KEY is not configured on the backend." });
  }
  const { ciphertext, nonce, tag } = req.body || {};
  if (!ciphertext || !nonce || !tag) {
    return res.status(400).json({ error: "ciphertext, nonce and tag are required." });
  }

  let payload;
  try {
    payload = decryptPayload(ciphertext, nonce, tag, PAYLOAD_KEY);
  } catch (error) {
    return res.status(400).json({ error: "Unable to decrypt payload.", reason: error.message });
  }

  const cacheKey = createCacheKey(payload);
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ data: cached, cached: true, payloadHash: cacheKey });
  }

  if (!OPENAI_API_KEY) {
    const fallback = buildDeterministicResponse(payload);
    cache.set(cacheKey, fallback);
    return res.status(503).json({
      data: fallback,
      fallback: true,
      warning: "OPENAI_API_KEY manquante, réponse déterministe fournie.",
      payloadHash: cacheKey,
    });
  }

  try {
    const aiResponse = await callOpenAi(payload);
    cache.set(cacheKey, aiResponse);
    return res.json({ data: aiResponse, payloadHash: cacheKey });
  } catch (error) {
    const fallback = buildDeterministicResponse(payload);
    cache.set(cacheKey, fallback);
    return res.status(502).json({
      data: fallback,
      fallback: true,
      error: error.message,
      payloadHash: cacheKey,
    });
  }
});

app.post("/api/coach", async (req, res) => {
  try {
    const response = await fetch(N8N_COACH_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();
    let data = null;
    if (contentType.includes("application/json") && rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      return res.status(response.status).json({
        error: "coach_unavailable",
        status: response.status,
        message: data ?? rawText,
      });
    }
    if (data) {
      return res.status(response.status).json(data);
    }
    return res.status(response.status).json({ message: rawText });
  } catch (error) {
    return res.status(502).json({ error: "coach_unavailable", reason: error.message });
  }
});

app.get("/api/coach/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    aiModelConfigured: Boolean(OPENAI_API_KEY),
    payloadKeyConfigured: Boolean(PAYLOAD_KEY),
  });
});

app.listen(PORT, () => {
  console.log(`SmartSave IA proxy listening on http://localhost:${PORT}`);
});

function decryptPayload(ciphertextBase64, nonceBase64, tagBase64, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("AI_PAYLOAD_KEY must be 32 bytes (64 hex chars)." );
  }
  const iv = Buffer.from(nonceBase64, "base64");
  const ciphertext = Buffer.from(ciphertextBase64, "base64");
  const authTag = Buffer.from(tagBase64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

function callOpenAi(payload) {
  const featureLabel = payload.context?.feature || "Analyse IA";
  const promptIntent = payload.context?.promptIntent || "analyse-ia";
  const systemPrompt = buildSystemPrompt(featureLabel, promptIntent);
  const userPrompt = buildUserPrompt(payload, featureLabel, promptIntent);

  const baseMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  return queryOpenAi(baseMessages).then((first) => {
    if (first.parsed) {
      return first.parsed;
    }
    const retryMessages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `${userPrompt}\nTu as renvoyé un JSON invalide. Réponds uniquement par le JSON conforme au schéma ci-dessous :\n${AI_JSON_SCHEMA_STR}`,
      },
    ];
    return queryOpenAi(retryMessages).then((retry) => {
      if (!retry.parsed) {
        throw new Error("could not parse AI output after retry");
      }
      return retry.parsed;
    });
  });
}

async function queryOpenAi(messages) {
  const body = {
    model: MODEL,
    temperature: 0.2,
    messages,
  };
  if (USE_OPENAI_RESPONSES) {
    body.response_format = {
      type: "json_object",
      json_schema: AI_JSON_SCHEMA,
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`OpenAI responded with ${response.status}`);
  }
  const payload = await response.json();
  const assistant = extractAssistantContent(payload);
  const parsed = parseAiJson(assistant);
  if (parsed && isValidAiResponse(parsed)) {
    return { parsed };
  }
  return { parsed: null, raw: assistant };
}

const PROMPT_VARIANTS = {
  "analyse-ia": {
    system: buildSystemPromptForAnalysis,
    user: buildUserPromptForAnalysis,
  },
};

function buildSystemPrompt(featureLabel, promptIntent) {
  return getPromptVariant(promptIntent).system(featureLabel, promptIntent);
}

function buildSystemPromptForAnalysis(featureLabel, promptIntent) {
  return `🧠 PROMPT SYSTÈME — SmartSave IA (DÉPENSES + RÈGLES SMARTSAVE)

Rôle
Tu es SmartSave, un coach financier personnel pour des particuliers en Suisse. Tu ne fais pas des “commentaires”, tu prends une décision et tu guides.

Règles absolues (non négociables)
- Tu ne fais AUCUN calcul (pas de nouveaux pourcentages, pas de divisions, pas de totaux).
- Tu n’inventes AUCUN chiffre et tu n’ajoutes AUCUNE hypothèse.
- Tu utilises UNIQUEMENT les données fournies dans le payload (métriques, ratios, flags, breakdown).
- Tu ne répètes pas ce que l’interface affiche déjà (évite de paraphraser les cartes/chiffres).
- Tu ne donnes jamais plus de 3 conseils. Une seule priorité principale.
- Ton style: humain, clair, motivant, zéro jargon, pas moralisateur.
- Si des données sont manquantes, tu le dis explicitement et tu adaptes l’analyse (sans combler les trous).

Cadre SmartSave (obligatoire)
Tu dois toujours raisonner et recommander en respectant cet ordre de priorités, sans sauter d’étape :
1) Provision impôts (si le payload indique qu’elle existe ou qu’elle manque)
2) Remplir le compte courant (objectif lié aux dépenses fixes)
3) Sécurité / épargne de précaution (objectif en mois de dépenses)
4) 3e pilier (si pertinent et si la sécurité minimale est atteinte)
5) Investissements (uniquement si les conditions de déblocage sont atteintes)
6) Bonus (uniquement si tout est respecté)

Règle d’or
Ta mission est de répondre à : “Avec MA situation précise, qu’est-ce qui compte vraiment maintenant et quelle action simple je fais ce mois-ci ?”
Tu dois faire un arbitrage, pas une liste.

Comment interpréter (sans recalculer)
- Utilise les ratios/faits DÉJÀ fournis (fixedRatio, variableRatio, debtRatio, taxRatio, safetyMonths, monthlySavingsCapacity, flags, topIssues, breakdown).
- Explique le “pourquoi” derrière un problème (ex: sécurité faible → tout le reste est prématuré).
- Appuie-toi sur le breakdown pour citer 1–2 catégories dominantes (largestCategory / largestFixedCategory / largestVariableCategory) si elles existent.
- Si un flag “critical/high” existe, il prend la priorité sur tout le reste (sauf budget négatif en premier).
- Ne parle d’investissement / 3e pilier que si la sécurité minimale est atteinte OU si le payload dit explicitement que c’est déjà en place.
Je veux vraiment que tu me donnes une analyse complète de ce que je te donne donc tu analyse les chiffres etc et tu me donnes une analyse, une plus value au chiffres que je te donne. Pas besoin de me dire les montant qu'on sait déjà mais donnes une analyse concrète de ce que la personne peut faire pour améliorer sa situation et comment. Attention, il ne faut pas contredire ce que disent les règles smartsave (ex: si l'app dit que je dois mettre XX sur le compte épargne, tu ne contredis pas ça)
Format de sortie STRICT (JSON uniquement)
Tu dois répondre uniquement avec ce JSON (pas de markdown, pas de texte autour) :
{
  "diagnostic": "",
  "priorityDecision": "",
  "whyThisPriority": "",
  "concreteAction": "",
  "notNowExplanation": "",
  "nextStepSignal": "",
  "toneCheck": "bienveillant"
}

Cette demande concerne ${featureLabel} (intent : ${promptIntent}).`;
}

function buildSystemPromptDefault(featureLabel, promptIntent) {
  return `Tu es un coach financier personnel bienveillant, clair et non technique.
Règles absolues :
- Ne calcule rien, ne devine rien, ne crée aucune info non fournie.
- Ne contredis jamais les chiffres du payload ; cite toujours la donnée exacte ou le flag associé.
- Si une info manque, mentionne-le dans warnings au lieu d’inventer.
- Chaque bloc doit apporter une valeur ajoutée par rapport aux scores et graphiques visibles : explique le “pourquoi”, les écarts, l’impact concret.
- Évite toute phrase générique ou tautologique, explique les écarts (mois manquants, seuils non atteints, ratios critiques).
- Si un flag est actif alors qu’une métrique paraît “bonne”, explique pourquoi il reste un frein.
- Contextualise toujours les montants (par exemple : “correspond à X mois de dépenses”).
- Réponds UNIQUEMENT par un JSON valide, sans markdown, sans texte autour.
Schéma JSON EXACT :
{
  "spendingAnalysis": "string (2-4 phrases max, cite ratios/flags)",
  "keyWeakness": "string (1-2 phrases, 1 faiblesse principale)",
  "priorityLever": "string (1 action prioritaire claire, immédiate)",
  "smartSaveNarrative": ["2-3 phrases max, liées à allocation/objectif"],
  "projectionMotivation": "string (1-2 phrases, netWorthStart -> netWorthEnd, horizon)",
  "warnings": ["0..n phrases, 1 phrase par flag ou donnée critique manquante"]
}
Cette demande concerne ${featureLabel} (intent : ${promptIntent}).`;
}

function getPromptVariant(intent) {
  return (
    PROMPT_VARIANTS[intent] || {
      system: buildSystemPromptDefault,
      user: buildUserPromptDefault,
    }
  );
}

function buildUserPrompt(payload, featureLabel, promptIntent) {
  return getPromptVariant(promptIntent).user(payload, featureLabel, promptIntent);
}

function buildUserPromptForAnalysis(payload, featureLabel, promptIntent) {
  const payloadString = JSON.stringify(payload, null, 2);
  return `🧠 PROMPT UTILISATEUR — SmartSave IA (à envoyer avec le payload)

Contexte: feature=${featureLabel}, intent=${promptIntent}

Payload (données SmartSave, déjà calculées — ne rien recalculer) :
${payloadString}

Mission
1) Identifie UNE priorité absolue maintenant (selon SmartSave).
2) Justifie-la avec les métriques/flags fournis (sans paraphraser l’UI).
3) Donne UNE action concrète faisable ce mois-ci.
4) Dis clairement ce qu’on ne fait pas encore (et pourquoi).
5) Dis quelle est l’étape suivante une fois la priorité atteinte.

Réponds UNIQUEMENT avec ce JSON :
{
  "diagnostic": "",
  "priorityDecision": "",
  "whyThisPriority": "",
  "concreteAction": "",
  "notNowExplanation": "",
  "nextStepSignal": "",
  "toneCheck": "bienveillant"
}`;
}

function buildUserPromptDefault(payload, featureLabel, promptIntent) {
  const payloadString = JSON.stringify(payload, null, 2);
  const missingData = payload.summary?.missingData || [];
  const missingText = missingData.length
    ? `Données manquantes : ${missingData.join(", ")}.`
    : "Aucune donnée critique manquante détectée.";
  const sizeWarning = payload.summary?.sizeWarning ? `Note : ${payload.summary.sizeWarning}` : "Toutes les données essentielles sont fournies.";
  const dataWarnings = payload.summary?.dataQualityWarnings || [];
  const warningNote = dataWarnings.length ? `Avertissements internes : ${dataWarnings.join(" | ")}.` : "Aucun avertissement interne.";

  return `Contexte : feature=${featureLabel}, intent=${promptIntent}
${sizeWarning}
${missingText}
${warningNote}

Payload :
${payloadString}

Mission :
- spendingAnalysis : explique comment le montant mensuel, les ratios fixes/variables/dette et les flags interagissent ; relie dépenses ↔ sécurité ↔ stabilité ; cite un écart concret (ex : “ton coussin couvrira X mois de dépenses”, “le ratio fixe dépasse de Y points”), 2 à 3 phrases max.
- keyWeakness : formule une seule faiblesse concrète (pas un score), décris ce qui bloque l’équilibre (“ce frein empêche ta situation de devenir solide”), et privilégie le flag le plus critique ou, si absent, le ratio le plus problématique.
- priorityLever : propose une action immédiate, mesurable et précise (“faire X pour atteindre Y”), liée à la faiblesse identifiée.
- smartSaveNarrative : 2-3 phrases qui relient allocation → protection → sérénité, en expliquant les bénéfices concrets plutôt que de répéter des montants.
- projectionMotivation : mentionne toujours l’horizon temporel et explique pourquoi la croissance existe (discipline, réallocation, économies régulières), pas seulement les chiffres.
- warnings : décline chaque flag interne en langage humain et explique le risque réel ; ajoute aussi les données essentielles manquantes (objective, revenu, projection) en termes compréhensibles. Si rien ne manque ni n’alerte, renvoie [].

Respecte rigoureusement ce format et cite uniquement les informations présentes dans le payload.`;
}

function extractAssistantContent(body) {
  if (Array.isArray(body?.output) && body.output[0]?.content?.[0]?.text) {
    return String(body.output[0].content[0].text);
  }
  return body?.choices?.[0]?.message?.content || "";
}

function parseAiJson(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/```json/i, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isValidAiResponse(response = {}) {
  if (typeof response !== "object" || response === null) return false;
  const arrayOfStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
  const newSchemaValid =
    typeof response.diagnostic === "string" &&
    typeof response.priorityDecision === "string" &&
    typeof response.whyThisPriority === "string" &&
    typeof response.concreteAction === "string" &&
    typeof response.notNowExplanation === "string" &&
    typeof response.nextStepSignal === "string" &&
    typeof response.toneCheck === "string";
  const legacyValid =
    typeof response.spendingAnalysis === "string" &&
    typeof response.keyWeakness === "string" &&
    typeof response.priorityLever === "string" &&
    typeof response.projectionMotivation === "string" &&
    arrayOfStrings(response.smartSaveNarrative) &&
    arrayOfStrings(response.warnings);
  return newSchemaValid || legacyValid;
}

function createCacheKey(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildDeterministicResponse(payload = {}) {
  const spending = payload.spending || {};
  const projection = payload.projection || {};
  const summaryMetrics = payload.summary?.metrics || {};
  const flags = spending.flags || [];

  const safetyMonths = Number.isFinite(summaryMetrics.safetyMonths)
    ? summaryMetrics.safetyMonths
    : null;
  const ratios = spending.ratios || {};
  const totalMonthly = spending.totalMonthly || 0;
  const monthlyIncome = summaryMetrics.monthlyIncome || 0;
  const savingsCapacity =
    Number.isFinite(summaryMetrics.savingsCapacity) ? summaryMetrics.savingsCapacity : null;

  const securityIssue = safetyMonths !== null && safetyMonths < 3;
  const fixedIssue = Number.isFinite(ratios.fixed) && ratios.fixed > 0.55;
  const variableIssue = Number.isFinite(ratios.variable) && ratios.variable > 0.35;
  const negativeSavings = Number.isFinite(savingsCapacity) && savingsCapacity < 0;

  const diagnosticParts = [];
  if (monthlyIncome > 0) {
    diagnosticParts.push(`Tu perçois ${formatCurrency(monthlyIncome)} de revenu net par mois.`);
  }
  if (totalMonthly > 0) {
    diagnosticParts.push(`Tu dépenses ${formatCurrency(totalMonthly)} chaque mois selon SmartSave.`);
  }
  if (securityIssue) {
    diagnosticParts.push(`Ta sécurité est fragile (${Math.round(safetyMonths)} mois de réserves).`);
  }
  if (!diagnosticParts.length) {
    diagnosticParts.push("Les données disponibles ne permettent pas d’aller plus loin que ce constat.");
  }

  let priorityDecision = "Rester discipliné sur la trajectoire SmartSave";
  let whyThisPriority = "La stabilité reste correcte et aucune zone critique ne bloque le plan.";
  if (securityIssue) {
    priorityDecision = "Renforcer immédiatement la sécurité";
    whyThisPriority = `La sécurité n’atteint pas 3 mois (actuellement ${Math.round(safetyMonths)}), donc l’urgence est là.`;
  } else if (fixedIssue) {
    priorityDecision = "Alléger les charges fixes";
    whyThisPriority = `Les charges fixes représentent ${Math.round(ratios.fixed * 100)}% du revenu, ce qui bride la capacité d’épargne.`;
  } else if (variableIssue) {
    priorityDecision = "Maîtriser les variables";
    whyThisPriority = `Les variables pèsent ${Math.round(ratios.variable * 100)}% du revenu, ce qui réduit la réserve de sécurité.`;
  } else if (negativeSavings) {
    priorityDecision = "Rétablir la capacité d’épargne";
    whyThisPriority = `La capacité d’épargne est négative (${formatCurrency(savingsCapacity)}), donc rien ne progresse tant qu’elle n’est pas positive.`;
  }

  let concreteAction = "Continue de suivre le plan SmartSave actuel et maintiens les transferts automatiques.";
  if (securityIssue) {
    const bufferTarget = totalMonthly ? formatCurrency(totalMonthly * 3) : "3 mois de dépenses";
    concreteAction = `Transfère immédiatement l’excédent vers la réserve sécurité jusqu’à atteindre ${bufferTarget}.`;
  } else if (fixedIssue) {
    concreteAction =
      "Identifie le poste fixe le plus coûteux (abonnement, assurance) et revoie ou négocie cette ligne cette semaine.";
  } else if (variableIssue) {
    concreteAction =
      "Choisis une catégorie variable et réduis-la de 10 à 15% ce mois, puis bloque ce seuil dans ton suivi.";
  } else if (negativeSavings) {
    concreteAction = "Active un virement automatique pour que la capacité d’épargne devienne positive dès ce mois.";
  }

  let notNowExplanation = "Ce n’est pas le moment de lancer un nouveau projet ou investissement.";
  if (securityIssue) {
    notNowExplanation = "Investir davantage serait prématuré tant que le coussin n’atteint pas les 3 mois de dépenses.";
  } else if (fixedIssue) {
    notNowExplanation = "Attends de stabiliser les charges fixes avant de réaffecter la trésorerie.";
  } else if (variableIssue) {
    notNowExplanation = "Ne change pas de plan avant d’avoir contenu ce niveau de variables.";
  } else if (negativeSavings) {
    notNowExplanation = "Ne pousse pas un objectif additionnel tant que la capacité d’épargne n’est pas revenue en positif.";
  }

  let nextStepSignal = "Une fois cette priorité validée, tu pourras accélérer vers la croissance.";
  if (priorityDecision.includes("sécurité")) {
    nextStepSignal =
      "Quand le coussin touchera 3 mois, concentre-toi sur les projets de croissance intelligemment alignés.";
  } else if (priorityDecision.includes("charges fixes")) {
    nextStepSignal =
      "Après avoir réduit ces charges, tu pourras réallouer la marge vers les objectifs SmartSave.";
  } else if (priorityDecision.includes("variables")) {
    nextStepSignal = "Une fois le cap posé, tu pourras augmenter l’épargne automatique sans créer de tension.";
  } else if (priorityDecision.includes("capacité d’épargne")) {
    nextStepSignal = "Quand la capacité sera redevenue positive, accélère l’épargne projetée.";
  }

  return {
    diagnostic: diagnosticParts.join(" "),
    priorityDecision,
    whyThisPriority,
    concreteAction,
    notNowExplanation,
    nextStepSignal,
    toneCheck: "bienveillant",
  };
}

function formatCurrency(value) {
  const number = Number.isFinite(value) ? value : Number(value) || 0;
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 0,
  }).format(number);
}
