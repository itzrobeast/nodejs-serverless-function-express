import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

// Ensure required environment variables are set
if (!process.env.MILA_SECRET) {
  throw new Error('MILA_SECRET environment variable is missing.');
}

router.post('/', async (req, res) => {
  try {
    const { accessToken } = req.body;

    // Validate input
    if (!accessToken) {
      return res.status(400).json({ error: 'Missing access token' });
    }

    // Verify the Facebook token
    const fbResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );

    if (!fbResponse.ok) {
      console.error('[ERROR] Invalid Facebook token.');
      return res.status(401).json({ error: 'Invalid Facebook token' });
    }

    const fbData = await fbResponse.json();
    console.log('[DEBUG] Facebook data fetched:', fbData);

    // Retrieve or create the user in Supabase
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', fbData.id)
      .single();
    console.log('[DEBUG] User fetched from Supabase:', user); // Add this log
if (userError) {
  console.error('[ERROR] Fetching user failed:', userError);
  return res.status(500).json({ error: 'Error fetching user from Supabase.' });
}

    if (userError && userError.code === 'PGRST116') {
      console.log('[DEBUG] User not found. Creating new user.');
      const { data: newUser, error: createUserError } = await supabase
        .from('users')
        .insert({
          fb_id: fbData.id,
          name: fbData.name,
          email: fbData.email,
        })
        .select('*')
        .single();
      console.log('[DEBUG] Newly created user in Supabase:', newUser); 



      if (createUserError) {
        console.error('[ERROR] Failed to create user:', createUserError.message);
        return res.status(500).json({ error: 'Failed to create user.' });
      }
      user = newUser;
    } else if (userError) {
      console.error('[ERROR] Error fetching user:', userError.message);
      return res.status(500).json({ error: 'Error fetching user.' });
    }

    const ownerId = user.id;

    // Retrieve or create the business for the user
    let { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', ownerId)
      .single();

    if (businessError && businessError.code === 'PGRST116') {
      console.log('[DEBUG] Business not found. Creating new business.');
      const { data: newBusiness, error: createBusinessError } = await supabase
        .from('businesses')
        .insert({
          user_id: ownerId,
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



        // Check user.id exists
if (!user?.id) {
  console.error('[ERROR] User ID is undefined before setting cookie.');
  return res.status(500).json({ error: 'Failed to retrieve user ID.' });
}

    
    // Set cookies for authentication
    res.cookie('authToken', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      domain: '.mila-verse.vercel.app',
      maxAge: 3600000, // 1 hour
    });



    console.log('[DEBUG] User ID before setting cookie:', user?.id);
    res.cookie('userId', user?.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      domain: '.mila-verse.vercel.app',
      maxAge: 3600000, // 1 hour
    });

    console.log('[DEBUG] Cookies Set:', {
      authToken: accessToken,
      userId: user.id,
    });

    // Send a single response
    return res.status(200).json({
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
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
