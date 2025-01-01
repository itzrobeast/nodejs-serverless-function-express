//helper

import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import { refreshUserAccessToken, refreshPageAccessToken } from './auth/refresh-token.js';

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

    // Check if the token is expired
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
    const { data: pageData, error: pageError } = await supabase
      .from('pages')
      .select('page_access_token, updated_at')
      .eq('page_id', pageId)
      .single();

    if (pageError || !pageData) {
      console.warn(`[WARN] Page access token not found for Page ID ${pageId}. Fetching dynamically...`);

      // Fetch the user access token for the associated business owner
      const { data: businessDetails, error: businessError } = await supabase
        .from('businesses')
        .select('business_owner_id')
        .eq('id', businessId)
        .single();

      if (businessError || !businessDetails) {
        console.error(`[ERROR] Failed to fetch business owner ID for Business ID ${businessId}:`, businessError.message);
        return null;
      }

      const userAccessToken = await getUserAccessToken(businessDetails.business_owner_id);
      if (!userAccessToken) {
        console.error(`[ERROR] Failed to fetch user access token for Business Owner ID ${businessDetails.business_owner_id}`);
        return null;
      }

      const newPageAccessToken = await refreshPageAccessToken(pageId, userAccessToken);
      return newPageAccessToken;
    }

    const { page_access_token: pageAccessToken, updated_at: updatedAt } = pageData;

    // Check if the token is expired
    if (isExpired(updatedAt)) {
      console.log(`[INFO] Page access token for Page ID ${pageId} is expired. Refreshing...`);

      // Fetch the user access token for the associated business owner
      const { data: businessDetails, error: businessError } = await supabase
        .from('businesses')
        .select('business_owner_id')
        .eq('id', businessId)
        .single();

      if (businessError || !businessDetails) {
        console.error(`[ERROR] Failed to fetch business owner ID for Business ID ${businessId}:`, businessError.message);
        return null;
      }

      const userAccessToken = await getUserAccessToken(businessDetails.business_owner_id);
      if (!userAccessToken) {
        console.error(`[ERROR] Failed to fetch user access token for Business Owner ID ${businessDetails.business_owner_id}`);
        return null;
      }

      const refreshedPageAccessToken = await refreshPageAccessToken(pageId, userAccessToken);
      return refreshedPageAccessToken;
    }

    return pageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching page access token for Page ID ${pageId}:`, err.message);
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
    // Fetch business details to get access token
    const { data: businessDetails, error: fetchError } = await supabase
      .from('businesses')
      .select('page_id, access_token')
      .eq('id', businessId)
      .single();

    if (fetchError || !businessDetails) {
      console.error(`[ERROR] Failed to fetch business details for businessId=${businessId}:`, fetchError?.message || 'No data found');
      return null;
    }

    const { page_id: pageId, access_token: accessToken } = businessDetails;

    if (!accessToken || !pageId) {
      console.error(`[ERROR] Missing page access token or page ID for businessId=${businessId}`);
      return null;
    }

    // Fetch user info from Graph API
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${senderId}?fields=id,username&access_token=${accessToken}`
    );
    const userInfo = await response.json();

    if (!response.ok || !userInfo.id) {
      console.error(`[ERROR] Failed to fetch Instagram user info for senderId=${senderId}:`, userInfo.error?.message || 'No data found');
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
 * Ensure valid Page Access Token by checking its existence or refreshing it dynamically.
 */
export async function ensurePageAccessToken(pageId, userAccessToken) {
  try {
    const { data, error } = await supabase
      .from('pages')
      .select('access_token, updated_at')
      .eq('page_id', pageId)
      .single();

    if (error || !data || !data.access_token) {
      console.warn(`[WARN] No Page Access Token found in the database for Page ID: ${pageId}`);
      const dynamicToken = await getPageAccessToken(pageId, userAccessToken);
      if (dynamicToken) {
        await supabase
          .from('pages')
          .upsert({ page_id: pageId, access_token: dynamicToken, updated_at: new Date().toISOString() });
        return dynamicToken;
      }
      return null;
    }

    const tokenUpdatedAt = new Date(data.updated_at);
    const now = new Date();
    const isExpired = (now - tokenUpdatedAt) / (1000 * 60 * 60 * 24) > 60;

    if (isExpired) {
      console.log(`[INFO] Page Access Token for Page ID: ${pageId} is expired. Refreshing...`);
      const refreshedToken = await getPageAccessToken(pageId, userAccessToken);
      if (refreshedToken) {
        await supabase
          .from('pages')
          .update({ access_token: refreshedToken, updated_at: new Date().toISOString() })
          .eq('page_id', pageId);
        return refreshedToken;
      }
      return null;
    }

    console.log(`[INFO] Valid Page Access Token retrieved for Page ID: ${pageId}`);
    return data.access_token;
  } catch (err) {
    console.error('[ERROR] Exception in ensurePageAccessToken:', err.message);
    return null;
  }
}

/**
 * Fetch Instagram Business ID using Facebook API.
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
 * Fetch Instagram ID from the database using a business ID.
 * @param {number} businessId - The business ID to search for.
 * @returns {Promise<string|null>} - The Instagram ID or null if not found.
 */
export async function fetchInstagramIdFromDatabase(businessId) {
  try {
    const { data, error } = await supabase
      .from('businesses') // Ensure 'businesses' is the correct table
      .select('ig_id') // Ensure 'ig_id' is the correct column name
      .eq('id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Could not fetch Instagram ID for business ID ${businessId}:`, error?.message || 'No data found');
      return null;
    }
    return data.ig_id;
  } catch (err) {
    console.error('[ERROR] Exception while fetching Instagram ID:', err.message);
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
    return data;
  } catch (err) {
    console.error('[ERROR] Exception while fetching business details:', err.message);
    return null;
  }
}

/**
 * Fetch all businesses for a specific business owner.
 */
export async function fetchBusinessesForOwner(businessOwnerId) {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, ig_id')
      .eq('business_owner_id', businessOwnerId);
    if (error || !data) {
      console.error(`[ERROR] Failed to fetch businesses for owner ID ${businessOwnerId}:`, error?.message || 'No data found');
      return [];
    }
    return data;
  } catch (err) {
    console.error('[ERROR] Exception while fetching businesses:', err.message);
    return [];
  }
}

