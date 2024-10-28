// api/instagram-webhook.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Step 1: Verification for Instagram Webhook (during setup)
    const challenge = req.query['hub.challenge'];
    const verifyToken = req.query['hub.verify_token'];
    if (verifyToken === process.env.INSTAGRAM_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Verification failed');
    }
  } else if (req.method === 'POST') {
    // Step 2: Process incoming Instagram messages
    const body = req.body;
    const userMessage = body.message;  // Adjust based on Instagram's message payload structure

    try {
      // Step 3: Call OpenAI's GPT for a response
      const gptResponse = await callOpenAI(userMessage);

      // Step 4: Optionally create a Google Calendar event if the message requests it
      if (userMessage.toLowerCase().includes("book appointment")) {
        const eventDetails = extractEventDetails(userMessage); // Function to extract date/time if present
        await createGoogleCalendarEvent(eventDetails);
      }

      // Send GPT response back to Instagram
      return res.status(200).json({ response: gptResponse });
    } catch (error) {
      console.error('Error processing Instagram webhook:', error);
      return res.status(500).json({ error: 'Failed to process the request' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Helper function to call OpenAI's API
async function callOpenAI(userMessage) {
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
}

// Helper function to create a Google Calendar event
async function createGoogleCalendarEvent(eventDetails) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${process.env.GOOGLE_CALENDAR_ID}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GOOGLE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary: eventDetails.summary || 'New Appointment',
      start: { dateTime: eventDetails.startDateTime, timeZone: 'America/Los_Angeles' },
      end: { dateTime: eventDetails.endDateTime, timeZone: 'America/Los_Angeles' }
    })
  });

  const data = await response.json();
  return data;
}

// Function to parse date/time details for Google Calendar (customize as needed)
function extractEventDetails(userMessage) {
  // Parse date and time (you could use regex or NLP parsing here for more accuracy)
  const date = new Date(); // Placeholder: Parse date from userMessage
  const startDateTime = date.toISOString();
  const endDateTime = new Date(date.getTime() + 60 * 60 * 1000).toISOString(); // Default 1-hour duration

  return {
    summary: 'Scheduled Appointment',
    startDateTime,
    endDateTime
  };
}
