import express from 'express';
import jwt from 'jsonwebtoken';

import supabase from './supabaseClient.js';
console.log('[DEBUG] Supabase client initialized:', supabase);

import fetch from 'node-fetch';

const router = express.Router();

// Helper function to verify Facebook access token
const verifyFacebookToken = async (accessToken) => {
  const fbResponse = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
  );
  if (!fbResponse.ok) {
    throw new Error('Invalid Facebook token');
  }
  return fbResponse.json();
};

// Helper function to find or create a user in Supabase
const findOrCreateUser = async (fbData) => {
  const { data: userData, error: userError } = await supabase
    .from('users')
    .upsert(
      {
        id: fbData.id,
        name: fbData.name,
        email: fbData.email,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  if (userError || !userData) {
    throw new Error('Failed to fetch or create user in Supabase');
  }
  return userData;
};

// Helper function to fetch business data
const fetchBusinessData = async (ownerId) => {
  const { data: businessData, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', ownerId)
    .single();

  if (businessError && businessError.code !== 'PGRST116') {
    throw new Error('Failed to fetch business data');
  }

  return businessData;
};

// Helper function to generate JWT token
const generateToken = (userData) => {
  return jwt.sign(
    { id: userData.id, name: userData.name, email: userData.email },
    process.env.MILA_SECRET,
    { expiresIn: '1h' }
  );
};

// POST /login route
router.post('/login', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing access token' });
    }

    // Step 1: Verify the Facebook access token
    const fbData = await verifyFacebookToken(accessToken);
    console.log('[DEBUG] Facebook user data:', fbData);

    // Step 2: Find or create user in Supabase
    const userData = await findOrCreateUser(fbData);
    console.log('[DEBUG] User fetched or created:', userData);

    // Step 3: Generate a session token
    const token = generateToken(userData);

    // Step 4: Fetch user's business information
    const businessData = await fetchBusinessData(userData.id);
    console.log('[DEBUG] Business fetched:', businessData);

    // Step 5: Respond with token and business info
    return res.status(200).json({
      token,
      businessId: businessData?.id || null,
    });
  } catch (error) {
    console.error('[ERROR] Login failed:', error.message);
    return res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

export default router;
