import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js';

const router = express.Router();

export const getLeadsFromMeta = async (accessToken, pageId) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v14.0/${pageId}/leadgen_forms?access_token=${accessToken}`
    );
    if (!response.ok) throw new Error('Failed to retrieve leads');
    const data = await response.json();
    return data.data; // Array of leads
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
    // Fetch leads from the database for the specified business_id
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('business_id', business_id);

    if (error) {
      console.error('[ERROR] Failed to retrieve leads:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve leads' });
    }


    const { access_token, page_id } = business;

    if (!access_token || !page_id) {
      return res.status(400).json({ error: 'Page ID or Access Token missing.' });
    }

    const url = `https://graph.facebook.com/v14.0/${page_id}/leads?access_token=${access_token}`;
    const response = await fetch(url);
    const leads = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: leads.error.message });
    }

    res.status(200).json({ leads: leads.data || [] });
  } catch (error) {
    console.error('[ERROR] Failed to retrieve leads:', error.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
