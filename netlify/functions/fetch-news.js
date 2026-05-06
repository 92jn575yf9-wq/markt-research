import { getStore } from "@netlify/blobs";

const STORE_NAME = "markt-research";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 Stunden

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// Yahoo Finance Search API — zuverlässigste News-Quelle
async function fetchYahooSearchNews(symbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=10&quotesCount=0&enableFuzzyQuery=false`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
    );
    const data = await res.json();
    const items = data?.news || [];
    return items.map((item, i) => ({
      id: `${symbol}-ys-${i}-${item.providerPublishTime}`,
      headline: item.title,
      summary: "",
      source: item.publisher || "Yahoo Finance",
      url: item.link,
      datetime: (item.providerPublishTime || Date.now() / 1000) * 1000,
      relatedSymbol: symbol,
    }));
  } catch { return []; }
}

// Finnhub Company News
async function fetchFinnhubNews(symbol, finnhubKey) {
  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${dateStr(7)}&to=${dateStr(0)}&token=${finnhubKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.slice(0, 8).map(item => ({
      id: `${symbol}-fh-${item.id}`,
      headline: item.headline,
      summary: item.summary || "",
      source: item.source,
      url: item.url,
      datetime: item.datetime * 1000,
      relatedSymbol: symbol,
    }));
  } catch { return []; }
}

// Finnhub Krypto-News (allgemeine Kategorie, gefiltert)
async function fetchFinnhubCryptoNews(symbol, finnhubKey) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${finnhubKey}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const keywords = {
      BTC: ["bitcoin", "btc"],
      ETH: ["ethereum", "eth"],
      SOL: ["solana", "sol"],
      XRP: ["ripple", "xrp"],
    };
    const kw = keywords[symbol] || [symbol.toLowerCase()];
    return data
      .filter(item => kw.some(k =>
        item.headline?.toLowerCase().includes(k) ||
        item.summary?.toLowerCase().includes(k)
      ))
      .slice(0, 6)
      .map(item => ({
        id: `${symbol}-fh-${item.id}`,
        headline: item.headline,
        summary: item.summary || "",
        source: item.source,
        url: item.url,
        datetime: item.datetime * 1000,
        relatedSymbol: symbol,
      }));
  } catch { return []; }
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const symbolsParam = url.searchParams.get("symbols") || "";
    const typesParam = url.searchParams.get("types") || "";
    const forceRefresh = url.searchParams.get("refresh") === "1";

    if (!symbolsParam) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    const symbols = symbolsParam.split(",").map(s => s.trim().toUpperCase());
    const types = typesParam.split(",").map(t => t.trim());
    const FINNHUB_KEY = process.env.FINNHUB_KEY;

    const store = getStore(STORE_NAME);
    const cacheKey = `news-v2-${symbols.join("-")}`;

    // Cache prüfen (außer bei Force-Refresh)
    if (!forceRefresh) {
      try {
        const cached = await store.get(cacheKey, { type: "json" });
        if (cached?.ts && (Date.now() - cached.ts) < CACHE_TTL) {
          return new Response(JSON.stringify(cached.items), { status: 200, headers });
        }
      } catch { /* Cache miss */ }
    }

    // News für alle Symbole parallel holen
    const allNews = [];
    const seen = new Set();

    await Promise.all(symbols.map(async (symbol, i) => {
      const type = types[i] || "stock";
      let items = [];

      if (type === "crypto") {
        // Krypto: Finnhub zuerst, dann Yahoo Search
        if (FINNHUB_KEY) items = await fetchFinnhubCryptoNews(symbol, FINNHUB_KEY);
        if (items.length === 0) items = await fetchYahooSearchNews(symbol + "-USD");
        if (items.length === 0) items = await fetchYahooSearchNews(symbol);
      } else {
        // Aktien & ETFs: Finnhub zuerst, dann Yahoo Search als Fallback
        if (FINNHUB_KEY) items = await fetchFinnhubNews(symbol, FINNHUB_KEY);
        if (items.length === 0) items = await fetchYahooSearchNews(symbol);
      }

      // Duplikate vermeiden
      for (const item of items) {
        if (!item.headline) continue;
        const key = item.headline.toLowerCase().slice(0, 80);
        if (!seen.has(key)) {
          seen.add(key);
          allNews.push(item);
        }
      }
    }));

    // Nach Datum sortieren, neueste zuerst
    allNews.sort((a, b) => b.datetime - a.datetime);

    // Cachen
    try {
      await store.set(cacheKey, JSON.stringify({ ts: Date.now(), items: allNews }));
    } catch { /* ignorieren */ }

    return new Response(JSON.stringify(allNews), { status: 200, headers });

  } catch (err) {
    console.error("fetch-news Fehler:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/fetch-news" };
