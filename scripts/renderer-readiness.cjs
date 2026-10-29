const { setTimeout: delay } = require('node:timers/promises');

// Only the read-only readiness poll may be repeated after a page reload.
// Actions, application exceptions, disconnected targets and other CDP errors fail.
function contextReplaced(error) {
  return error?.method === 'Runtime.evaluate' && error.code === -32000 && [
    'Inspected target navigated or closed',
    'Execution context was destroyed.',
    'Cannot find context with specified id'
  ].includes(error.message);
}

async function waitForRendererCondition({ evaluate, expression, message, timeoutMs = 10000, pollMs = 50 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate('return ' + expression)) return; }
    catch (error) { if (!contextReplaced(error)) throw error; }
    await delay(pollMs);
  }
  let diagnostic;
  try { diagnostic = await evaluate('return document.body.innerText'); }
  catch (error) {
    if (!contextReplaced(error)) throw error;
    throw new Error(message + '\nA página não ficou pronta após a navegação.', { cause: error });
  }
  throw new Error(message + '\n' + diagnostic);
}

module.exports = { waitForRendererCondition };
