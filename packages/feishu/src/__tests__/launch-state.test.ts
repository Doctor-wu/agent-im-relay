import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginFeishuDispatch,
  consumeMirroredFeishuMessageId,
  markFeishuDispatchMessageEmitted,
  rememberMirroredFeishuMessageId,
  resetFeishuLaunchStateForTests,
} from '../index.js';

describe('Feishu launch state', () => {
  beforeEach(() => {
    resetFeishuLaunchStateForTests();
  });

  it('consumes mirrored message ids exactly once', () => {
    rememberMirroredFeishuMessageId('message-mirror-1');

    expect(consumeMirroredFeishuMessageId('message-mirror-1')).toBe(true);
    expect(consumeMirroredFeishuMessageId('message-mirror-1')).toBe(false);
  });

  it('emits each visible message kind at most once per dispatch', () => {
    const dispatch = beginFeishuDispatch('message-user-1');

    expect(markFeishuDispatchMessageEmitted(dispatch.dispatchId, 'interrupt-card')).toBe(true);
    expect(markFeishuDispatchMessageEmitted(dispatch.dispatchId, 'interrupt-card')).toBe(false);
    expect(markFeishuDispatchMessageEmitted(dispatch.dispatchId, 'final-output')).toBe(true);
    expect(markFeishuDispatchMessageEmitted(dispatch.dispatchId, 'final-output')).toBe(false);
  });
});
