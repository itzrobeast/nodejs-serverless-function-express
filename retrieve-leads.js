import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

export const getLeadsFromMeta = async (accessToken, pageId) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v14.0/${pageId}/leads?access_token=${accessToken}`
    );
    if (!response.ok) throw new Error('Failed to retrieve leads');
    const data = await response.json();
    return data.data || []; // Array of leads
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads from Meta:', error.message);
    return [];
  }
};

// GET Handler for Leads Retrieval
router.get('/', async (req, res) => {
  const { business_id } = req.query;

  if (!business_id) {
    return res.status(400).json({ error: 'Missing required parameter: business_id' });
  }

  try {
    // Fetch business data to get access_token and page_id
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('access_token, page_id')
      .eq('id', business_id)
      .single();

    if (businessError || !business) {
      console.error('[ERROR] Business not found or database error:', businessError?.message);
      return res.status(404).json({ error: 'Business not found' });
    }

    const { access_token, page_id } = business;

    if (!access_token || !page_id) {
      return res.status(400).json({ error: 'Page ID or Access Token missing.' });
    }

    // Fetch leads from Meta API
    const leads = await getLeadsFromMeta(access_token, page_id);

    res.status(200).json({ leads });
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads:', error.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
