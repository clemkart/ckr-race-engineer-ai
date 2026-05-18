const Anthropic = require("@anthropic-ai/sdk");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { message, context } = JSON.parse(event.body);

    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Message requis" }) };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const contextStr = context ? `
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
` : "Aucun contexte de session fourni.";

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
2. "message" : explication claire en français, max 150 mots, avec le POURQUOI mécanique
3. "apply" : objet JSON avec UNIQUEMENT les réglages à modifier (laisser vide {} si aucun réglage)

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

${contextStr}

Si question théorique sans réglages à faire, réponds avec "apply": {}.`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    let parsed;
    try {
      parsed = JSON.parse(response.content[0].text);
    } catch (e) {
      parsed = { message: response.content[0].text, apply: {} };
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

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
