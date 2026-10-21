const { build } = require('../package.json');

// Development artifacts remain unsigned. Public candidates must fail closed.
module.exports = {
  ...build,
  forceCodeSigning: true,
  mac: {
    ...build.mac, hardenedRuntime: true, notarize: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist'
  }
};
