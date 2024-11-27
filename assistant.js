import OpenAI from 'openai';
import { sendSMS, makeCall } from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

export async function assistantHandler(userMessage) {
  try {
    console.log('[DEBUG] Sending message to OpenAI:', userMessage);

    const response = await openai.chat.completions.create({
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

    const functionCall = response.choices[0]?.message?.function_call;

    if (functionCall) {
      const { name, arguments: args } = functionCall;
      console.log('[DEBUG] Function call received:', name, args);

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

    return { text: response.choices[0]?.message?.content || "I'm here to help!" };
  } catch (error) {
    console.error('[ERROR] Failed to process assistant request:', error);
    return { text: 'Something went wrong. Please try again later.' };
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ message: 'Assistant endpoint is live. Use POST to interact with the assistant.' });
    }

    if (req.method === 'POST') {
      const { messages } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "'messages' must be a non-empty array." });
      }

      const assistantResponse = await assistantHandler(messages[0]);
      return res.status(200).json({ success: true, assistantResponse });
    }

    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  } catch (error) {
    console.error('[ERROR] Assistant API handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
