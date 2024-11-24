import fetch from 'node-fetch';
import { createGoogleCalendarEvent } from './google-calendar.js';

// Function to fetch lead details using the leadgen_id
async function fetchLeadDetails(leadgenId) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/${leadgenId}?access_token=${process.env.FACEBOOK_ACCESS_TOKEN}`
    );

    if (!response.ok) {
      throw new Error(`Error fetching lead details: ${response.statusText}`);
    }

    const leadDetails = await response.json();
    console.log('Fetched Lead Details:', leadDetails);

    // Further processing (e.g., save to DB, notify team, push to CRM)
    return leadDetails;
  } catch (error) {
    console.error('Error fetching lead details:', error);
    return null;
  }
}

// Function to send a message back to Instagram user
async function sendInstagramMessage(recipientId, message) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error sending message to Instagram:', errorText);
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error in sendInstagramMessage:', error);
    throw error;
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

        // Handle leadgen events
        entry.changes.forEach(async (change) => {
          if (change.field === 'leadgen') {
            console.log('Leadgen event received:', change.value);
            const leadDetails = await fetchLeadDetails(change.value.leadgen_id);

            if (leadDetails) {
              // Example: Log lead details or notify your team
              console.log('Lead Details Processed:', leadDetails);

              // Optional: Notify your team (e.g., email, SMS) or save to a database
              // await notifyTeam(leadDetails);
            }
          }
        });

        // Handle messaging events (Instagram DMs or comments)
        if (entry.messaging) {
          entry.messaging.forEach(async (message) => {
            const userMessage = message.message?.text || 'default message';
            const recipientId = message.sender?.id || 'default recipient';

            if (userMessage && recipientId) {
              try {
                // Example: Respond to Instagram messages via OpenAI
                const responseMessage = `Thank you for your message: "${userMessage}". We'll get back to you soon!`;
                await sendInstagramMessage(recipientId, responseMessage);
                console.log('Response sent to Instagram user.');
              } catch (error) {
                console.error('Error processing Instagram message:', error);
              }
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
