import fetch from 'node-fetch';
import supabase from '../supabaseClient.js';
import express from 'express';
import cron from 'node-cron';

const router = express.Router();

/**
 * Check if a token is expired based on the last updated time.
 * @param {string} updatedAt - Timestamp when the token was last updated.
 * @param {string} tokenType - The type of token ('user', 'page', or 'general').
 * @returns {boolean} True if the token is expired, otherwise false.
 */
export const isExpired = (updatedAt, tokenType = 'general') => {
  try {
    const lastUpdated = new Date(updatedAt);
    const now = new Date();
    let expiryDays;

    switch (tokenType) {
      case 'user':
        expiryDays = 60; // Long-lived user tokens typically last 60 days
        break;
      case 'page':
        expiryDays = 1; // Short-lived page tokens last 1 day
        break;
      default:
        expiryDays = 1; // Default to 1 day
    }

    const differenceInDays = (now - lastUpdated) / (1000 * 60 * 60 * 24);
    console.log(`[DEBUG] Token last updated: ${lastUpdated}, Difference in days: ${differenceInDays}, Token Type: ${tokenType}`);
    return differenceInDays > expiryDays;
  } catch (err) {
    console.error('[ERROR] Failed to calculate token expiration:', err.message);
    return true;
  }
};


export async function getBusinessOwnerId(businessId) {
  try {
    console.log(`[DEBUG] Fetching business owner ID for Business ID: ${businessId}`);
    const { data, error } = await supabase
      .from('businesses')
      .select('business_owner_id')
      .eq('id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch business owner ID for Business ID ${businessId}:`, error?.message || 'No data found');
      return null;
    }

    console.log(`[DEBUG] Retrieved business owner ID: ${data.business_owner_id}`);
    return data.business_owner_id;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching business owner ID for Business ID ${businessId}:`, err.message);
    return null;
  }
}

/**
 * Validate if the user access token is still valid.
 * @param {string} userAccessToken - The user access token to validate.
 * @returns {Promise<boolean>} True if valid, false otherwise.
 */
export async function validateUserAccessToken(userAccessToken) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  try {
    const debugTokenUrl = `https://graph.facebook.com/debug_token?input_token=${userAccessToken}&access_token=${appId}|${appSecret}`;
    const response = await fetch(debugTokenUrl);
    const data = await response.json();

    if (response.ok && data?.data?.is_valid) {
      console.log('[DEBUG] User access token is valid.');
      return true;
    }

    console.error('[ERROR] User access token validation failed:', data.error || 'Unknown error');
    return false;
  } catch (err) {
    console.error('[ERROR] Exception while validating user access token:', err.message);
    return false;
  }
}


/**
 * Ensure the user access token is valid and refresh if necessary.
 * @param {number} businessOwnerId - The business owner ID.
 * @returns {Promise<string|null>} The valid user access token or null if failed.
 */
export async function getUserAccessToken(businessOwnerId) {
  try {
    console.log(`[DEBUG] Fetching user access token for Business Owner ID: ${businessOwnerId}`);
    const { data, error } = await supabase
      .from('business_owners')
      .select('user_access_token, updated_at')
      .eq('id', businessOwnerId);

    if (error || !data || data.length === 0) {
      console.error(`[ERROR] No user access token found for Business Owner ID ${businessOwnerId}`);
      return null;
    }

    const { user_access_token: userAccessToken, updated_at: updatedAt } = data[0];
    const isTokenValid = await validateUserAccessToken(userAccessToken);

    if (!isTokenValid || isExpired(updatedAt, 'user')) {
      return await refreshUserAccessToken(businessOwnerId, userAccessToken);
    }

    return userAccessToken;
  } catch (err) {
    console.error('[ERROR] Failed to fetch user access token:', err.message);
    return null;
  }
}

/**
 * Refresh and update the user access token in the database.
 * @param {number} businessOwnerId - The business owner ID in the database.
 * @param {string} shortLivedToken - The short-lived user token to exchange.
 * @returns {Promise<string|null>} The refreshed user access token or null if the refresh fails.
 */
export async function refreshUserAccessToken(businessOwnerId, shortLivedToken) {
  const longLivedToken = await getLongLivedUserAccessToken(shortLivedToken);

  if (longLivedToken) {
    const { error } = await supabase
      .from('business_owners')
      .update({ user_access_token: longLivedToken, updated_at: new Date().toISOString() })
      .eq('id', businessOwnerId);

    if (error) {
      console.error('[ERROR] Failed to update user access token in database:', error.message);
      return null;
    }

    console.log('[INFO] User access token refreshed and updated in database for Business Owner ID:', businessOwnerId);
    return longLivedToken;
  }

  return null;
}




