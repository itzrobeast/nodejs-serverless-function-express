import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const {
      appId,
      user,
      accessToken,
      businessName,
      contactEmail,
      locations,
      insurancePolicies,
      objections,
      aiKnowledgeBase = '',
      pageId,
    } = req.body;

    console.log('[DEBUG] POST /setup-business payload:', req.body);

    if (!appId || !businessName || !user?.id || !contactEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['appId', 'businessName', 'user.id', 'contactEmail'],
      });
    }

    if (appId !== 'milaVerse') {
      return res.status(400).json({ error: 'Unknown application', appId });
    }

    const igId = await fetchInstagramId(user.id, accessToken);

    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw new Error('Database error while fetching user');
    }

    if (existingUser) {
      const { error: updateError } = await supabase
        .from('users')
        .update({ name: user.name, email: user.email, ig_id: igId })
        .eq('id', existingUser.id);

      if (updateError) throw new Error('Failed to update user');
    } else {
      const { error: insertError } = await supabase
        .from('users')
        .insert([{ fb_id: user.id, ig_id: igId, name: user.name, email: user.email }]);

      if (insertError) throw new Error('Failed to insert user');
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.MILA_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ message: 'Business setup successful', token });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
