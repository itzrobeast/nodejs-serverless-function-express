import fetch from 'node-fetch';
import { createGoogleCalendarEvent } from './google-calendar.js';

// Function to interact with OpenAI API
async function callOpenAI(userMessage) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || 'Sorry, I could not process your request.';
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    throw new Error('Failed to get response from OpenAI');
  }
}

// Function to send a message back to Instagram or Messenger user
async function sendMessage(platform, recipientId, message) {
  const platformUrl =
    platform === 'instagram'
      ? `https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`
      : `https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.FACEBOOK_ACCESS_TOKEN}`;

  try {
    const response = await fetch(platformUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error sending message to ${platform}:`, errorText);
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
}

// Helper function to extract event details
function extractEventDetails(userMessage) {
  const date = new Date();
  const startDateTime = date.toISOString();
  const endDateTime = new Date(date.getTime() + 60 * 60 * 1000).toISOString();

  return {
    summary: 'Scheduled Appointment',
    startDateTime,
    endDateTime,
  };
}

// Function to process Leadgen events
async function processLeadgenEvent(leadId) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/${leadId}?access_token=${process.env.FACEBOOK_ACCESS_TOKEN}`
    );
    const leadDetails = await response.json();
    console.log('Lead details:', leadDetails);

    // Handle lead details (e.g., save to DB, notify team)
    return leadDetails;
  } catch (error) {
    console.error('Error fetching lead details:', error);
  }
}

// Primary webhook handler
export default async function handler(req, res) {
  console.log('Received request:', req.method);
  console.log('Full query parameters:', req.query);

  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

    console.log('Expected token:', process.env.INSTAGRAM_VERIFY_TOKEN);
    console.log('Received token:', token);

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      console.log('Verification successful, returning challenge:', challenge);
      return res.status(200).send(challenge);
    } else {
      console.error('Verification failed');
      return res.status(403).send('Verification failed');
    }
  } else if (req.method === 'POST') {
    const body = req.body;

    if (!body || !body.object) {
      console.error('Invalid payload:', body);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    if (body.object === 'instagram' || body.object === 'page') {
      body.entry.forEach((entry) => {
        console.log('Processing entry:', entry);

        // Handle Instagram or Messenger events
        if (entry.messaging) {
          entry.messaging.forEach(async (message) => {
            const userMessage = message.message?.text || 'default message';
            const recipientId = message.sender?.id || 'default recipient';

            if (userMessage && recipientId) {
              try {
                const gptResponse = await callOpenAI(userMessage);
                console.log('Generated response from OpenAI:', gptResponse);

                if (userMessage.toLowerCase().includes('book appointment')) {
                  const eventDetails = extractEventDetails(userMessage);
                  await createGoogleCalendarEvent(eventDetails);
                  console.log('Appointment created in Google Calendar');
                }

                await sendMessage('instagram', recipientId, gptResponse);
                console.log('Response sent back to user');
              } catch (error) {
                console.error('Error processing message event:', error);
              }
            }
          });
        }

        // Handle Leadgen events
        if (entry.changes) {
          entry.changes.forEach((change) => {
            if (change.field === 'leadgen') {
              console.log('Leadgen event received:', change.value);
              processLeadgenEvent(change.value.lead_id);
            }
          });
        }
      });

      return res.status(200).send('EVENT_RECEIVED');
    } else {
      console.error('Unknown object type:', body.object);
      return res.status(400).json({ error: 'Invalid object type' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
