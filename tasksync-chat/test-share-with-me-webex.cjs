// FR-036 forbids reading real Keychain credentials even in Webex tests.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
if (process.env.ASKAWAY_WEBEX_LIVE !== '1') {
    console.log('SKIP EV-SHARE-WITH-ME-WEBEX matched=0 live arrival requires ASKAWAY_WEBEX_LIVE=1; no network or credentials read');
} else {
    console.error('BLOCKED EV-SHARE-WITH-ME-WEBEX matched=0: existing external script uses real Keychain; FR-036 requires an injectable fake credential boundary and independent arrival evidence');
    process.exitCode = 1;
}
