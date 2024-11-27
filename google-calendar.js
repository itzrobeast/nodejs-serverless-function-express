import fetch from 'node-fetch';
import { google } from 'googleapis';

// Decode and initialize Google credentials from the environment variable
const serviceAccount = (() => {
  try {
    return JSON.parse(
      Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT, 'base64').toString('utf8')
    );
  } catch (error) {
    console.error('Failed to parse Google service account credentials:', error);
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT environment variable');
  }
})();

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
    console.error('Failed to generate Google API access token:', error.message, error.stack);
    throw new Error('Unable to authenticate with Google API');
  }
}

// Function to create a Google Calendar event
export async function createGoogleCalendarEvent(eventDetails) {
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
          description: eventDetails.description || '',
          start: {
            dateTime: eventDetails.startDateTime,
            timeZone: eventDetails.timeZone || 'America/Los_Angeles',
          },
          end: {
            dateTime: eventDetails.endDateTime,
            timeZone: eventDetails.timeZone || 'America/Los_Angeles',
          },
          attendees: eventDetails.attendees || [],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create calendar event: ${errorText}`);
    }

    const event = await response.json();
    console.log('Google Calendar event created successfully:', event);
    return event;
  } catch (error) {
    console.error('Error creating Google Calendar event:', error.message, error.stack);
    throw error;
  }
}

// Function to fetch upcoming events from Google Calendar
export async function getUpcomingEvents(maxResults = 10) {
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
    console.log('Fetched upcoming Google Calendar events successfully:', events.items);
    return events.items || [];
  } catch (error) {
    console.error('Error fetching upcoming Google Calendar events:', error.message, error.stack);
    throw error;
  }
}
