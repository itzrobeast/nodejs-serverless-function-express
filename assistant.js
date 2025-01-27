/**********************************************************/
/** assistant.js -- Master Code with Redis + Setmore + AI **/
/**********************************************************/
import OpenAI from 'openai';
import axios from 'axios';
import supabase from './supabaseClient.js';
import { createClient } from 'redis'; // For Upstash or other cloud Redis

/**********************************************************
 * 0) Redis (Upstash) Setup
 *    - Make sure you have REDIS_URL and REDIS_AUTH in env.
 *    - If you're using a different Redis provider, adjust below.
 **********************************************************/
const redis = createClient({
  url: process.env.KV_URL, 
  password: process.env.KV_REST_API_TOKEN, 
  socket: {
    tls: true,
    rejectUnauthorized: false,      // Accept self-signed cert in Upstash
  },
});

// Connect to Redis
redis.connect()
  .then(() => console.log('[INFO] Connected to Redis successfully via Upstash'))
  .catch((err) => console.error('[ERROR] Redis connection failed:', err.message));

export default redis;

/**********************************************************
 * 1) Initialize OpenAI
 **********************************************************/
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // must be set in your environment
});

/**********************************************************
 * 2) Fetch Business Config with Redis Caching
 *    - We store minimal but essential fields from the 'businesses' table.
 *    - This logic can be expanded if you want more fields.
 **********************************************************/
const getBusinessConfig = async (businessId) => {
  try {
    console.time(`Fetch BusinessConfig for Business ${businessId}`);

    // 1. Attempt to fetch from Redis cache first
    const cacheKey = `business:${businessId}`;
    const cachedConfig = await redis.get(cacheKey);
    if (cachedConfig) {
      console.timeEnd(`Fetch BusinessConfig for Business ${businessId}`);
      console.log(`[INFO] Cache hit for businessId=${businessId}`);
      return JSON.parse(cachedConfig);
    }

    // 2. If not in cache, query Supabase
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
      console.error(`[ERROR] Fetching business config failed: ${error.message}`);
      return null;
    }
    if (!data) {
      console.warn(`[WARN] No data returned for businessId=${businessId}`);
      return null;
    }

    // 3. Store the result in Redis (1 hour TTL)
    await redis.set(cacheKey, JSON.stringify(data), { EX: 3600 });
    console.timeEnd(`Fetch BusinessConfig for Business ${businessId}`);
    return data;
  } catch (err) {
    console.error(`[ERROR] Unexpected error in getBusinessConfig: ${err.message}`);
    return null;
  }
};

/**********************************************************
 * 3) Create System Message
 *    - Insert the business info into a prompt that instructs the AI.
 **********************************************************/
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
  } = businessConfig || {};

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

/**********************************************************
 * 4) Setmore Token Management
 *    - Each business may have a row in 'setmore_integrations'
 *      with refresh_token, access_token, token_expires_at.
 **********************************************************/
/**
 * Refresh the Setmore token if expired, store new tokens in DB
 */
const refreshSetmoreToken = async (businessId) => {
  try {
    // 4a) Fetch refresh token from 'setmore_integrations'
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

    // 4b) Call Setmore's refresh endpoint
    const url = `https://developer.setmore.com/api/v1/o/oauth2/token?refreshToken=${refresh_token}`;
    const response = await axios.get(url);

    if (!response.data?.response || !response.data?.data?.token) {
      console.error('[ERROR] Unexpected response from Setmore refresh:', response.data);
      return null;
    }

    const { access_token, expires_in } = response.data.data.token;

    // 4c) Compute new expiration time, minus a 1-hour buffer
    const now = new Date();
    const bufferMs = 60 * 60 * 1000;
    const expirationDate = new Date(now.getTime() + expires_in * 1000 - bufferMs);

    // 4d) Store new token in DB
    const { error: updateError } = await supabase
      .from('setmore_integrations')
      .update({
        access_token,
        token_expires_at: expirationDate.toISOString(),
      })
      .eq('id', integrationId);

    if (updateError) {
      console.error('[ERROR] Failed to update new token in DB:', updateError.message);
      return null;
    }

    console.log(`[INFO] Refreshed Setmore token for businessId=${businessId}`);
    return access_token;
  } catch (err) {
    console.error('[ERROR] refreshSetmoreToken:', err.message);
    return null;
  }
};

/**
 * Retrieve valid Setmore access token, refreshing if needed.
 */
const getSetmoreAccessToken = async (businessId) => {
  try {
    const { data, error } = await supabase
      .from('setmore_integrations')
      .select('id, access_token, token_expires_at')
      .eq('business_id', businessId)
      .single();

    if (error || !data) {
      console.error(`[ERROR] Could not load setmore integration for business=${businessId}`, error?.message);
      return null;
    }

    const { id, access_token, token_expires_at } = data;
    if (!access_token) {
      console.warn(`[WARN] No access_token found for business=${businessId}`);
      return null;
    }

    // Check if near or past expiration
    const now = new Date();
    if (token_expires_at) {
      const expiresAt = new Date(token_expires_at);
      if (expiresAt < now) {
        console.log('[INFO] Setmore token expired. Refreshing...');
        const newToken = await refreshSetmoreToken(businessId);
        return newToken; // Possibly null if refresh fails
      }
    }

    return access_token;
  } catch (err) {
    console.error('[ERROR] getSetmoreAccessToken:', err.message);
    return null;
  }
};

/**********************************************************
 * 5) Setmore API Wrappers: fetchAvailableSlots, bookSetmoreAppointment
 **********************************************************/
