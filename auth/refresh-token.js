import fetch from 'node-fetch';
import supabase from '../supabaseClient.js';
import { refreshUserAccessToken, refreshPageAccessToken } from './auth/refresh-token.js';

/**
 * Ensure the user access token is valid and fetch a refreshed one if necessary.
 */
async function getUserAccessToken(businessOwnerId) {
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
async function getPageAccessToken(businessId, pageId) {
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
 * Check if a token is expired.
 */
function isExpired(updatedAt, expiryDays = 60) {
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

export { getUserAccessToken, getPageAccessToken };
