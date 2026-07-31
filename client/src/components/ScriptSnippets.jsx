const PRE_SNIPPETS = [
  {
    label: 'Set an environment variable',
    code: `pg.env.set('requestId', pg.utils.uuid());`,
  },
  {
    label: 'Add a computed header',
    code: `pg.request.headers['X-Signature'] = pg.utils.hmac('sha256', pg.env.get('secret'), pg.request.body.raw);`,
  },
  {
    label: 'Log in first, then reuse the token (request chaining)',
    code: `const login = await pg.sendRequest({
  method: 'POST',
  url: pg.env.get('baseUrl') + '/login',
  headers: { 'Content-Type': 'application/json' },
  body: { mode: 'raw', raw: JSON.stringify({ user: 'demo', pass: 'demo' }) },
});
pg.env.set('token', login.json().accessToken);`,
  },
  {
    label: 'Build the body dynamically',
    code: `pg.request.body.mode = 'raw';
pg.request.body.raw = JSON.stringify({
  createdAt: new Date().toISOString(),
  items: Array.from({ length: 3 }, (_, i) => ({ sku: 'SKU-' + i, qty: pg.utils.randomInt(1, 9) })),
}, null, 2);`,
  },
  {
    label: 'Skip the request conditionally',
    code: `if (!pg.env.get('token')) {
  console.warn('No token yet — skipping this request');
  pg.execution.skipRequest();
}`,
  },
];

const POST_SNIPPETS = [
  {
    label: 'Assert the status code',
    code: `pg.test('status is 200', () => pg.expect(pg.response).to.have.status(200));`,
  },
  {
    label: 'Assert on the JSON body',
    code: `const data = pg.response.json();
pg.test('returns a non-empty list', () => {
  pg.expect(data.items).to.be.an('array');
  pg.expect(data.items.length).to.be.above(0);
});`,
  },
  {
    label: 'Save a value for the next request',
    code: `pg.env.set('userId', pg.response.json().id);`,
  },
  {
    label: 'Check response time and headers',
    code: `pg.test('responds under 500ms', () => pg.expect(pg.response.responseTime).to.be.below(500));
pg.test('is JSON', () => pg.expect(pg.response.header('content-type')).to.include('application/json'));`,
  },
  {
    label: 'Loop over results with plain JS',
    code: `const users = pg.response.json();
for (const user of users) {
  pg.test('user ' + user.id + ' has an email', () => pg.expect(user.email).to.include('@'));
}`,
  },
];

export function ScriptSnippets({ phase, onInsert }) {
  const snippets = phase === 'pre' ? PRE_SNIPPETS : POST_SNIPPETS;
  return (
    <div className="snippet-list">
      {snippets.map((snippet) => (
        <button key={snippet.label} type="button" onClick={() => onInsert(snippet.code)}>
          + {snippet.label}
        </button>
      ))}
    </div>
  );
}
