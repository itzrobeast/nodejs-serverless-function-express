import { assistantHandler } from "../assistant.js"; // ✅ Import your existing assistant logic

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userMessage, businessId } = req.body;

  if (!userMessage || !businessId) {
    return res.status(400).json({ error: "Missing userMessage or businessId" });
  }

  try {
    const aiResponse = await assistantHandler({ userMessage, businessId });
    return res.json({ message: aiResponse.message });
  } catch (error) {
    console.error("❌ Error in assistant API:", error.message);
    return res.status(500).json({ error: "AI processing failed" });
  }
}
