import express from 'express';
import fetch from 'node-fetch';
import supabase from '../supabaseClient.js'; // Adjust path as needed

const router = express.Router();

// Helper function to refresh a page access token
async function refreshPageAccessToken(pageId, userAccessToken) {
  try {
    // Fetch pages and their new access tokens using the user access token
    const response = await fetch(`https://graph.facebook.com/v15.0/me/accounts?access_token=${userAccessToken}`);
    const data = await response.json();

    if (data.error) {
      console.error('[ERROR] Failed to fetch page access token:', data.error.message);
      throw new Error(data.error.message);
    }

    // Find the page in the response
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
      console.error('[ERROR] Failed to update page access token in Supabase:', error.message);
      throw new Error(error.message);
    }

    console.log(`[INFO] Token refreshed successfully for Page ID: ${pageId}`);
    return newPageAccessToken;
  } catch (error) {
    console.error('[ERROR] Token refresh failed:', error.message);
    return null;
  }
}

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

export default router;
