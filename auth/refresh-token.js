import express from 'express';
import fetch from 'node-fetch';
import cron from 'node-cron';
import supabase from '../supabaseClient.js'; // Adjust path as needed

const router = express.Router();

// Helper function to refresh a page access token
export async function refreshPageAccessToken(pageId, userAccessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v15.0/me/accounts?access_token=${userAccessToken}`);
    const data = await response.json();

    if (data.error) {
      console.error(`[ERROR] Failed to fetch page access token for Page ID: ${pageId}:`, data.error.message);
      throw new Error(data.error.message);
    }

    // Find the specific page in the response
    const pageData = data.data.find((page) => page.id === pageId);

    if (!pageData) {
      console.warn(`[WARN] Page ID ${pageId} not found in user accounts.`);
      return null;
    }

    const newPageAccessToken = pageData.access_token;

    // Update the token in Supabase
    const { error } = await supabase
      .from('pages')
      .update({ page_access_token: newPageAccessToken })
      .eq('page_id', pageId);

    if (error) {
      console.error(`[ERROR] Failed to update page access token for Page ID: ${pageId}:`, error.message);
      throw new Error(error.message);
    }

    console.log(`[INFO] Token refreshed successfully for Page ID: ${pageId}`);
    return newPageAccessToken;
  } catch (error) {
    console.error('[ERROR] Token refresh failed:', error.message);
    return null;
  }
}

// Route to manually refresh a token for a specific page
router.post('/', async (req, res) => {
  try {
    const { pageId, userAccessToken } = req.body;

    if (!pageId || !userAccessToken) {
      return res.status(400).json({ error: 'Page ID and User Access Token are required.' });
    }

    const newPageAccessToken = await refreshPageAccessToken(pageId, userAccessToken);

    if (!newPageAccessToken) {
      return res.status(500).json({ error: 'Failed to refresh page access token.' });
    }

    res.status(200).json({ message: 'Token refreshed successfully', newPageAccessToken });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred during token refresh.' });
  }
});

// Scheduled task to refresh tokens for all pages in the database
async function refreshAllTokens() {
  try {
    console.log('[INFO] Starting scheduled token refresh...');
    
    // Fetch all pages from Supabase
    const { data: pages, error } = await supabase.from('pages').select('page_id, user_access_token');

    if (error) {
      console.error('[ERROR] Failed to fetch pages from Supabase:', error.message);
      return;
    }

    for (const page of pages) {
      const { page_id: pageId, user_access_token: userAccessToken } = page;

      if (!pageId || !userAccessToken) {
        console.warn(`[WARN] Skipping token refresh for Page ID ${pageId}: Missing user access token.`);
        continue;
      }

      const result = await refreshPageAccessToken(pageId, userAccessToken);

      if (!result) {
        console.error(`[ERROR] Failed to refresh token for Page ID ${pageId}`);
      }
    }

    console.log('[INFO] Scheduled token refresh completed successfully.');
  } catch (error) {
    console.error('[ERROR] Failed to refresh all tokens:', error.message);
  }
}

// Schedule the token refresh task to run every 24 hours
cron.schedule('0 0 * * *', refreshAllTokens); // Runs at midnight every day
console.log('[INFO] Token refresh scheduler initialized.');

export default router;
