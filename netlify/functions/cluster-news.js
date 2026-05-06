import { getStore } from "@netlify/blobs";

const STORE_NAME = "markt-research";
const CACHE_TTL = 6 * 60 * 60 * 1000;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Nur POST" }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { news = [], forceRefresh = false } = body;

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) throw new Error("Anthropic Key fehlt");

    const store = getStore(STORE_NAME);
    const cacheKey = `news-clusters-v1-${news.slice(0,3).map(n=>n.id).join('-')}`;

    if (!forceRefresh) {
      try {
        const cached = await store.get(cacheKey, { type: "json" });
        if (cached?.ts && (Date.now() - cached.ts) < CACHE_TTL) {
          return new Response(JSON.stringify(cached.clusters), { status: 200, headers });
        }
      } catch { /* miss */ }
    }

    // News-Liste für Prompt aufbereiten
    const newsList = news.slice(0, 20).map((n, i) =>
      `${i+1}. [${n.source}] ${n.headline.replace(/ - Reuters$| - CNBC$| - Bloomberg$/, '')}`
    ).join('\n');

    const prompt = `Du bist ein deutschsprachiger Finanz-Redakteur. Analysiere diese Markt-News und clustere sie in 3-4 thematische Gruppen.

News:
${newsList}

Antworte NUR mit einem JSON-Array (keine Backticks, kein Text davor/danach):
[
  {
    "emoji": "🤖",
    "titel": "Kurzer deutscher Thementitel (max 4 Wörter)",
    "zusammenfassung": "2-3 Sätze Zusammenfassung auf Deutsch. Sachlich, prägnant, für einen Investor relevant.",
    "indizes": [1, 3, 7]
  }
]

Regeln:
- Genau 3-4 Cluster, keine Überschneidungen
- Titel auf Deutsch, max 4 Wörter
- Zusammenfassung auf Deutsch, 2-3 Sätze, investor-relevant
- indizes = Nummern der zugehörigen News aus der Liste
- Sinnvolle Emojis: 🤖 Tech/KI, 🛢 Energie, 🏦 Banken/Zinsen, 🌍 Geopolitik, 📊 Märkte, 💊 Gesundheit, 🏭 Industrie, 💰 Rohstoffe`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await res.json();
    const raw = claudeData.content?.[0]?.text || "[]";
    const clusters = JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim());

    // News-Objekte zu den Clustern hinzufügen
    const enriched = clusters.map(c => ({
      ...c,
      items: (c.indizes || [])
        .map(i => news[i-1])
        .filter(Boolean)
        .map(n => ({
          ...n,
          headline: n.headline.replace(/ - Reuters$| - CNBC$| - Bloomberg$| - AP$/, '').trim()
        }))
    }));

    try {
      await store.set(cacheKey, JSON.stringify({ ts: Date.now(), clusters: enriched }));
    } catch { /* ignorieren */ }

    return new Response(JSON.stringify(enriched), { status: 200, headers });

  } catch (err) {
    console.error("cluster-news Fehler:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/cluster-news" };
