import fetch from 'node-fetch';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function to send a direct reply to an Instagram user
async function sendInstagramMessage(recipientId, message) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`,
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

// Function to process a single messaging event dynamically with OpenAI
async function processMessagingEvent(message) {
  console.log('Processing Instagram message:', JSON.stringify(message, null, 2));

  const userMessage = message.message?.text || null;
  const recipientId = message.sender?.id || null;

  if (userMessage && recipientId) {
    try {
      console.log('Generating response using OpenAI...');
      const openaiResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful business assistant responding to customer inquiries.' },
          { role: 'user', content: userMessage },
        ],
      });

      if (!openaiResponse || !openaiResponse.choices || !openaiResponse.choices[0]?.message?.content) {
        throw new Error('Invalid OpenAI response format');
      }

      const responseMessage = openaiResponse.choices[0].message.content;
      console.log('Generated response from OpenAI:', responseMessage);

      console.log('Sending response to Instagram user...');
      await sendInstagramMessage(recipientId, responseMessage);
      console.log('Response sent successfully to Instagram user.');
    } catch (error) {
      console.error('Error processing message with OpenAI or sending response:', error);
    }
  } else if (message.message?.is_deleted) {
    console.log('Skipping deleted message:', message.message.mid);
  } else {
    console.warn('Unhandled messaging event or missing data:', message);
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
      const processingTasks = body.entry.map(async (entry) => {
        console.log('Processing entry:', entry);

        if (entry.messaging && Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            await processMessagingEvent(message);
          }
        } else {
          console.warn('No messaging events found in entry:', entry);
        }
      });

      await Promise.all(processingTasks);
    } catch (error) {
      console.error('Error processing entries:', error);
    }

    return res.status(200).send('EVENT_RECEIVED');
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
