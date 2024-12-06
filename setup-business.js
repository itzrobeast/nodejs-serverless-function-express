import express from 'express';
import jwt from 'jsonwebtoken'; // Add this
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';

const router = express.Router();

// Function to generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name }, // Payload
    process.env.MILA_SECRET, // Secret key from environment variables
    { expiresIn: '1h' } // Token expires in 1 hour
  );
};

// POST Handler for /setup-business
router.post('/', async (req, res) => {
  try {
    console.log('[DEBUG] Is fetchInstagramId defined?', typeof fetchInstagramId); // Debug

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

    console.log('[DEBUG] POST /setup-business hit:', req.body);


    // Validate required fields
    if (!appId || !businessName || !user?.id || !contactEmail) {
      console.error('[ERROR] Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        requiredFields: ['appId', 'businessName', 'user.id', 'contactEmail'],
        receivedData: req.body,
      });
    }

    // Validate appId
    if (appId !== 'milaVerse') {
      console.error('[ERROR] Invalid appId:', appId);
      return res.status(400).json({ error: 'Unknown application', appId });
    }

    // Fetch Instagram User ID (ig_id)
    const igId = await fetchInstagramId(user.id, accessToken); // Ensure function is properly defined here
    console.log('[DEBUG] Instagram ID fetched:', igId);
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
});

    // Step 1: Check or Insert User
    let { data: existingUser, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('fb_id', user.id)
      .single();

    if (userFetchError && userFetchError.code !== 'PGRST116') {
      console.error('[ERROR] Failed to fetch existing user:', userFetchError.message);
      throw new Error('Database error while fetching user');
    }

    if (existingUser) {
      console.log('[INFO] User already exists. Updating user details...');
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name: user.name,
          email: user.email,
          ig_id: igId,
        })
        .eq('id', existingUser.id);

      if (updateError) {
        console.error('[ERROR] Failed to update user:', updateError.message);
        throw new Error('Failed to update user');
      }
    } else {
      console.log('[INFO] User does not exist. Creating new user...');
      const { error: insertError } = await supabase
        .from('users')
        .insert([
          {
            fb_id: user.id,
            ig_id: igId,
            name: user.name,
            email: user.email,
          },
        ]);

      if (insertError) {
        console.error('[ERROR] Failed to insert new user:', insertError.message);
        throw new Error('Failed to insert new user');
      }
    }

    // Step 2: Check or Insert Business
    const { data: existingBusiness, error: businessFetchError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    let businessData;

    if (existingBusiness) {
      console.log('[INFO] Business already exists. Updating business details...');
      const updateFields = {
        name: businessName || existingBusiness.name,
        contact_email: contactEmail || existingBusiness.contact_email,
        locations: locations !== undefined ? locations : existingBusiness.locations,
        insurance_policies: insurancePolicies !== undefined ? insurancePolicies : existingBusiness.insurance_policies,
        objections: objections !== undefined ? objections : existingBusiness.objections,
        ai_knowledge_base: aiKnowledgeBase || existingBusiness.ai_knowledge_base,
        page_id: pageId || existingBusiness.page_id,
        platform: getPlatform(req),
      };

      const { error: updateError } = await supabase
        .from('businesses')
        .update(updateFields)
        .eq('id', existingBusiness.id);

      if (updateError) {
        console.error('[ERROR] Failed to update business:', updateError.message);
        throw new Error('Failed to update business');
      }

      businessData = { ...existingBusiness, ...updateFields };
    } else {
      console.log('[INFO] Business does not exist. Creating new business...');
      const { data: newBusiness, error: insertError } = await supabase
        .from('businesses')
        .insert([
          {
            name: businessName,
            owner_id: user.id,
            page_id: pageId || null,
            access_token: accessToken || null,
            contact_email: contactEmail,
            locations: locations || [],
            insurance_policies: insurancePolicies || {},
            objections: objections || {},
            ai_knowledge_base: aiKnowledgeBase,
            platform: getPlatform(req),
          },
        ])
        .single();

      if (insertError) {
        console.error('[ERROR] Failed to insert new business:', insertError.message);
        throw new Error('Failed to insert new business');
      }

      businessData = newBusiness;
    }

    // Step 3: Generate JWT and Return Response
    const token = generateToken(user);

    res.status(200).json({
      message: 'Business setup successful',
      business: businessData,
      token, // Include the generated token in the response
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
});

export default router;
