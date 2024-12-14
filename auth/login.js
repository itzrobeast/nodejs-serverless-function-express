import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import cookie from 'cookie';

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

    // Retrieve or create the user in Supabase using `fb_id`
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', fbData.id)
      .single();

    if (userError && userError.code === 'PGRST116') {
      // If the user doesn't exist, create a new one
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
        return res.status(500).json({ error: 'Failed to create user.' });
      }
      user = newUser;
    } else if (userError) {
      console.error('[ERROR] Error fetching user:', userError.message);
      return res.status(500).json({ error: 'Error fetching user.' });
    }

  const ownerId = user.id; // Use the user's primary ID for the user_id field

// Find or create business for the user
const { data: business, error: businessError } = await supabase
  .from('businesses')
  .select('*')
  .eq('user_id', ownerId) // Match on user_id
  .single();

if (businessError && businessError.code === 'PGRST116') {
  const { data: newBusiness, error: createBusinessError } = await supabase
    .from('businesses')
    .insert({
      user_id: ownerId, // Assign the user's ID
      name: `${fbData.name}'s Business`,
    })
    .select('*')
    .single();

  if (createBusinessError) {
    console.error('[ERROR] Failed to create business:', createBusinessError.message);
    return res.status(500).json({ error: 'Failed to create business.' });
  }
  business = newBusiness;
} else if (businessError) {
  console.error('[ERROR] Error fetching business:', businessError.message);
  return res.status(500).json({ error: 'Error fetching business.' });
}


    // Set cookies
    res.cookie('authToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });
    res.cookie('userId', ownerId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 3600000, // 1 hour
    });

    // Respond with user and business details
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
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
