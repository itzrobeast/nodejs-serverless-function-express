/***************************/
/** assistant.js (Final)  **/
/***************************/

import OpenAI from 'openai';
import axios from 'axios';
import supabase from './supabaseClient.js';

/**
 * Initialize the OpenAI client.
 * Make sure your environment has OPENAI_API_KEY set.
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * ----------------------------------------------------------------------------
 * 1) Fetch Business Configuration
 * ----------------------------------------------------------------------------
 * This only fetches the core "business" fields that you want the AI to know:
 * - name, locations, insurance policies, knowledge base, etc.
 *
 * NOTE: We no longer fetch setmore_access_token from 'businesses'
 * because it's now stored in 'setmore_integrations'.
 */
const getBusinessConfig = async (businessId) => {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select(`
        name,
        locations,
        insurance_policies,
        objections,
        ai_knowledge_base,
        contact_email,
        financing_link,
        appointment_booking_link,
        custom_links
      `)
      .eq('id', businessId)
      .single();

    if (error) {
      console.error('[ERROR] Fetching business configuration failed:', error.message);
      return null;
    }

    if (!data) {
      console.warn('[WARN] No data returned for businessId:', businessId);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[ERROR] Unexpected error fetching business config:', err.message);
    return null;
  }
};

/**
 * ----------------------------------------------------------------------------
 * 2) System Prompt Creation
 * ----------------------------------------------------------------------------
 * Dynamically creates a robust system prompt that includes business-specific info.
 */
const createSystemMessage = (businessConfig) => {
  const {
    name,
    locations,
    insurance_policies,
    objections,
    ai_knowledge_base,
    contact_email,
    financing_link,
    appointment_booking_link,
    custom_links,
  } = businessConfig;

  // Convert JSON fields to readable strings where needed
  const locationsStr = locations ? JSON.stringify(locations) : 'Not provided';
  const customLinksStr = custom_links ? JSON.stringify(custom_links) : 'Not provided';

  return `
You are an AI receptionist for "${name}". Your role is to:
1. Assist customers with professionalism, empathy, and accuracy.
2. Provide business-specific details like hours, location, links, and policies.
3. Help with appointment scheduling (via Setmore).
4. Always remain polite, concise, and correct.

Business-specific details:
- Locations: ${locationsStr}
- Insurance Policies: ${insurance_policies || 'Not provided'}
- Common Objections: ${objections || 'Not provided'}
- Contact Email: ${contact_email || 'Not provided'}
- Financing Link: ${financing_link || 'Not provided'}
- Appointment Booking Link: ${appointment_booking_link || 'Not provided'}
- Custom Links: ${customLinksStr}
- AI Knowledge Base: ${ai_knowledge_base || 'Not provided'}

When unsure of an answer, politely acknowledge and suggest following up via email or phone.
Keep responses concise and relevant to user queries.
`;
};

/**
 * ----------------------------------------------------------------------------
 * 3) Setmore Token Management
 * ----------------------------------------------------------------------------
 * We'll store and retrieve tokens from the 'setmore_integrations' table.
 * This example shows a basic "check + refresh if expired" approach.
 */

/**
 * Refresh the Setmore access token using the refresh token,
 * then update setmore_integrations with the new token and expiration.
 */
const refreshSetmoreToken = async (businessId) => {
  try {
    // 1. Fetch refresh token from setmore_integrations
    const { data, error } = await supabase
      .from('setmore_integrations')
      .select('id, refresh_token')
      .eq('business_id', businessId)
      .single();

    if (error || !data?.refresh_token) {
      console.error('[ERROR] Missing Setmore refresh token or supabase error:', error?.message);
      return null;
    }

    const { id: integrationId, refresh_token } = data;

    // 2. Make the refresh request to Setmore
    //    This is the example endpoint from the Setmore docs. 
    //    Adjust to your environment if necessary.
    const url = `https://developer.setmore.com/api/v1/o/oauth2/token?refreshToken=${refresh_token}`;
    const response = await axios.get(url);

    if (!response.data?.response || !response.data?.data?.token) {
      console.error('[ERROR] Unexpected response from Setmore refresh:', response.data);
      return null;
    }

    const { access_token, expires_in } = response.data.data.token;

    // 3. Calculate new expiration time
    const now = new Date();
    const bufferMs = 60 * 60 * 1000; // 1 hour buffer
    const expirationDate = new Date(now.getTime() + expires_in * 1000 - bufferMs);

    // 4. Update setmore_integrations with the new token
    const { error: updateError } = await supabase
      .from('setmore_integrations')
      .update({
        access_token,
        token_expires_at: expirationDate.toISOString(),
      })
      .match({ id: integrationId });

    if (updateError) {
      console.error('[ERROR] Updating new token in DB failed:', updateError.message);
      return null;
    }

    console.log('[INFO] Successfully refreshed Setmore token for businessId:', businessId);
    return access_token;
  } catch (err) {
    console.error('[ERROR] refreshSetmoreToken:', err.message);
    return null;
  }
};

