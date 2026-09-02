// SERVER-SIDE fayl (Vercel serverless function).
//
// Vercel Environment Variables:
//   RAPIDAPI_KEY  — YouTube download linklar uchun
//   GEMINI_API_KEY — AI video tahlil uchun (Google AI Studio)
// Kodga key yozmang!

const API_HOST = "youtube-media-downloader.p.rapidapi.com";
const GEMINI_MODEL = "gemini-3.6-flash"; // YouTube video qo'llab-quvvatlaydi

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 daqiqa

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

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

function extractPlaylistId(url) {
  if (!url || !url.includes("list=")) return null;
  try {
    return url.split("list=")[1].split("&")[0];
  } catch (e) {
    return null;
  }
}

async function callRapidApi(path, apiKey) {
  const response = await fetch(`https://${API_HOST}${path}`, {
    method: "GET",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": API_HOST,
    },
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

/**
 * Gemini orqali YouTube videoni tahlil qiladi.
 * To'g'ridan-to'g'ri YouTube URL beriladi — model video + audioni "ko'radi".
 */
async function analyzeWithGemini(youtubeUrl, geminiKey, lang = "uz", mode = "short") {
  if (!geminiKey) {
    return { error: "GEMINI_API_KEY o'rnatilmagan (Vercel Environment Variables)" };
  }

  const langName = lang === "ru" ? "RUS" : lang === "en" ? "INGLIZ" : "O'ZBEK";
  const prompt = mode === "detailed"
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
                {
                  file_data: {
                    file_uri: youtubeUrl,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.error?.message || `HTTP ${response.status}`;
      console.error("Gemini xato:", msg);
      return { error: msg };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;

    if (!text) {
      // safety block yoki bo'sh javob
      const block = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
      return { error: block ? `Gemini blokladi: ${block}` : "Gemini bo'sh javob qaytardi" };
    }

    return { text };
  } catch (err) {
    console.error("Gemini so'rov xatosi:", err.message);
    return { error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Faqat GET so'rov qabul qilinadi" });
  }

  const rapidKey = process.env.RAPIDAPI_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!rapidKey) {
    console.error("RAPIDAPI_KEY topilmadi!");
    return res.status(500).json({ error: "Server konfiguratsiyasi xato" });
  }

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "URL ko'rsatilmadi" });
  }

  const playlistId = extractPlaylistId(url);
  const videoId = extractVideoId(url);

  if (!playlistId && !videoId) {
    return res.status(400).json({ error: "Noto'g'ri YouTube URL" });
  }

  // Cache (AI tahlil bilan birga)
  const cacheKey = playlistId ? `playlist:${playlistId}` : `video:${videoId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return res.status(200).json({ ...cached, fromCache: true });
  }

  try {
    // —— PLAYLIST ——
    if (playlistId) {
      const { ok, status, data } = await callRapidApi(
        `/v2/playlist/videos?playlistId=${playlistId}`,
        rapidKey
      );
      if (!ok) {
        return res.status(status).json({
          error: `Playlist olishda xatolik (${status})`,
        });
      }
      if (!data.items || !data.items.length) {
        return res.status(404).json({ error: "Playlist bo'sh yoki topilmadi" });
      }

      const result = {
        type: "playlist",
        title: "Playlist",
        videos: data.items
          .filter((v) => v.type === "video")
          .map((v) => ({
            id: v.id,
            title: v.title,
            duration: v.lengthText || null,
            thumbnail: v.thumbnails ? v.thumbnails[0]?.url : null,
          })),
      };
      setCache(cacheKey, result);
      return res.status(200).json(result);
    }

    // —— BITTA VIDEO ——
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Parallel: download info + Gemini tahlil
    const rapidRes = await callRapidApi(`/v2/video/details?videoId=${videoId}`, rapidKey);
    const { ok, status, data } = rapidRes;

    if (!ok) {
      if (status === 404) {
        return res
          .status(404)
          .json({ error: "Video topilmadi (o'chirilgan yoki noto'g'ri link)" });
      }
      if (status === 403) {
        return res
          .status(403)
          .json({ error: "Video yopiq (private) yoki yosh chegarasi bor" });
      }
      return res
        .status(status)
        .json({ error: `RapidAPI xatolik qaytardi: ${status}` });
    }

    if (!data.videos || !data.videos.items) {
      return res
        .status(404)
        .json({ error: "Yuklab olish formatlari topilmadi" });
    }

    const result = {
      type: "video",
      title: data.title,
      description:
        data.description ||
        data.shortDescription ||
        data.videoDetails?.shortDescription ||
        data.videoDetails?.description ||
        null,
            thumbnail: data.thumbnails
        ? data.thumbnails[data.thumbnails.length - 1]?.url
        : null,
      lengthSeconds: data.lengthSeconds || null,
      channel: data.channelName || data.author || data.channel?.name || null,
      viewCount: data.viewCount || data.viewCountText || null,
      items: data.videos.items.map((item) => ({
        url: item.url,
        quality: item.qualityLabel || item.quality,
        extension: item.extension,
        hasAudio: item.hasAudio !== false,
        size: item.contentLength || item.size || item.filesize || item.contentLengthText || null,
      })),
    };

    setCache(cacheKey, result);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Xatolik:", err);
    return res.status(500).json({ error: "Server xatoligi yuz berdi" });
  }
}
