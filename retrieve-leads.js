import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

// Utility: Fetch Lead Forms for a Page
const fetchLeadForms = async (pageId, pageAccessToken) => {
  const response = await fetch(
    `https://graph.facebook.com/v14.0/${pageId}/leadgen_forms?access_token=${pageAccessToken}`
  );
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leadgen forms: ${JSON.stringify(errorData)}`);
  }
  return (await response.json()).data || [];
};

// Utility: Fetch Leads for a Specific Form
const fetchLeadsForForm = async (formId, pageAccessToken) => {
  const response = await fetch(
    `https://graph.facebook.com/v14.0/${formId}/leads?access_token=${pageAccessToken}`
  );
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leads for form ${formId}: ${JSON.stringify(errorData)}`);
  }
  return (await response.json()).data || [];
};

// Main Function: Fetch Leads for All Forms of a Page
const fetchAllLeadsForPage = async (pageId, pageAccessToken) => {
  try {
    const forms = await fetchLeadForms(pageId, pageAccessToken);
    const allLeads = [];

    for (const form of forms) {
      if (form.status === 'ACTIVE') { // Only fetch leads for active forms
        console.log(`[DEBUG] Fetching leads for form: ${form.name}`);
        const leads = await fetchLeadsForForm(form.id, pageAccessToken);
        allLeads.push(...leads);
      }
    }

    return allLeads;
  } catch (err) {
    console.error('[ERROR] Failed to fetch leads:', err.message);
    throw err;
  }
};

// API Endpoint: Retrieve Leads
router.get('/', async (req, res) => {
  const { userId, businessId } = req.headers;

  console.log('[DEBUG] Headers:', { userId, businessId });

  if (!userId || !businessId) {
    return res.status(400).json({ error: 'Missing userId or businessId in headers' });
  }

  try {
    // Fetch the page access token and page ID for the business
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

    // Fetch all leads for the page
    const leads = await fetchAllLeadsForPage(pageId, pageAccessToken);

    console.log('[DEBUG] Retrieved Leads:', leads);
    res.status(200).json({ leads });
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
