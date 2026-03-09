#!/usr/bin/env node

import { runCli } from './cli.js';

void runCli().catch((error) => {
  console.error('[agent-inbox] failed to start:', error);
  process.exitCode = 1;
});
