import fetch from 'node-fetch';
import { google } from 'googleapis';
import supabase from './supabaseClient.js';
import express from 'express';

const router = express.Router();

// Initialize Google OAuth Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.BASE_URL}/auth/google/callback`
);

// Route to initiate Google OAuth flow
router.get('/auth/google', (req, res) => {
  const { businessId } = req.query;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: businessId,
  });

  res.redirect(authUrl);
});

// OAuth callback route
router.get('/auth/google/callback', async (req, res) => {
  const { code, state: businessId } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);

    // Store tokens in Supabase
    const { error } = await supabase
      .from('google_calendar')
      .upsert({
        business_id: businessId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: tokens.expiry_date,
      });

    if (error) {
      console.error('Error storing Google tokens:', error);
      throw new Error('Failed to store Google Calendar tokens');
    }

    res.redirect('/calendar');
  } catch (error) {
    console.error('Error during OAuth callback:', error);
    res.status(500).send('Authentication failed');
  }
});

// Function to fetch Google access token from Supabase
async function getGoogleAccessToken(businessId) {
  try {
    const { data, error } = await supabase
      .from('google_calendar')
      .select('access_token, refresh_token, token_expiry')
      .eq('business_id', businessId)
      .single();

    if (error || !data) {
      throw new Error('Google access token not found');
    }

    return data.access_token;
  } catch (error) {
    console.error('Failed to retrieve Google API access token:', error.message);
    throw new Error('Unable to authenticate with Google API');
  }
}

// Function to create a Google Calendar event
export async function createGoogleCalendarEvent(businessId, eventDetails) {
  try {
    const accessToken = await getGoogleAccessToken(businessId);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${eventDetails.calendarId}/events`,
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
    console.error('Error creating Google Calendar event:', error.message);
    throw error;
  }
}

// Function to fetch upcoming Google Calendar events
export async function getUpcomingEvents(businessId, maxResults = 10) {
  try {
    const accessToken = await getGoogleAccessToken(businessId);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${maxResults}&orderBy=startTime&singleEvents=true`,
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
    console.error('Error fetching upcoming Google Calendar events:', error.message);
    throw error;
  }
}

export default router;
