import fetch from 'node-fetch';
import { createGoogleCalendarEvent } from './google-calendar.js';

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
  console.log("Received request:", req.method);
  console.log("Full query parameters:", req.query);

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log("Expected token:", process.env.INSTAGRAM_VERIFY_TOKEN);
    console.log("Received token:", token);

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      console.log("Verification successful, returning challenge:", challenge);
      return res.status(200).send(challenge);
    } else {
      console.error("Verification failed");
      return res.status(403).send("Verification failed");
    }
  } 
  
  // Handle POST requests
  else if (req.method === 'POST') {
    const body = req.body;

    // Check for a valid Instagram payload structure
    if (body.object === 'instagram' && body.entry && body.entry.length > 0) {
      const changes = body.entry[0].changes;  // Access the 'changes' array in the first entry

      // Process the first change (if any), assuming a simple message-based webhook
      if (changes && changes.length > 0) {
        const change = changes[0];
        console.log("Processing change:", JSON.stringify(change, null, 2));

        // Check if the change is a message and extract details
        const userMessage = change.value?.message?.text || "default message";
        const recipientId = change.value?.sender?.id || "default recipient";

        // Validate the parsed data
        if (!userMessage || !recipientId) {
          console.error('Invalid request payload:', body);
          return res.status(400).json({ error: 'Invalid payload' });
        }

        try {
          // Generate a response with OpenAI
          const gptResponse = await callOpenAI(userMessage);
          console.log('Generated response from OpenAI:', gptResponse);

          // Trigger Google Calendar event creation if "book appointment" is mentioned
          if (userMessage.toLowerCase().includes('book appointment')) {
            const eventDetails = extractEventDetails(userMessage);
            await createGoogleCalendarEvent(eventDetails);
            console.log('Appointment created in Google Calendar');
          }

          // Send the generated response back to Instagram
          await sendInstagramMessage(recipientId, gptResponse);
          console.log('Response sent back to Instagram');
          return res.status(200).json({ response: 'Message sent!' });

        } catch (error) {
          console.error('Error processing Instagram webhook:', error);
          return res.status(500).json({ error: 'Failed to process the request' });
        }
      } else {
        console.error('No valid changes in the payload');
        return res.status(400).json({ error: 'No valid changes in the payload' });
      }
    } else {
      console.error('Invalid request payload:', body);
      return res.status(400).json({ error: 'Invalid payload structure' });
    }
  } else {
    return res.status(405).json({ error: "Method not allowed" });
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
    throw error;
  }
}

// Helper function to extract event details from user message
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
