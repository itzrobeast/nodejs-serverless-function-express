import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js'; // Adjust path if file is in a subfolder

import fetch from 'node-fetch';

console.log('[DEBUG] Supabase client initialized successfully:', supabase);
console.log('[DEBUG] Resolved path for supabaseClient:', require.resolve('./supabaseClient.js'));

const router = express.Router();

if (!process.env.MILA_SECRET) {
  throw new Error('MILA_SECRET environment variable is missing.');
}

router.get('/debug', (req, res) => {
  try {
    const fs = require('fs');
    const fileExists = fs.existsSync('./supabaseClient.js');
    res.json({ fileExists });
  } catch (err) {
    res.status(500).json({ error: 'Debugging failed', details: err.message });
  }
});




// Helper function to verify Facebook access token
const verifyFacebookToken = async (accessToken) => {
  try {
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );
    if (!fbResponse.ok) {
      throw new Error('Invalid Facebook token');
    }
    return fbResponse.json();
  } catch (error) {
    error.step = 'Verify Facebook Token';
    throw error;
  }
};

// Helper function to find or create a user in Supabase
const findOrCreateUser = async (fbData) => {
  try {
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
  } catch (error) {
    error.step = 'Find or Create User';
    throw error;
  }
};

// Helper function to fetch business data
const fetchBusinessData = async (ownerId) => {
  try {
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', ownerId)
      .single();

    if (businessError && businessError.code !== 'PGRST116') {
      throw new Error('Failed to fetch business data');
    }

    return businessData;
  } catch (error) {
    error.step = 'Fetch Business Data';
    throw error;
  }
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

    const fbData = await verifyFacebookToken(accessToken);
    const userData = await findOrCreateUser(fbData);
    const token = generateToken(userData);
    const businessData = await fetchBusinessData(userData.id);

    return res.status(200).json({
      token,
      businessId: businessData?.id || null,
    });
  } catch (error) {
    console.error(`[ERROR] Login failed at step: ${error.step || 'Unknown'} - ${error.message}`);
    return res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

export default router;
