import fetch from 'node-fetch';
import { sendInstagramMessage } from './vonage.js';
import { assistantHandler } from './assistant.js'; // Assistant integration

// Function to process messaging events dynamically with OpenAI and the assistant
async function processMessagingEvent(message) {
  console.log('Processing Instagram message:', JSON.stringify(message, null, 2));

  const userMessage = message.message?.text || null;
  const recipientId = message.sender?.id || null;

  if (userMessage && recipientId) {
    try {
      // Use the assistant to process the user message and decide the next action
      const assistantResponse = await assistantHandler(userMessage);
      console.log('Assistant Response:', assistantResponse);

      // Send the assistant-generated response back to Instagram
      await sendInstagramMessage(recipientId, assistantResponse.text || "I'm here to help!");
      console.log('Dynamic response sent to Instagram user.');
    } catch (error) {
      console.error('Error processing Instagram message with assistant:', error);
    }
  } else if (message.reaction) {
    // Handle reaction events
    console.log('Reaction event received:', message.reaction);
    const { reaction, emoji } = message.reaction;

    if (recipientId) {
      try {
        const responseMessage = `Thanks for reacting with ${emoji} (${reaction})!`;
        await sendInstagramMessage(recipientId, responseMessage);
        console.log('Reaction response sent to Instagram user.');
      } catch (error) {
        console.error('Error responding to Instagram reaction:', error);
      }
    }
  } else {
    console.warn('Unhandled messaging event:', message);
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

    body.entry.forEach((entry) => {
      console.log('Processing entry:', entry);

      // Handle messaging events (Instagram DMs, comments, or reactions)
      if (entry.messaging && Array.isArray(entry.messaging)) {
        entry.messaging.forEach(async (message) => {
          await processMessagingEvent(message);
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
