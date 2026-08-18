// SERVER-SIDE fayl (Vercel serverless function). Bu yerda API key xavfsiz.
//
// MUHIM: RAPIDAPI_KEY'ni Vercel dashboard > Settings > Environment Variables
// ichiga qo'sh. Kodga yozma!

const API_HOST = "youtube-media-downloader.p.rapidapi.com";

// ODDIY IN-MEMORY CACHE haqida ogohlantirish:
// Vercel serverless funksiyalar har safar yangi (yoki "cold") instance'da
// ishga tushishi mumkin, shuning uchun bu cache 100% ishonchli emas —
// ba'zan urib, ba'zan urmaydi. Bu "best effort" optimizatsiya, garantiya emas.
// Haqiqiy production cache uchun Vercel KV yoki Redis kerak bo'ladi.
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
    // m.youtube.com yoki boshqa domenlar ham watch?v= formatidan foydalanadi,
    // yuqoridagi shart ularni ham qamrab oladi.
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Faqat GET so'rov qabul qilinadi" });
  }

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.error("RAPIDAPI_KEY environment variable topilmadi!");
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

  const cacheKey = playlistId ? `playlist:${playlistId}` : `video:${videoId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return res.status(200).json({ ...cached, fromCache: true });
  }

  try {
    if (playlistId) {
      // ESLATMA: quyidagi endpoint nomi RapidAPI docs asosida taxminiy
      // yozilgan (men live chaqira olmayman). Agar 404/xato qaytarsa,
      // RapidAPI console > "youtube-media-downloader" > Endpoints bo'limidan
      // to'g'ri playlist path'ini topib, shu yerga almashtir.
      const { ok, status, data } = await callRapidApi(
        `/v2/playlist/videos?playlistId=${playlistId}`,
        apiKey
      );
      if (!ok) {
        return res.status(status).json({
          error: `Playlist olishda xatolik (${status}). Endpoint path'ini RapidAPI docs'idan tekshiring.`,
        });
      }
      if (!data.videos || !data.videos.length) {
        return res.status(404).json({ error: "Playlist bo'sh yoki topilmadi" });
      }

      const result = {
        type: "playlist",
        title: data.title || "Playlist",
        videos: data.videos.map((v) => ({
          id: v.id,
          title: v.title,
          thumbnail: v.thumbnails ? v.thumbnails[0]?.url : null,
        })),
      };
      setCache(cacheKey, result);
      return res.status(200).json(result);
    }

    // Oddiy bitta video
    const { ok, status, data } = await callRapidApi(
      `/v2/video/details?videoId=${videoId}`,
      apiKey
    );

    if (!ok) {
      if (status === 404) {
        return res.status(404).json({ error: "Video topilmadi (o'chirilgan yoki noto'g'ri link)" });
      }
      if (status === 403) {
        return res.status(403).json({ error: "Video yopiq (private) yoki yosh chegarasi bor" });
      }
      return res.status(status).json({ error: `RapidAPI xatolik qaytardi: ${status}` });
    }

    if (!data.videos || !data.videos.items) {
      return res.status(404).json({ error: "Yuklab olish formatlari topilmadi" });
    }

    const result = {
      type: "video",
      title: data.title,
      thumbnail: data.thumbnails ? data.thumbnails[data.thumbnails.length - 1]?.url : null,
      lengthSeconds: data.lengthSeconds || null,
      items: data.videos.items.map((item) => ({
        url: item.url,
        quality: item.qualityLabel || item.quality,
        extension: item.extension,
        hasAudio: item.hasAudio !== false, // API ba'zan bu maydonni bermaydi
      })),
    };
    setCache(cacheKey, result);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Xatolik:", err);
    return res.status(500).json({ error: "Server xatoligi yuz berdi" });
  }
}
