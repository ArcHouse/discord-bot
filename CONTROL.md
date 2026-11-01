# Zohan server control

The endpoint is disabled unless all three Render variables are configured:

- `SERVER_CONTROL_ENABLED=true`
- `SERVER_CONTROL_GUILD_ID=1269021960042446860`
- `SERVER_CONTROL_SECRET`: the 64-character key in local `.local/control-key.txt`.

The key is separate from the Discord bot token. Do not paste either key into chat, screenshots, logs, commit messages or GitHub. Only the user enters the new credential into Render. Local credentials are in `.local/server-control.json`, excluded from Git.

From this workspace, use `node tools/server-control.cjs .local/snapshot.json` inside `work/server-control`. The helper sends a Bearer header to the pinned HTTPS endpoint; the key is never an argument or output. Keep network access available when using it.

Supported read operations: `snapshot`; `messages` with channelId, optional limit (1–50) and before message ID. Reads include channel content, so use them only for channels relevant to the user's request. Do not read unrelated private conversations.

Supported changes: create/edit text, voice and category channels; create/edit roles; set one role's channel overwrite; send text and edit this bot's own messages. No arbitrary API proxy, code execution, channel deletion, banning, user token access or permission bypass is exposed. Bot role hierarchy and Discord permissions still apply. This is a direct HTTPS helper invoked using the existing local tool, not a newly registered MCP plugin. The local credential file is required on this computer for future chats.

Changes require an explicit user request. First read the current state and present a concrete preview. Submit `{"op":"prepare","plan":{"action":"edit_channel","targetId":"CHANNEL_ID","data":{"topic":"New topic"}}}`. Preparation does not write to Discord. The result has a one-use confirmation token valid for two minutes. Only apply the requested reviewed change with `{"op":"apply","confirmation":"TOKEN"}`. Never retry apply blindly after a timeout; read the current state first. Never use reads or access setup as permission to send messages or change server settings.

Test connection with snapshot, then verify message reading in the private test channel. To verify editing without changing user settings, prepare a no-op edit using the current test channel topic, apply it only within authorized testing, then read it back. Do not publish a message in a public channel for testing. Revoke access by setting SERVER_CONTROL_ENABLED=false or rotating/removing SERVER_CONTROL_SECRET.

The 14:00 Moscow automatic news run must be checked independently. `no_new_items` confirms the scheduled check ran but does not demonstrate fresh delivery. Do not mark both requested items complete until the live connection and the scheduled run are verified. Check the old Telegram bridge only after both items are done, without enabling it or sending test messages.
