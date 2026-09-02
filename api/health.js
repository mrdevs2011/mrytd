// GET /api/health — env holatini tekshirish
export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    rapidapi: Boolean(process.env.RAPIDAPI_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
}
