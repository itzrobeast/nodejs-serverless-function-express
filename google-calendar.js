
// api/google-calendar.js
import fetch from 'node-fetch';
import { google } from 'googleapis';

// Decode and initialize Google credentials from service_account.json in environment variable
const serviceAccount = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT, 'base64').toString('utf8')
);

// Function to generate a Google API access token
async function getGoogleAccessToken() {
  const jwtClient = new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key,
    ['https://www.googleapis.com/auth/calendar']
  );

  await jwtClient.authorize();
  return jwtClient.credentials.access_token;
}

// Function to create a Google Calendar event
export async function createGoogleCalendarEvent(eventDetails) {
  const accessToken = await getGoogleAccessToken();

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${process.env.GOOGLE_CALENDAR_ID}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary: eventDetails.summary || 'New Appointment',
      start: { dateTime: eventDetails.startDateTime, timeZone: 'America/Los_Angeles' },
      end: { dateTime: eventDetails.endDateTime, timeZone: 'America/Los_Angeles' }
    })
  });

  return await response.json();
}
