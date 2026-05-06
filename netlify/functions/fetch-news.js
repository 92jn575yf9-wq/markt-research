import { getStore } from "@netlify/blobs";

const STORE_NAME = "markt-research";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 Stunden

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// Datum im Format YYYY-MM-DD
function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// Finnhub: Firmen-News für Aktien/ETFs
async function fetchFinnhubNews(symbol, finnhubKey) {
  const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${dateStr(7)}&to=${dateStr(0)}&token=${finnhubKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.slice(0, 8).map(item => ({
    id: `${symbol}-${item.id}`,
    headline: item.headline,
    summary: item.summary,
    source: item.source,
    url: item.url,
    datetime: item.datetime * 1000,
    relatedSymbol: symbol,
    sentiment: null,
  }));
}

// Finnhub: Krypto-News via allgemeine Kategorie
async function fetchFinnhubCryptoNews(symbol, finnhubKey) {
  const url = `https://finnhub.io/api/v1/news?category=crypto&token=${finnhubKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  // Filtern nach Symbol-Relevanz
  const sym = symbol.toLowerCase();
  const relevant = data.filter(item =>
    item.headline?.toLowerCase().includes(sym) ||
    item.summary?.toLowerCase().includes(sym) ||
    (sym === "btc" && (item.headline?.toLowerCase().includes("bitcoin") || item.summary?.toLowerCase().includes("bitcoin"))) ||
    (sym === "eth" && (item.headline?.toLowerCase().includes("ethereum") || item.summary?.toLowerCase().includes("ethereum")))
  );
  return relevant.slice(0, 5).map(item => ({
    id: `${symbol}-${item.id}`,
    headline: item.headline,
    summary: item.summary,
    source: item.source,
    url: item.url,
    datetime: item.datetime * 1000,
    relatedSymbol: symbol,
    sentiment: null,
  }));
}

// Yahoo Finance News als Fallback
async function fetchYahooNews(symbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?modules=news`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    const items = data?.chart?.result?.[0]?.news || [];
    return items.slice(0, 5).map((item, i) => ({
      id: `${symbol}-yahoo-${i}`,
      headline: item.title,
      summary: "",
      source: item.publisher || "Yahoo Finance",
      url: item.link,
      datetime: (item.providerPublishTime || Date.now() / 1000) * 1000,
      relatedSymbol: symbol,
      sentiment: null,
    }));
  } catch { return []; }
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const symbolsParam = url.searchParams.get("symbols") || "";
    const typesParam = url.searchParams.get("types") || "";

    if (!symbolsParam) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    const symbols = symbolsParam.split(",").map(s => s.trim().toUpperCase());
    const types = typesParam.split(",").map(t => t.trim());
    const FINNHUB_KEY = process.env.FINNHUB_KEY;

    const store = getStore(STORE_NAME);
    const cacheKey = `news-${symbols.join("-")}`;

    // Cache prüfen
    try {
      const cached = await store.get(cacheKey, { type: "json" });
      if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL) {
        return new Response(JSON.stringify(cached.items), { status: 200, headers });
      }
    } catch { /* Cache miss, weitermachen */ }

    // News für alle Symbole holen
    const allNews = [];
    const seen = new Set();

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const type = types[i] || "stock";

      let items = [];

      if (type === "crypto") {
        if (FINNHUB_KEY) {
          items = await fetchFinnhubCryptoNews(symbol, FINNHUB_KEY);
        }
        if (items.length === 0) {
          items = await fetchYahooNews(symbol + "-EUR");
        }
      } else {
        if (FINNHUB_KEY) {
          items = await fetchFinnhubNews(symbol, FINNHUB_KEY);
        }
        if (items.length === 0) {
          items = await fetchYahooNews(symbol + ".L");
        }
        if (items.length === 0) {
          items = await fetchYahooNews(symbol);
        }
      }

      // Duplikate per Headline vermeiden
      for (const item of items) {
        const key = item.headline?.toLowerCase().slice(0, 60);
        if (key && !seen.has(key)) {
          seen.add(key);
          allNews.push(item);
        }
      }
    }

    // Nach Datum sortieren, neueste zuerst
    allNews.sort((a, b) => b.datetime - a.datetime);

    // In Blob cachen
    try {
      await store.set(cacheKey, JSON.stringify({ ts: Date.now(), items: allNews }));
    } catch { /* Cache-Fehler ignorieren */ }

    return new Response(JSON.stringify(allNews), { status: 200, headers });

  } catch (err) {
    console.error("fetch-news Fehler:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/fetch-news" };
