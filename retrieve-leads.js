import Joi from 'joi';
import fetch from 'node-fetch';
import express from 'express';
import supabase from './supabaseClient.js';
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN, // Ensure this is set
  tracesSampleRate: 1.0,
});

const router = express.Router();

/**
 * Define the Joi schema for a lead
 */
const leadSchema = Joi.object({
  lead_id: Joi.string().required(),
  created_time: Joi.date().required(),
  business_id: Joi.number().required(),
  field_data: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        values: Joi.array().items(Joi.string()).required(),
      })
    )
    .required(),
  name: Joi.string().optional().allow(null, ''),
  phone: Joi.string().optional().allow(null, ''),
  email: Joi.string().email().optional().allow(null, ''),
  city: Joi.string().optional().allow(null, ''),
  status: Joi.string().optional().allow(null, ''),
  // Add other fields as necessary
});

/**
 * Mapping of desired field keys to actual field names in field_data
 */
const FIELD_NAME_MAPPING = {
  name: [
    'name',
    'full name',
    'fullname',
    'contact name',
    'contactfullname',
    'contact_fullname',
    'fullName',
    'FullName',
    'Full Name',
    'full_name',
  ],
  phone: [
    'phone',
    'phone number',
    'telephone',
    'contact number',
    'contactphone',
    'phonenumber',
    'mobile number',
    'phone_number',
    'user_provided_phone_number',
  ],
  email: ['email', 'email address', 'contact email', 'EmailAddress', 'Email Address'],
  city: ['city', 'town', 'location', 'City', 'Town', 'Location'],
  status: ['status', 'lead status', 'lead_status', 'Status', 'Lead Status', 'Lead_Status'],
};

/**
 * Sanitize field_data to ensure consistent structure
 */
const sanitizeFieldData = (fieldData) => {
  return fieldData.map((field) => ({
    name: field.name ? field.name.trim().toLowerCase() : 'unnamed_field',
    values: Array.isArray(field.values)
      ? field.values.map((value) => value.trim())
      : [field.values ? field.values.trim() : 'no_value'],
  }));
};

/**
 * Extract a specific field from field_data using FIELD_NAME_MAPPING
 */
const getFieldValue = (fieldData, fieldKey) => {
  const possibleNames = FIELD_NAME_MAPPING[fieldKey.toLowerCase()] || [fieldKey.toLowerCase()];

  // Find matching fields
  const matchingFields = fieldData.filter((item) =>
    possibleNames.includes(item.name.trim().toLowerCase())
  );

  if (matchingFields.length > 0) {
    const allValues = matchingFields.flatMap((field) =>
      Array.isArray(field.values) ? field.values.map((val) => val.trim()) : []
    );
    const uniqueValues = [...new Set(allValues)];
    const combinedValues = uniqueValues.join(', ');

    console.log(`[DEBUG] Extracted ${fieldKey}: ${combinedValues}`);
    return combinedValues;
  }

  console.log(`[DEBUG] ${fieldKey} not found in field_data. Possible names: ${possibleNames.join(', ')}`);
  console.log(`[DEBUG] Current field_data: ${JSON.stringify(fieldData, null, 2)}`);
  return null;
};

/**
 * Fetch leadgen forms from FB
 */
const fetchLeadForms = async (pageId, pageAccessToken) => {
  let allForms = [];
  let nextPageUrl = `https://graph.facebook.com/v14.0/${pageId}/leadgen_forms?access_token=${pageAccessToken}&limit=100`;

  while (nextPageUrl) {
    const response = await fetch(nextPageUrl);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch leadgen forms: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    allForms.push(...(data.data || []));
    nextPageUrl = data.paging?.next || null;
  }

  console.log(`[DEBUG] Total fetched forms: ${allForms.length}`);
  return allForms;
};

/**
 * Fetch leads for a specific form
 */
const fetchLeadsForForm = async (formId, pageAccessToken) => {
  let allLeads = [];
  let nextPageUrl = `https://graph.facebook.com/v14.0/${formId}/leads?access_token=${pageAccessToken}&limit=100`;

  while (nextPageUrl) {
    const response = await fetch(nextPageUrl);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch leads for form ${formId}: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    allLeads.push(...(data.data || []));
    nextPageUrl = data.paging?.next || null;
  }

  console.log(`[DEBUG] Total fetched leads for form ${formId}: ${allLeads.length}`);
  return allLeads;
};

/**
 * Fetch all leads for a page by scanning each active form
 */
const fetchAllLeadsForPage = async (pageId, pageAccessToken) => {
  const forms = await fetchLeadForms(pageId, pageAccessToken);
  const allLeads = [];

  for (const form of forms) {
    console.log(`[DEBUG] Fetching leads for form: ${form.name} (ID: ${form.id})`);
    try {
      const leads = await fetchLeadsForForm(form.id, pageAccessToken);
      const validLeads = leads.filter((lead) => Array.isArray(lead.field_data));
      if (validLeads.length !== leads.length) {
        console.warn(
          `[WARN] ${leads.length - validLeads.length} leads from form ${form.id} have invalid field_data and were skipped.`
        );
      }
      allLeads.push(...validLeads);
    } catch (formError) {
      console.error(`[ERROR] Error fetching leads for form ${form.id}: ${formError.message}`);
      // continue
    }
  }

  return allLeads;
};

