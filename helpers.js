// Import necessary modules
import axios from 'axios';
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import {
  getPageAccessToken,
  getUserAccessToken,
  refreshUserAccessToken,
  ensurePageAccessToken,
  validateUserAccessToken,
  getLongLivedUserAccessToken,
  refreshLongLivedUserAccessToken,
  isExpired,
} from './auth/refresh-token.js';

/**
 * Validate and standardize an Instagram ID (ig_id).
 * @param {string|number} igId - The Instagram ID to validate.
 * @returns {string|null} - The validated ig_id as a string, or null if invalid.
 */
export function validateIgId(igId) {
  const igIdStr = typeof igId === 'number' ? igId.toString() : igId;
  if (!igIdStr || !/^\d+$/.test(igIdStr)) {
    console.warn('[WARN] Invalid ig_id detected:', igId);
    return null;
  }
  return igIdStr;
}

/**
 * Validate a Facebook access token.
 * @param {string} token - The access token to validate.
 * @returns {Promise<object>} - Token validation details.
 * @throws {Error} - If the token is invalid or the validation fails.
 */
export const validateFacebookToken = async (token) => {
  try {
    console.log(`[DEBUG] Validating Facebook token: ${token}`);
    const appAccessToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
    const response = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: token,
        access_token: appAccessToken,
      },
    });
    const { data } = response;
    if (!data?.data?.is_valid) {
      const errorMessage = data?.data?.error?.message || 'Invalid token';
      console.error('[ERROR] Token validation failed:', errorMessage);
      throw new Error(errorMessage);
    }
    console.log('[DEBUG] Facebook Token Validated:', data.data);
    return {
      isValid: data.data.is_valid,
      appId: data.data.app_id,
      userId: data.data.user_id,
      scopes: data.data.scopes,
    };
  } catch (error) {
    console.error('[ERROR] Facebook token validation failed:', error.message);
    throw new Error('Your session has expired. Please log in again.');
  }
};

/**
 * Fetch Instagram Business ID using Facebook API.
 * @param {string} pageId - The Facebook Page ID.
 * @param {string} pageAccessToken - The page access token.
 * @returns {Promise<string|null>} - The Instagram Business ID or null if not found.
 */
