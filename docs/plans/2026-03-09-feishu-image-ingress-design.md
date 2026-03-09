# Feishu Image Ingress Design

**Context**

Feishu inbound handling in `packages/feishu` currently only treats `message_type: "file"` as an attachment-bearing event. Image messages are ignored as attachments, and richer message bodies such as `post` are not parsed for embedded text or image resources. That leaves image-bearing user messages falling through to prompt validation and replying with `Please include a prompt after mentioning the bot.` even when the user already supplied text.

**Decision**

Keep the fix scoped to `packages/feishu` and preserve the existing `@agent-im-relay/core` attachment pipeline.

The Feishu adapter will:

- normalize inbound attachment extraction for both `file` and `image`
- carry the resource type through download so Feishu resource fetches use the correct `type` query
- extract prompt text from both plain text messages and `post` rich-text messages
- extract embedded image resources from `post` rich-text messages and queue them as pending attachments

**Why this shape**

- `core` already supports image attachments generically once the platform adapter supplies `RemoteAttachmentLike`
- the reported bug can happen through more than one Feishu payload shape, so a file-only patch would be incomplete
- confining the change to `packages/feishu` reduces regression risk for Discord and shared runtime code

**Testing**

Add regression coverage in `packages/feishu/src/__tests__/events.test.ts` for:

- `message_type: "image"` queues an attachment instead of falling through to missing-prompt handling
- `message_type: "post"` with text plus embedded image starts a run with extracted prompt text and queued attachment(s)
