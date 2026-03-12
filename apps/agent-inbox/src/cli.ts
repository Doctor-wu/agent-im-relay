import { mkdir } from 'node:fs/promises';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { resolveRelayPaths } from '@agent-im-relay/core';
import {
  loadAppConfig,
  saveAppConfig,
  type AvailableIm,
  upsertRecord,
} from './config.js';
import { acquirePidLock, registerPidCleanup } from './pid-lock.js';
import { startSelectedIm } from './runtime.js';
import {
  runSetup,
  getUnconfiguredPlatforms,
  PLATFORM_LABELS,
} from './setup.js';

const CONFIGURE_NEW = '__configure_new__' as const;

function orderAvailableIms(
  availableIms: AvailableIm[],
  lastUsedPlatform: AvailableIm['id'] | undefined,
): AvailableIm[] {
  const rememberedPlatform = availableIms.some(im => im.id === lastUsedPlatform)
    ? lastUsedPlatform
    : undefined;

  return availableIms
    .map((im, index) => ({
      im,
      index,
      priority: rememberedPlatform
        ? (im.id === rememberedPlatform ? 0 : 1)
        : (im.id === 'discord' ? 0 : 1),
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ im }) => im);
}

export async function runCli(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Agent Inbox ')));

  const paths = resolveRelayPaths();
  await Promise.all([
    mkdir(paths.homeDir, { recursive: true }),
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.pidsDir, { recursive: true }),
  ]);

  let loaded = await loadAppConfig(paths);

  while (true) {
    const unconfigured = getUnconfiguredPlatforms(loaded.availableIms);

    if (loaded.availableIms.length === 0) {
      if (unconfigured.length === 0) {
        p.log.error('No platforms available to configure.');
        p.outro('Exiting.');
        return;
      }

      p.log.info("No platforms configured yet. Let's set one up.");
      loaded = await runSetup(paths, unconfigured);
      continue;
    }

    const orderedIms = orderAvailableIms(
      loaded.availableIms,
      loaded.lastUsedPlatform,
    );

    const options: Array<{ value: string; label: string; hint?: string }> =
      orderedIms.map(im => ({
        value: im.id,
        label: PLATFORM_LABELS[im.id] ?? im.id,
        hint: im.id === loaded.lastUsedPlatform
          ? 'Last used'
          : (im.note ?? 'configured'),
      }));

    if (unconfigured.length > 0) {
      options.push({
        value: CONFIGURE_NEW,
        label: 'Configure a new platform...',
      });
    }

    const selected = await p.select({
      message: 'Select a platform to start',
      options,
    });

    if (p.isCancel(selected)) {
      p.cancel('Cancelled.');
      return;
    }

    if (selected === CONFIGURE_NEW) {
      loaded = await runSetup(paths, unconfigured);
      continue;
    }

    const selectedIm = loaded.availableIms.find(
      im => im.id === selected,
    )!;

    await saveAppConfig(
      paths,
      upsertRecord(loaded.records, {
        type: 'local-preferences',
        lastUsedPlatform: selectedIm.id,
      }),
    );

    const acquired = await acquirePidLock(paths.pidsDir, selectedIm.id);
    if (!acquired) {
      p.log.error(
        `${PLATFORM_LABELS[selectedIm.id]} is already running. Only one instance per platform is allowed.`,
      );
      p.outro('Exiting.');
      return;
    }

    registerPidCleanup(paths.pidsDir, selectedIm.id);

    const s = p.spinner();
    s.start(`Starting ${PLATFORM_LABELS[selectedIm.id]}...`);

    try {
      s.stop(`${PLATFORM_LABELS[selectedIm.id]} runtime started.`);
      await startSelectedIm(selectedIm, loaded.runtime, paths);
    } catch (error) {
      s.stop(`Failed to start ${PLATFORM_LABELS[selectedIm.id]}.`);
      throw error;
    }

    break;
  }
}
