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
    console.log('[DEBUG] Full message object:', JSON.stringify(message, null, 2));

    // Extract the user message text
    const userMessage = message.message?.text || null;
    const recipientId = message.sender?.id || null;

    console.log('[DEBUG] Extracted user message:', userMessage);
    console.log('[DEBUG] Extracted recipient ID:', recipientId);

    if (!userMessage) {
      console.error('[ERROR] Invalid user message:', userMessage);
      throw new Error('Invalid user message. Message content is empty or undefined.');
    }

    if (!recipientId) {
      console.error('[ERROR] Missing recipient ID:', recipientId);
      throw new Error('Recipient ID is missing or invalid.');
    }

    console.log('[DEBUG] Sending user message to assistant for response.');

    // Pass the message to the assistant for processing
    const assistantResponse = await assistantHandler(userMessage);

    console.log('[DEBUG] Assistant response:', assistantResponse.text);

    // Send the assistant's response back to the Instagram user
    console.log('[DEBUG] Sending assistant response back to Instagram user.');
    await sendInstagramMessage(recipientId, assistantResponse.text);
    console.log('[DEBUG] Response sent successfully to Instagram user:', assistantResponse.text);

  } catch (error) {
    console.error('[ERROR] Failed to process messaging event:', error.message);
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
