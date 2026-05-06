// Holt 30-Tage Kursdaten für den Chart im Detail-View
// GET /.netlify/functions/fetch-chart?symbol=AAPL&type=stock

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export default async (req) => {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    const type = url.searchParams.get("type") || "stock";

    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol fehlt" }), { status: 400, headers });
    }

    // Yahoo Finance 30-Tage Kursdaten
    const suffixes = type === "crypto"
      ? ["-EUR", "-USD"]
      : type === "etf"
      ? ["", ".L", ".AS", ".DE"]
      : ["", ".L", ".AS", ".DE"];

    let prices = [];
    for (const suffix of suffixes) {
      try {
        const candidate = symbol + suffix;
        const range = url.searchParams.get("range") || "1mo";
      const interval = range === "1d" ? "5m" : "1d";
      const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${candidate}?interval=${interval}&range=${range}`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (result?.indicators?.quote?.[0]?.close) {
          prices = result.indicators.quote[0].close
            .filter(p => p !== null && p !== undefined)
            .map(p => Math.round(p * 100) / 100);
          if (prices.length > 3) break;
        }
      } catch { continue; }
    }

    return new Response(JSON.stringify({ symbol, prices }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/fetch-chart" };
