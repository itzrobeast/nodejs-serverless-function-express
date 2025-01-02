import fetch from 'node-fetch';
import supabase from '../supabaseClient.js';
import express from 'express';
import cron from 'node-cron';

const router = express.Router();

/**
 * Check if a token is expired based on the last updated time.
 * @param {string} updatedAt - Timestamp when the token was last updated.
 * @param {number} expiryDays - Number of days before the token is considered expired.
 * @returns {boolean} True if the token is expired, otherwise false.
 */
export const isExpired = (updatedAt, expiryDays = 1) => {
  try {
    const lastUpdated = new Date(updatedAt);
    const now = new Date();
    const differenceInDays = (now - lastUpdated) / (1000 * 60 * 60 * 24);
    console.log(`[DEBUG] Token last updated: ${lastUpdated}, Difference in days: ${differenceInDays}`);
    return differenceInDays > expiryDays;
  } catch (err) {
    console.error('[ERROR] Failed to calculate token expiration:', err.message);
    return true;
  }
};

/**
 * Refresh the user access token using Facebook API.
 * @param {string} businessOwnerId - The business owner ID in the database.
 * @param {string} shortLivedToken - The short-lived token to exchange.
 * @returns {Promise<string|null>} The refreshed user access token or null if the refresh fails.
 */
export async function refreshUserAccessToken(businessOwnerId, shortLivedToken) {
  try {
    console.log(`[INFO] Refreshing user access token for Business Owner ID: ${businessOwnerId}`);
    const response = await fetch(
      `https://graph.facebook.com/v15.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<app_id>&client_secret=<app_secret>&fb_exchange_token=${shortLivedToken}`
    );
    const data = await response.json();
    console.log('[DEBUG] Facebook API response:', data);

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
    } else {
  console.log('[INFO] Successfully updated user access token in database for Business Owner ID:', businessOwnerId);
}


    

    console.log('[INFO] User access token refreshed successfully for Business Owner ID:', businessOwnerId);
    return data.access_token;
  } catch (err) {
    console.error('[ERROR] Exception while refreshing user access token:', err.message);
    return null;
  }
}

/**
 * Refresh the page access token using Facebook API.
 * @param {string} pageId - The Facebook Page ID.
 * @param {string} userAccessToken - The user access token with permissions for the page.
 * @returns {Promise<string|null>} The refreshed page access token or null if the refresh fails.
 */
