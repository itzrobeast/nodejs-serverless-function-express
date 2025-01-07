import express from 'express';
import supabase from './supabaseClient.js';
import fetch from 'node-fetch';
import { fetchInstagramIdFromFacebook } from './helpers.js';

const router = express.Router();

/**
 * Helper: Subscribe a page to the webhook
 */
async function subscribePageToWebhook(pageId, pageAccessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v15.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: pageAccessToken }),
    });

    const data = await response.json();
    if (data.error) {
      console.error(`[ERROR] Failed to subscribe page ${pageId}:`, data.error.message);
      return false;
    }

    console.log(`[INFO] Page ${pageId} successfully subscribed to webhook.`);
    return true;
  } catch (error) {
    console.error('[ERROR] Subscription to webhook failed:', error.message);
    return false;
  }
}

/**
 * POST /setup-business
 * Creates or updates the user and business based on Facebook Auth data.
 */
router.post('/', async (req, res) => {
  try {
    const {
      appId,
      user, // Facebook User Info
      accessToken, // Facebook User Access Token
      businessName,
      contactEmail,
      locations = [],
      insurancePolicies = [],
      objections = [],
      aiKnowledgeBase = '',
    } = req.body;

    console.log('[DEBUG] /setup-business route hit with payload:', req.body);

    // Validate Application ID
    if (appId !== 'milaVerse') {
      return res.status(400).json({ error: 'Invalid application' });
    }

    // Step 1: Upsert User in Supabase
    const { data: owner, error: userError } = await supabase
      .from('business_owners')
      .upsert({ fb_id: user.id, name: user.name, email: contactEmail }, { onConflict: 'fb_id' })
      .select()
      .single();

    if (userError) {
      throw new Error(`Failed to upsert user: ${userError.message}`);
    }

    console.log('[INFO] User upserted successfully:', owner);

    // Step 2: Fetch or Create Business
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .upsert(
        {
          business_owner_id: owner.id,
          name: businessName || `${user.name}'s Business`,
          contact_email: contactEmail,
          locations,
          insurance_policies: insurancePolicies,
          objections,
          ai_knowledge_base: aiKnowledgeBase,
        },
        { onConflict: 'business_owner_id' }
      )
      .select()
      .single();

    if (businessError) {
      throw new Error(`Failed to upsert business: ${businessError.message}`);
    }

    console.log('[INFO] Business upserted successfully:', business);

    // Step 3: Fetch Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${accessToken}`
    );

    if (!pagesResponse.ok) {
      throw new Error('Failed to fetch Facebook Pages');
    }

    const pagesData = await pagesResponse.json();

    // Step 4: Process Each Page
    for (const page of pagesData.data) {
      const { id: pageId, access_token: pageAccessToken, name: pageName } = page;

      // Fetch Instagram Business Account ID
      const igId = await fetchInstagramIdFromFacebook(pageId, pageAccessToken);

      if (!igId) {
        console.warn('[WARN] No Instagram Business ID found for page:', pageId);
      }

      // Upsert Page in the Pages Table
      const { data: existingPage, error: pageFetchError } = await supabase
        .from('pages')
        .select('id')
        .eq('page_id', pageId)
        .single();

      if (pageFetchError && pageFetchError.code !== 'PGRST116') {
        throw new Error(
          `Error checking existing page with page_id ${pageId}: ${pageFetchError.message}`
        );
      }

      if (existingPage) {
        // Update existing page
        const { error: pageUpdateError } = await supabase
          .from('pages')
          .update({
            name: pageName,
            page_access_token: pageAccessToken,
            business_id: business.id, // Link to the current business
          })
          .eq('id', existingPage.id);

        if (pageUpdateError) {
          throw new Error(
            `Page update failed for page_id ${pageId}: ${pageUpdateError.message}`
          );
        }

        console.log(
          `[INFO] Page updated successfully for page_id ${pageId}, linked to business_id ${business.id}`
        );
      } else {
        // Insert a new page
        const { data: newPage, error: pageInsertError } = await supabase
          .from('pages')
          .insert({
            page_id: pageId,
            name: pageName,
            page_access_token: pageAccessToken,
            business_id: business.id, // Link to the current business
          })
          .select()
          .single();

        if (pageInsertError) {
          throw new Error(
            `Page insert failed for page_id ${pageId}: ${pageInsertError.message}`
          );
        }

        console.log(
          `[INFO] Page inserted successfully with page_id ${pageId}, linked to business_id ${business.id}`
        );
      }
    }

    // Final Response
    res.status(200).json({
      message: 'Business setup successful',
      businessId: business.id,
      businessOwnerId: owner.id,
    });
  } catch (error) {
    console.error('[ERROR] /setup-business:', error.message);
    res.status(500).json({ error: error.message });
  }
});


export default router;
