// helpers.js
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import { refreshPageAccessToken, refreshUserAccessToken } from './auth/refresh-token.js';

/**
 * Check if a token is expired based on the last updated time.
 * @param {string} updatedAt - The timestamp of when the token was last updated.
 * @param {number} expiryDays - Number of days before the token expires (default is 60 days).
 * @returns {boolean} - True if the token is expired, otherwise false.
 */
export function isExpired(updatedAt, expiryDays = 60) {
  try {
    const lastUpdated = new Date(updatedAt);
    const now = new Date();

    // Calculate the difference in days
    const differenceInDays = (now - lastUpdated) / (1000 * 60 * 60 * 24);
    return differenceInDays > expiryDays;
  } catch (err) {
    console.error('[ERROR] Failed to calculate token expiration:', err.message);
    return true; // Assume expired if there's an error
  }
}

/**
 * Fetch Instagram Business ID using Facebook API.
 * @param {string} pageId - The Facebook Page ID.
 * @param {string} pageAccessToken - The access token for the Facebook Page.
 * @returns {string|null} - The Instagram Business Account ID as a string or null if not found.
 */
export async function fetchInstagramIdFromFacebook(pageId, pageAccessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    const data = await response.json();

    if (response.ok && data.instagram_business_account) {
      return data.instagram_business_account.id;
    } else {
      console.warn(`[WARN] No Instagram Business Account linked to Page ID: ${pageId}`);
      return null;
    }
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram Business Account ID:', err.message);
    return null;
  }
}

/**
 * Fetch Instagram Business ID from the database.
 */
export async function fetchInstagramIdFromDatabase(businessId) {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('ig_id')
      .eq('id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch Instagram ID for business ID ${businessId}:`, error?.message || 'No data found');
      return null;
    }

    return data.ig_id;
  } catch (err) {
    console.error('[ERROR] Exception while fetching Instagram ID from database:', err.message);
    return null;
  }
}

/**
 * Fetch business details from the database.
 */
export async function fetchBusinessDetails(businessId) {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, ig_id, page_id, business_owner_id') 
      .eq('id', businessId)
      .single();

    if (error || !data) {
      throw new Error(`[ERROR] Failed to fetch business details: ${error?.message || 'No data found'}`);
    }

    return data; // Return the complete business object
  } catch (err) {
    console.error('[ERROR] Exception while fetching business details:', err.message);
    return null;
  }
}


/**
 * Fetch user access token and refresh if expired.
 */
export async function getValidUserAccessToken(userId, shortLivedToken) {
  try {
    const { token, updatedAt } = await getUserAccessToken(userId);

    if (!token || isExpired(updatedAt)) {
      console.log('[INFO] User access token expired or missing. Refreshing...');
      if (!shortLivedToken) {
        console.error('[ERROR] No short-lived token available to refresh user access token.');
        return null;
      }
      return await refreshUserAccessToken(userId, shortLivedToken);
    }

    return token;
  } catch (err) {
    console.error('[ERROR] Failed to get valid user access token:', err.message);
    return null;
  }
}

/**
 * Fetch user access token from the database.
 */
export async function getUserAccessToken(userId) {
  try {
    const { data, error } = await supabase
      .from('business_owners')
      .select('user_access_token, updated_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch user access token for User ID ${userId}:`, error?.message || 'No data found');
      return null;
    }

    return { token: data.user_access_token, updatedAt: data.updated_at };
  } catch (err) {
    console.error('[ERROR] Exception while fetching user access token:', err.message);
    return null;
  }
}

/**
 * Fetch page access token and refresh if expired.
 */
export async function getPageAccessToken(businessId, pageId) {
  try {
    const { data, error } = await supabase
      .from('page_access_tokens')
      .select('page_access_token, user_id, updated_at')
      .eq('business_id', businessId)
      .eq('page_id', pageId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch page access token for Business ID ${businessId}, Page ID ${pageId}:`, error?.message || 'No data found');
      return null;
    }

    const { page_access_token: pageAccessToken, user_id: userId, updated_at: updatedAt } = data;

    if (isExpired(updatedAt)) {
      console.warn(`[WARN] Page access token expired for Page ID ${pageId}. Refreshing token...`);
      const userAccessToken = await getUserAccessToken(userId);
      return await refreshPageAccessToken(pageId, userAccessToken);
    }

    return pageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching page access token for Page ID ${pageId}:`, err.message);
    return null;
  }
}

/**
 * Fetch Instagram user information using the sender ID.
 */
export async function fetchInstagramUserInfo(senderId, businessId) {
  try {
    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return null;
    }

    const { page_id: pageId } = businessDetails;
    const accessToken = await getPageAccessToken(businessId, pageId);

    if (!accessToken) {
      console.error(`[ERROR] Access token not available for businessId=${businessId}, pageId=${pageId}`);
      return null;
    }

    const response = await fetch(`https://graph.facebook.com/v15.0/${senderId}?fields=id,username&access_token=${accessToken}`);
    const data = await response.json();

    if (!response.ok) {
      console.error(`[ERROR] Instagram API error for senderId=${senderId}:`, data.error?.message || 'Unknown error');
      return null;
    }

    return data;
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram user info:', err.message);
    return null;
  }
}

/**
 * Send a message to an Instagram user.
 */
export async function sendInstagramMessage(recipientId, message, accessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v15.0/me/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[ERROR] Failed to send Instagram message:', data.error?.message || 'Unknown error');
      return null;
    }

    return data;
  } catch (err) {
    console.error('[ERROR] Failed to send Instagram message:', err.message);
    return null;
  }
}



export function parseUserMessage(userMessage) {
    // Example implementation to extract a field and value
    const regex = /(\w+):\s*(.+)/;
    const match = userMessage.match(regex);

    if (!match) return { field: null, value: null };

    return {
        field: match[1].toLowerCase(),
        value: match[2].trim(),
    };
}





/**
 * Log a message into the database.
 */
export async function logMessage(businessId, senderId, recipientId, message, type, messageId, isBusinessMessage, igId, username) {
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert([{
        business_id: businessId,
        sender_id: senderId,
        recipient_id: recipientId,
        message,
        type,
        message_id: messageId,
        is_business_message: isBusinessMessage,
        ig_id: igId,
        username,
      }]);

    if (error) {
      console.error(`[ERROR] Failed to log message for businessId=${businessId}:`, error.message);
      return;
    }

    console.log('[DEBUG] Message logged successfully:', data);
  } catch (err) {
    console.error('[ERROR] Exception while logging message:', err.message);
  }
}

console.log('[DEBUG] helpers.js loaded successfully');

/**
 * Upsert Instagram user into the database.
 * @param {string} senderId - The Instagram sender ID.
 * @param {object} userInfo - The user information object.
 * @param {number} businessId - The associated business ID.
 */
export async function upsertInstagramUser(senderId, userInfo, businessId) {
  try {
    const { username } = userInfo;

    const { data, error } = await supabase
      .from('instagram_users')
      .upsert(
        {
          instagram_id: senderId,
          username: username || null,
          business_id: businessId,
        },
        { onConflict: ['instagram_id', 'business_id'] }
      )
      .select()
      .single();

    if (error) {
      console.error(`[ERROR] Failed to upsert Instagram user:`, error.message);
      return null;
    }

    console.log(`[INFO] Instagram user upserted successfully: ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    console.error(`[ERROR] Exception while upserting Instagram user:`, err.message);
    return null;
  }
}

