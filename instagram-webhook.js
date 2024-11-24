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
      throw new Error(`Failed to send message: ${errorText}`);
    }
    console.log('Message successfully sent to Instagram user.');
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

    // Process entries
    body.entry.forEach((entry) => {
      console.log('Processing entry:', entry);

      // Handle leadgen events
      if (entry.changes && Array.isArray(entry.changes)) {
        entry.changes.forEach(async (change) => {
          if (change.field === 'leadgen') {
            console.log('Leadgen event received:', change.value);

            try {
              const leadDetails = await fetchLeadDetails(change.value.leadgen_id);

              if (leadDetails) {
                console.log('Lead Details Processed:', leadDetails);

                // Optional: Notify your team or save to a database
                // await notifyTeam(leadDetails);
              }
            } catch (error) {
              console.error('Error fetching lead details:', error);
            }
          }
        });
      }

      // Handle messaging events (Instagram DMs or comments)
      if (entry.messaging && Array.isArray(entry.messaging)) {
        entry.messaging.forEach(async (message) => {
          const userMessage = message.message?.text || null;
          const recipientId = message.sender?.id || null;

          if (userMessage && recipientId) {
            try {
              const responseMessage = `Thank you for your message: "${userMessage}". We'll get back to you soon!`;
              await sendInstagramMessage(recipientId, responseMessage);
              console.log('Response sent to Instagram user.');
            } catch (error) {
              console.error('Error responding to Instagram message:', error);
            }
          } else {
            console.warn('Message or senderId missing in messaging event:', message);
          }
        });
      } else {
        console.warn('No messaging or leadgen events found in entry:', entry);
      }
    });

    return res.status(200).send('EVENT_RECEIVED');
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