const fetchSetmoreSlotsAPI = async (accessToken) => {
  try {
    // This is an example endpoint. Adjust to your actual usage
    // Possibly a POST to '/api/v1/bookingapi/slots' with staff_key, service_key, etc.
    const response = await axios.get('https://api.setmore.com/v1/bookingapi/availability', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.data?.data) {
      return response.data.data;
    }
    console.error('[ERROR] Unexpected data from fetchSetmoreSlotsAPI:', response.data);
    return [];
  } catch (err) {
    console.error('[ERROR] fetchSetmoreSlotsAPI:', err.message);
    return [];
  }
};

const bookSetmoreAppointmentAPI = async ({
  accessToken,
  serviceId,
  customerName,
  customerContact,
  appointmentDate,
}) => {
  try {
    // This is an example endpoint. Adjust to your actual usage
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
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (response.data?.data) {
      return 'Your appointment has been successfully booked!';
    } else {
      console.error('[ERROR] Failed booking response from Setmore:', response.data);
      return 'Unable to confirm booking. Please try again later.';
    }
  } catch (err) {
    console.error('[ERROR] bookSetmoreAppointmentAPI:', err.message);
    return 'Something went wrong during booking. Please try again later.';
  }
};

/**
 * 5a) Higher-level fetchAvailableSlots
 */
const fetchAvailableSlots = async (businessId) => {
  try {
    const accessToken = await getSetmoreAccessToken(businessId);
    if (!accessToken) {
      console.error('[ERROR] No valid Setmore token for slots');
      return [];
    }
    const slots = await fetchSetmoreSlotsAPI(accessToken);
    return slots;
  } catch (err) {
    console.error('[ERROR] fetchAvailableSlots:', err.message);
    return [];
  }
};

/**
 * 5b) Higher-level bookSetmoreAppointment
 */
const bookSetmoreAppointment = async ({
  businessId,
  customerName,
  customerContact,
  appointmentDate,
  serviceId,
}) => {
  try {
    const accessToken = await getSetmoreAccessToken(businessId);
    if (!accessToken) {
      console.error(`[ERROR] Could not get Setmore token for business=${businessId}`);
      return 'Unable to process your appointment booking request right now.';
    }
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

/**********************************************************
 * 6) Provide Link Function
 **********************************************************/
const provideLink = (businessConfig, linkType) => {
  const { financing_link, appointment_booking_link, custom_links } = businessConfig || {};

  switch (linkType) {
    case 'financing':
      return financing_link || 'No financing link is currently available.';
    case 'appointment':
      return appointment_booking_link || 'No appointment booking link is currently available.';
    default:
      return custom_links?.[linkType] || 'No relevant link found for that request.';
  }
};

/**********************************************************
 * 7) The Main Assistant Handler
 *    - Gathers business config
 *    - Creates system prompt
 *    - Calls OpenAI with function calling
 *    - Possibly calls Setmore wrappers if the AI triggers them
 **********************************************************/
export const assistantHandler = async ({ userMessage, businessId }) => {
  try {
    console.log(`[DEBUG] assistantHandler -> businessId=${businessId}, userMessage="${userMessage}"`);

    if (!userMessage || typeof userMessage !== 'string') {
      console.error('[ERROR] Invalid user message');
      return { message: 'I couldn’t understand your message. Could you please rephrase it?' };
    }

    // 7a) Fetch business config (cached in Redis)
    const businessConfig = await getBusinessConfig(businessId);
    if (!businessConfig) {
      return { message: 'Unable to retrieve business details. Please try again later.' };
    }

    // 7b) Build system prompt from config
    const systemMessage = createSystemMessage(businessConfig);

    // 7c) Define the possible function calls
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
            customerName: { type: 'string', description: 'Customer name.' },
            customerContact: { type: 'string', description: 'Customer contact info (phone/email).' },
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
              description: 'The type of link requested: "financing", "appointment", or a key in custom_links.',
            },
          },
          required: ['linkType'],
        },
      },
    ];

    // 7d) Create the Chat Completion with function calling
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      functions,
      function_call: 'auto',
      max_tokens: 370, // Adjust for speed/cost
      temperature: 0.7,
      stream: true,   // If you want streaming, set to true & handle streams
    });

    // 7e) Extract AI's response
    const choice = openaiResponse.choices?.[0];
    let responseMessage = choice?.message?.content?.trim() || "I'm here to help!";

    // 7f) If the AI wants to call a function, handle it
    if (choice?.message?.function_call) {
      const { name: functionName, arguments: args } = choice.message.function_call;
      const parsedArgs = args ? JSON.parse(args) : {};

      switch (functionName) {
        case 'fetch_available_slots': {
          const slots = await fetchAvailableSlots(businessId);
          if (slots.length > 0) {
            // Example: listing time from each slot
            const times = slots.map((s) => s.start_time || 'Unknown');
            responseMessage = `Here are the available slots: ${times.join(', ')}`;
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
          console.warn(`[WARN] AI requested unknown function: ${functionName}`);
          responseMessage = "I'm sorry, I’m not sure how to handle that request.";
      }
    }

    // 7g) Ensure final text under 1000 chars (e.g., Instagram limit)
    const maxLength = 1000;
    if (responseMessage.length > maxLength) {
      responseMessage = `${responseMessage.substring(0, maxLength - 3)}...`;
    }

    console.log(`[DEBUG] Final AI response to user: "${responseMessage}"`);
    return { message: responseMessage };
  } catch (err) {
    console.error('[ERROR] assistantHandler:', err.message);
    return { message: 'Something went wrong. Please try again later.' };
  }
};

/**********************************************************
 * 8) Default Export
 *    - If you'd rather do named exports, adjust accordingly.
 **********************************************************/
export default assistantHandler;
