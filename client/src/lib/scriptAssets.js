export const SCRIPT_ASSETS = [
  {
    id: 'dashboard-poller',
    name: 'Dashboard poller',
    description: 'Poll a dashboard endpoint every 15 seconds and record a compact result.',
    code: `// Dashboard poller: configure baseUrl and token below.
const baseUrl = pg.env.get('baseUrl');
const token = pg.env.get('token');

if (!baseUrl) {
  throw new Error('Set the baseUrl environment variable before running this asset.');
}

const headers = { Accept: 'application/json' };
if (token) headers.Authorization = \`Bearer \${token}\`;

const response = await pg.sendRequest({
  method: 'GET',
  url: \`\${baseUrl}/api/dashboard\`,
  headers,
});

const data = response.tryJson() ?? {};
console.log(\`dashboard poll #\${pg.job.iteration}: \${response.status} (\${response.time} ms)\`);

pg.record({
  iteration: pg.job.iteration,
  status: response.status,
  responseMs: response.time,
  users: data.users ?? data.data?.users ?? null,
  revenue: data.revenue ?? data.data?.revenue ?? null,
});`,
    vars: [
      { key: 'baseUrl', value: 'https://your-dashboard.example', description: 'Dashboard origin' },
      { key: 'token', value: '', description: 'Optional bearer token' },
    ],
    config: { iterations: 10000, concurrency: 1, interval: 15, intervalUnit: 's' },
  },
  {
    id: 'auth-dashboard-poller',
    name: 'Login + authenticated poller',
    description: 'Login once, cache the bearer token in the job environment, then poll a protected API.',
    code: `// Login once, then reuse the token on every iteration.
const baseUrl = pg.env.get('baseUrl');
const username = pg.env.get('username');
const password = pg.env.get('password');
const loginPath = pg.env.get('loginPath') || '/login';
const apiPath = pg.env.get('apiPath') || '/api/dashboard';

if (!baseUrl || !username || !password) {
  throw new Error('Set baseUrl, username and password before running this asset.');
}

if (!pg.env.get('accessToken')) {
  const login = await pg.sendRequest({
    method: 'POST',
    url: \`\${baseUrl}\${loginPath}\`,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: {
      mode: 'raw',
      raw: JSON.stringify({ username, password }),
      language: 'json',
    },
  });

  const payload = login.tryJson() ?? {};
  const token = payload.access_token ?? payload.accessToken ?? payload.token;
  if (!token) throw new Error('Login succeeded but no access token was found.');
  pg.env.set('accessToken', token);
}

const response = await pg.sendRequest({
  method: 'GET',
  url: \`\${baseUrl}\${apiPath}\`,
  headers: {
    Accept: 'application/json',
    Authorization: \`Bearer \${pg.env.get('accessToken')}\`,
  },
});

const data = response.tryJson() ?? {};
console.log(\`poll #\${pg.job.iteration}: \${response.status} (\${response.time} ms)\`);
pg.record({
  iteration: pg.job.iteration,
  status: response.status,
  responseMs: response.time,
  users: data.users ?? data.data?.users ?? null,
  revenue: data.revenue ?? data.data?.revenue ?? null,
});`,
    vars: [
      { key: 'baseUrl', value: 'https://your-api.example', description: 'API origin' },
      { key: 'username', value: '', description: 'Login username' },
      { key: 'password', value: '', description: 'Login password' },
      { key: 'loginPath', value: '/login', description: 'Login endpoint' },
      { key: 'apiPath', value: '/api/dashboard', description: 'Protected endpoint' },
      { key: 'accessToken', value: '', description: 'Filled automatically after login' },
    ],
    config: { iterations: 10000, concurrency: 1, interval: 15, intervalUnit: 's' },
  },
];

export function findScriptAsset(id) {
  return SCRIPT_ASSETS.find((asset) => asset.id === id) ?? null;
}
