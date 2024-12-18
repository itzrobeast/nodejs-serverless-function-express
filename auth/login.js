// 1. Validate Access Token
const schema = Joi.object({ accessToken: Joi.string().required() });
const { error, value } = schema.validate(req.body);
if (error) return res.status(400).json({ error: error.details[0].message });

const { accessToken } = value;

// 2. Fetch FB User Data
const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
if (!fbResponse.ok) throw new Error('Invalid Facebook Access Token');

const fbUser = await fbResponse.json();
const { id: fb_id, name, email } = fbUser;

// 3. Fetch Instagram Business Account (Optional)
const igResponse = await fetch(`https://graph.facebook.com/me?fields=instagram_business_account&access_token=${accessToken}`);
const igData = await igResponse.json();
const ig_id = igData.instagram_business_account?.id || null;

// 4. Insert or Update User
const { data: user, error: userError } = await supabase
  .from('users')
  .upsert([{ fb_id, name, email, ig_id }], { onConflict: 'fb_id' })
  .select('*')
  .single();

if (userError) throw userError;

// 5. Insert or Update Pages
await Promise.all(pagesData.map(page =>
  supabase.from('pages').upsert({
    page_id: page.id, // Store FB Page ID here
    name: page.name,
    access_token: page.access_token,
  }, { onConflict: 'page_id' })
));

// 6. Fetch Page ID
const { data: page, error: pageError } = await supabase
  .from('pages')
  .select('id')
  .eq('page_id', pagesData[0].id)
  .single();

if (pageError || !page) throw new Error('Page lookup failed.');

// 7. Insert or Update Business
const { data: business, error: businessError } = await supabase
  .from('businesses')
  .upsert([{ user_id: user.id, name: `${name}'s Business`, page_id: page.id }], { onConflict: 'user_id' })
  .select('*')
  .single();

if (businessError) throw businessError;

// 8. Set Cookies
res.cookie('authToken', accessToken, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
res.cookie('userId', user.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });
res.cookie('businessId', business.id.toString(), { httpOnly: true, secure: true, sameSite: 'None', maxAge: 3600000 });

res.status(200).json({ message: 'Login successful', user, business });
