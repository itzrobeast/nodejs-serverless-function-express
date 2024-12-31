// helpers.js
import fetch from 'node-fetch';

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

