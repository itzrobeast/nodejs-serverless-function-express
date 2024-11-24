import OpenAI from "openai";
import { sendSMS, makeCall } from "./vonage.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "'messages' must be a valid array of messages." });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      functions: [
        {
          name: "sendSMS",
          description: "Send an SMS using Vonage",
          parameters: { type: "object", properties: { to: { type: "string" }, text: { type: "string" } } },
        },
        {
          name: "makeCall",
          description: "Make a call using Vonage",
          parameters: { type: "object", properties: { to: { type: "string" }, message: { type: "string" } } },
        },
      ],
    });

    const functionCall = response.choices[0].message.function_call;

    if (functionCall.name === "sendSMS") {
      const { to, text } = functionCall.arguments;
      const smsResponse = await sendSMS(to, text);
      return res.status(200).json({ success: true, message: "SMS sent successfully!", smsResponse });
    }

    if (functionCall.name === "makeCall") {
      const { to, message } = functionCall.arguments;
      const callResponse = await makeCall(to, message);
      return res.status(200).json({ success: true, message: "Call placed successfully!", callResponse });
    }

    return res.status(200).json({ functionCall }); // Default response
  } catch (error) {
    console.error("Error in assistant.js:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
}
