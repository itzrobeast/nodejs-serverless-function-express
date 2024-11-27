import { assistantHandler } from './assistant.js'; // Centralized logic
import fetch from 'node-fetch'; // For Instagram API

// Function to send a direct reply to an Instagram user
async function sendInstagramMessage(recipientId, message) {
  try {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message content. Cannot send empty or undefined message.');
    }

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
    console.error('[ERROR] Failed to send Instagram message:', error);
    throw error;
  }
}

// Process individual messaging events
async function processMessagingEvent(message) {
  try {
    console.log('[DEBUG] Received message for processing:', JSON.stringify(message, null, 2));

    const userMessage = message.message?.text || null;
    const recipientId = message.sender?.id || null;

    if (!userMessage || !recipientId) {
      console.warn('[DEBUG] Missing required fields. Skipping processing.');
      return; // Skip processing
    }

    console.log('[DEBUG] Passing message to assistant for processing.');

    // Generate response using assistant
    const assistantResponse = await assistantHandler(userMessage);
    console.log('[DEBUG] Assistant response:', assistantResponse.text);

    // Send the response back to Instagram
    await sendInstagramMessage(recipientId, assistantResponse.text);
  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error);
  }
}

// Primary webhook handler
export default async function handler(req, res) {
  console.log('Received request:', req.method);

  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      console.log('Verification successful. Returning challenge.');
      return res.status(200).send(challenge);
    } else {
      console.error('Verification failed.');
      return res.status(403).send('Verification failed.');
    }
  } else if (req.method === 'POST') {
    const body = req.body;

    if (!body || !body.object) {
      console.error('[ERROR] Invalid payload:', body);
      return res.status(400).json({ error: 'Invalid payload structure.' });
    }

    try {
      for (const entry of body.entry) {
        console.log('[DEBUG] Processing entry:', entry);

        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            await processMessagingEvent(message);
          }
        } else {
          console.warn('[DEBUG] No messaging events found in entry.');
        }
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('[ERROR] Failed to process webhook entries:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed.' });
  }
}