export async function fetchInstagramIdFromFacebook(pageId, pageAccessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    const data = await response.json();
    if (response.ok && data.instagram_business_account) {
      return validateIgId(data.instagram_business_account.id);
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
 * Fetch Instagram user info from the Facebook Graph API.
 * @param {string} senderId - The Instagram user's sender ID.
 * @param {number} businessId - The business ID for authentication context.
 * @returns {Promise<object|null>} - The user info object or null if not found.
 */
export async function fetchInstagramUserInfo(senderId, businessId) {
  try {
    // Fetch business details to get the page_id
    const { data: businessDetails, error } = await supabase
      .from('businesses')
      .select('page_id')
      .eq('id', businessId)
      .single();

    if (error || !businessDetails) {
      console.error(`[ERROR] Failed to fetch business details for businessId=${businessId}:`, error?.message || 'No data found');
      return null;
    }

    const { page_id: pageId } = businessDetails;

    // Fetch page access token
    const accessToken = await getPageAccessToken(businessId, pageId);
    if (!accessToken) {
      console.error('[ERROR] No access token available for Page ID:', pageId);
      return null;
    }

    // Fetch user info from Graph API
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${senderId}?fields=id,username&access_token=${accessToken}`
    );

    // Check for response status
    if (!response.ok) {
      const errorResponse = await response.json();
      console.error(`[ERROR] Failed to fetch Instagram user info for senderId=${senderId}:`, errorResponse.error?.message || 'Unknown error');
      return null;
    }

    const userInfo = await response.json();

    // Validate userInfo
    if (!userInfo.id) {
      console.warn(`[WARN] Could not retrieve valid user info for senderId=${senderId}.`);
      return null;
    }

    return {
      id: userInfo.id,
      username: userInfo.username || null,
    };
  } catch (err) {
    console.error('[ERROR] Exception while fetching Instagram user info:', err.message);
    return null;
  }
}


/**
 * Fetch Instagram ID from the database using a business ID.
 * @param {number} businessId - The business ID to search for.
 * @returns {Promise<string|null>} - The Instagram ID or null if not found.
 */
export async function fetchInstagramIdFromDatabase(businessId) {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('ig_id')
      .eq('id', businessId)
      .single();
    if (error || !data) {
      console.error(`[ERROR] Could not fetch Instagram ID for business ID ${businessId}:`, error?.message || 'No data found');
      return null;
    }
    console.log('[DEBUG] Retrieved ig_id:', data.ig_id);
    return validateIgId(data.ig_id);
  } catch (err) {
    console.error('[ERROR] Exception while fetching Instagram ID:', err.message);
    return null;
  }
}

/**
 * Fetch business details from the database.
 * @param {number} businessId - The business ID.
 * @returns {Promise<object|null>} - The business details or null if not found.
 */
export async function fetchBusinessDetails(businessId) {
  try {
    console.log('[DEBUG] Fetching business details for businessId:', businessId);
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, ig_id, page_id, business_owner_id')
      .eq('id', businessId)
      .single();
    if (error || !data) {
      throw new Error(`[ERROR] Failed to fetch business details: ${error?.message || 'No data found'}`);
    }
    console.log('[DEBUG] Fetched business details:', data);
    return data;
  } catch (err) {
    console.error('[ERROR] Exception while fetching business details:', err.message);
    return null;
  }
}

/**
 * Log a message into the database.
 * @param {object} params - Parameters for logging the message.
 */
export async function logMessage({
  businessId,
  senderId,
  recipientId,
  message,
  type,
  role = 'customer',
  igId = null,
  username = null,
  email = null,
  phone_number = null,
  location = null,
}) {
  try {
    // Validate required fields
    if (!businessId || !senderId || !recipientId || !message || !type) {
      console.warn('[WARN] Missing required fields for logging message:', { businessId, senderId, recipientId, message, type });
      return;
    }

    console.log('[DEBUG] Logging message with data:', {
      business_id: businessId,
      sender_id: senderId,
      recipient_id: recipientId,
      message,
      message_type: type,
      role,
      ig_id: igId,
      sender_name: username,
      email,
      phone_number,
      location,
    });

    const { error } = await supabase
      .from('instagram_conversations')
      .insert([{
        business_id: businessId,
        sender_id: senderId,
        recipient_id: recipientId,
        message,
        message_type: type,
        role,
        ig_id: igId || null,
        sender_name: username || null,
        email: email || null,
        phone_number: phone_number || null,
        location: location || null,
      }]);

    if (error) {
      console.error('[ERROR] Failed to log message:', error.message);
    } else {
      console.log('[INFO] Message logged successfully.');
    }
  } catch (err) {
    console.error('[ERROR] Exception while logging message:', err.message);
  }
}



/**
 * Handle unsent (deleted) messages.
 * @param {string} messageId - The ID of the deleted message.
 * @param {number} businessId - The ID of the business associated with the message.
 */
export async function handleUnsentMessage(messageId, businessId) {
  try {
    // Validate inputs
    if (!messageId || !businessId) {
      console.error('[ERROR] Invalid parameters. Message ID and Business ID are required.');
      return;
    }

    console.log(`[INFO] Attempting to delete message ID: ${messageId} for business ID: ${businessId}`);
    
    // Delete the message from the database
    const { data, error, count } = await supabase
      .from('instagram_conversations')
      .delete()
      .match({ business_id: businessId, message_id: messageId })
      .select('*', { count: 'exact' }); // Ensure you get the count of affected rows
    
    if (error) {
      console.error('[ERROR] Failed to delete message:', error.message);
      return;
    }

    // Check if the row was deleted
    if (count === 0) {
      console.warn(`[WARN] No message found with ID: ${messageId} for business ID: ${businessId}`);
    } else {
      console.log(`[INFO] Successfully deleted message ID: ${messageId} for business ID: ${businessId}.`);
    }
  } catch (err) {
    console.error('[ERROR] Exception during message deletion:', err.message);
  }
}

/**
 * Send a message to a user via Instagram Messaging API.
 * @param {string} recipientId - Instagram user ID of the recipient.
 * @param {string} messageText - Message content to be sent.
 * @param {string} accessToken - Facebook page access token.
 */
export async function sendInstagramMessage(
  senderId,
  messageText,
  pageAccessToken,
  businessId,
  pageId,
  retryCount = 0
) {
  try {
    const response = await fetch(
      'https://graph.facebook.com/v17.0/me/messages',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: { text: messageText },
          access_token: pageAccessToken, // Potentially expired
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      // Let’s unify error handling by throwing
      throw new Error(data.error?.message || 'Unknown error occurred while sending message');
    }

    console.log('[INFO] Instagram message sent successfully.');
    return data;
  } catch (err) {
    console.error('[ERROR] Failed to send Instagram message:', err.message);

    // Check if it’s token expiration
    if (
      err.message.includes('Error validating access token') ||
      err.message.includes('Session has expired')
    ) {
      // If we already retried once or twice, STOP to avoid infinite loop
      if (retryCount >= 1) {
        console.error('[ERROR] Multiple token refresh attempts have failed. Aborting.');
        return null; // Fail gracefully
      }

      console.log('[INFO] Attempting to refresh tokens and retry...');

      // Force a new page token from Facebook, ignoring expires_at in DB
      // so we do a "fresh" fetch from user token.
      const refreshedToken = await forceRefreshPageAccessToken(businessId, pageId);

      // If we got a new token, let’s try one more time
      if (refreshedToken) {
        return sendInstagramMessage(
          senderId,
          messageText,
          refreshedToken,
          businessId,
          pageId,
          retryCount + 1
        );
      }
    }

    // If it’s another error, or if refresh didn’t work, just bail out
    return null;
  }
}


/**
 * Upsert Instagram user into the database.
 * @param {string} senderId - Instagram user ID.
 * @param {object} userInfo - Instagram user information (e.g., username).
 * @param {number} businessId - Associated business ID.
 */
export async function upsertInstagramUser(senderId, userInfo, businessId, role = 'customer', location = null) {
  try {
    if (!senderId || !businessId) {
      console.warn('[WARN] Missing required fields for upserting Instagram user:', { senderId, businessId });
      return null;
    }

    const { username, email = null, phone_number = null } = userInfo || {};

    console.log('[DEBUG] Attempting to upsert user with:', { senderId, username, businessId });

    const { data, error } = await supabase
      .from('instagram_users')
      .upsert(
        {
          instagram_id: senderId,
          sender_id: senderId, // Ensure sender_id is populated
          username: username || null,
          email,
          phone_number,
          business_id: businessId,
          role,
          location,
        },
        { onConflict: ['instagram_id', 'business_id'] } // Prevent duplicate instagram_id entries
      )
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation error
        console.warn('[WARN] Instagram user already exists:', { senderId, businessId });
        return null; // Optionally fetch and return the existing user
      }
      throw error;
    }

    console.log('[INFO] Instagram user upserted successfully:', data);
    return data;
  } catch (err) {
    console.error('[ERROR] Exception while upserting Instagram user:', err.message);
    return null;
  }
}


/**
 * Parse user messages to extract field-value pairs in the format "key: value".
 * @param {string} userMessage - The message from the user.
 * @returns {Object} Parsed field and value or null if the message format is incorrect.
 */
export function parseUserMessage(userMessage) {
  if (typeof userMessage !== 'string' || userMessage.trim() === '') {
    console.error('[ERROR] Invalid or empty input for parseUserMessage:', userMessage);
    return { field: null, value: null, location: null };
  }
  const locationRegex = /location:\s*(.+)$/i;
  const match = userMessage.match(locationRegex);
  const location = match ? match[1].trim() : null;
  return {
    field: null,
    value: null,
    location,
  };
}
