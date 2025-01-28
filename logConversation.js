import supabase from './supabaseClient.js';

/**
 * Log a conversation entry into the inbound_calls table.
 * @param {Object} conversationData - Data for logging the conversation.
 * @param {number} conversationData.businessId - ID of the business.
 * @param {string} conversationData.senderPhone - Phone number of the sender.
 * @param {string} conversationData.receiverPhone - Phone number of the receiver.
 * @param {string} conversationData.message - Message content.
 * @param {string} conversationData.messageType - Type of message (text, dtmf, speech, etc.).
 * @param {string} conversationData.role - Role of the sender (customer or business).
 * @param {string} conversationData.conversationId - Conversation ID provided by Vonage.
 * @param {string} [conversationData.callerName] - Name of the caller (optional).
 * @param {string} [conversationData.email] - Email address (optional).
 * @param {string} [conversationData.location] - Location (optional).
 */
export const logConversation = async ({
  businessId,
  senderPhone,
  receiverPhone,
  message,
  messageType,
  role,
  conversationId,
  callerName = null,
  email = null,
  location = null,
}) => {
  try {
    // Ensure conversationId is provided
    if (!conversationId) {
      throw new Error('conversationId is required but not provided.');
    }

    const { error } = await supabase.from(`inbound_calls_${businessId}`).insert({
      business_id: businessId,
      conversation_id: conversationId, // Explicitly set the conversationId
      sender_phone: senderPhone,
      receiver_phone: receiverPhone,
      message,
      message_type: messageType,
      role,
      caller_name: callerName,
      email,
      location,
      timestamp: new Date().toISOString(), // Add timestamp for logging
    });

    if (error) {
      console.error('[ERROR] Failed to log conversation:', error.message);
    } else {
      console.log(`[INFO] Conversation logged successfully for Conversation ID: ${conversationId}`);
    }
  } catch (err) {
    console.error('[ERROR] logConversation:', err.message);
  }
};
