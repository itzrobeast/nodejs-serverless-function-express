import express from 'express';
import supabase from '../supabaseClient.js';
import fetch from 'node-fetch';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    // 1. Validate Access Token
    const schema = Joi.object({ accessToken: Joi.string().required() });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { accessToken } = value;

    // 2. Fetch FB User Data
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');

    const fbUser = await fbResponse.json();
    const { id: fb_id, name, email } = fbUser;

    // 3. Fetch Facebook Pages
    const pagesData = await fetchPages(accessToken);
    if (!pagesData || pagesData.length === 0) throw new Error('No Facebook Pages Found');

    // 4. Insert or Update User
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert([{ fb_id, name, email, ig_id: fb_id }], { onConflict: 'fb_id' })
      .select('*')
      .single();

    if (userError) throw userError;

    // 5. Insert or Update Pages
    await Promise.all(pagesData.map(page =>
      supabase.from('pages').upsert({
        id: page.id,
        name: page.name,
        access_token: page.access_token,
      }, { onConflict: 'id' })
    ));

    // 6. Insert or Update Business
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert([{ user_id: user.id, name: `${name}'s Business`, page_id: pagesData[0].id }], { onConflict: 'user_id' })
      .select('*')
      .single();

    if (businessError) throw businessError;

    // 7. Set Cookies
    res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
    res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

    return res.status(200).json({
      message: 'Login successful',
      user,
      business,
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// Fetch Facebook Pages
const fetchPages = async (accessToken) => {
  let pages = [];
  let nextUrl = `https://graph.facebook.com/me/accounts?access_token=${accessToken}`;

  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) throw new Error('Failed to fetch pages');

    const data = await response.json();
    pages = pages.concat(data.data);
    nextUrl = data.paging?.next || null;
  }

  return pages;
};

export default router;
