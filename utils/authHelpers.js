// authHelpers.js
export const getAuthToken = (req) => {
  // Retrieve token from cookies
  let token = req.cookies?.authToken;

  // Fallback: Retrieve token from Authorization header
  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  return token;
};
