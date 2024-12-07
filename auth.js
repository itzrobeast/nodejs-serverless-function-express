import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';
console.log('[DEBUG] Supabase client initialized:', supabase);
import fetch from 'node-fetch';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing access token' });
    }

    // Step 1: Verify the Facebook access token
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) {
      throw new Error('Invalid Facebook token');
    }
    const fbData = await fbResponse.json();

    console.log('[DEBUG] Facebook user data:', fbData);

    // Step 2: Find or create user in Supabase
    const { data: userData, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          id: fbData.id,
          name: fbData.name,
          email: fbData.email,
        },
        { onConflict: 'id' } // Avoid duplicating users with the same ID
      )
      .select('*')
      .single();

    if (userError || !userData) {
      console.error('[ERROR] Failed to fetch or create user in Supabase:', userError?.message);
      throw new Error('Failed to fetch or create user');
    }

    console.log('[DEBUG] User fetched or created:', userData);

    // Step 3: Generate a session token
    const token = jwt.sign(
      { id: userData.id, name: userData.name, email: userData.email },
      process.env.MILA_SECRET,
      { expiresIn: '1h' }
    );

    // Step 4: Fetch user's business information
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', userData.id)
      .single();

    if (businessError && businessError.code !== 'PGRST116') { // 'PGRST116' is no matching row found
      console.error('[ERROR] Failed to fetch business data:', businessError?.message);
      throw new Error('Failed to fetch business data');
    }

    // Step 5: Respond with token and business info
    return res.status(200).json({
      token,
      businessId: businessData?.id || null, // Return businessId if available, otherwise null
    });
  } catch (error) {
    console.error('[ERROR] Login failed:', error.message);
    return res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

export default router;
