// retrieve-leads.js
import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/**
 * Helper function to fetch leadgen forms from Facebook Graph API
 * @param {string} pageId - Facebook Page ID
 * @param {string} pageAccessToken - Page-specific access token
 * @returns {Array} Array of leadgen forms
 */
const fetchLeadForms = async (pageId, pageAccessToken) => {
  const url = `https://graph.facebook.com/v14.0/${pageId}/leadgen_forms?access_token=${pageAccessToken}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leadgen forms: ${JSON.stringify(errorData)}`);
  }
  const data = await response.json();
  return data.data || [];
};

/**
 * Helper function to fetch leads for a specific leadgen form
 * @param {string} formId - Leadgen Form ID
 * @param {string} pageAccessToken - Page-specific access token
 * @returns {Array} Array of leads
 */
const fetchLeadsForForm = async (formId, pageAccessToken) => {
  const url = `https://graph.facebook.com/v14.0/${formId}/leads?access_token=${pageAccessToken}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leads for form ${formId}: ${JSON.stringify(errorData)}`);
  }
  const data = await response.json();
  return data.data || [];
};

/**
 * Helper function to fetch all leads for a page by fetching all active forms and their leads
 * @param {string} pageId - Facebook Page ID
 * @param {string} pageAccessToken - Page-specific access token
 * @returns {Array} Array of all leads
 */
const fetchAllLeadsForPage = async (pageId, pageAccessToken) => {
  try {
    const forms = await fetchLeadForms(pageId, pageAccessToken);
    const allLeads = [];

    for (const form of forms) {
      if (form.status === 'ACTIVE') {
        console.log(`[DEBUG] Fetching leads for form: ${form.name} (ID: ${form.id})`);
        const leads = await fetchLeadsForForm(form.id, pageAccessToken);
        allLeads.push(...leads);
      }
    }

    return allLeads;
  } catch (error) {
    console.error('[ERROR] Failed to fetch leads for page:', error.message);
    throw error;
  }
};

/**
 * Optional: Validate the page access token using Facebook's debug_token endpoint
 * @param {string} pageAccessToken - Page access token to validate
 * @returns {boolean} Whether the token is valid
 */
const validatePageToken = async (pageAccessToken) => {
  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      console.warn('[WARN] Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET for token validation.');
      return true; // Skip validation if missing
    }

    const response = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${pageAccessToken}&access_token=${appId}|${appSecret}`
    );
    const data = await response.json();
    console.log('[DEBUG] Page Token Validation Response:', data);

    if (data.data && data.data.is_valid) {
      return true;
    } else {
      console.error('[ERROR] Page token is invalid or expired:', data);
      return false;
    }
  } catch (error) {
    console.error('[ERROR] Failed to validate page token:', error.message);
    return false;
  }
};

/**
 * Helper function to store leads in Supabase
 * @param {Array} leads - Array of lead objects
 * @param {string} businessId - Business ID to associate the leads with
 * @returns {void}
 */
const storeLeadsInSupabase = async (leads, businessId) => {
  try {
    if (!leads.length) return;

    // Prepare leads for insertion
    const formattedLeads = leads.map((lead) => ({
      lead_id: lead.id,
      created_time: lead.created_time,
      business_id: businessId,
      field_data: JSON.stringify(lead.field_data), // Store as JSON string
    }));

    // Insert leads, ignoring duplicates based on lead_id
    const { error } = await supabase
      .from('leads')
      .upsert(formattedLeads, { onConflict: 'lead_id' }); // Ensure 'lead_id' is unique

    if (error) {
      console.error('[ERROR] Failed to insert leads into Supabase:', error.message);
    } else {
      console.log(`[DEBUG] Successfully inserted ${formattedLeads.length} leads into Supabase.`);
    }
  } catch (error) {
    console.error('[ERROR] Exception while storing leads:', error.message);
  }
};

/**
 * GET /retrieve-leads
 * Fetches leads from Facebook using stored page access tokens and stores them in Supabase
 * Requires userId and businessId from cookies
 */
router.get('/', async (req, res) => {
  try {
    const { userId, businessId } = req.cookies;

    console.log('[DEBUG] Parsed Cookies:', { userId, businessId });

    if (!userId || !businessId) {
      return res.status(400).json({ error: 'Missing userId or businessId in cookies.' });
    }

    // 1. Retrieve the page access token and page ID from 'page_access_tokens' table
    const { data: pageRow, error: pageRowError } = await supabase
      .from('page_access_tokens')
      .select('page_id, page_access_token')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .single();

    if (pageRowError || !pageRow) {
      console.error('[ERROR] Page access token not found:', pageRowError?.message);
      return res.status(404).json({ error: 'Page access token not found.' });
    }

    const { page_id: pageId, page_access_token: pageAccessToken } = pageRow;
    console.log('[DEBUG] Retrieved Page Token:', { pageId, pageAccessToken });

    // 2. (Optional) Validate the page access token
    const isValid = await validatePageToken(pageAccessToken);
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid or expired page access token.' });
    }

    // 3. Fetch all leads for the page
    const leads = await fetchAllLeadsForPage(pageId, pageAccessToken);
    console.log('[DEBUG] Retrieved Leads:', leads);

    // 4. Store leads in Supabase
    await storeLeadsInSupabase(leads, businessId);

    // 5. Return the leads to frontend
    return res.status(200).json({ leads });
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads:', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