/**
 * Get a valid access token for the given business. This will:
 * 1) Check if the token is expired or near-expired -> refresh if needed
 * 2) Return the valid token
 */
const getSetmoreAccessToken = async (businessId) => {
  try {
    // Pull current token + expiration from setmore_integrations
    const { data, error } = await supabase
      .from('setmore_integrations')
      .select('id, access_token, token_expires_at')
      .eq('business_id', businessId)
      .single();

    if (error || !data) {
      console.error('[ERROR] Could not load setmore integration for business:', businessId, error?.message);
      return null;
    }

    const { access_token, token_expires_at } = data;
    if (!access_token) {
      console.warn('[WARN] No access_token found in setmore_integrations for business:', businessId);
      return null;
    }

    // Check if token is near or past expiration
    if (token_expires_at) {
      const now = new Date();
      const expiresAt = new Date(token_expires_at);
      if (expiresAt < now) {
        // It's expired, so refresh
        console.log('[INFO] Setmore token expired, refreshing now...');
        const newToken = await refreshSetmoreToken(businessId);
        return newToken; // May be null if refresh fails
      }
    }

    // Token is valid, just return it
    return access_token;
  } catch (err) {
    console.error('[ERROR] getSetmoreAccessToken:', err.message);
    return null;
  }
};

/**
 * ----------------------------------------------------------------------------
 * 4) API Wrappers for Setmore
 * ----------------------------------------------------------------------------
 */

/**
 * 4a) Fetch available slots from Setmore (example).
 * Replace endpoint & payload with your actual approach from Setmore docs.
 */
const fetchSetmoreSlotsAPI = async (accessToken) => {
  // Example endpoint - you must adjust to your actual usage
  // e.g. POST to /api/v1/bookingapi/slots with staff_key, service_key, etc.
  try {
    const response = await axios.get('https://api.setmore.com/v1/bookingapi/availability', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.data && response.data.data) {
      return response.data.data;
    }
    console.error('[ERROR] Unexpected data structure from Setmore slots API.');
    return [];
  } catch (err) {
    console.error('[ERROR] Failed to fetch slots from Setmore:', err.message);
    return [];
  }
};

/**
 * 4b) Book an appointment with Setmore (example).
 * Replace endpoint & payload with your actual usage from Setmore docs.
 */
