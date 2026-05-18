const Anthropic = require("@anthropic-ai/sdk");

// Rate limiting en mémoire (reset à chaque cold start Netlify)
// Limite : 30 requêtes par IP par fenêtre de 60 secondes
const rateLimitMap = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Rate limiting par IP
  const clientIp = event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ message: "Trop de requêtes. Attends quelques secondes.", apply: {} }),
    };
  }

  try {
    const { message, context } = JSON.parse(event.body);

    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Message requis" }) };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Contexte réglages actuels formaté pour le prompt
    const contextStr = context
      ? `
Contexte actuel du pilote :
- Grip piste : ${context.grip || "non renseigné"}
- Météo : ${context.meteo || "non renseigné"}
- Température air : ${context.tempAir || "?"}°C
- Température piste : ${context.tempPiste || "?"}°C
- Type de circuit : ${context.circuit || "non renseigné"}
- Type de session : ${context.session || "non renseigné"}
- Problème dominant : ${context.comportement || "non renseigné"}
- Intensité : ${context.intensite || "?"}/10
- Barre avant : ${context.barre || "non renseigné"}
- Voie avant (bagues) : ${context.voieAv || "?"}
- Pincement : ${context.pincement || "?"}
- Voie arrière : ${context.voieAr || "?"} cm
- Arbre transmission : ${context.arbre || "non renseigné"}
- Moyeux : ${context.moyeux || "non renseigné"}
- Pare-chocs : ${context.parechocs || "non renseigné"}
- Chasse : ${context.chasse || "?"}
- Garde au sol AV : ${context.gardeAv || "non renseigné"}
- Garde au sol AR : ${context.gardeAr || "non renseigné"}
- Moteur : ${context.moteur || "non renseigné"}
- Couronne : ${context.couronne || "?"} dents
- Gicleur : ${context.gicleur || "?"}
- Notes pilote : ${context.notes || "aucune"}
`
      : "Aucun contexte de session fourni.";

    const systemPrompt = `Tu es Race Engineer AI, un ingénieur de course karting expert spécialisé en châssis OTK (Tony Kart, Kosmic, Exprit, Formula K).

Tu as une connaissance approfondie de :
- La philosophie OTK : travail par flexion du châssis, pas par grip mécanique brut
- Les réglages châssis karting : barre avant, voie AV/AR, pincement, chasse, garde au sol, arbre de transmission, moyeux, pare-chocs
- La mécanique du grip : comment chaque réglage affecte le comportement en entrée, milieu et sortie de virage
- Les pressions pneus : delta froid→chaud cible +0.13 à +0.17 bar
- La carburation : adaptation gicleur selon température
- Les règles DD2 : couronne + contre-pignon = 100

Règles de réponse :
1. Réponds TOUJOURS en JSON valide avec deux clés : "message" et "apply"
2. "message" : explication claire en français, max 150 mots, avec le POURQUOI mécanique de chaque réglage proposé
3. "apply" : objet JSON avec UNIQUEMENT les réglages à modifier (laisser vide {} si aucun réglage à appliquer)
4. IMPORTANT : Ne jamais entourer le JSON de backticks ou de balises markdown. Retourner UNIQUEMENT le JSON brut.

Format "apply" disponible :
{
  "barre": "sans" | "ronde" | "plate" | "plateau",
  "voieAv": nombre (0-6, valeur absolue),
  "pincement": nombre (-3 à +3, valeur absolue),
  "voieAr": nombre delta en cm (ex: +0.5 ou -0.5),
  "arbre": "court" | "standard" | "tendre" | "medium" | "dur",
  "moyeux": "courts" | "medium" | "longs",
  "parechocs": "desserre" | "serre",
  "chasse": nombre delta (ex: +1 ou -1),
  "gardeAv": "bas" | "medium" | "haut",
  "gardeAr": "bas" | "medium" | "haut"
}

Exemple de réponse valide :
{
  "message": "Ton kart pousse en entrée de virage rapide parce que l'avant manque de grip. On va élargir la voie avant pour augmenter la charge sur les roues AV et ajouter de la chasse pour améliorer le retour de direction. La barre ronde va rigidifier légèrement l'avant sans bloquer le châssis.",
  "apply": {
    "voieAv": 5,
    "chasse": 1,
    "barre": "ronde"
  }
}

${contextStr}

Si le pilote pose une question théorique sans demander de réglages spécifiques, réponds avec "apply": {}.
Si tu n'es pas certain d'un réglage, dis-le clairement et propose une direction à tester.`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    // Parse la réponse JSON de Claude
    let parsed;
    try {
      // Nettoyer les éventuels backticks markdown (```json ... ```)
      let raw = response.content[0].text.trim();
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(raw);
    } catch (e) {
      // Si Claude ne répond pas en JSON, on encapsule le texte brut
      parsed = {
        message: response.content[0].text,
        apply: {},
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error("Erreur chat function:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: "Erreur serveur. Vérifie ta clé API dans les variables d'environnement Netlify.",
        apply: {},
      }),
    };
  }
};
