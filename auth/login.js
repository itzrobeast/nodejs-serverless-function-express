import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';
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

    console.log('[DEBUG] Facebook Data:', fbData);

    // Assign or fetch the business_id (implement your logic for fetching/assigning the correct business_id)
    const businessId = await getOrCreateBusinessId(fbData.id); // Custom logic here

    // Upsert user in Supabase
    const { data: userData, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          id: fbData.id,
          name: fbData.name,
          email: fbData.email,
          business_id: businessId, // Ensure this is correct
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();

    if (userError) {
      console.error('[ERROR] Supabase Error:', userError.message);
      throw new Error('Failed to create or fetch user in Supabase');
    }

    // Generate a JWT token
    const token = jwt.sign(
      { id: userData.id, name: userData.name, email: userData.email },
      process.env.MILA_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ token, businessId });
  } catch (err) {
    console.error('[ERROR] Login failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Example of business ID logic
async function getOrCreateBusinessId(userId) {
  // Example: Fetch or create a business for the user
  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .single();

  if (businessError) {
    // If no business exists, create one
    const { data: newBusiness, error: createError } = await supabase
      .from('businesses')
      .insert({ owner_id: userId })
      .select('id')
      .single();

    if (createError) {
      throw new Error('Failed to create business for the user');
    }
    return newBusiness.id;
  }
  return business.id;
}

export default router;
