import fetch from 'node-fetch';
import supabase from '../supabaseClient.js';
import express from 'express';
import cron from 'node-cron';


const router = express.Router();

/**
 * Check if a token is expired based on the last updated time.
 */
export function isExpired(updatedAt, expiryDays = 60) {
  try {
    const lastUpdated = new Date(updatedAt);
    const now = new Date();
    const differenceInDays = (now - lastUpdated) / (1000 * 60 * 60 * 24);
    return differenceInDays > expiryDays;
  } catch (err) {
    console.error('[ERROR] Failed to calculate token expiration:', err.message);
    return true; // Assume expired if there's an error
  }
}

/**
 * Refresh the user access token.
 * @param {string} businessOwnerId - The user ID in the database.
 * @param {string} shortLivedToken - The short-lived token to exchange.
 * @returns {string|null} - The refreshed user access token or null if the refresh fails.
 */
export async function refreshUserAccessToken(businessOwnerId, shortLivedToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<app_id>&client_secret=<app_secret>&fb_exchange_token=${shortLivedToken}`
    );
    const data = await response.json();

    if (!data.access_token) {
      console.error('[ERROR] Failed to refresh user access token:', data.error?.message || 'Unknown error');
      return null;
    }

    const { error } = await supabase
      .from('business_owners')
      .update({ user_access_token: data.access_token, updated_at: new Date().toISOString() })
      .eq('id', businessOwnerId);

    if (error) {
      console.error('[ERROR] Failed to update user access token in database:', error.message);
      return null;
    }

    console.log('[INFO] User access token refreshed successfully for user:', businessOwnerId);
    return data.access_token;
  } catch (err) {
    console.error('[ERROR] Exception while refreshing user access token:', err.message);
    return null;
  }
}

/**
 * Refresh the page access token.
 * @param {string} pageId - The Facebook Page ID.
 * @param {string} userAccessToken - The user access token with permissions for the page.
 * @returns {string|null} - The refreshed page access token or null if the refresh fails.
 */
export async function refreshPageAccessToken(pageId, userAccessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v15.0/me/accounts?access_token=${userAccessToken}`);
    const data = await response.json();

    const pageData = data.data.find((page) => page.id === pageId);

    if (!pageData) {
      console.warn(`[WARN] Page ID ${pageId} not found in the accounts response.`);
      return null;
    }

    const newPageAccessToken = pageData.access_token;

    const { error } = await supabase
      .from('pages')
      .update({ page_access_token: newPageAccessToken, updated_at: new Date().toISOString() })
      .eq('page_id', pageId);

    if (error) {
      console.error(`[ERROR] Failed to update page access token in database for Page ID ${pageId}: ${error.message}`);
      return null;
    }

    console.log(`[INFO] Page access token refreshed successfully for Page ID ${pageId}`);
    return newPageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception in refreshPageAccessToken for Page ID ${pageId}:`, err.message);
    return null;
  }
}

/**
 * Ensure the user access token is valid and fetch a refreshed one if necessary.
 */
export async function getUserAccessToken(businessOwnerId) {
  try {
    const { data, error } = await supabase
      .from('business_owners')
      .select('user_access_token, updated_at')
      .eq('id', businessOwnerId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch user access token for Business Owner ID ${businessOwnerId}:`, error.message);
      return null;
    }

    const { user_access_token: userAccessToken, updated_at: updatedAt } = data;

    if (!userAccessToken || isExpired(updatedAt)) {
      console.log(`[INFO] User access token for Business Owner ID ${businessOwnerId} is expired. Refreshing...`);
      const refreshedToken = await refreshUserAccessToken(businessOwnerId, userAccessToken);
      return refreshedToken;
    }

    return userAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching user access token for Business Owner ID ${businessOwnerId}:`, err.message);
    return null;
  }
}

/**
 * Ensure the page access token is valid and fetch or refresh it dynamically.
 */
export async function getPageAccessToken(businessId, pageId) {
  try {
    const { data, error } = await supabase
      .from('pages')
      .select('page_access_token, updated_at')
      .eq('page_id', pageId)
      .single();

    if (error || !data) {
      console.warn(`[WARN] Page access token not found for Page ID ${pageId}. Fetching dynamically...`);
      const refreshedToken = await refreshPageAccessToken(pageId, await getUserAccessToken(businessId));
      return refreshedToken;
    }

    const { page_access_token: pageAccessToken, updated_at: updatedAt } = data;

    if (isExpired(updatedAt)) {
      console.log(`[INFO] Page access token for Page ID ${pageId} is expired. Refreshing...`);
      const refreshedToken = await refreshPageAccessToken(pageId, await getUserAccessToken(businessId));
      return refreshedToken;
    }

    return pageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching page access token for Page ID ${pageId}:`, err.message);
    return null;
  }
}


/**
 * Manual refresh route for a specific page.
 */
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

/**
 * Scheduled task to refresh tokens for all pages.
 */
async function refreshAllTokens() {
  console.log('[INFO] Starting scheduled token refresh...');
  // Fetch all pages and refresh their tokens
  const { data: pages, error } = await supabase
    .from('pages')
    .select('page_id, business_id');

  if (error) {
    console.error('[ERROR] Failed to fetch pages for scheduled token refresh:', error.message);
    return;
  }

  for (const page of pages) {
    const userAccessToken = await getUserAccessToken(page.business_id);
    if (!userAccessToken) continue;

    await refreshPageAccessToken(page.page_id, userAccessToken);
  }

  console.log('[INFO] Scheduled token refresh completed.');
}


// Schedule the token refresh task to run every 24 hours
cron.schedule('0 0 * * *', refreshAllTokens);
console.log('[INFO] Token refresh scheduler initialized.');

// Export the router and other functions
export default router;


