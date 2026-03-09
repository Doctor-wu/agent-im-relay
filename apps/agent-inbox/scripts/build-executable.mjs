import { chmod, copyFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(packageDir, 'dist');
const entryFile = join(distDir, 'index.mjs');
const blobFile = join(distDir, 'agent-inbox.blob');
const seaConfigFile = join(distDir, 'sea-config.json');
const executableFile = join(
  distDir,
  process.platform === 'win32' ? 'agent-inbox.exe' : 'agent-inbox',
);
const postjectCli = join(packageDir, 'node_modules', 'postject', 'dist', 'cli.js');
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

await writeFile(seaConfigFile, JSON.stringify({
  main: entryFile,
  output: blobFile,
  disableExperimentalSEAWarning: true,
}, null, 2));

run(process.execPath, ['--experimental-sea-config', seaConfigFile]);
await copyFile(process.execPath, executableFile);

if (process.platform !== 'win32') {
  await chmod(executableFile, 0o755);
}

const postjectArgs = [
  postjectCli,
  executableFile,
  'NODE_SEA_BLOB',
  blobFile,
  '--sentinel-fuse',
  fuse,
];

if (process.platform === 'darwin') {
  postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}

run(process.execPath, postjectArgs);

await rm(blobFile, { force: true });
await rm(seaConfigFile, { force: true });
