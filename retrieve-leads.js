// retrieve-leads.js

import Joi from 'joi';
import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js'; // Ensure supabaseClient.js is correctly configured

const router = express.Router();

/**
 * Define the Joi schema for a lead
 */
const leadSchema = Joi.object({
  lead_id: Joi.string().required(),
  created_time: Joi.date().required(),
  business_id: Joi.number().required(),
  field_data: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      values: Joi.array().items(Joi.string()).required(),
    })
  ).required(),
  name: Joi.string().optional().allow(null, ''),
  phone: Joi.string().optional().allow(null, ''),
  email: Joi.string().email().optional().allow(null, ''),
  city: Joi.string().optional().allow(null, ''),
  status: Joi.string().optional().allow(null, ''),
  // Add other fields as necessary
});

/**
 * Mapping of desired field keys to actual field names in field_data
 * Ensure this mapping includes all possible variations used in your Facebook Leadgen forms
 */
const FIELD_NAME_MAPPING = {
  name: ['name', 'full name', 'fullname', 'contact name', 'contactfullname', 'contactfullname'],
  phone: ['phone', 'phone number', 'telephone', 'contact number', 'contactphone'],
  email: ['email', 'email address', 'contact email'],
  city: ['city', 'town', 'location'],
  status: ['status', 'lead status', 'lead_status'],
};

/**
 * Helper function to sanitize field_data
 * Ensures that each field has a 'name' and 'values' as an array
 * @param {Array} fieldData - Array of field data objects
 * @returns {Array} Sanitized field data
 */
const sanitizeFieldData = (fieldData) => {
  return fieldData.map((field) => ({
    name: field.name ? field.name.trim().toLowerCase() : 'unnamed field',
    values: Array.isArray(field.values)
      ? field.values.map(value => value.trim())
      : [field.values ? field.values.trim() : 'no value'],
  }));
};

/**
 * Helper function to extract specific fields from field_data based on mappings
 * @param {Array} fieldData - Array of field data objects
 * @param {string} fieldKey - The key of the field to extract (e.g., 'name', 'phone')
 * @returns {string|null} - The extracted field value or null if not found
 */
const getFieldValue = (fieldData, fieldKey) => {
  const possibleNames = FIELD_NAME_MAPPING[fieldKey.toLowerCase()] || [fieldKey.toLowerCase()];
  const field = fieldData.find(item => possibleNames.includes(item.name.toLowerCase()));

  if (field && Array.isArray(field.values)) {
    const joinedValues = field.values.join(', ');
    console.log(`[DEBUG] Extracted ${fieldKey}: ${joinedValues}`);
    return joinedValues;
  }

  console.log(`[DEBUG] ${fieldKey} not found in field_data. Possible names: ${possibleNames.join(', ')}`);
  return null;
};

/**
 * Helper function to fetch leadgen forms from Facebook Graph API
 * @param {string} pageId - Facebook Page ID
 * @param {string} pageAccessToken - Page-specific access token
 * @returns {Array} Array of leadgen forms
 */
const fetchLeadForms = async (pageId, pageAccessToken) => {
  const url = `https://graph.facebook.com/v14.0/${pageId}/leadgen_forms?access_token=${pageAccessToken}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leadgen forms: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  return data.data || [];
};

/**
 * Helper function to fetch leads for a specific leadgen form
 * @param {string} formId - Leadgen Form ID
 * @param {string} pageAccessToken - Page-specific access token
 * @returns {Array} Array of leads
 */
const fetchLeadsForForm = async (formId, pageAccessToken) => {
  const url = `https://graph.facebook.com/v14.0/${formId}/leads?access_token=${pageAccessToken}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch leads for form ${formId}: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  console.log(`[DEBUG] Fetched ${data.data.length} leads for form ${formId}`);
  return data.data || [];
};

