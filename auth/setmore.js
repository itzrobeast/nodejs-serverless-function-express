import express from "express";
import axios from "axios";
import supabase from "../supabaseClient.js"; // Adjust this path if necessary

const router = express.Router();

// Environment variables
const SETMORE_CLIENT_ID = process.env.SETMORE_CLIENT_ID;
const SETMORE_CLIENT_SECRET = process.env.SETMORE_CLIENT_SECRET;
const SETMORE_REDIRECT_URI = process.env.SETMORE_REDIRECT_URI; // Backend callback URL
const SETMORE_AUTH_URL = "https://developer.setmore.com/api/v1/o/oauth2/authorize";
const SETMORE_TOKEN_URL = "https://developer.setmore.com/api/v1/o/oauth2/token";

/**
 * Step 1: Redirect users to Setmore's OAuth authorization page
 */
router.get("/auth/setmore", (req, res) => {
  const { businessId } = req.query;

  // Validate that a business ID is provided
  if (!businessId) {
    return res.status(400).send("Missing business ID");
  }

  // Construct the Setmore OAuth URL
  const authorizationUrl = `${SETMORE_AUTH_URL}?client_id=${SETMORE_CLIENT_ID}&redirect_uri=${SETMORE_REDIRECT_URI}&response_type=code`;

  console.log(`[INFO] Redirecting to Setmore OAuth: ${authorizationUrl}`);

  // Redirect the user to Setmore's authorization page
  res.redirect(authorizationUrl);
});

/**
 * Step 2: Handle the callback from Setmore
 */
router.get("/auth/setmore/callback", async (req, res) => {
  const { code, state } = req.query;

  // Validate that the authorization code is provided
  if (!code) {
    return res.status(400).send("Authorization code is missing");
  }

  try {
    console.log(`[INFO] Received authorization code: ${code}`);

    // Exchange the authorization code for an access token
    const response = await axios.post(SETMORE_TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: SETMORE_CLIENT_ID,
      client_secret: SETMORE_CLIENT_SECRET,
      redirect_uri: SETMORE_REDIRECT_URI,
      code,
    });

    // Extract tokens and expiration
    const { access_token, refresh_token, expires_in } = response.data.data.token;

    console.log("[INFO] Tokens received from Setmore:", {
      access_token,
      refresh_token,
      expires_in,
    });

    // Save tokens to the database
    const { error } = await supabase.from("setmore_integrations").upsert(
      {
        business_id: state, // Pass business_id via state in the OAuth flow
        access_token,
        refresh_token,
        token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
      },
      { onConflict: "business_id" } // Ensures no duplicates
    );

    if (error) {
      console.error("[ERROR] Failed to store Setmore tokens in Supabase:", error.message);
      return res.status(500).send("Failed to connect Setmore account");
    }

    console.log("[INFO] Setmore tokens stored successfully!");
    res.send("Setmore account connected successfully!");
  } catch (err) {
    console.error("[ERROR] Failed to exchange Setmore authorization code:", err.message);
    res.status(500).send("Failed to complete Setmore connection");
  }
});

export default router;
