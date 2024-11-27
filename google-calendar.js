import fetch from 'node-fetch';
import { google } from 'googleapis';

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

export async function createGoogleCalendarEvent(eventDetails) {
  // Function to create Google Calendar events
  // Same as provided
}

export async function getUpcomingEvents(maxResults = 10) {
  // Function to fetch upcoming events
  // Same as provided
}
