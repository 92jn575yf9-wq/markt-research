import { getStore } from "@netlify/blobs";

const STORE_NAME = "markt-research";
const CACHE_TTL = 6 * 60 * 60 * 1000;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// Finnhub Company News (Aktien/ETFs)
async function fetchFinnhubNews(symbol, finnhubKey) {
  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${dateStr(14)}&to=${dateStr(0)}&token=${finnhubKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.slice(0, 8).map(item => ({
      id: `${symbol}-fh-${item.id}`,
      headline: item.headline,
      source: item.source,
      url: item.url,
      datetime: item.datetime * 1000,
      relatedSymbol: symbol,
    }));
  } catch(e) {
    console.error(`Finnhub News Fehler für ${symbol}:`, e.message);
    return [];
  }
}

// Finnhub General News (gefiltert nach Symbol)
async function fetchFinnhubGeneralNews(symbol, finnhubKey, category = "general") {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${finnhubKey}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const kw = symbol.toLowerCase();
    const nameMap = { AAPL:"apple", MSFT:"microsoft", GOOGL:"google", AMZN:"amazon", TSLA:"tesla", NVDA:"nvidia", META:"meta", ASML:"asml", BTC:"bitcoin", ETH:"ethereum" };
    const keywords = [kw, nameMap[symbol]].filter(Boolean);
    return data
      .filter(item => keywords.some(k =>
        item.headline?.toLowerCase().includes(k) ||
        item.summary?.toLowerCase().includes(k)
      ))
      .slice(0, 5)
      .map(item => ({
        id: `${symbol}-gen-${item.id}`,
        headline: item.headline,
        source: item.source,
        url: item.url,
        datetime: item.datetime * 1000,
        relatedSymbol: symbol,
      }));
  } catch(e) {
    console.error(`Finnhub General News Fehler:`, e.message);
    return [];
  }
}

// Yahoo Finance RSS (funktioniert server-seitig zuverlässig)
async function fetchYahooRSS(symbol) {
  try {
    const res = await fetch(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } }
    );
    const text = await res.text();
    // RSS XML parsen
    const items = [];
    const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of itemMatches) {
      const content = match[1];
      const title = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
                    content.match(/<title>(.*?)<\/title>/)?.[1] || "";
      const link = content.match(/<link>(.*?)<\/link>/)?.[1] || "";
      const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
      const source = content.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || "Yahoo Finance";
      if (title) {
        items.push({
          id: `${symbol}-rss-${items.length}`,
          headline: title.trim(),
          source: source.trim(),
          url: link.trim(),
          datetime: pubDate ? new Date(pubDate).getTime() : Date.now(),
          relatedSymbol: symbol,
        });
      }
      if (items.length >= 8) break;
    }
    return items;
  } catch(e) {
    console.error(`Yahoo RSS Fehler für ${symbol}:`, e.message);
    return [];
  }
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const symbolsParam = url.searchParams.get("symbols") || "";
    const typesParam = url.searchParams.get("types") || "";
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const debug = url.searchParams.get("debug") === "1";

    if (!symbolsParam) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    const symbols = symbolsParam.split(",").map(s => s.trim().toUpperCase());
    const types = typesParam.split(",").map(t => t.trim());

    // Generelle Markt-News (kein Symbol-Filter)
    if (symbols[0] === "MARKET") {
      const FINNHUB_KEY = process.env.FINNHUB_KEY;
      let items = [];
      if (FINNHUB_KEY) {
        try {
          const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`);
          const data = await res.json();
          if (Array.isArray(data)) {
            items = data.slice(0, 20).map((n, i) => ({
              id: `market-${i}`,
              headline: n.headline,
              source: n.source,
              url: n.url,
              datetime: n.datetime * 1000,
              relatedSymbol: null,
            }));
          }
        } catch { /* ignorieren */ }
      }
      // Yahoo RSS als Fallback
      if (items.length === 0) {
        try {
          const res = await fetch("https://feeds.finance.yahoo.com/rss/2.0/headline?region=US&lang=en-US",
            { headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } });
          const text = await res.text();
          const itemMatches = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];
          items = itemMatches.slice(0, 15).map((m, i) => {
            const c = m[1];
            const title = c.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || c.match(/<title>(.*?)<\/title>/)?.[1] || "";
            const link = c.match(/<link>(.*?)<\/link>/)?.[1] || "";
            const pubDate = c.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
            return { id: `market-yahoo-${i}`, headline: title.trim(), source: "Yahoo Finance", url: link.trim(), datetime: pubDate ? new Date(pubDate).getTime() : Date.now(), relatedSymbol: null };
          }).filter(x => x.headline);
        } catch { /* ignorieren */ }
      }
      return new Response(JSON.stringify(items), { status: 200, headers });
    }
    const FINNHUB_KEY = process.env.FINNHUB_KEY;

    const store = getStore(STORE_NAME);
    const cacheKey = `news-v3-${symbols.join("-")}`;

    if (!forceRefresh) {
      try {
        const cached = await store.get(cacheKey, { type: "json" });
        if (cached?.ts && (Date.now() - cached.ts) < CACHE_TTL) {
          return new Response(JSON.stringify(cached.items), { status: 200, headers });
        }
      } catch { /* Cache miss */ }
    }

    const allNews = [];
    const seen = new Set();
    const debugLog = [];

    await Promise.all(symbols.map(async (symbol, i) => {
      const type = types[i] || "stock";
      let items = [];

      if (type === "crypto") {
        if (FINNHUB_KEY) {
          items = await fetchFinnhubGeneralNews(symbol, FINNHUB_KEY, "crypto");
          debugLog.push(`${symbol} crypto finnhub: ${items.length}`);
        }
        if (items.length === 0) {
          items = await fetchYahooRSS(symbol + "-USD");
          debugLog.push(`${symbol} yahoo rss: ${items.length}`);
        }
      } else {
        // Schritt 1: Finnhub Company News
        if (FINNHUB_KEY) {
          items = await fetchFinnhubNews(symbol, FINNHUB_KEY);
          debugLog.push(`${symbol} finnhub company: ${items.length}`);
        }
        // Schritt 2: Yahoo RSS Fallback
        if (items.length === 0) {
          items = await fetchYahooRSS(symbol);
          debugLog.push(`${symbol} yahoo rss: ${items.length}`);
        }
        // Schritt 3: Finnhub General News als letzter Ausweg
        if (items.length === 0 && FINNHUB_KEY) {
          items = await fetchFinnhubGeneralNews(symbol, FINNHUB_KEY, "general");
          debugLog.push(`${symbol} finnhub general: ${items.length}`);
        }
      }

      for (const item of items) {
        if (!item.headline) continue;
        const key = item.headline.toLowerCase().slice(0, 80);
        if (!seen.has(key)) { seen.add(key); allNews.push(item); }
      }
    }));

    allNews.sort((a, b) => b.datetime - a.datetime);

    if (debug) {
      return new Response(JSON.stringify({ debug: debugLog, count: allNews.length, items: allNews }), { status: 200, headers });
    }

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
