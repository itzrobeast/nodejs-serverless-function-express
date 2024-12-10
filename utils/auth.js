import Cookies from 'js-cookie';

export const getAuthToken = () => {
  return Cookies.get('authToken'); // Retrieve the token from the cookie
};
