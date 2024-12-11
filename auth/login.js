import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

if (!process.env.MILA_SECRET) {
  throw new Error('MILA_SECRET environment variable is missing.');
}

router.post('/', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing access token' });
    }

    // Verify Facebook token
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );
    if (!fbResponse.ok) {
      throw new Error('Invalid Facebook token');
    }

    const fbData = await fbResponse.json();

    // Find or create user in Supabase
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', fbData.id)
      .single();

    if (userError && userError.code === 'PGRST116') {
      const { data: newUser, error: createUserError } = await supabase
        .from('users')
        .insert({
          fb_id: fbData.id,
          name: fbData.name,
          email: fbData.email,
        })
        .select('*')
        .single();

      if (createUserError) {
        throw new Error('Failed to create user in Supabase');
      }
      user = newUser;
    } else if (userError) {
      throw new Error('Error fetching user from Supabase');
    }

    // Generate JWT token
    const token = jwt.sign(
      { fb_id: user.fb_id, name: user.name, email: user.email },
      process.env.MILA_SECRET,
      { expiresIn: '1h' }
    );

    // Set the token in a secure cookie
    res.cookie('authToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None', // Required for cross-origin requests
      maxAge: 3600000, // 1 hour
      domain: process.env.NODE_ENV === 'production' ? '.mila-verse.vercel.app' : undefined,
    });

    // Respond with token and business ID
    res.status(200).json({ token, businessId: business.id });
  } catch (err) {
    console.error('[ERROR] Login failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
