import { assistantHandler } from './assistant.js'; // Import centralized logic
import fetch from 'node-fetch'; // For sending messages back to Instagram

// Function to send a direct reply to an Instagram user
async function sendInstagramMessage(recipientId, message) {
  try {
    console.log(`[DEBUG] Sending message to Instagram user ${recipientId}: "${message}"`);

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
      throw new Error(`Failed to send Instagram message: ${response.statusText}`);
    }

    console.log('Message sent to Instagram user successfully.');
    return await response.json();
  } catch (error) {
    console.error('Error in sendInstagramMessage:', error);
    throw error;
  }
}

// Function to process a single messaging event
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Received message for processing:', JSON.stringify(message, null, 2));

    const userMessage = message.message?.text || null;
    const recipientId = message.sender?.id || null;

    if (userMessage && recipientId) {
      console.log('[DEBUG] Passing message to assistant for processing.');

      // Pass the message to assistantHandler for logic and AI response generation
      const assistantResponse = await assistantHandler(userMessage);

      // Send the response back to Instagram
      await sendInstagramMessage(recipientId, assistantResponse.text);
    } else {
      console.warn('[DEBUG] Missing required fields. Skipping message processing.');
    }
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
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
    try {
      for (const entry of body.entry) {
        console.log('Processing entry:', entry);

        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            await processMessagingEvent(message);
          }
        } else {
          console.warn('[DEBUG] No messaging events found in entry:', entry);
        }
      }

      return res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('[ERROR] Failed to process webhook entries:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
