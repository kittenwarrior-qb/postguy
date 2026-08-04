// PostGuy asset: Dashboard poller
// Configure the Script tab with:
//   Iterations: 10000
//   Concurrency: 1
//   Interval: 15 sec
//
// Required environment variables:
//   baseUrl — https://your-domain.example
//   token   — optional bearer token

const baseUrl = pg.env.get('baseUrl');
const token = pg.env.get('token');

if (!baseUrl) {
  throw new Error('Set the baseUrl environment variable before running this asset.');
}

const headers = {
  Accept: 'application/json',
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const response = await pg.sendRequest({
  method: 'GET',
  url: `${baseUrl}/api/dashboard`,
  headers,
});

const data = response.tryJson() ?? {};

console.log(`dashboard poll #${pg.job.iteration}: ${response.status} (${response.time} ms)`);

pg.record({
  iteration: pg.job.iteration,
  status: response.status,
  responseMs: response.time,
  users: data.users ?? data.data?.users ?? null,
  revenue: data.revenue ?? data.data?.revenue ?? null,
});