/**
 * Optional: Validate the page token with Facebook
 */
const validatePageToken = async (pageAccessToken) => {
  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      console.warn('[WARN] Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET, skipping token validation.');
      return true;
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
 * Store leads in Supabase
 */
const storeLeadsInSupabase = async (leads, businessId) => {
  try {
    if (!leads.length) {
      console.log('[INFO] No leads to process.');
      return;
    }

    const formattedLeads = leads.map((lead) => {
      const sanitizedFieldData = sanitizeFieldData(lead.field_data);

      return {
        lead_id: lead.id,
        created_time: new Date(lead.created_time),
        business_id: Number(businessId),
        field_data: sanitizedFieldData,
        name: getFieldValue(sanitizedFieldData, 'name'),
        phone: getFieldValue(sanitizedFieldData, 'phone'),
        email: getFieldValue(sanitizedFieldData, 'email'),
        city: getFieldValue(sanitizedFieldData, 'city'),
        status: getFieldValue(sanitizedFieldData, 'status'),
      };
    });

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

    if (invalidLeads.length > 0) {
      console.warn(`[WARN] ${invalidLeads.length} leads failed validation and will not be inserted.`);

      const invalidFormattedLeads = invalidLeads.map(({ lead, errors }) => ({
        lead_id: lead.lead_id,
        business_id: lead.business_id,
        errors: errors.map((err) => err.message).join('; '),
        field_data: lead.field_data,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        status: lead.status,
        created_time: lead.created_time,
      }));

      if (invalidFormattedLeads.length > 0) {
        const { error: insertInvalidError } = await supabase
          .from('invalid_leads')
          .insert(invalidFormattedLeads);

        if (insertInvalidError) {
          console.error(
            `[ERROR] Failed to insert invalid leads into Supabase: ${insertInvalidError.message}`
          );
        } else {
          console.log(
            `[DEBUG] Successfully inserted ${invalidFormattedLeads.length} invalid leads into Supabase.`
          );
        }
      }
    }

    if (validatedLeads.length === 0) {
      console.warn('[WARN] No valid leads to insert into Supabase.');
      return;
    }

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
    Sentry.captureException(error);
  }
};

/**
 * GET /retrieve-leads
 *
 * Expects:
 *   - businessOwnerId, businessId from query (or use your own approach)
 * e.g. GET /retrieve-leads?businessOwnerId=123&businessId=456
 */
router.get('/', Sentry.Handlers.requestHandler(), async (req, res) => {
  try {
    // 1) Retrieve businessOwnerId, businessId from query (instead of cookies)
    const { businessOwnerId, businessId } = req.query;

    console.log('[DEBUG] Query params:', { businessOwnerId, businessId });

    if (!businessOwnerId || !businessId) {
      console.error('[ERROR] Missing businessOwnerId or businessId in query.');
      return res
        .status(400)
        .json({ error: 'Missing businessOwnerId or businessId in query parameters.' });
    }

    // 2) Retrieve the page access token from your database
    //    Adjust these table/column names to match your schema
    const { data: pageRow, error: pageRowError } = await supabase
      .from('page_access_tokens')
      .select('page_id, page_access_token')
      .eq('business_owner_id', businessOwnerId)
      .eq('business_id', businessId)
      .single();

    if (pageRowError || !pageRow) {
      console.error(
        `[ERROR] Page access token not found for businessOwnerId: ${businessOwnerId}, businessId: ${businessId}.`
      );
      return res.status(404).json({ error: 'Page access token not found.' });
    }

    const { page_id: pageId, page_access_token: pageAccessToken } = pageRow;
    console.log('[DEBUG] Retrieved Page Token:', { pageId, pageAccessToken: '******' });

    // 3) (Optional) Validate the page token
    const isValid = await validatePageToken(pageAccessToken);
    if (!isValid) {
      console.error('[ERROR] Invalid or expired page access token.');
      return res.status(403).json({ error: 'Invalid or expired page access token.' });
    }

    // 4) Fetch leads from Facebook
    const leads = await fetchAllLeadsForPage(pageId, pageAccessToken);
    console.log(`[DEBUG] Retrieved ${leads.length} leads for businessId: ${businessId}`);

    // 5) Store leads in Supabase
    await storeLeadsInSupabase(leads, businessId);

    // 6) Fetch and return leads from the database
    const { data: insertedLeads, error: insertError } = await supabase
      .from('leads')
      .select('*')
      .eq('business_id', businessId)
      .order('created_time', { ascending: false });

    if (insertError) {
      console.error(
        `[ERROR] Failed to fetch inserted leads for businessId: ${businessId}: ${insertError.message}`
      );
      return res.status(500).json({ error: 'Failed to fetch leads after insertion.' });
    }

    return res.status(200).json({ leads: insertedLeads });
  } catch (error) {
    console.error(`[ERROR] Failed to retrieve leads: ${error.message}`);
    Sentry.captureException(error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.use(Sentry.Handlers.errorHandler());

export default router;
