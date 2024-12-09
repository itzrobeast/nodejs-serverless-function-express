import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.MILA_SECRET) {
  throw new Error('MILA_SECRET environment variable is missing.');
}

const router = express.Router();

/**
 * Verify Facebook access token using Facebook Graph API
 */
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

/**
 * Find or create a user in Supabase
 */
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

/**
 * Fetch business data for the user
 */
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

/**
 * Generate a JWT token for the user
 */
const generateToken = (userData) => {
  return jwt.sign(
    { id: userData.id, name: userData.name, email: userData.email },
    process.env.MILA_SECRET,
    { expiresIn: '1h' }
  );
};

/**
 * Debug route to check the existence of the Supabase client file
 */
router.get('/debug', async (req, res) => {
  try {
    const fileExists = await fs.access(path.join(__dirname, './supabaseClient.js'))
      .then(() => true)
      .catch(() => false);
    res.json({ fileExists });
  } catch (err) {
    res.status(500).json({ error: 'Debugging failed', details: err.message });
  }
});

/**
 * POST /login - Login a user with Facebook access token
 */
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

    // Set cookie with appropriate policies
    res.cookie('authToken', token, {
      httpOnly: true, // Prevents client-side JavaScript from accessing the cookie
      secure: process.env.NODE_ENV === 'production', // Ensures cookies are sent over HTTPS only in production
      sameSite: 'None', // Allows cross-site cookie sharing
    });

    return res.status(200).json({
      businessId: businessData?.id || null,
    });
  } catch (error) {
    console.error(`[ERROR] Login failed: ${error.message}`);
    return res.status(500).json({ error: 'Login failed', details: error.message });
  }
});


export default router;
