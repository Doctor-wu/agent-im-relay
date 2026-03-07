import { startManagedFeishuRelayClient } from '../index.js';

void startManagedFeishuRelayClient().catch((error) => {
  console.error('[feishu-client] failed to start:', error);
  process.exitCode = 1;
});
