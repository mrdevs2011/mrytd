// POST /api/download
// Body: { url, filename }
// YouTube CDN ni server orqali oqimlab, brauzerga attachment qilib beradi.

export const config = {
  api: {
    responseLimit: false,
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Faqat POST" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Noto'g'ri JSON" });
    }
  }

  const { url, filename } = body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url kerak" });
  }

  // Faqat googlevideo / youtube CDN
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "Noto'g'ri url" });
  }

  const host = parsed.hostname || "";
  const allowed =
    host.includes("googlevideo.com") ||
    host.includes("googleusercontent.com") ||
    host.includes("ytimg.com") ||
    host.includes("youtube.com");

  if (!allowed) {
    return res.status(400).json({ error: "Ruxsat etilmagan domen" });
  }

  const safeName = String(filename || "video.mp4")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 120);

  try {
    const upstream = await fetch(url, {
      headers: {
        // Ba'zi CDN lar User-Agent kutadi
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `CDN xato: ${upstream.status}`,
      });
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader("Cache-Control", "no-store");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    // Node.js runtime: buffer orqali (Vercel limitlariga e'tibor)
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buf);
  } catch (err) {
    console.error("download proxy:", err);
    return res.status(500).json({ error: err.message || "Yuklab olish xatosi" });
  }
}
