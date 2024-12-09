import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

if (!process.env.MILA_SECRET) {
  throw new Error('MILA_SECRET environment variable is missing.');
}

// POST /auth/login
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

    // Find or create the user in the `users` table
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', fbData.id)
      .single();

    if (!user) {
      // If user doesn't exist, insert a new one
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
    }

    // Check if a business exists for this user's `fb_id`
    let { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', fbData.id) // Use `fb_id` for matching
      .single();

    if (!business) {
      // If no business exists, create one
      const { data: newBusiness, error: createBusinessError } = await supabase
        .from('businesses')
        .insert({
          owner_id: fbData.id, // Use `fb_id` here as `owner_id`
          name: `${fbData.name}'s Business`, // Default business name
        })
        .select('*')
        .single();

      if (createBusinessError) {
        throw new Error('Failed to create business for the user');
      }

      business = newBusiness;
    }

    // Generate a JWT token
    const token = jwt.sign(
      { fb_id: user.fb_id, name: user.name, email: user.email },
      process.env.MILA_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ token, businessId: business.id });
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
