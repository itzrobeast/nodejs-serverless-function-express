// helpers.js
import fetch from 'node-fetch';
import supabase from './supabaseClient.js';

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
async function fetchInstagramUserInfo(senderId, businessId, supabase) {
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


export {

  
  fetchInstagramUserInfo, // Ensure this line exists
  
};

