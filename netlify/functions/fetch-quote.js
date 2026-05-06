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

    // Krypto: Finnhub erwartet z.B. "BINANCE:BTCEUR"
    if (type === "crypto") {
      const quoteRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=BINANCE:${symbol}EUR&token=${FINNHUB_KEY}`);
      const quote = await quoteRes.json();
      if (!quote.c || quote.c === 0) {
        return new Response(JSON.stringify({ error: `Kein Kurs für ${symbol} gefunden` }), {
          status: 404, headers,
        });
      }
      return new Response(JSON.stringify({
        symbol, type,
        name: symbol,
        currency: "EUR",
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        high: quote.h,
        low: quote.l,
        open: quote.o,
        prevClose: quote.pc,
        timestamp: Date.now(),
      }), { status: 200, headers });
    }

    // ETFs: europäische Exchange-Suffixe automatisch durchprobieren
    // Aktien: direkt versuchen, dann mit Suffixen als Fallback
    const suffixes = type === "etf"
      ? ["", ".L", ".AS", ".DE", ".PA", ".MI", ".SW"]
      : ["", ".L", ".AS", ".DE"];

    let quote = null;
    let resolvedSymbol = symbol;

    for (const suffix of suffixes) {
      const candidate = symbol + suffix;
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${candidate}&token=${FINNHUB_KEY}`);
      const data = await res.json();
      if (data.c && data.c !== 0) {
        quote = data;
        resolvedSymbol = candidate;
        break;
      }
    }

    if (!quote) {
      return new Response(JSON.stringify({ error: `Kein Kurs für ${symbol} gefunden` }), {
        status: 404, headers,
      });
    }

    const profileRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${resolvedSymbol}&token=${FINNHUB_KEY}`);
    const profile = await profileRes.json();

    return new Response(JSON.stringify({
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
    }), { status: 200, headers });

  } catch (err) {
    console.error("fetch-quote Fehler:", err);
    return new Response(JSON.stringify({ error: "Interner Fehler", detail: err.message }), {
      status: 500, headers,
    });
  }
};

export const config = { path: "/.netlify/functions/fetch-quote" };
