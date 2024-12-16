import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

/** 
 * Fetch Lead Gen Forms for a given Facebook Page
 */
async function fetchLeadForms(pageId, pageAccessToken) {
  const url = `https://graph.facebook.com/v14.0/${pageId}/leadgen_forms?access_token=${pageAccessToken}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leadgen forms: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  return data.data || [];
}

/**
 * Fetch leads for a single form
 */
async function fetchLeadsForForm(formId, pageAccessToken) {
  const url = `https://graph.facebook.com/v14.0/${formId}/leads?access_token=${pageAccessToken}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leads for form ${formId}: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  return data.data || [];
}

/**
 * Fetch leads for all active forms on a given page
 */
async function fetchAllLeadsForPage(pageId, pageAccessToken) {
  // 1. Get all leadgen forms for this page
  const forms = await fetchLeadForms(pageId, pageAccessToken);
  const allLeads = [];

  // 2. For each ACTIVE form, fetch leads
  for (const form of forms) {
    if (form.status === 'ACTIVE') {
      console.log(`[DEBUG] Fetching leads for form: ${form.name} (id=${form.id})`);
      const leads = await fetchLeadsForForm(form.id, pageAccessToken);
      allLeads.push(...leads);
    }
  }

  return allLeads;
}

/**
 * GET /retrieve-leads
 * Headers must include { userId, businessId } 
 */
router.get('/', async (req, res) => {
  try {
    const { userId, businessId } = req.headers;
    console.log('[DEBUG] Headers:', { userId, businessId });

    if (!userId || !businessId) {
      return res.status(400).json({ error: 'Missing userId or businessId in headers' });
    }

    // 1. Fetch the page token & page ID from 'businesses' (assuming page_access_token is stored as 'access_token')
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('page_id, access_token')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.error('[ERROR] Failed to fetch business:', businessError?.message);
      return res.status(404).json({ error: 'Business not found' });
    }

    const { page_id: pageId, access_token: pageAccessToken } = business;
    if (!pageId || !pageAccessToken) {
      return res.status(400).json({ error: 'Page ID or access token missing for the business' });
    }

    console.log('[DEBUG] Retrieved Page Info:', { pageId, pageAccessToken });

    // 2. Fetch leads (all forms) 
    const leads = await fetchAllLeadsForPage(pageId, pageAccessToken);
    console.log('[DEBUG] Retrieved Leads:', leads);

    // Return the combined leads
    res.status(200).json({ leads });
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
