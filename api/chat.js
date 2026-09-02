// Video bo'yicha suhbat (follow-up savollar)
// Env: GEMINI_API_KEY

const GEMINI_MODEL = "gemini-3.6-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Faqat POST" });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY o'rnatilmagan" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Noto'g'ri JSON" });
  }

  const { videoUrl, message, history } = body || {};

  if (!videoUrl || !message) {
    return res.status(400).json({ error: "videoUrl va message kerak" });
  }

  // Tarixni tozalash (faqat oxirgi 10 ta xabar)
  const cleanHistory = Array.isArray(history)
    ? history.slice(-10).filter((h) => h && h.role && h.text)
    : [];

  // Gemini contents: video + tarix + yangi savol
  const parts = [
    {
      text: `Sen YouTube video tahlilchisisan. Foydalanuvchi shu video haqida savol beradi.
Javobni O'ZBEK tilida, qisqa va aniq ber.
Video: ${videoUrl}`,
    },
    {
      file_data: {
        file_uri: videoUrl,
      },
    },
  ];

  // Tarixni qo'shamiz
  const contents = [
    {
      role: "user",
      parts,
    },
  ];

  // Multi-turn: history ni contents ga qo'shish
  for (const h of cleanHistory) {
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.text }],
    });
  }

  // Yangi savol
  contents.push({
    role: "user",
    parts: [{ text: message }],
  });

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
          contents,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.error?.message || `HTTP ${response.status}`;
      return res.status(response.status).json({ error: msg });
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

    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error("Chat xato:", err);
    return res.status(500).json({ error: err.message || "Server xatosi" });
  }
}
