import axios from 'axios';
import { assistantHandler } from './assistant.js';

/**
 * processAudioHandler
 * --------------------
 * This endpoint accepts POST requests containing audio data (and a businessId),
 * sends the audio to Deepgram for transcription, and then passes the transcription
 * to the AI (assistantHandler) to generate a response.
 */
const processAudioHandler = async (req, res) => {
  // Allow only POST requests.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audio, businessId } = req.body;

    // Validate required inputs.
    if (!audio) {
      return res.status(400).json({ error: 'No audio data received' });
    }
    if (!businessId) {
      return res.status(400).json({ error: 'No businessId provided' });
    }

    // Send the audio to Deepgram for transcription.
    const deepgramResponse = await axios.post(
      'https://api.deepgram.com/v1/listen',
      audio,
      {
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/wav',
        },
      }
    );

    // Extract the transcription from the Deepgram response.
    const transcription =
      deepgramResponse.data.results.channels[0].alternatives[0].transcript;
    console.log(`🎤 Deepgram Transcription: ${transcription}`);

    // If Deepgram does not return any useful transcription, notify the caller.
    if (!transcription || transcription.trim() === '') {
      return res.status(200).json({
        message: "I'm sorry, I couldn't understand the audio. Could you please try again?"
      });
    }

    // Generate an AI response using the assistantHandler from assistant.js.
    const aiResponse = await assistantHandler({
      userMessage: transcription,
      businessId: businessId,
    });
    console.log(`🤖 AI Response: ${aiResponse.message}`);

    // Return the AI response.
    return res.status(200).json({ message: aiResponse.message });
  } catch (error) {
    console.error('❌ Error processing audio:', error.message);
    return res.status(500).json({ error: 'Failed to process audio' });
  }
};

export default processAudioHandler;
