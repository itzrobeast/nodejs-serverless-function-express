import { Vonage } from '@vonage/server-sdk';
import OpenAI from "openai";

// Initialize Vonage
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    // Ensure the request is a POST method
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const { messages } = req.body;

    // Validate input
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "'messages' must be a valid array of messages." });
    }

    // Generate a response from OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      functions: [
        {
          name: "bookAppointment",
          description: "Book an appointment on Google Calendar",
          parameters: { type: "object", properties: { title: { type: "string" }, time: { type: "string" } } },
        },
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
      // Handle sending SMS with Vonage
      const { to, text } = functionCall.arguments;
      await vonage.sms.send({
        to,
        from: process.env.VONAGE_PHONE_NUMBER,
        text,
      });
      return res.status(200).json({ success: true, message: "SMS sent successfully!" });
    }

    if (functionCall.name === "makeCall") {
      // Handle making a call with Vonage
      const { to, message } = functionCall.arguments;
      await vonage.voice.createCall({
        to: [{ type: "phone", number: to }],
        from: { type: "phone", number: process.env.VONAGE_PHONE_NUMBER },
        ncco: [
          {
            action: "talk",
            text: message,
          },
        ],
      });
      return res.status(200).json({ success: true, message: "Call placed successfully!" });
    }

    return res.status(200).json({ functionCall }); // Default response for other function calls
  } catch (error) {
    console.error("Error in assistant.js:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
}