const bookSetmoreAppointmentAPI = async ({
  accessToken,
  serviceId,
  customerName,
  customerContact,
  appointmentDate,
}) => {
  try {
    // Example endpoint - replace with actual Setmore booking endpoint & payload
    const response = await axios.post(
      'https://api.setmore.com/v1/bookingapi/appointments',
      {
        service_id: serviceId,
        customer: {
          name: customerName,
          email: customerContact,
        },
        start_time: appointmentDate,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.data && response.data.data) {
      return 'Your appointment has been successfully booked!';
    } else {
      console.error('[ERROR] Failed booking response from Setmore:', response.data);
      return 'Unable to confirm booking. Please try again later.';
    }
  } catch (err) {
    console.error('[ERROR] Error booking appointment with Setmore:', err.message);
    return 'Something went wrong during booking. Please try again later.';
  }
};

/**
 * 4c) Helper function to fetch available slots for a given business from Setmore.
 * In real usage, you might require staff_key, service_key, etc. from the user.
 */
const fetchAvailableSlots = async (businessId) => {
  try {
    // 1. Get (or refresh) a valid access token
    const accessToken = await getSetmoreAccessToken(businessId);
    if (!accessToken) {
      console.error('[ERROR] Unable to retrieve valid Setmore token.');
      return [];
    }

    // 2. Fetch from the actual Setmore endpoint
    const slots = await fetchSetmoreSlotsAPI(accessToken);
    return slots;
  } catch (err) {
    console.error('[ERROR] fetchAvailableSlots:', err.message);
    return [];
  }
};

/**
 * 4d) Helper function to book an appointment for a given business.
 */
const bookSetmoreAppointment = async ({
  businessId,
  customerName,
  customerContact,
  appointmentDate,
  serviceId,
}) => {
  try {
    // 1. Get (or refresh) a valid token
    const accessToken = await getSetmoreAccessToken(businessId);
    if (!accessToken) {
      console.error('[ERROR] No valid token for booking. businessId=', businessId);
      return 'Unable to process your appointment booking request right now.';
    }

    // 2. Make the Setmore API call
    const resultMessage = await bookSetmoreAppointmentAPI({
      accessToken,
      serviceId,
      customerName,
      customerContact,
      appointmentDate,
    });
    return resultMessage;
  } catch (err) {
    console.error('[ERROR] bookSetmoreAppointment:', err.message);
    return 'Unable to book your appointment at this time. Please try again later.';
  }
};

/**
 * ----------------------------------------------------------------------------
 * 5) Provide Link Function
 * ----------------------------------------------------------------------------
 * This function returns specific links from the business config
 * (e.g., financing, appointment booking, or custom links).
 */
const provideLink = (businessConfig, linkType) => {
  const { financing_link, appointment_booking_link, custom_links } = businessConfig;

  switch (linkType) {
    case 'financing':
      return financing_link || 'No financing link is currently available.';
    case 'appointment':
      return appointment_booking_link || 'No appointment booking link is currently available.';
    default:
      // Check if there's a custom link that matches linkType
      return custom_links?.[linkType] || 'No relevant link found for that request.';
  }
};

/**
 * ----------------------------------------------------------------------------
 * 6) The Main Assistant Handler
 * ----------------------------------------------------------------------------
 * Integrates everything: fetching business config, creating system message,
 * calling OpenAI with function calling, and handling function calls.
 */
export const assistantHandler = async ({ userMessage, businessId }) => {
  try {
    console.log(`[DEBUG] Processing message for business ID: ${businessId}`);
    console.log(`[DEBUG] User message: "${userMessage}"`);

    // Basic validation
    if (!userMessage || typeof userMessage !== 'string') {
      console.error('[ERROR] Invalid user message:', userMessage);
      return { message: 'I couldn’t understand your message. Could you please rephrase it?' };
    }

    // 6a) Fetch business configuration
    const businessConfig = await getBusinessConfig(businessId);
    if (!businessConfig) {
      return { message: 'Unable to retrieve business details. Please try again later.' };
    }

    // 6b) Create the dynamic system message
    const systemMessage = createSystemMessage(businessConfig);

    // 6c) Define all possible functions for function calling
    const functions = [
      {
        name: 'fetch_available_slots',
        description: 'Fetch available appointment slots for the business using Setmore.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'book_appointment',
        description: 'Book an appointment for the customer via Setmore.',
        parameters: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: 'The name of the customer.' },
            customerContact: { type: 'string', description: 'The customer’s contact info (email or phone).' },
            appointmentDate: {
              type: 'string',
              format: 'date-time',
              description: 'Desired appointment date/time (ISO-8601).',
            },
            serviceId: { type: 'string', description: 'The ID of the service to be booked on Setmore.' },
          },
          required: ['customerName', 'customerContact', 'appointmentDate', 'serviceId'],
        },
      },
      {
        name: 'provide_link',
        description: 'Provide a specific link to the customer (e.g., financing, appointment, custom).',
        parameters: {
          type: 'object',
          properties: {
            linkType: {
              type: 'string',
              description:
                'The type of link requested: "financing", "appointment", or a key in custom_links.',
            },
          },
          required: ['linkType'],
        },
      },
    ];

    // 6d) Call OpenAI’s Chat Completion with function calling
    const openaiResponse = await openai.chat.completions.create({
      // For the latest model, you could replace 'gpt-4' with 'openai.o1' or another
      model: 'gpt-3.5-turbo',
      // If you want to leverage the new 'reasoning_effort' param (supported in new models like o1),
      // you can uncomment the following line (and switch model to openai.o1 if supported):
      // reasoning_effort: 2,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      functions,
      function_call: 'auto', // Let the model decide if/when to call a function
      max_tokens: 500,
      temperature: 0.7,
    });

    // 6e) Extract the relevant choice and check if function call is requested
    const choice = openaiResponse.choices?.[0];
    let responseMessage = choice?.message?.content?.trim() || "I'm here to help!";

    if (choice?.message?.function_call) {
      const { name: functionName, arguments: args } = choice.message.function_call;
      // Be sure to parse arguments from JSON
      const parsedArgs = args ? JSON.parse(args) : {};

      switch (functionName) {
        case 'fetch_available_slots': {
          // In a real use-case, you might also require staff_key, service_key, etc.
          // For this example, we'll just fetch some generic "availability."
          const slots = await fetchAvailableSlots(businessId);
          if (slots.length > 0) {
            // Example formatting: listing date/time if that’s how your data looks
            const slotTimes = slots.map((slot) => slot.start_time || 'Unknown time');
            responseMessage = `Here are the available slots: ${slotTimes.join(', ')}`;
          } else {
            responseMessage = 'No slots are currently available.';
          }
          break;
        }

        case 'book_appointment': {
          const { customerName, customerContact, appointmentDate, serviceId } = parsedArgs;
          responseMessage = await bookSetmoreAppointment({
            businessId,
            customerName,
            customerContact,
            appointmentDate,
            serviceId,
          });
          break;
        }

        case 'provide_link': {
          const { linkType } = parsedArgs;
          responseMessage = provideLink(businessConfig, linkType);
          break;
        }

        default:
          console.error(`[WARN] Unknown function call: ${functionName}`);
          responseMessage = "I’m sorry, but I’m not sure how to handle that request.";
      }
    }

    // 6f) Enforce Instagram (or any platform) character limit, e.g., 1000 chars
    const maxLength = 1000;
    if (responseMessage.length > maxLength) {
      responseMessage = `${responseMessage.substring(0, maxLength - 3)}...`;
    }

    console.log(`[DEBUG] Final AI response: "${responseMessage}"`);
    return { message: responseMessage };
  } catch (error) {
    console.error('[ERROR] Failed to process assistant request:', error);
    return { message: 'Something went wrong. Please try again later.' };
  }
};

export default assistantHandler;
