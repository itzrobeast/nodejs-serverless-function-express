import OpenAI from 'openai';
import { sendSMS, makeCall } from './vonage.js';
import { createGoogleCalendarEvent, getUpcomingEvents } from './google-calendar.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function to handle assistant actions
export async function assistantHandler(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that manages appointments and responds to user queries.' },
        { role: 'user', content: userMessage },
      ],
      functions: [
        {
          name: 'fetchEvents',
          description: 'Fetch upcoming events from Google Calendar',
          parameters: { type: 'object', properties: { maxResults: { type: 'number' } } },
        },
        {
          name: 'sendSMS',
          description: 'Send an SMS using Vonage',
          parameters: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } } },
        },
        {
          name: 'makeCall',
          description: 'Make a call using Vonage',
          parameters: { type: 'object', properties: { to: { type: 'string' }, message: { type: 'string' } } },
        },
        {
          name: 'createGoogleCalendarEvent',
          description: 'Create an event on Google Calendar',
          parameters: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              startDateTime: { type: 'string' },
              endDateTime: { type: 'string' },
            },
          },
        },
      ],
    });

    const functionCall = response.choices[0]?.message?.function_call;

    // Handle assistant function calls
    if (functionCall) {
      const { name, arguments: args } = functionCall;

      if (name === 'fetchEvents') {
        const events = await getUpcomingEvents(args.maxResults || 10);
        return { text: `Here are your upcoming events: ${JSON.stringify(events)}` };
      }

      if (name === 'sendSMS') {
        const { to, text } = JSON.parse(args);
        await sendSMS(to, text);
        return { text: 'SMS sent successfully!' };
      }

      if (name === 'makeCall') {
        const { to, message } = JSON.parse(args);
        await makeCall(to, message);
        return { text: 'Call placed successfully!' };
      }

      if (name === 'createGoogleCalendarEvent') {
        const { summary, startDateTime, endDateTime } = JSON.parse(args);
        await createGoogleCalendarEvent({ summary, startDateTime, endDateTime });
        return { text: 'Appointment created successfully on Google Calendar!' };
      }
    }

    // Default response
    return { text: response.choices[0]?.message?.content || "I'm here to help!" };
  } catch (error) {
    console.error('Error in assistantHandler:', error);
    return { text: 'Something went wrong. Please try again later.' };
  }
}

// Default API handler
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ message: 'Assistant endpoint is live. Use POST to interact with the assistant.' });
    }

    if (req.method === 'POST') {
      const { messages } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "'messages' must be a valid array of messages." });
      }

      const assistantResponse = await assistantHandler(messages);
      return res.status(200).json({ success: true, assistantResponse });
    }

    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  } catch (error) {
    console.error('Error in assistant API:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
