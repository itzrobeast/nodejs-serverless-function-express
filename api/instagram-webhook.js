// api/instagram-webhook.js
import fetch from 'node-fetch';
import { createGoogleCalendarEvent } from './google-calendar';

// Helper function to call OpenAI's API
async function callOpenAI(userMessage) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    const verifyToken = req.query['hub.verify_token'];

    if (verifyToken === process.env.INSTAGRAM_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Verification failed');
    }
  } else if (req.method === 'POST') {
    const body = req.body;
    const userMessage = body.message;

    try {
      const gptResponse = await callOpenAI(userMessage);

      if (userMessage.toLowerCase().includes("book appointment")) {
        const eventDetails = extractEventDetails(userMessage);
        await createGoogleCalendarEvent(eventDetails);
      }

      return res.status(200).json({ response: gptResponse });
    } catch (error) {
      console.error('Error processing Instagram webhook:', error);
      return res.status(500).json({ error: 'Failed to process the request' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Function to parse event details
function extractEventDetails(userMessage) {
  const date = new Date();
  const startDateTime = date.toISOString();
  const endDateTime = new Date(date.getTime() + 60 * 60 * 1000).toISOString();

  return {
    summary: 'Scheduled Appointment',
    startDateTime,
    endDateTime
  };
}
