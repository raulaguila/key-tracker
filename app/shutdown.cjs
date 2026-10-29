// One owner for accepted operations. The deadline only bounds waiting; it never
// pretends an OS write or an external effect can be rolled back.
function drainServices({ engine, tracker, desktopActions, macroService, tray, monitor, storage, configuration }) {
  const call = operation => { try { return operation(); } catch (error) { return Promise.reject(error); } };
  const cleanup = [() => engine?.dispose(), () => tracker?.stop(), () => desktopActions?.dispose(), () => macroService?.dispose(), () => tray?.dispose(), () => monitor?.dispose()].map(call);
  return Promise.allSettled([
    ...cleanup,
    (async () => {
      await Promise.allSettled([configuration, engine?.whenIdle()]);
      await storage?.flush();
    })()
  ]);
}

function waitForShutdown(drain, timeoutMs = 10000) {
  let timer;
  return Promise.race([
    Promise.resolve(drain).then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

module.exports = { drainServices, waitForShutdown };
