# share-with-me live check (T018)

Date: 2026-10-22

- Offline: `tasksync-chat/test-share-with-me-webex.cjs` PASS EV-SHARE-WITH-ME-WEBEX matched=6 (real script, fake Keychain and fake Webex).
- Live (`ASKAWAY_WEBEX_LIVE=1`, reviewer opt-in): the script exited 0; the General space then held one message with one attached text file `live.txt` (read back through the Webex messages API, 1 file). No ids or tokens recorded here.
- Discrepancy: the script exits 0 on a missing credential and on Webex 401/500 (warning only). The test asserts that behaviour and reports it.
