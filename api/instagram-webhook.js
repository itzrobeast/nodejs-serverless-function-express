// api/instagram-webhook.js
import fetch from 'node-fetch';
import { createGoogleCalendarEvent } from './google-calendar'; // Imports Google Calendar function for scheduling events

// Function to interact with OpenAI API
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

// Primary handler for Instagram webhook
export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Verify token for Instagram webhook setup
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Verification failed');
    }
  } else if (req.method === 'POST') {
    const body = req.body;
    const userMessage = body.message;

    try {
      // Call GPT to generate a response
      const gptResponse = await callOpenAI(userMessage);

      // Check if user asked for an appointment and create event if so
      if (userMessage.toLowerCase().includes("book appointment")) {
        const eventDetails = extractEventDetails(userMessage);
        await createGoogleCalendarEvent(eventDetails);
      }

      // Send the generated response back to Instagram
      await sendInstagramMessage(body.sender.id, gptResponse);
      return res.status(200).json({ response: 'Message sent!' });
    } catch (error) {
      console.error('Error processing Instagram webhook:', error);
      return res.status(500).json({ error: 'Failed to process the request' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Function to send a message back to Instagram user
async function sendInstagramMessage(recipientId, message) {
  await fetch(`https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message }
    })
  });
}

// Optional helper function to extract event details from user message
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
