router.post('/refresh-token', async (req, res) => {
  try {
    const { shortLivedToken } = req.body;
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken);
    res.status(200).json({ longLivedToken });
  } catch (error) {
    console.error('Error refreshing token:', error.message);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});
