// helpers.js

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
  forceRefreshPageAccessToken,
  isExpired,
} from './auth/refresh-token.js';

/**
 * Validate and standardize an Instagram ID (ig_id).
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
 */
export const validateFacebookToken = async (token) => {
  try {
    console.log(`[DEBUG] Validating Facebook token: ${token}`);
    const appAccessToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
    const response = await axios.get('https://graph.facebook.com/debug_token', {
      params: { input_token: token, access_token: appAccessToken },
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
 */
export async function fetchInstagramUserInfo(senderId, businessId) {
  try {
    const { data: businessDetails, error } = await supabase
      .from('businesses')
      .select('page_id')
      .eq('id', businessId)
      .single();

    if (error || !businessDetails) {
      console.error(`[ERROR] Could not get page_id for businessId=${businessId}:`, error?.message || 'No data');
      return null;
    }

    const { page_id: pageId } = businessDetails;

    const accessToken = await getPageAccessToken(businessId, pageId);
    if (!accessToken) {
      console.error('[ERROR] No access token for Page ID:', pageId);
      return null;
    }

    const response = await fetch(
      `https://graph.facebook.com/v17.0/${senderId}?fields=id,username&access_token=${accessToken}`
    );
    if (!response.ok) {
      const errorResponse = await response.json();
      console.error(`[ERROR] Failed to fetch IG user info for senderId=${senderId}:`, errorResponse.error?.message || 'Unknown');
      return null;
    }

    const userInfo = await response.json();
    if (!userInfo.id) {
      console.warn('[WARN] Invalid user info for senderId=', senderId);
      return null;
    }
    return { id: userInfo.id, username: userInfo.username || null };
  } catch (err) {
    console.error('[ERROR] Exception while fetching IG user info:', err.message);
    return null;
  }
}

/**
 * Fetch business details from the database.
 */
export async function fetchBusinessDetails(businessId) {
  try {
    console.log('[DEBUG] Fetching business details for businessId=', businessId);
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, ig_id, page_id, business_owner_id')
      .eq('id', businessId)
      .single();

    if (error || !data) {
      throw new Error(`[ERROR] Could not fetch business details for ID=${businessId}: ` + (error?.message || 'No data'));
    }
    console.log('[DEBUG] Fetched business details:', data);
    return data;
  } catch (err) {
    console.error('[ERROR] Exception fetching business details:', err.message);
    return null;
  }
}

/**
 * Log a message into the database.
 * Still includes a DB-level check for duplicates.
 */
export async function logMessage({
  businessId,
  senderId,
  recipientId,
  message,
  type,
  role,
  igId,
  username = null,
  email = null,
  phone_number = null,
  location = null,
}) {
  try {
    console.log('[DEBUG] Checking for existing message:', { businessId, senderId, recipientId, message, type });

    // Check if the message already exists
    const { data: existingMessage, error: fetchError } = await supabase
      .from('instagram_conversations')
      .select('id')
      .eq('business_id', businessId)
      .eq('sender_id', senderId)
      .eq('recipient_id', recipientId)
      .eq('message', message)
      .eq('message_type', type)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to check for duplicate message:', fetchError.message);
      return;
    }

    // If you want to SKIP duplicates, uncomment this block:
    /*
    if (existingMessage) {
      console.log('[INFO] Duplicate message detected. Skipping log.');
      return;
    }
    */

    console.log('[DEBUG] Attempting to insert new message:', {
      businessId,
      senderId,
      recipientId,
      message,
      type,
      role,
      igId,
      username,
      email,
      phone_number,
      location,
    });

    const { error } = await supabase.from('instagram_conversations').insert([
      {
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
      },
    ]);

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
 */
export async function handleUnsentMessage(messageId, businessId) {
  try {
    if (!messageId || !businessId) {
      console.error('[ERROR] Missing messageId or businessId for handleUnsentMessage');
      return;
    }

    console.log(`[INFO] Deleting message ID=${messageId} for business ID=${businessId}`);
    const { data, error, count } = await supabase
      .from('instagram_conversations')
      .delete()
      .match({ business_id: businessId, message_id: messageId });

    if (error) {
      console.error(`[ERROR] Deletion failed for messageId=${messageId}`, error.message);
      return;
    }
    if (count === 0) {
      console.warn(`[WARN] No message found with ID=${messageId} for businessId=${businessId}`);
    } else {
      console.log(`[INFO] Deleted message ID=${messageId} for businessId=${businessId}`);
    }
  } catch (err) {
    console.error('[ERROR] Exception in handleUnsentMessage:', err.message);
  }
}

/**
 * Send a message to a user via the Instagram Messaging API (no memory dedup).
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
    const response = await fetch('https://graph.facebook.com/v17.0/me/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: messageText },
        access_token: pageAccessToken,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Unknown error sending IG message');
    }

    console.log('[INFO] Instagram message sent successfully.');
    return data;
  } catch (err) {
    console.error('[ERROR] sendInstagramMessage failed:', err.message);

    // If token expired, we attempt refresh once
    if (retryCount < 1 && err.message.includes('Error validating access token')) {
      console.log('[INFO] Attempting token refresh and retry...');
      const newToken = await forceRefreshPageAccessToken(businessId, pageId);
      if (newToken) {
        return sendInstagramMessage(
          senderId,
          messageText,
          newToken,
          businessId,
          pageId,
          retryCount + 1
        );
      }
    }
    return null;
  }
}

/**
 * Upsert Instagram user into the DB.
 */
export async function upsertInstagramUser(senderId, userInfo, businessId, role = 'customer', location = null, igId) {
  try {
    if (!businessId || !senderId) {
      console.error('[ERROR] Missing businessId or senderId in upsertInstagramUser');
      return;
    }

    const { error } = await supabase.from('instagram_users').upsert(
      {
        sender_id: senderId,
        ig_id: igId,
        business_id: businessId,
        username: userInfo?.username || null,
        role,
        location,
        updated_at: new Date().toISOString(),
      },
      { onConflict: ['sender_id', 'business_id'] }
    );

    if (error) {
      console.error('[ERROR] upsertInstagramUser failed:', error.message);
    } else {
      console.log(`[INFO] upserted IG user for businessId=${businessId}, role=${role}`);
    }
  } catch (err) {
    console.error('[ERROR] Exception in upsertInstagramUser:', err.message);
  }
}

/**
 * Parse user messages for location
 */
export function parseUserMessage(userMessage) {
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    console.error('[ERROR] parseUserMessage got invalid input:', userMessage);
    return { field: null, value: null, location: null };
  }

  const locationRegex = /location:\s*(.+)$/i;
  const match = userMessage.match(locationRegex);
  const location = match ? match[1].trim() : null;

  return { field: null, value: null, location };
}
