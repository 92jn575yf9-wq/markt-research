export default async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    const type = url.searchParams.get("type") || "stock";

    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol fehlt" }), {
        status: 400, headers,
      });
    }

    const FINNHUB_KEY = process.env.FINNHUB_KEY;
    if (!FINNHUB_KEY) {
      return new Response(JSON.stringify({ error: "API Key nicht konfiguriert" }), {
        status: 500, headers,
      });
    }

    let quoteSymbol = symbol;
    if (type === "crypto") {
      quoteSymbol = `BINANCE:${symbol}EUR`;
    }

    const [quoteRes, profileRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${quoteSymbol}&token=${FINNHUB_KEY}`),
      type !== "crypto"
        ? fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_KEY}`)
        : Promise.resolve(null),
    ]);

    const quote = await quoteRes.json();
    const profile = profileRes ? await profileRes.json() : {};

    if (!quote.c || quote.c === 0) {
      return new Response(JSON.stringify({ error: `Kein Kurs für ${symbol} gefunden` }), {
        status: 404, headers,
      });
    }

    const result = {
      symbol,
      type,
      name: profile.name || symbol,
      currency: profile.currency || "EUR",
      exchange: profile.exchange || "",
      industry: profile.finnhubIndustry || "",
      price: quote.c,
      change: quote.d,
      changePercent: quote.dp,
      high: quote.h,
      low: quote.l,
      open: quote.o,
      prevClose: quote.pc,
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(result), { status: 200, headers });

  } catch (err) {
    console.error("fetch-quote Fehler:", err);
    return new Response(JSON.stringify({ error: "Interner Fehler", detail: err.message }), {
      status: 500, headers,
    });
  }
};

export const config = { path: "/.netlify/functions/fetch-quote" };
