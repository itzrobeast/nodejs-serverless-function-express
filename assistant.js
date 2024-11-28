import OpenAI from 'openai';
import { sendSMS, makeCall } from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function handlers for various actions
const functionHandlers = {
  fetchEvents: async (args) => {
    const maxResults = args.maxResults || 10;
    const events = await getUpcomingEvents(maxResults);
    return { text: `Here are your upcoming events: ${JSON.stringify(events)}` };
  },
  sendSMS: async (args) => {
    const { to, text } = args;
    await sendSMS(to, text);
    return { text: 'SMS sent successfully!' };
  },
  makeCall: async (args) => {
    const { to, message } = args;
    await makeCall(to, message);
    return { text: 'Call placed successfully!' };
  },
  createGoogleCalendarEvent: async (args) => {
    const { summary, startDateTime, endDateTime } = args;
    await createGoogleCalendarEvent({ summary, startDateTime, endDateTime });
    return { text: 'Appointment created successfully on Google Calendar!' };
  },
};

// Assistant handler to process user messages
export async function assistantHandler({ userMessage, recipientId, platform }) {
  try {
    console.log(`[DEBUG] Processing message from platform: ${platform}`);
    console.log(`[DEBUG] User message: "${userMessage}"`);
    console.log('[DEBUG] Received user message:', userMessage);

    if (!userMessage || typeof userMessage !== 'string') {
      console.error('[ERROR] Invalid user message:', userMessage);
      return { text: 'I couldn’t understand your message. Could you please rephrase it?' };
    }

    // Generate response using OpenAI
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that manages appointments and responds to user queries.' },
        { role: 'user', content: userMessage },
      ],
      functions: Object.keys(functionHandlers).map((name) => ({
        name,
        description: `Executes the ${name} function.`,
        parameters: { type: 'object', properties: {} },
      })),
    });

    const functionCall = openaiResponse.choices[0]?.message?.function_call;

    // Handle OpenAI function calls if requested
    if (functionCall) {
      const { name, arguments: args } = functionCall;
      console.log(`[DEBUG] OpenAI requested function call: ${name}`, args);

      try {
        const parsedArgs = JSON.parse(args);
        if (functionHandlers[name]) {
          return await functionHandlers[name](parsedArgs);
        } else {
          console.warn(`[DEBUG] No handler found for function: ${name}`);
        }
      } catch (err) {
        console.error(`[ERROR] Error processing function call for ${name}:`, err);
      }
    }

    // Default OpenAI response
    const responseMessage = openaiResponse.choices[0]?.message?.content || "I'm here to help!";
    console.log(`[DEBUG] Generated response from OpenAI: "${responseMessage}"`);

    // Return the response
    return { message: responseMessage };
  } catch (error) {
    console.error('[ERROR] Failed to process assistant request:', error);
    return { message: 'Something went wrong. Please try again later.' };
  }
}

// Default API handler for external requests
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { userMessage, recipientId, platform } = req.body;

      if (!userMessage || !recipientId || !platform) {
        return res.status(400).json({ error: 'Missing required fields: userMessage, recipientId, or platform.' });
      }

      const assistantResponse = await assistantHandler({ userMessage, recipientId, platform });
      return res.status(200).json({ success: true, assistantResponse });
    }

    if (req.method === 'GET') {
      return res.status(200).json({ message: 'Assistant endpoint is live. Use POST to interact with the assistant.' });
    }

    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  } catch (error) {
    console.error('[ERROR] Assistant API handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
