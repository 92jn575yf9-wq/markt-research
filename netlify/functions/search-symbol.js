// Sucht Aktien/ETFs/Krypto per Freitext via Finnhub
// GET /.netlify/functions/search-symbol?q=Apple

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export default async (req) => {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q || q.length < 2) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    const FINNHUB_KEY = process.env.FINNHUB_KEY;
    if (!FINNHUB_KEY) {
      return new Response(JSON.stringify({ error: "API Key fehlt" }), { status: 500, headers });
    }

    // Rohstoff-Direktvorschläge bei relevanten Keywords
    const commodityKeywords = ["öl","oil","brent","wti","gold","silber","silver","kupfer","copper","gas","erdgas","rohstoff","commodity","weizen","wheat","mais","corn","platin","platinum","palladium"];
    const qLower = q.toLowerCase();
    const commodities = [
      { symbol: "CL=F",  name: "WTI Rohöl (Crude Oil)",      type: "commodity", exchange: "NYMEX" },
      { symbol: "BZ=F",  name: "Brent Rohöl",                 type: "commodity", exchange: "ICE" },
      { symbol: "GC=F",  name: "Gold",                        type: "commodity", exchange: "COMEX" },
      { symbol: "SI=F",  name: "Silber",                      type: "commodity", exchange: "COMEX" },
      { symbol: "NG=F",  name: "Erdgas (Natural Gas)",        type: "commodity", exchange: "NYMEX" },
      { symbol: "HG=F",  name: "Kupfer (Copper)",             type: "commodity", exchange: "COMEX" },
      { symbol: "PL=F",  name: "Platin (Platinum)",           type: "commodity", exchange: "NYMEX" },
      { symbol: "ZW=F",  name: "Weizen (Wheat)",              type: "commodity", exchange: "CBOT" },
      { symbol: "ZC=F",  name: "Mais (Corn)",                 type: "commodity", exchange: "CBOT" },
    ];
    if (commodityKeywords.some(k => qLower.includes(k))) {
      const filtered = commodities.filter(c =>
        c.name.toLowerCase().includes(qLower) ||
        c.symbol.toLowerCase().includes(qLower) ||
        (qLower.includes("öl") || qLower.includes("oil")) && (c.symbol === "CL=F" || c.symbol === "BZ=F") ||
        (qLower.includes("gold")) && c.symbol === "GC=F" ||
        (qLower.includes("silber") || qLower.includes("silver")) && c.symbol === "SI=F" ||
        (qLower.includes("gas") || qLower.includes("erdgas")) && c.symbol === "NG=F" ||
        (qLower.includes("kupfer") || qLower.includes("copper")) && c.symbol === "HG=F"
      );
      const results = filtered.length > 0 ? filtered : commodities;
      return new Response(JSON.stringify(results.slice(0,6)), { status: 200, headers });
    }

    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();

    if (!data.result) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    // Relevante Typen filtern und aufbereiten
    const typeMap = {
      "Common Stock": "stock",
      "ETP": "etf",
      "ETF": "etf",
      "Crypto": "crypto",
    };

    const results = data.result
      .filter(item => item.symbol && item.description && item.type)
      .map(item => ({
        symbol: item.symbol,
        name: item.description,
        type: typeMap[item.type] || "stock",
        exchange: item.displaySymbol || item.symbol,
      }))
      .slice(0, 6);

    return new Response(JSON.stringify(results), { status: 200, headers });

  } catch (err) {
    console.error("search-symbol Fehler:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/search-symbol" };
