import { getStore } from "@netlify/blobs";

const STORE_NAME = "markt-research";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 Stunden

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
    const { symbol, type, name, price, changePercent, news = [] } = body;

    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol fehlt" }), { status: 400, headers });
    }

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ error: "Anthropic Key nicht konfiguriert" }), { status: 500, headers });
    }

    const store = getStore(STORE_NAME);
    const cacheKey = `analysis-v1-${symbol}`;

    // Cache prüfen
    const forceRefresh = body.forceRefresh === true;
    if (!forceRefresh) {
      try {
        const cached = await store.get(cacheKey, { type: "json" });
        if (cached?.ts && (Date.now() - cached.ts) < CACHE_TTL) {
          return new Response(JSON.stringify(cached), { status: 200, headers });
        }
      } catch { /* Cache miss */ }
    }

    // News-Zusammenfassung für den Prompt
    const newsText = news.length > 0
      ? news.slice(0, 6).map((n, i) => `${i + 1}. [${n.source}] ${n.headline}`).join("\n")
      : "Keine aktuellen News verfügbar.";

    const typeLabel = { stock: "Aktie", etf: "ETF", crypto: "Kryptowährung" }[type] || type;

    const prompt = `Du bist ein nüchterner, faktenbasierter Finanz-Research-Assistent. Du gibst keine Anlageberatung, sondern strukturierte Analyse-Thesen für einen privaten Langfrist-Investor mit monatlichem Sparplan (DCA-Strategie).

Analysiere folgendes Asset:
- Symbol: ${symbol}
- Name: ${name || symbol}
- Typ: ${typeLabel}
- Aktueller Kurs: ${price ? `€ ${price.toFixed(2)}` : "unbekannt"}
- Tagesveränderung: ${changePercent !== undefined ? `${changePercent.toFixed(2)}%` : "unbekannt"}

Aktuelle News (letzte 7 Tage):
${newsText}

Antworte NUR mit einem JSON-Objekt in exakt diesem Format (kein Text davor oder danach, keine Markdown-Backticks):
{
  "verdict": "akku" | "beobachten" | "risiko",
  "verdictText": "Ein Satz der Empfehlung erklärt (max 20 Wörter)",
  "dcaScore": 1-5,
  "dcaReason": "Ein Satz warum dieser DCA-Score (max 15 Wörter)",
  "pro": [
    { "text": "Argument 1 (max 15 Wörter)", "source": "Quelle oder Kennzahl" },
    { "text": "Argument 2 (max 15 Wörter)", "source": "Quelle oder Kennzahl" },
    { "text": "Argument 3 (max 15 Wörter)", "source": "Quelle oder Kennzahl" }
  ],
  "contra": [
    { "text": "Risiko 1 (max 15 Wörter)" },
    { "text": "Risiko 2 (max 15 Wörter)" }
  ],
  "risiken": [
    { "text": "Konkretes Risiko-Flag (max 15 Wörter)", "source": "Quelle falls vorhanden" }
  ],
  "newsSignal": "positiv" | "neutral" | "negativ",
  "newsKommentar": "Ein Satz zum News-Sentiment (max 15 Wörter)",
  "geaendertSeit": "Was hat sich seit einer typischen letzten Analyse geändert (max 20 Wörter)"
}

Wichtig:
- verdict "akku" = gut für monatlichen Sparplan geeignet
- verdict "beobachten" = abwarten, keine neuen Käufe empfohlen  
- verdict "risiko" = erhöhtes Risiko, Vorsicht geboten
- dcaScore 5 = ideal für Sparplan, 1 = ungeeignet
- Bleib sachlich, keine Übertreibungen
- Schreibe auf Deutsch`;

    // Claude API aufrufen
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
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

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      throw new Error(`Claude API Fehler: ${claudeRes.status} ${err}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "";

    // JSON aus Antwort extrahieren
    let analysis;
    try {
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      throw new Error(`Claude Antwort kein gültiges JSON: ${rawText.slice(0, 200)}`);
    }

    const result = {
      ...analysis,
      symbol,
      ts: Date.now(),
    };

    // Cachen
    try {
      await store.set(cacheKey, JSON.stringify(result));
    } catch { /* ignorieren */ }

    return new Response(JSON.stringify(result), { status: 200, headers });

  } catch (err) {
    console.error("analyze Fehler:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/analyze" };
