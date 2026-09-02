// GET /api/analyze?url=...&lang=uz&mode=short
// Faqat AI tahlil — download ma'lumotlaridan mustaqil

const GEMINI_MODEL = "gemini-3.6-flash";

function extractVideoId(url) {
  if (!url) return null;
  try {
    if (url.includes("shorts/")) return url.split("shorts/")[1].split(/[?&]/)[0];
    if (url.includes("youtu.be/")) return url.split("youtu.be/")[1].split(/[?&]/)[0];
    if (url.includes("watch?v=")) return url.split("watch?v=")[1].split("&")[0];
    if (url.includes("/embed/")) return url.split("/embed/")[1].split(/[?&]/)[0];
  } catch (e) {
    return null;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Faqat GET" });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY o'rnatilmagan" });
  }

  const { url, lang = "uz", mode = "short" } = req.query;
  if (!url) return res.status(400).json({ error: "URL kerak" });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: "Noto'g'ri YouTube URL" });

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const langName = lang === "ru" ? "RUS" : lang === "en" ? "INGLIZ" : "O'ZBEK";

  const prompt =
    mode === "detailed"
      ? `Bu YouTube videoni chuqur tahlil qil. Javobni ${langName} tilida, markdown ishlatmasdan oddiy matnda ber.

XULOSA:
(4-6 gapda video mazmuni)

ASOSIY NUQTALAR:
- kamida 5 ta muhim nuqta (imkon bo'lsa vaqt belgisi bilan, masalan 2:15)

MUHIM IQTIBOSLAR:
- videodan 1-2 ta muhim gap

KIM UCHUN:
(kimga foydali)

XULOSA BAHOSI:
(qisqa: foydali / o'rtacha / zaif va nima uchun)`
      : `Bu YouTube videoni qisqa tahlil qil. Javobni ${langName} tilida, markdown ishlatmasdan oddiy matnda ber.

XULOSA:
(2-3 gap)

ASOSIY NUQTALAR:
- 3 ta muhim nuqta (imkon bo'lsa vaqt belgisi bilan)

KIM UCHUN:
(1 gap)`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { file_data: { file_uri: youtubeUrl } },
              ],
            },
          ],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || `HTTP ${response.status}`,
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    if (!text) {
      const block =
        data?.candidates?.[0]?.finishReason ||
        data?.promptFeedback?.blockReason;
      return res.status(500).json({
        error: block ? `Gemini blokladi: ${block}` : "Bo'sh javob",
      });
    }

    return res.status(200).json({ analysis: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server xatosi" });
  }
}
