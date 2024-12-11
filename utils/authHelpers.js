export const getAuthToken = () => {
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'authToken') {
      return decodeURIComponent(value);
    }
  }
  return null; // Return null if no token found
};
