import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

if (!process.env.MILA_SECRET) {
  throw new Error('MILA_SECRET environment variable is missing.');
}

// POST /auth/login
router.post('/', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing access token' });
    }

    // Verify the Facebook token
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );
    if (!fbResponse.ok) {
      throw new Error('Invalid Facebook token');
    }

    const fbData = await fbResponse.json();

    // Find or create user in Supabase
    const { data: userData, error } = await supabase
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

    if (error) {
      throw new Error('Failed to create or fetch user in Supabase');
    }

    // Generate a JWT token
    const token = jwt.sign(
      { id: userData.id, name: userData.name, email: userData.email },
      process.env.MILA_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ token, businessId: userData.business_id || null });
  } catch (err) {
    console.error('[ERROR] Login failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
