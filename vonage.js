/*******************************************************
 * vonage.js
 *
 * Handles Vonage telephony events:
 *  - Inbound Answer URL -> returns a pure WebRTC NCCO
 *  - Input URL (legacy; not used when WS is connected)
 *  - Event URL
 *  - Fallback URL
 *  - Inbound Message (SMS)
 *  - Status URL
 *
 * IMPORTANT:
 *  - No hard-coded greeting. Mila’s voice comes directly
 *    from the OpenAI Realtime API through the WebRTC bridge.
 *******************************************************/
import { Vonage } from "@vonage/server-sdk";
import supabase from "./supabaseClient.js";
import { assistantHandler } from "./assistant.js"; // used for inbound SMS only
import { logConversation } from "./logConversation.js"; // used in legacy input flow

// ---------- ENV ----------
const WEBRTC_BRIDGE_URL =
  process.env.WEBRTC_BRIDGE_URL || "https://milaverse-websocket.onrender.com/webrtc-session";

// Initialize Vonage SDK (for outbound features if needed later)
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: process.env.VONAGE_PRIVATE_KEY,
});

/** Extract conversation UUID from request safely */
function getConversationId(req) {
  const conversationId =
    req.body?.conversation_uuid ||
    req.query?.conversation_uuid ||
    req.body?.uuid ||
    req.query?.uuid ||
    null;

  if (!conversationId) {
    console.error("[ERROR] Missing conversationId from Vonage");
  }
  return conversationId;
}

/** Normalize E.164-ish phone formatting (lightweight) */
function normalizeNumber(n) {
  if (!n) return "";
  return String(n).replace(/[^\d+]/g, "");
}

/**
 * 1) handleInboundCall (Answer URL)
 *
 * Looks up business_id by inbound "to" number and returns a
 * WebRTC NCCO. Mila’s audio is streamed through the Render
 * bridge (milaverse-websocket).
 */
export const handleInboundCall = async (req, res) => {
  try {
    console.log(
      "[DEBUG] handleInboundCall body:",
      JSON.stringify(req.body || {}, null, 2)
    );
    console.log(
      "[DEBUG] handleInboundCall query:",
      JSON.stringify(req.query || {}, null, 2)
    );

    const to = normalizeNumber(req.body?.to || req.query?.to);
    const from = normalizeNumber(req.body?.from || req.query?.from);
    const conversationId = getConversationId(req);

    if (!conversationId || !to || !from) {
      console.error(
        "[ERROR] Missing required call params (conversationId/to/from)."
      );
      return res.json([
        {
          action: "talk",
          text: "Sorry, we cannot process your call right now.",
          language: "en-US",
          style: 14,
        },
      ]);
    }

    // Map inbound "to" number -> business_id
    const { data: mapRow, error: mapErr } = await supabase
      .from("vonage_numbers")
      .select("business_id")
      .eq("vonage_number", to)
      .single();

    if (mapErr || !mapRow?.business_id) {
      console.error(
        "[ERROR] Business mapping not found for number:",
        to,
        mapErr?.message
      );
      return res.json([
        {
          action: "talk",
          text: "We are unable to route your call at this time.",
          language: "en-US",
          style: 14,
        },
      ]);
    }
    const businessId = mapRow.business_id;

    // Log conversation start
    await supabase.from("inbound_calls").insert([
      {
        conversation_id: conversationId,
        sender_phone: from,
        receiver_phone: to,
        business_id: businessId,
        message: "Conversation started",
        message_type: "system",
        role: "system",
        timestamp: new Date().toISOString(),
      },
    ]);

    // Build WebRTC NCCO
    const webrtcUri = `${WEBRTC_BRIDGE_URL}?business_id=${encodeURIComponent(
      businessId
    )}&conversation_id=${encodeURIComponent(conversationId)}`;

    const ncco = [
      {
        action: "connect",
        endpoint: [
          {
            type: "webrtc",
            uri: webrtcUri,
            "content-type": "audio/l16;rate=16000",
          },
        ],
      },
    ];

    console.log("[INFO] handleInboundCall -> Returning WebRTC NCCO:", webrtcUri);
    return res.json(ncco);
  } catch (err) {
    console.error("[ERROR] handleInboundCall:", err);
    return res.json([
      {
        action: "talk",
        text: "We are unable to process your call at the moment. Please try again later.",
        language: "en-US",
        style: 14,
      },
    ]);
  }
};

/**
 * 2) handleInputWebhook (legacy Input URL)
 */
