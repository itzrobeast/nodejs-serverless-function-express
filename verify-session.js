import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

router.get('/verify-session', async (req, res) => {
  try {
    console.log('[DEBUG] Request received:', req.url, req.query);

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[ERROR] Missing or malformed Authorization header');
      return res.status(400).json({ error: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const user = jwt.verify(token, process.env.MILA_SECRET);
    console.log('[DEBUG] Token verified:', user);

    const businessId = req.query.business_id;
    if (!businessId) {
      console.error('[ERROR] Missing required parameter: business_id');
      return res.status(400).json({ error: 'Missing required parameter: business_id' });
    }

    // Fetch the business from the database
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      console.error('[ERROR] Business not found:', businessError?.message);
      return res.status(404).json({ error: 'Business not found' });
    }

    console.log('[DEBUG] Business fetched:', businessData);

    // Validate page ID and access token
    const { page_id: pageId, access_token: accessToken } = businessData;

    if (!pageId || !accessToken) {
      console.error('[ERROR] Page ID or Access Token missing');
      return res.status(400).json({ error: 'Page ID or Access Token missing.' });
    }

    // Fetch leads from Facebook Graph API
    const leads = await fetchLeads(pageId, accessToken);
    console.log('[DEBUG] Leads retrieved:', leads);

    return res.status(200).json({ user, business: businessData, leads });
  } catch (error) {
    console.error('[ERROR] Internal error in /verify-session:', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Helper function to fetch leads
const fetchLeads = async (pageId, accessToken) => {
  const url = `https://graph.facebook.com/v14.0/${pageId}/leads?access_token=${accessToken}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch leads: ${response.statusText}`);
    }
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('[ERROR] Failed to fetch leads:', error.message);
    throw error;
  }
};

export default router;