/**
 * Helper function to fetch all leads for a page by fetching all active forms and their leads
 * @param {string} pageId - Facebook Page ID
 * @param {string} pageAccessToken - Page-specific access token
 * @returns {Array} Array of all leads
 */
const fetchAllLeadsForPage = async (pageId, pageAccessToken) => {
  try {
    const forms = await fetchLeadForms(pageId, pageAccessToken);
    const allLeads = [];

    for (const form of forms) {
      if (form.status === 'ACTIVE') {
        console.log(`[DEBUG] Fetching leads for form: ${form.name} (ID: ${form.id})`);
        try {
          const leads = await fetchLeadsForForm(form.id, pageAccessToken);
          // Filter out leads without valid field_data
          const validLeads = leads.filter(lead => Array.isArray(lead.field_data));
          if (validLeads.length !== leads.length) {
            console.warn(`[WARN] ${leads.length - validLeads.length} leads from form ${form.id} have invalid field_data and were skipped.`);
          }
          allLeads.push(...validLeads);
        } catch (formError) {
          console.error(`[ERROR] Error fetching leads for form ${form.id}: ${formError.message}`);
          // Continue with other forms
        }
      }
    }

    return allLeads;
  } catch (error) {
    console.error(`[ERROR] Failed to fetch all leads for page ${pageId}: ${error.message}`);
    throw error;
  }
};

/**
 * Optional: Validate the page access token using Facebook's debug_token endpoint
 * @param {string} pageAccessToken - Page access token to validate
 * @returns {boolean} Whether the token is valid
 */
