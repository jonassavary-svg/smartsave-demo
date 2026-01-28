# SmartSave IA Proxy

Ce backend Node/Express expose un endpoint sécurisé (`POST /api/ai/insights`) qui :

1. Réceptionne un payload chiffré (AES-256-GCM) depuis l’interface.
2. Déchiffre les données côté serveur avec `AI_PAYLOAD_KEY`.
3. Interroge l’API OpenAI (ou autre modèle compatible) avec un prompt strict.
4. Met en cache les réponses et limite le débit des appels.

## Installation

```bash
cd server
npm install
```

## Variables d’environnement

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | Clé privée OpenAI. Obligatoire pour appeler l’IA. |
| `AI_PAYLOAD_KEY` | Clé AES-256-GCM (32 bytes hex) utilisée pour déchiffrer les payloads. |
| `OPENAI_MODEL` | Modèle cible (défaut `gpt-4o-mini`). |
| `AI_RATE_LIMIT_PER_MINUTE` | Limite des requêtes par minute (défaut `15`). |
| `AI_CACHE_TTL_MINUTES` | TTL du cache local en minutes (défaut `5`). |
| `PORT` | Port d’écoute (défaut `3000`). |
| `N8N_COACH_URL` | URL du webhook n8n pour `/api/coach` (défaut = webhook prod). |

Génère une clé AES avec :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Injection de la clé côté client

Le frontend ne doit jamais embracher directement `OPENAI_API_KEY`. La même clé que `AI_PAYLOAD_KEY` doit être fournie au script `aiAssistant.js` via un rendu sécurisé (ex. : script inline généré par le serveur, header ou meta tag construit dynamiquement). L’idée est de ne pas stocker la clé dans un fichier versionné.

Exemple (Express) :

```js
app.get("/resultats", (req, res) => {
  res.render("resultats", {
    aiPayloadKey: process.env.AI_PAYLOAD_KEY,
  });
});
```

Et dans ton HTML rendu :

```html
<script>
  window.SMARTSAVE_AI_PAYLOAD_KEY = "{{aiPayloadKey}}";
</script>
```

## Lancement

```bash
npm run start
```

Optionnel : override du webhook n8n

```bash
export N8N_COACH_URL="https://jonasavary.app.n8n.cloud/webhook/smartsave-ai-coach"
```

Le serveur expose :

- `POST /api/ai/insights` : accepte `{ ciphertext, nonce, tag }` et renvoie la réponse IA.
- `POST /api/coach` : proxy vers n8n, renvoie toujours du JSON.
- `GET /api/coach/health` : healthcheck simple (`{ ok: true }`).
- `GET /api/health` : vérifie la configuration.

## Sécurité & robustesse

- L’API applique un rate-limit et un cache mémoire (LRU) pour éviter les appels doublons.
- Si OpenAI est indisponible, le backend retourne une réponse déterministe (toujours valide) pour maintenir l’expérience.

## Prompts IA

Le backend construit dynamiquement un prompt système + utilisateur avant chaque appel OpenAI.
- Pour la section *Analyse IA* (intent `"analyse-ia"`), le prompt insiste sur une analyse complète, chiffres/ratios, forces/faiblesses, et actions concrètes.
- D’autres intents pourront être ajoutées pour des usages différents : `buildSystemPrompt`/`buildUserPrompt` détectent actuellement l’intent et choisissent la variante adéquate.
- Pour ajouter un nouvel intent, crée une entrée dans la constante `PROMPT_VARIANTS` (dans `server/index.js`) avec les fonctions `system` et `user` correspondantes.
Les réponses doivent toujours suivre le schéma JSON strict défini dans `server/index.js`. Toute modification de l’intent doit rester compatible avec cette structure.
