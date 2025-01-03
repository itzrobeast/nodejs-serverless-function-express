// Import necessary modules
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
  isExpired
} from './auth/refresh-token.js';

/**
 * Fetch Instagram user info from the Facebook Graph API.
 * @param {string} senderId - The Instagram user's sender ID.
 * @param {number} businessId - The business ID for authentication context.
 * @returns {Promise<object|null>} - The user info object or null if not found.
 */

export async function fetchInstagramUserInfo(senderId, businessId) {
  try {
    const { data: businessDetails, error } = await supabase
      .from('businesses')
      .select('page_id, access_token')
      .eq('id', businessId)
      .single();

    if (error || !businessDetails) {
      console.error(`[ERROR] Failed to fetch business details for businessId=${businessId}:`, error?.message || 'No data found');
      return null;
    }

    const { page_id: pageId, access_token: accessToken } = businessDetails;
    if (!accessToken || !pageId) {
      console.error(`[ERROR] Missing page access token or page ID for businessId=${businessId}`);
      return null;
    }

    const response = await fetch(
      `https://graph.facebook.com/v17.0/${senderId}?fields=id,username,email,phone_number&access_token=${accessToken}`
    );
    const userInfo = await response.json();

    if (!response.ok || !userInfo.id) {
      console.error(`[ERROR] Failed to fetch Instagram user info for senderId=${senderId}:`, userInfo.error?.message || 'No data found');
      return null;
    }

    return {
      id: userInfo.id,
      username: userInfo.username || null,
      email: userInfo.email || null,
      phone_number: userInfo.phone_number || null,
    };
  } catch (err) {
    console.error('[ERROR] Exception while fetching Instagram user info:', err.message);
    return null;
  }
}





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
      .from('businesses')
      .select('ig_id')
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
 * @param {number} businessId - The business ID.
 * @returns {Promise<object|null>} - The business details or null if not found.
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
  isBusinessMessage, // Boolean indicating if the message is from the business
  igId,
  username,
  email = null,
  phone_number = null,
  location = null
) {
  try {
    // Determine the role based on whether it's a business message
    const role = isBusinessMessage ? 'business' : 'customer';

    console.log('[DEBUG] Logging message with data:', {
      business_id: businessId,
      sender_id: senderId,
      recipient_id: recipientId,
      message,
      message_type: type,
      message_id: messageId,
      role,
      ig_id: igId,
      sender_name: username,
      email,
      phone_number,
      location,
    });

    const { data, error } = await supabase
      .from('instagram_conversations')
      .insert([{
        business_id: businessId,
        sender_id: senderId,
        recipient_id: recipientId,
        message,
        message_type: type,
        message_id: messageId,
        role, // Use the 'role' column instead of 'is_business_message'
        ig_id: igId,
        sender_name: username,
        email,
        phone_number,
        location,
      }]);

    if (error) {
      console.error(`[ERROR] Failed to log message for businessId=${businessId}:`, error.message || error);
      return;
    }

    console.log('[DEBUG] Message logged successfully:', data);
  } catch (err) {
    console.error('[ERROR] Exception while logging message:', err.message || err);
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

  // Regex to match location-related keywords (e.g., "Location: New York")
  const locationRegex = /location:\s*(.+)$/i;
  const match = userMessage.match(locationRegex);

  const location = match ? match[1].trim() : null;

  return {
    field: null, // Add logic for other fields if needed
    value: null, // Add logic for other fields if needed
    location,
  };
}


/**
 * Send a message to a user via Instagram Messaging API.
 * @param {string} recipientId - Instagram user ID of the recipient.
 * @param {string} messageText - Message content to be sent.
 * @param {string} accessToken - Facebook page access token.
 */
export async function sendInstagramMessage(recipientId, messageText, accessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/me/messages?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: messageText },
        }),
      }
    );

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
 */
export async function upsertInstagramUser(senderId, userInfo, businessId, role = 'customer', location = null) {
  try {
    const { username, email, phone_number } = userInfo;

    const { data, error } = await supabase
      .from('instagram_users')
      .upsert(
        {
          instagram_id: senderId,
          username: username || null,
          email: email || null,
          phone_number: phone_number || null,
          business_id: businessId,
          role, // Assign role
          location, // Store location
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

