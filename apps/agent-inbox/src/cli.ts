import { mkdir } from 'node:fs/promises';
import { resolveRelayPaths } from '@agent-im-relay/core';
import { loadAppConfig, type AvailableIm } from './config.js';
import { createPromptContext, promptSelect, type PromptStreams } from './prompts.js';
import { startSelectedIm } from './runtime.js';
import { runSetup } from './setup.js';

function canPrompt(streams: PromptStreams): boolean {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  return Boolean(input.isTTY && output.isTTY);
}

async function selectIm(
  availableIms: AvailableIm[],
  streams: PromptStreams = {},
): Promise<AvailableIm> {
  if (availableIms.length === 1) {
    return availableIms[0]!;
  }

  const context = createPromptContext(streams);

  try {
    const value = await promptSelect(
      context,
      'Choose which IM to start',
      availableIms.map((im) => ({
        value: im.id,
        label: im.note ? `${im.id} - ${im.note}` : im.id,
      })),
    );

    return availableIms.find(im => im.id === value)!;
  } finally {
    context.rl?.close();
  }
}

export async function runCli(streams: PromptStreams = {}): Promise<void> {
  const paths = resolveRelayPaths();
  await Promise.all([
    mkdir(paths.homeDir, { recursive: true }),
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
  ]);

  let loaded = await loadAppConfig(paths);
  if (loaded.availableIms.length === 0) {
    if (!canPrompt(streams)) {
      throw new Error(`No configured IM found. Create ${paths.configFile} or run the program in an interactive terminal.`);
    }

    loaded = await runSetup(paths, streams);
  }

  if (loaded.availableIms.length === 0) {
    throw new Error(`No valid IM configuration found in ${paths.configFile}.`);
  }

  if (loaded.availableIms.length > 1 && !canPrompt(streams)) {
    throw new Error(
      `Multiple IM configurations found in ${paths.configFile}. Run the program in an interactive terminal to choose one.`,
    );
  }

  const selectedIm = await selectIm(loaded.availableIms, streams);
  await startSelectedIm(selectedIm, loaded.runtime, paths);
}
