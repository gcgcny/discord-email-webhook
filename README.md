# Post incoming emails to Discord

- Receives inbound emails through Postmark (postmarkapp.com).
- Breaks message apart into Discord embeds, then POST it to the specified webhook

If Postmark is unavailable or no longer free, forwardemail is free and will also work, but requires listing the API endpoint publicly, which does present some spam potential. It is preferable to restrict knowledge the endpoint to prevent spam in the Discord channel.
