router.get('/verify-session', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]; // Extract the Bearer token
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // Verify the token (e.g., using JWT or your auth logic)
    const user = jwt.verify(token, process.env.JWT_SECRET);

    // If valid, return user info
    res.status(200).json({ user });
  } catch (error) {
    console.error('Token verification failed:', error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});
