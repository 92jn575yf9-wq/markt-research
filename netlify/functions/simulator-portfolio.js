import { getStore } from "@netlify/blobs";

const STORE_NAME = "markt-research";
const BLOB_KEY = "simulator-portfolio";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export default async (req) => {
  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    try {
      const raw = await store.get(BLOB_KEY);
      if (!raw) return new Response(JSON.stringify([]), { status: 200, headers });
      return new Response(raw, { status: 200, headers });
    } catch {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await req.text();
      JSON.parse(body);
      await store.set(BLOB_KEY, body);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: "Methode nicht erlaubt" }), { status: 405, headers });
};

export const config = { path: "/.netlify/functions/simulator-portfolio" };