export const handleInputWebhook = async (req, res) => {
  try {
    console.log(
      "[DEBUG] InputWebhook Body:",
      JSON.stringify(req.body || {}, null, 2)
    );
    console.log(
      "[DEBUG] InputWebhook Query:",
      JSON.stringify(req.query || {}, null, 2)
    );

    const { businessId, conversationId } = req.query;
    const from = normalizeNumber(req.body?.from || "Unknown");
    const to = normalizeNumber(req.body?.to || "Unknown");

    if (!businessId || !conversationId) {
      console.error(
        "[ERROR] Missing businessId or conversationId in Input Webhook."
      );
      return res.json([
        {
          action: "talk",
          text: "Sorry, something went wrong. Goodbye.",
          language: "en-US",
          style: 14,
        },
      ]);
    }

    const userText =
      req.body?.speech?.results?.[0]?.text ||
      (req.body?.dtmf?.digits ? `dtmf digit: ${req.body.dtmf.digits}` : "");

    const cleaned = (userText || "").trim().toLowerCase();
    const fillerRegex =
      /^(uh|um|ah|hm|hmm|noise|silent|background|end_on_silence)$/i;

    if (!cleaned || cleaned.length < 3 || fillerRegex.test(cleaned)) {
      const nextUrl = `${req.protocol}://${req.get(
        "host"
      )}/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;
      return res.json([
        {
          action: "talk",
          text: "I didn’t catch that. Could you repeat that, please?",
          language: "en-US",
          style: 14,
          bargeIn: true,
        },
        {
          action: "input",
          type: ["speech", "dtmf"],
          eventUrl: [nextUrl],
          speech: { endOnSilence: 0.3, language: "en-US" },
          dtmf: { maxDigits: 1, submitOnHash: false },
        },
      ]);
    }

    // Non-realtime AI reply
    const assistantResponse = await assistantHandler({
      userMessage: cleaned,
      businessId,
      platform: "phone",
    });

    const ttsMessage = assistantResponse?.message || "How else can I help you?";

    await logConversation({
      businessId,
      senderPhone: from,
      receiverPhone: to,
      message: cleaned,
      messageType: "speech",
      role: "customer",
      conversationId,
    }).catch((e) => console.error("[WARN] log customer failed:", e?.message));

    await logConversation({
      businessId,
      senderPhone: "AI",
      receiverPhone: from,
      message: ttsMessage,
      messageType: "text",
      role: "business",
      conversationId,
    }).catch((e) => console.error("[WARN] log ai failed:", e?.message));

    const nextUrl = `${req.protocol}://${req.get(
      "host"
    )}/vonage/input-webhook?businessId=${businessId}&conversationId=${conversationId}`;
    const ncco = [
      {
        action: "talk",
        text: ttsMessage,
        language: "en-US",
        style: 14,
        bargeIn: true,
      },
      {
        action: "input",
        type: ["speech", "dtmf"],
        eventUrl: [nextUrl],
        speech: { endOnSilence: 0.3, language: "en-US" },
        dtmf: { maxDigits: 1, submitOnHash: false },
      },
    ];
    return res.json(ncco);
  } catch (err) {
    console.error("[ERROR] handleInputWebhook:", err);
    return res.json([
      {
        action: "talk",
        text: "Sorry, something went wrong. Goodbye.",
        language: "en-US",
        style: 14,
      },
    ]);
  }
};

/**
 * 3) handleCallEvent (Event URL)
 */
export const handleCallEvent = async (req, res) => {
  try {
    console.log(
      "[DEBUG] handleCallEvent Query:",
      JSON.stringify(req.query || {}, null, 2)
    );

    const { status, conversation_uuid, to, from } = req.query || {};
    console.log(
      `[INFO] Call event: status=${status}, conversation_uuid=${conversation_uuid}, to=${to}, from=${from}`
    );

    await supabase.from("call_events").insert([
      {
        status,
        conversation_uuid,
        to,
        from,
        event_time: new Date().toISOString(),
      },
    ]);

    res.status(200).send("Event received");
  } catch (err) {
    console.error("[ERROR] handleCallEvent:", err);
    res.status(500).send("Failed to handle call event");
  }
};

/**
 * 4) handleFallback (Fallback URL)
 */
export const handleFallback = async (req, res) => {
  try {
    console.error(
      "[ERROR] Fallback triggered:",
      JSON.stringify(req.body || req.query || {}, null, 2)
    );
    return res.json([
      {
        action: "talk",
        text: "We are unable to process your call at the moment. Please try again later.",
        language: "en-US",
      },
    ]);
  } catch (err) {
    console.error("[ERROR] handleFallback:", err);
    res.status(500).send("Failed to handle fallback");
  }
};

/**
 * 5) handleInboundMessage (SMS/Messages)
 */
export const handleInboundMessage = async (req, res) => {
  try {
    console.log(
      "[DEBUG] handleInboundMessage Body:",
      JSON.stringify(req.body || {}, null, 2)
    );
    console.log(
      "[DEBUG] handleInboundMessage Query:",
      JSON.stringify(req.query || {}, null, 2)
    );

    const { text, msisdn } = req.body || req.query || {};
    console.log(`[INFO] Inbound message from ${msisdn}: "${text}"`);

    const assistantResponse = await assistantHandler({
      userMessage: text,
      platform: "sms",
    });

    return res.status(200).json({
      message: assistantResponse?.message || "Thank you for your message!",
    });
  } catch (err) {
    console.error("[ERROR] handleInboundMessage:", err);
    return res.status(500).send("Failed to handle inbound message");
  }
};

/**
 * 6) handleCallStatus (Status URL)
 */
export const handleCallStatus = async (req, res) => {
  try {
    console.log(
      "[DEBUG] handleCallStatus Body:",
      JSON.stringify(req.body || {}, null, 2)
    );
    console.log(
      "[DEBUG] handleCallStatus Query:",
      JSON.stringify(req.query || {}, null, 2)
    );

    const { status, conversation_uuid } = req.body || req.query || {};
    console.log(
      `[INFO] Call status update: ${status}, conversation_uuid=${conversation_uuid}`
    );

    await supabase.from("call_status_updates").insert([
      {
        status,
        conversation_uuid,
        status_time: new Date().toISOString(),
      },
    ]);

    res.status(200).send("Status received");
  } catch (err) {
    console.error("[ERROR] handleCallStatus:", err);
    res.status(500).send("Failed to handle call status");
  }
};
