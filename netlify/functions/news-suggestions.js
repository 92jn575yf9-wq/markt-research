import { getStore } from "@netlify/blobs";

const STORE_NAME = "markt-research";
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 Stunden

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Nur POST erlaubt" }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { watchlistSymbols = [], forceRefresh = false } = body;

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    const FINNHUB_KEY = process.env.FINNHUB_KEY;

    if (!ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ error: "Anthropic Key fehlt" }), { status: 500, headers });
    }

    const store = getStore(STORE_NAME);
    const cacheKey = `news-suggestions-v1`;

    // Cache prüfen
    if (!forceRefresh) {
      try {
        const cached = await store.get(cacheKey, { type: "json" });
        if (cached?.ts && (Date.now() - cached.ts) < CACHE_TTL) {
          return new Response(JSON.stringify(cached.suggestions), { status: 200, headers });
        }
      } catch { /* Cache miss */ }
    }

    // Aktuelle Markt-News holen (Finnhub General News)
    let newsText = "";
    if (FINNHUB_KEY) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`);
        const news = await res.json();
        if (Array.isArray(news)) {
          newsText = news.slice(0, 15).map((n, i) =>
            `${i + 1}. [${n.source}] ${n.headline}`
          ).join("\n");
        }
      } catch { /* ignorieren */ }
    }

    if (!newsText) {
      newsText = "Keine aktuellen News verfügbar.";
    }

    const watchlistStr = watchlistSymbols.length > 0
      ? `Bereits in der Watchlist (NICHT vorschlagen): ${watchlistSymbols.join(", ")}`
      : "Watchlist ist leer.";

    const prompt = `Du bist ein nüchterner Finanz-Research-Assistent für einen Privatinvestor mit monatlichem Sparplan (DCA-Strategie), der langfristig anlegt.

Aktuelle Markt-News:
${newsText}

${watchlistStr}

Analysiere die News und identifiziere 3 interessante Investitionsmöglichkeiten die sich aus den News ergeben. Wähle nur Assets die DU aufgrund der News für einen Langfrist-Investor interessant findest — keine wilden Spekulationen.

Antworte NUR mit einem JSON-Array (kein Text davor/danach, keine Backticks):
[
  {
    "symbol": "TICKER",
    "name": "Vollständiger Name",
    "type": "stock" | "etf" | "crypto",
    "grund": "Ein konkreter Satz warum dieses Asset jetzt interessant ist (max 20 Wörter)",
    "newsAnker": "Welche News hat diesen Vorschlag ausgelöst (max 15 Wörter)",
    "signal": "positiv" | "neutral",
    "risiko": "Kurzes Gegenargument (max 12 Wörter)"
  }
]

Wichtig:
- Nur bekannte, liquide Assets (keine Penny Stocks, keine exotischen Coins)
- Kein Asset aus der bestehenden Watchlist
- Auf Deutsch schreiben
- Genau 3 Vorschläge`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) throw new Error(`Claude API: ${claudeRes.status}`);

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "[]";
    const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const suggestions = JSON.parse(cleaned);

    // Cachen
    try {
      await store.set(cacheKey, JSON.stringify({ ts: Date.now(), suggestions }));
    } catch { /* ignorieren */ }

    return new Response(JSON.stringify(suggestions), { status: 200, headers });

  } catch (err) {
    console.error("news-suggestions Fehler:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/news-suggestions" };
