import express from 'express';
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
      return res.status(401).json({ error: 'Invalid Facebook token' });
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
        console.error('[ERROR] Failed to create user:', createUserError.message);
        return res.status(500).json({ error: 'Failed to create user' });
      }
      user = newUser;
    } else if (userError) {
      console.error('[ERROR] Error fetching user:', userError.message);
      return res.status(500).json({ error: 'Error fetching user' });
    }

    // Find or create business for the user
    let business;
    try {
      const { data: existingBusiness, error: businessError } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', fbData.id)
        .single();

      if (businessError && businessError.code === 'PGRST116') {
        // If no business exists, create one
        const { data: newBusiness, error: createBusinessError } = await supabase
          .from('businesses')
          .insert({
            owner_id: fbData.id,
            name: `${fbData.name}'s Business`,
          })
          .select('*')
          .single();

        if (createBusinessError) {
          console.error('[ERROR] Failed to create business:', createBusinessError.message);
          return res.status(500).json({ error: 'Failed to create business' });
        }
        business = newBusiness;
      } else if (businessError) {
        console.error('[ERROR] Error fetching business:', businessError.message);
        return res.status(500).json({ error: 'Error fetching business' });
      } else {
        business = existingBusiness;
      }
    } catch (err) {
      console.error('[ERROR] Business retrieval/creation failed:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve or create business' });
    }

    // Set Facebook token in a secure HTTP-only cookie
    res.cookie('authToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None', // Required for cross-origin requests
      maxAge: 3600000, // 1 hour
      domain: process.env.NODE_ENV === 'production' ? '.mila-verse.vercel.app' : undefined,
    });

    // Respond with user and business details
    res.status(200).json({
      message: 'Login successful',
      user: {
        fb_id: user.fb_id,
        name: user.name,
        email: user.email,
      },
      business: {
        id: business.id,
        name: business.name,
      },
    });
  } catch (err) {
    console.error('[ERROR] Login failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