/**
 * Exchange a short-lived user token for a long-lived token.
 * @param {string} shortLivedToken - The short-lived user token.
 * @returns {Promise<string|null>} The long-lived token or null if the refresh fails.
 */
export async function getLongLivedUserAccessToken(shortLivedToken) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`
    );
    const data = await response.json();

    if (response.ok && data.access_token) {
      console.log('[INFO] Long-lived user access token retrieved:', data.access_token);
      return data.access_token;
    }

    console.error('[ERROR] Failed to get long-lived user access token:', data.error?.message || 'Unknown error');
    return null;
  } catch (err) {
    console.error('[ERROR] Exception while exchanging for long-lived token:', err.message);
    return null;
  }
}

/**
 * Refresh a long-lived user access token before expiry.
 * @param {string} longLivedToken - The current long-lived user access token.
 * @returns {Promise<string|null>} The refreshed token or null if the refresh fails.
 */
export async function refreshLongLivedUserAccessToken(longLivedToken) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  try {
    const response = await fetch(
      `https://graph.facebook.com/v15.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${longLivedToken}`
    );
    const data = await response.json();

    if (response.ok && data.access_token) {
      console.log('[INFO] Refreshed long-lived user access token:', data.access_token);
      return data.access_token;
    }

    console.error('[ERROR] Failed to refresh long-lived user access token:', data.error?.message || 'Unknown error');
    return null;
  } catch (err) {
    console.error('[ERROR] Exception while refreshing long-lived token:', err.message);
    return null;
  }
}


/**
 * Ensure a valid page access token.
 * @param {string} pageId - The Facebook Page ID.
 * @param {string} userAccessToken - The user access token with permissions for the page.
 * @param {string} currentPageToken - The current page access token.
 * @returns {Promise<string|null>} The valid page access token or null if failed.
 */
export async function ensurePageAccessToken(pageId, userAccessToken, currentPageToken) {
  try {
    console.log(`[INFO] Validating page access token for Page ID: ${pageId}`);
    const isValid = await validatePageAccessToken(currentPageToken);

    if (isValid) {
      console.log('[INFO] Existing page access token is valid.');
      return currentPageToken;
    }

    console.log('[INFO] Page access token is invalid or expired. Refreshing...');
    const refreshedToken = await refreshPageAccessToken(pageId, userAccessToken);
    return refreshedToken;
  } catch (err) {
    console.error('[ERROR] Failed to ensure page access token:', err.message);
    return null;
  }
}


/**
 * Ensure the page access token is valid and refresh if necessary.
 * @param {string} businessId - The business ID.
 * @param {string} pageId - The Facebook Page ID.
 * @returns {Promise<string|null>} The valid page access token or null if failed.
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
      const userAccessToken = await getUserAccessToken(await getBusinessOwnerId(businessId));
      return await refreshPageAccessToken(pageId, userAccessToken);
    }

    const { access_token: pageAccessToken, updated_at: updatedAt } = data;
    const isPageTokenValid = await validatePageAccessToken(pageAccessToken);

    if (!isPageTokenValid || isExpired(updatedAt, 'page')) {
      const userAccessToken = await getUserAccessToken(await getBusinessOwnerId(businessId));
      return await refreshPageAccessToken(pageId, userAccessToken);
    }

    return pageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Failed to fetch page access token for Page ID ${pageId}:`, err.message);
    return null;
  }
}

/**
 * Refresh tokens for all pages at scheduled intervals.
 */
async function refreshAllTokens() {
  try {
    console.log('[INFO] Starting scheduled token refresh...');
    const { data, error } = await supabase.from('pages').select('page_id, business_id');

    if (error || !data) {
      console.error('[ERROR] Failed to fetch pages for token refresh:', error.message);
      return;
    }

    for (const { page_id: pageId, business_id: businessId } of data) {
      const userAccessToken = await getUserAccessToken(await getBusinessOwnerId(businessId));
      if (!userAccessToken) continue;

      await refreshPageAccessToken(pageId, userAccessToken);
    }

    console.log('[INFO] Token refresh completed.');
  } catch (err) {
    console.error('[ERROR] Scheduled token refresh failed:', err.message);
  }
}

// Schedule the token refresh task
cron.schedule('0 0 * * *', refreshAllTokens);
console.log('[INFO] Token refresh scheduler initialized.');

export default router;
