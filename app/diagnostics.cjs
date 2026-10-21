// Diagnostics are constructed field by field. Never spread State or user text here.
function createDiagnostics({ state = {}, versions = {}, platform, arch } = {}) {
  const member = (value, allowed) => allowed.includes(value) ? value : 'unknown';
  const version = value => typeof value === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5}|-(?:alpha|beta|rc|dev|canary)(?:\.\d{1,5})?)?$/.test(value) ? value : null;
  const array = value => Array.isArray(value) ? value : [];
  const layers = array(state.config?.layers);
  const bindings = layers.flatMap(layer => array(layer?.bindings));
  const events = array(state.events);
  const actions = events.filter(event => event?.kind === 'action');
  const durations = actions.map(event => event.durationMs).filter(value => Number.isFinite(value) && value >= 0 && value <= 7 * 24 * 60 * 60 * 1000);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    versions: { app: version(versions.app), electron: version(versions.electron), node: version(versions.node), chrome: version(versions.chrome) },
    host: { platform: member(platform, ['linux', 'win32', 'darwin']), arch: member(arch, ['x64', 'arm64', 'ia32', 'arm']) },
    capabilities: {
      inputGlobal: state.input?.mode === 'global', trackingGlobal: state.tracking?.mode === 'global',
      applicationMonitoring: state.application?.status === 'ready', tray: state.desktop?.trayAvailable === true,
      encryption: state.storage?.encryptionAvailable === true, backup: state.storage?.backupAvailable === true,
      protection: member(state.storage?.protection, ['encrypted', 'plain', 'legacy', 'unavailable'])
    },
    counts: {
      layers: layers.length, bindings: bindings.length, disabledBindings: bindings.filter(binding => binding?.enabled === false).length,
      running: array(state.running).length, registeredShortcuts: array(state.shortcuts?.registered).length, failedShortcuts: array(state.shortcuts?.failed).length,
      events: events.length, actionSuccesses: actions.filter(event => event.status === 'success').length,
      actionErrors: actions.filter(event => event.status === 'error').length, actionCancelled: actions.filter(event => event.status === 'cancelled').length
    },
    timingMs: { samples: durations.length, total: durations.reduce((sum, value) => sum + value, 0), max: durations.length ? Math.max(...durations) : 0 }
  };
}

module.exports = { createDiagnostics };
