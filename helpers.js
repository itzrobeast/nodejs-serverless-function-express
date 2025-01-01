import fetch from 'node-fetch';
import supabase from './supabaseClient.js';

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
 * Fetch the Page Access Token dynamically using a User Access Token.
 */
export async function getPageAccessToken(pageId, userAccessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${pageId}?fields=access_token&access_token=${userAccessToken}`
    );

    const data = await response.json();

    if (response.ok && data.access_token) {
      console.log(`[INFO] Successfully fetched Page Access Token for Page ID: ${pageId}`);
      return data.access_token;
    } else {
      console.warn(
        `[WARN] Failed to fetch Page Access Token for Page ID: ${pageId}`,
        data.error ? data.error.message : 'No data returned'
      );
      return null;
    }
  } catch (err) {
    console.error('[ERROR] Exception while fetching Page Access Token:', err.message);
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
