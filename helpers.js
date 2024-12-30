// helpers.js

import fetch from 'node-fetch';

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
      console.log(`[DEBUG] Instagram Business Account ID: ${data.instagram_business_account.id}`);
      return data.instagram_business_account.id;
    }
    console.warn(`[WARN] No Instagram Business Account linked to Page ID: ${pageId}`);
    return null;
  } catch (err) {
    console.error('[ERROR] Failed to fetch Instagram Business Account ID:', err.message);
    return null;
  }
}

/**
 * Fetch Instagram Business ID from the database.
 */
export async function fetchInstagramBusinessIdFromDatabase(businessId, supabase) {
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
