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
      return new Response(JSON.stringify({ error: "symbol fehlt" }), { status: 400, headers });
    }

    const FINNHUB_KEY = process.env.FINNHUB_KEY;

    // ── Krypto via Finnhub ───────────────────────────────────
    if (type === "crypto") {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=BINANCE:${symbol}EUR&token=${FINNHUB_KEY}`);
      const q = await res.json();
      if (!q.c || q.c === 0) {
        return new Response(JSON.stringify({ error: `Kein Kurs für ${symbol}` }), { status: 404, headers });
      }
      return new Response(JSON.stringify({
        symbol, type, name: symbol, currency: "EUR",
        price: q.c, change: q.d, changePercent: q.dp,
        high: q.h, low: q.l, open: q.o, prevClose: q.pc,
        timestamp: Date.now(),
      }), { status: 200, headers });
    }

    // ── Aktien/ETFs: Finnhub zuerst ──────────────────────────
    // Symbol hat bereits Suffix (z.B. RHM.DE, AAPL.L) → nicht nochmal anhängen
    const hasExchangeSuffix = /\.[A-Z]{1,3}$/.test(symbol);
    const suffixes = hasExchangeSuffix
      ? [""]
      : type === "etf"
        ? ["", ".L", ".AS", ".DE", ".PA", ".MI", ".SW"]
        : ["", ".L", ".AS", ".DE"];

    let quote = null;
    let resolvedSymbol = symbol;

    if (FINNHUB_KEY) {
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
    }

    // ── Fallback: Yahoo Finance ──────────────────────────────
    if (!quote) {
      const yahooSuffixes = hasExchangeSuffix
        ? [""]
        : type === "etf"
          ? ["", ".L", ".AS", ".DE", ".PA", ".MI", ".SW"]
          : ["", ".L", ".AS", ".DE"];

      for (const suffix of yahooSuffixes) {
        const candidate = symbol + suffix;
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${candidate}?interval=1d&range=1d`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const data = await res.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const prevClose = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
            const change = meta.regularMarketPrice - prevClose;
            const changePercent = (change / prevClose) * 100;
            quote = {
              c: meta.regularMarketPrice,
              d: change,
              dp: changePercent,
              h: meta.regularMarketDayHigh || meta.regularMarketPrice,
              l: meta.regularMarketDayLow || meta.regularMarketPrice,
              o: meta.regularMarketOpen || meta.regularMarketPrice,
              pc: prevClose,
              _name: meta.longName || meta.shortName || candidate,
              _currency: meta.currency || "EUR",
            };
            resolvedSymbol = candidate;
            break;
          }
        } catch { continue; }
      }
    }

    if (!quote) {
      return new Response(JSON.stringify({ error: `Kein Kurs für ${symbol} gefunden` }), { status: 404, headers });
    }

    // ── Profil via Finnhub (optional) ───────────────────────
    let name = quote._name || symbol;
    let currency = quote._currency || "EUR";
    let exchange = "";

    if (FINNHUB_KEY && !quote._name) {
      try {
        const pRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${resolvedSymbol}&token=${FINNHUB_KEY}`);
        const profile = await pRes.json();
        if (profile.name) name = profile.name;
        if (profile.currency) currency = profile.currency;
        if (profile.exchange) exchange = profile.exchange;
      } catch { /* ignorieren */ }
    }

    return new Response(JSON.stringify({
      symbol, type, name, currency, exchange,
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
    return new Response(JSON.stringify({ error: "Interner Fehler", detail: err.message }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/fetch-quote" };
