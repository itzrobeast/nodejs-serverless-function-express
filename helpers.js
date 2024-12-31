// helpers.js
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import { refreshPageAccessToken, refreshUserAccessToken } from './auth/refresh-token.js';

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
      const fetchedIgId = data.instagram_business_account.id;
      console.log(`[DEBUG] Fetched Instagram Business Account ID: ${fetchedIgId}`);

      // Validate that fetchedIgId is a string of digits
      if (typeof fetchedIgId !== 'string' || !/^\d+$/.test(fetchedIgId)) {
        console.error(`[ERROR] Invalid Instagram Business Account ID format: ${fetchedIgId}`);
        return null;
      }

      // Convert to integer
      const igIdInt = parseInt(fetchedIgId, 10);

      // If conversion fails, handle appropriately
      if (isNaN(igIdInt)) {
        console.error(`[ERROR] Invalid Instagram Business Account ID: ${fetchedIgId}`);
        return null;
      }

      return fetchedIgId;  
      
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
export async function fetchInstagramIdFromDatabase(businessId, supabase) {
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

    console.log(`[DEBUG] Instagram ID for business ID ${businessId}: ${data.ig_id}`);
    return data.ig_id;
  } catch (err) {
    console.error('[ERROR] Exception while fetching Instagram ID from database:', err.message);
    return null;
  }
}

async function fetchAccessTokenForBusiness(businessId, supabase) {
  try {
    const { data, error } = await supabase
      .from('page_access_tokens')
      .select('page_access_token')
      .eq('business_id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Could not fetch access token for businessId=${businessId}:`, error?.message || 'No data found');
      return null;
    }

    return data.page_access_token;
  } catch (err) {
    console.error('[ERROR] Failed to fetch access token from Supabase:', err.message);
    return null;
  }
}


export async function fetchBusinessDetails(businessId) {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('ig_id, page_id')
      .eq('id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch business details for businessId=${businessId}:`, error?.message || 'No data found');
      return null;
    }
    return { ig_id: data.ig_id, page_id: data.page_id };
  } catch (err) {
    console.error('[ERROR] Exception while fetching business details:', err.message);
    return null;
  }
}


export async function getValidUserAccessToken(userId, shortLivedToken) {
  const userAccessToken = await getUserAccessToken(userId);

  if (!userAccessToken || isExpired(userAccessToken)) {
    console.log('[INFO] User access token expired or missing. Refreshing...');
    const refreshedToken = await refreshUserAccessToken(userId, shortLivedToken);

    if (!refreshedToken) {
      console.error('[ERROR] Failed to refresh user access token.');
      return null;
    }

    return refreshedToken;
  }

  return userAccessToken;
}


export async function getUserAccessToken(userId, shortLivedToken = null) {
  try {
    const { data, error } = await supabase
      .from('users')
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

    const { user_access_token: userAccessToken, updated_at: updatedAt } = data;

    // Assume tokens expire in 60 days and check the last updated time
    const isExpired = () => {
      const tokenExpiryDays = 60;
      const lastUpdated = new Date(updatedAt);
      const now = new Date();
      return (now - lastUpdated) / (1000 * 60 * 60 * 24) > tokenExpiryDays;
    };

    // If the token is missing or expired, refresh it
    if (!userAccessToken || isExpired()) {
      console.log('[INFO] User access token expired or missing. Refreshing...');
      if (!shortLivedToken) {
        console.error('[ERROR] No short-lived token available to refresh user access token.');
        return null;
      }

      const refreshedToken = await refreshUserAccessToken(userId, shortLivedToken);
      if (!refreshedToken) {
        console.error('[ERROR] Failed to refresh user access token.');
        return null;
      }

      return refreshedToken;
    }

    return userAccessToken;
  } catch (err) {
    console.error('[ERROR] Exception while fetching user access token:', err.message);
    return null;
  }
}




export async function getPageAccessToken(businessId, pageId) {
  try {
    const { data, error } = await supabase
      .from('page_access_tokens')
      .select('page_access_token, user_id')
      .eq('business_id', businessId)
      .eq('page_id', pageId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Failed to fetch page access token for Business ID ${businessId}, Page ID ${pageId}:`, error?.message || 'No data found');
      return null;
    }

    const { page_access_token: pageAccessToken, user_id: userId } = data;

    // Fetch user access token
    const userAccessToken = await getUserAccessToken(userId);

    // Validate the page access token
    const testResponse = await fetch(`https://graph.facebook.com/v15.0/me?access_token=${pageAccessToken}`);
    const testData = await testResponse.json();

    if (testData.error?.message.includes('Session has expired')) {
      console.warn(`[WARN] Page access token expired for Page ID ${pageId}. Refreshing token...`);
      return await refreshPageAccessToken(pageId, userAccessToken);
    }

    return pageAccessToken;
  } catch (err) {
    console.error(`[ERROR] Exception while fetching page access token for Page ID ${pageId}:`, err.message);
    return null;
  }
}








/**
 * Logs a message into the database.
 * @param {string} businessId - The ID of the business.
 * @param {string} senderId - The ID of the message sender.
 * @param {string} recipientId - The ID of the message recipient.
 * @param {string} message - The message content.
 * @param {string} type - The type of message ('received' or 'sent').
 * @param {string|null} messageId - The unique message ID.
 * @param {boolean} isBusinessMessage - Whether the message is from the business.
 * @param {string} igId - The Instagram ID of the business or user.
 * @param {string} username - The Instagram username of the sender.
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
  username,
  supabase
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


console.log('[DEBUG] helpers.js loaded successfully');



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
 * Fetch Instagram user information using the sender ID.
 * @param {string} senderId - The Instagram sender ID.
 * @returns {object|null} - The user info object or null if not found.
 */
export async function fetchInstagramUserInfo(senderId, businessId, supabase) {
  try {
    const businessDetails = await fetchBusinessDetails(businessId);
    if (!businessDetails) {
      console.error(`[ERROR] Could not fetch business details for businessId=${businessId}`);
      return null;
    }

    const { page_id: pageId } = businessDetails;
    const accessToken = await getPageAccessToken(businessId, pageId, supabase);

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

    console.log('[DEBUG] Fetched Instagram user info:', data);
    return data;
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram user info:', err.message);
    return null;
  }
}


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

    console.log('[DEBUG] Message sent successfully:', data);
    return data;
  } catch (err) {
    console.error('[ERROR] Failed to send Instagram message:', err.message);
    return null;
  }
}

