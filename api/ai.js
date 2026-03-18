// Quick Pre Study — Backend AI Proxy
// Provider: Google Gemini Flash (cheap, fast, great quality)
// Deploy this file to: /api/ai.js in your Vercel project
// Add GOOGLE_API_KEY in Vercel Environment Variables

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt, systemPrompt } = req.body;

  try {
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // stored safely in Vercel

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt || 'You are a Malaysian property market analyst. Respond only in valid JSON, no markdown, no extra text.' }]
          },
          contents: [
            { role: 'user', parts: [{ text: prompt }] }
          ],
          generationConfig: {
            temperature: 0.3,       // lower = more consistent/factual
            maxOutputTokens: 1000,
          }
        })
      }
    );

    const data = await response.json();

    // Extract text from Gemini response format
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Return in a format the frontend understands
    res.status(200).json({
      content: [{ text }]
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
