import fetch from 'node-fetch';
import supabase from './supabaseClient.js';
import { refreshPageAccessToken, refreshUserAccessToken } from './auth/refresh-token.js';

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

/**
 * Parse user message.
 */
export function parseUserMessage(userMessage) {
  if (typeof userMessage !== 'string') {
    console.error('[ERROR] Invalid input type for parseUserMessage:', typeof userMessage);
    return { field: null, value: null };
  }

  const regex = /(\w+):\s*(.+)/;
  const match = userMessage.match(regex);
  if (!match) return { field: null, value: null };
  return {
    field: match[1].toLowerCase(),
    value: match[2].trim(),
  };
}


/**
 * Upsert Instagram user into the database.
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

console.log('[DEBUG] helpers.js loaded successfully');
