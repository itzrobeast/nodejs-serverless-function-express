import fetch from 'node-fetch';
import { google } from 'googleapis';
import { applyCors } from './cors'; // Import centralized CORS utility

// Decode and initialize Google credentials from service_account.json in environment variable
const serviceAccount = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT, 'base64').toString('utf8')
);

// Function to generate a Google API access token
async function getGoogleAccessToken() {
  try {
    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      ['https://www.googleapis.com/auth/calendar']
    );

    await jwtClient.authorize();
    return jwtClient.credentials.access_token;
  } catch (error) {
    console.error('Failed to generate Google API access token:', error);
    throw error;
  }
}

// Function to create a Google Calendar event
export async function createGoogleCalendarEvent(eventDetails, req, res) {
  applyCors(res); // Apply CORS headers
  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // Handle preflight requests
  }

  try {
    const accessToken = await getGoogleAccessToken();

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${process.env.GOOGLE_CALENDAR_ID}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: eventDetails.summary || 'New Appointment',
          start: {
            dateTime: eventDetails.startDateTime,
            timeZone: eventDetails.timeZone || 'America/Los_Angeles',
          },
          end: {
            dateTime: eventDetails.endDateTime,
            timeZone: eventDetails.timeZone || 'America/Los_Angeles',
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create calendar event: ${errorText}`);
    }

    const event = await response.json();
    return res.status(200).json(event);
  } catch (error) {
    console.error('Error creating Google Calendar event:', error);
    return res.status(500).json({ error: 'Failed to create calendar event' });
  }
}

// Function to fetch upcoming events from Google Calendar
export async function getUpcomingEvents(req, res, maxResults = 10) {
  applyCors(res); // Apply CORS headers
  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // Handle preflight requests
  }

  try {
    const accessToken = await getGoogleAccessToken();

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${process.env.GOOGLE_CALENDAR_ID}/events?maxResults=${maxResults}&orderBy=startTime&singleEvents=true`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch upcoming events: ${errorText}`);
    }

    const events = await response.json();
    return res.status(200).json(events.items || []);
  } catch (error) {
    console.error('Error fetching upcoming Google Calendar events:', error);
    return res.status(500).json({ error: 'Failed to fetch upcoming events' });
  }
}