console.log('[DEBUG] helpers.js loaded successfully');



/**
 * Parse user messages to extract field-value pairs in the format "key: value".
 * @param {string} userMessage - The message from the user.
 * @returns {Object} Parsed field and value or null if the message format is incorrect.
 */
export function parseUserMessage(userMessage) {
  if (typeof userMessage !== 'string' || userMessage.trim() === '') {
    console.error('[ERROR] Invalid or empty input for parseUserMessage:', userMessage);
    return { field: null, value: null };
  }

  // Define regex to match key-value pairs in the format "key: value"
  const regex = /^([\w-]+):\s*(.+)$/; // Allow hyphenated keys (e.g., "key-name")
  const match = userMessage.match(regex);

  if (!match) {
    console.warn('[WARN] User message does not match expected format:', userMessage);
    return { field: null, value: null };
  }

  const [, field, value] = match;

  return {
    field: field.toLowerCase(),
    value: value.trim(),
  };
}




/**
 * Log a message into the database.
 * @param {number} businessId - The ID of the business.
 * @param {string} senderId - The ID of the sender (Instagram user).
 * @param {string} recipientId - The ID of the recipient (your business).
 * @param {string} message - The message content.
 * @param {string} type - The type of the message (e.g., "sent" or "received").
 * @param {string|null} messageId - The unique message ID.
 * @param {boolean} isBusinessMessage - Whether the message is from the business.
 * @param {string} igId - The Instagram ID associated with the message.
 * @param {string} username - The username of the sender.
 */
export async function logMessage(
  businessId,
  senderId,
  recipientId,
  message,
  type,
  messageId,
  isBusinessMessage,
  igId,
  username
) {
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

/**
 * Send a message to a user via Instagram Messaging API.
 * @param {string} recipientId - Instagram user ID of the recipient.
 * @param {string} messageText - Message content to be sent.
 * @param {string} accessToken - Facebook page access token.
 * @returns {Promise<void>}
 */
export async function sendInstagramMessage(recipientId, messageText, accessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: messageText },
      }),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      console.error('[ERROR] Failed to send Instagram message:', errorResponse);
      throw new Error(errorResponse.error?.message || 'Unknown error');
    }

    console.log('[INFO] Instagram message sent successfully.');
  } catch (err) {
    console.error('[ERROR] Exception while sending Instagram message:', err.message);
    throw err;
  }
}


/**
 * Upsert Instagram user into the database.
 * @param {string} senderId - Instagram user ID.
 * @param {object} userInfo - Instagram user information (e.g., username).
 * @param {number} businessId - Associated business ID.
 * @returns {Promise<object|null>} The upserted user data or null on failure.
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
      console.error('[ERROR] Failed to upsert Instagram user:', error.message);
      return null;
    }

    console.log('[INFO] Instagram user upserted successfully:', data);
    return data;
  } catch (err) {
    console.error('[ERROR] Exception while upserting Instagram user:', err.message);
    return null;
  }
}

