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