export async function refreshPageAccessToken(pageId, userAccessToken) {
  try {
    console.log(`[INFO] Refreshing page access token for Page ID: ${pageId}`);

    if (!userAccessToken || userAccessToken.trim() === '') {
      console.error('[ERROR] User access token is missing or invalid.');
      return null;
    }

    const response = await fetch(`https://graph.facebook.com/v15.0/me/accounts?access_token=${userAccessToken}`);
    const data = await response.json();

    if (!data || !data.data) {
      console.error(`[ERROR] Invalid response from Facebook API for Page ID ${pageId}:`, JSON.stringify(data));
      return null;
    }
    console.log('[DEBUG] Facebook API response:', JSON.stringify(data, null, 2));

    const pageData = data.data.find((page) => page.id === pageId);
    if (!pageData) {
      console.warn(`[WARN] Page ID ${pageId} not found in the accounts response.`);
      return null;
    }

    const newPageAccessToken = pageData.access_token;
    if (!newPageAccessToken) {
      console.error(`[ERROR] Missing new page access token for Page ID ${pageId}.`);
      return null;
    }

    // Update database with the new token
    const { error: pageError } = await supabase
      .from('pages')
      .update({ access_token: newPageAccessToken, updated_at: new Date().toISOString() })
      .eq('page_id', pageId);

    if (pageError) {
      console.error(`[ERROR] Failed to update pages table for Page ID ${pageId}:`, pageError.message);
      return null;
    }

    const { error: accessTokenError } = await supabase
      .from('page_access_tokens')
      .update({ page_access_token: newPageAccessToken, updated_at: new Date().toISOString() })
      .eq('page_id', pageId);

    if (accessTokenError) {
      console.error(`[ERROR] Failed to update page_access_tokens table for Page ID ${pageId}:`, accessTokenError.message);
      return null;
    }

    console.log(`[INFO] Page access token refreshed successfully for Page ID: ${pageId}`);
    return newPageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception in refreshPageAccessToken for Page ID ${pageId}:`, err.message);
    return null;
  }
}





/**
 * Ensure the user access token is valid and refresh it if necessary.
 * @param {string} businessOwnerId - The business owner ID in the database.
 * @returns {Promise<string|null>} The valid user access token or null if it cannot be fetched or refreshed.
 */
export async function getUserAccessToken(businessOwnerId) {
  try {
    console.log(`[DEBUG] Fetching user access token for Business Owner ID: ${businessOwnerId}`);
    
    const { data, error } = await supabase
      .from('business_owners')
      .select('user_access_token, updated_at')
      .eq('id', businessOwnerId)
      .limit(1); // Ensure single row is returned
    
    if (error) {
      console.error(`[ERROR] Supabase query error for Business Owner ID ${businessOwnerId}:`, error.message);
      return null;
    }

    if (!data || data.length === 0) {
      console.error(`[ERROR] No user access token found for Business Owner ID ${businessOwnerId}`);
      return null;
    }

    const { user_access_token: userAccessToken, updated_at: updatedAt } = data[0];

    console.log(`[DEBUG] Retrieved user access token for Business Owner ID ${businessOwnerId}:`, userAccessToken);

    if (!userAccessToken || isExpired(updatedAt)) {
      console.log(`[INFO] User access token for Business Owner ID ${businessOwnerId} is expired. Refreshing...`);
      return await refreshUserAccessToken(businessOwnerId, userAccessToken);
    }

    return userAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching user access token for Business Owner ID ${businessOwnerId}:`, err.message);
    return null;
  }
}


/**
 * Ensure the page access token is valid and refresh it if necessary.
 * @param {string} businessId - The business ID associated with the page.
 * @param {string} pageId - The Facebook Page ID.
 * @returns {Promise<string|null>} The valid page access token or null if it cannot be fetched or refreshed.
 */
export async function getPageAccessToken(businessId, pageId) {
  try {
    console.log(`[DEBUG] Fetching page access token for Page ID: ${pageId}`);
    const { data, error } = await supabase
      .from('pages')
      .select('access_token, updated_at')
      .eq('page_id', pageId)
      .single();

    if (error || !data) {
      console.warn(`[WARN] Page access token not found for Page ID ${pageId}. Fetching dynamically...`);
      const userAccessToken = await getUserAccessToken(businessId);
      return await refreshPageAccessToken(pageId, userAccessToken);
    }

    const { access_token: pageAccessToken, updated_at: updatedAt } = data;

    if (!pageAccessToken || isExpired(updatedAt)) {
      console.log(`[INFO] Page access token for Page ID ${pageId} is expired. Refreshing...`);
      const userAccessToken = await getUserAccessToken(businessId);
      return await refreshPageAccessToken(pageId, userAccessToken);
    }

    return pageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching page access token for Page ID ${pageId}:`, err.message);
    return null;
  }
}

/**
 * Scheduled task to refresh tokens for all pages.
 */
async function refreshAllTokens() {
  try {
    console.log('[INFO] Starting scheduled token refresh...');
    const { data: pages, error } = await supabase.from('pages').select('page_id, business_id');

    if (error) {
      console.error('[ERROR] Failed to fetch pages for scheduled token refresh:', error.message);
      return;
    }

    for (const { page_id: pageId, business_id: businessId } of pages) {
      const userAccessToken = await getUserAccessToken(businessId);
      if (!userAccessToken) continue;

      await refreshPageAccessToken(pageId, userAccessToken);
    }

    console.log('[INFO] Scheduled token refresh completed.');
  } catch (err) {
    console.error('[ERROR] Exception during scheduled token refresh:', err.message);
  }
}

// Schedule the token refresh task to run every 24 hours
cron.schedule('0 0 * * *', refreshAllTokens);
console.log('[INFO] Token refresh scheduler initialized.');

// Export the router and other functions
export default router;
