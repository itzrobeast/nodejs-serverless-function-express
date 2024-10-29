// api/instagram-webhook.js
import fetch from 'node-fetch';
import { createGoogleCalendarEvent } from './google-calendar';

// Function to interact with OpenAI API
async function callOpenAI(userMessage) {
  try {
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
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    throw new Error('Failed to get response from OpenAI');
  }
}

// Primary handler for Instagram webhook
export default async function handler(req, res) {
  console.log('Received request:', req.method, req.body);

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      console.log('Verification successful');
      return res.status(200).send(challenge);
    } else {
      console.error('Verification failed');
      return res.status(403).send('Verification failed');
    }
  } else if (req.method === 'POST') {
    const body = req.body;
    const userMessage = body.message;
    const recipientId = body.sender?.id;  // Ensure the sender ID exists

    if (!userMessage || !recipientId) {
      console.error('Invalid request payload:', body);
      return res.status(400).json({ error: 'Invalid payload' });
    }

    try {
      const gptResponse = await callOpenAI(userMessage);
      console.log('Generated response from GPT:', gptResponse);

      if (userMessage.toLowerCase().includes('book appointment')) {
        const eventDetails = extractEventDetails(userMessage);
        await createGoogleCalendarEvent(eventDetails);
        console.log('Appointment created in Google Calendar');
      }

      await sendInstagramMessage(recipientId, gptResponse);
      console.log('Response sent back to Instagram');
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
  try {
    const response = await fetch(`https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error sending message to Instagram:', errorText);
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error in sendInstagramMessage:', error);
  }
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