const validatePageToken = async (pageAccessToken) => {
  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      console.warn('[WARN] Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET for token validation.');
      return true; // Skip validation if missing
    }

    const response = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${pageAccessToken}&access_token=${appId}|${appSecret}`
    );
    const data = await response.json();
    console.log('[DEBUG] Page Token Validation Response:', data);

    if (data.data && data.data.is_valid) {
      return true;
    } else {
      console.error('[ERROR] Page token is invalid or expired:', data);
      return false;
    }
  } catch (error) {
    console.error(`[ERROR] Failed to validate page token: ${error.message}`);
    return false;
  }
};

/**
 * Helper function to store leads in Supabase
 * @param {Array} leads - Array of lead objects
 * @param {string} businessId - Business ID to associate the leads with
 * @returns {void}
 */
const storeLeadsInSupabase = async (leads, businessId) => {
  try {
    if (!leads.length) {
      console.log('[INFO] No leads to process.');
      return;
    }

    // Prepare leads for insertion
    const formattedLeads = leads.map((lead) => {
      const sanitizedFieldData = sanitizeFieldData(lead.field_data);

      return {
        lead_id: lead.id,
        created_time: new Date(lead.created_time), // Ensure proper date format
        business_id: businessId,
        field_data: sanitizedFieldData, // Store as JSON object
        name: getFieldValue(sanitizedFieldData, 'name'),
        phone: getFieldValue(sanitizedFieldData, 'phone'),
        email: getFieldValue(sanitizedFieldData, 'email'),
        city: getFieldValue(sanitizedFieldData, 'city'),
        status: getFieldValue(sanitizedFieldData, 'status'),
        // Add other fields as necessary
      };
    });

    // Validate each lead against the schema
    const validatedLeads = [];
    const invalidLeads = [];

    formattedLeads.forEach((lead) => {
      const { error, value } = leadSchema.validate(lead, { abortEarly: false });

      if (error) {
        console.error(`[ERROR] Validation failed for lead ID ${lead.lead_id}:`, error.details);
        invalidLeads.push({ lead, errors: error.details });
      } else {
        validatedLeads.push(value);
      }
    });

    // Handle invalid leads (e.g., log, notify, etc.)
    if (invalidLeads.length > 0) {
      console.warn(`[WARN] ${invalidLeads.length} leads failed validation and will not be inserted.`);
      // Optionally, insert invalid leads into a separate table for review
      const invalidFormattedLeads = invalidLeads.map(({ lead, errors }) => ({
        lead_id: lead.lead_id,
        business_id: lead.business_id,
        errors: errors.map(err => err.message).join('; '),
        field_data: lead.field_data,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        status: lead.status,
        created_time: lead.created_time,
        // Include other relevant fields as needed
      }));

      if (invalidFormattedLeads.length > 0) {
        const { error: insertInvalidError } = await supabase
          .from('invalid_leads') // Ensure you have this table created
          .insert(invalidFormattedLeads);

        if (insertInvalidError) {
          console.error(`[ERROR] Failed to insert invalid leads into Supabase: ${insertInvalidError.message}`);
        } else {
          console.log(`[DEBUG] Successfully inserted ${invalidFormattedLeads.length} invalid leads into Supabase.`);
        }
      }
    }

    if (validatedLeads.length === 0) {
      console.warn('[WARN] No valid leads to insert into Supabase.');
      return;
    }

    // Insert validated leads, ignoring duplicates based on lead_id and business_id
    const { error } = await supabase
      .from('leads')
      .upsert(validatedLeads, { onConflict: ['business_id', 'lead_id'] });

    if (error) {
      console.error(`[ERROR] Failed to insert leads into Supabase: ${error.message}`);
    } else {
      console.log(`[DEBUG] Successfully inserted ${validatedLeads.length} leads into Supabase.`);
    }
  } catch (error) {
    console.error(`[ERROR] Exception while storing leads: ${error.message}`);
  }
};

/**
 * GET /retrieve-leads
 * Fetches leads from Facebook using stored page access tokens and stores them in Supabase
 * Requires userId and businessId from cookies
 */
router.get('/', async (req, res) => {
  try {
    const { userId, businessId } = req.cookies;

    console.log('[DEBUG] Parsed Cookies:', { userId, businessId });

    if (!userId || !businessId) {
      console.error('[ERROR] Missing userId or businessId in cookies.');
      return res.status(400).json({ error: 'Missing userId or businessId in cookies.' });
    }

    // 1. Retrieve the page access token and page ID from 'page_access_tokens' table
    const { data: pageRow, error: pageRowError } = await supabase
      .from('page_access_tokens')
      .select('page_id, page_access_token')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .single();

    if (pageRowError || !pageRow) {
      console.error(`[ERROR] Page access token not found for userId: ${userId}, businessId: ${businessId}. Error: ${pageRowError?.message}`);
      return res.status(404).json({ error: 'Page access token not found.' });
    }

    const { page_id: pageId, page_access_token: pageAccessToken } = pageRow;
    console.log('[DEBUG] Retrieved Page Token:', { pageId, pageAccessToken });

    // 2. (Optional) Validate the page access token
    const isValid = await validatePageToken(pageAccessToken);
    if (!isValid) {
      console.error('[ERROR] Invalid or expired page access token.');
      return res.status(403).json({ error: 'Invalid or expired page access token.' });
    }

    // 3. Fetch all leads for the page
    const leads = await fetchAllLeadsForPage(pageId, pageAccessToken);
    console.log(`[DEBUG] Retrieved ${leads.length} leads for businessId: ${businessId}`);

    // 4. Store leads in Supabase
    await storeLeadsInSupabase(leads, businessId);

    // 5. Fetch and return the leads to frontend
    const { data: insertedLeads, error: insertError } = await supabase
      .from('leads')
      .select('*')
      .eq('business_id', businessId)
      .order('created_time', { ascending: false });

    if (insertError) {
      console.error(`[ERROR] Failed to fetch inserted leads for businessId: ${businessId}: ${insertError.message}`);
      return res.status(500).json({ error: 'Failed to fetch leads after insertion.' });
    }

    return res.status(200).json({ leads: insertedLeads });
  } catch (error) {
    console.error(`[ERROR] Failed to retrieve leads: ${error.message}`);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
