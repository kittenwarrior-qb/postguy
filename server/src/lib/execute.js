import { sendRequest } from './http.js';
import { runScript } from './scripting.js';
import { getSettings } from './settings.js';
import { resolveDeep } from './variables.js';

/**
 * The full request lifecycle, mirroring what Postman does but with the script
 * phases promoted to first-class citizens:
 *
 *   pre-request script → resolve {{variables}} → send → post-response script
 *
 * Scripts can rewrite the request, short-circuit it, chain extra calls, and
 * write back into the environment, so the caller gets the updated scopes.
 */
export async function execute({ request, environment = {}, globals = {} }) {
  const started = Date.now();
  let env = { ...environment };
  let glob = { ...globals };
  const logs = [];
  const tests = [];

  let effectiveRequest = request;

  const pre = await runScript({
    code: request.scripts?.preRequest,
    phase: 'pre',
    request,
    environment: env,
    globals: glob,
    requestName: request.name,
  });
  logs.push(...pre.logs);
  tests.push(...pre.tests);
  env = pre.environment;
  glob = pre.globals;
  if (pre.ran) {
    effectiveRequest = { ...request, ...pre.request };
  }

  if (pre.skipRequest) {
    return {
      skipped: true,
      response: null,
      logs,
      tests,
      environment: env,
      globals: glob,
      scriptErrors: { pre: pre.error, post: null },
      totalTime: Date.now() - started,
    };
  }

  // Variables resolve after the pre-request script so a script can set a value
  // and have `{{that}}` pick it up in the same run.
  const scope = { ...glob, ...env };
  const resolved = resolveDeep(
    {
      method: effectiveRequest.method,
      url: effectiveRequest.url,
      headers: effectiveRequest.headers,
      params: effectiveRequest.params,
      body: effectiveRequest.body,
      auth: effectiveRequest.auth,
      followRedirects: effectiveRequest.followRedirects,
      timeout: effectiveRequest.timeout,
    },
    scope,
  );

  const response = await sendRequest(resolved, { settings: await getSettings() });

  const post = await runScript({
    code: request.scripts?.postResponse,
    phase: 'post',
    request: resolved,
    response,
    environment: env,
    globals: glob,
    requestName: request.name,
  });
  logs.push(...post.logs);
  tests.push(...post.tests);
  env = post.environment;
  glob = post.globals;

  return {
    skipped: false,
    response,
    resolvedRequest: resolved,
    logs,
    tests,
    environment: env,
    globals: glob,
    scriptErrors: { pre: pre.error, post: post.error },
    totalTime: Date.now() - started,
  };
}
