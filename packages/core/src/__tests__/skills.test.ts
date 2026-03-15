import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSkillFrontmatter, readSkillsFromDirectory } from '../skills';

const tempDirs: string[] = [];

describe('parseSkillFrontmatter', () => {
  it('extracts name and description from YAML frontmatter', () => {
    const markdown = `---
name: vitest
description: "Write tests"
---

Body`;

    expect(parseSkillFrontmatter(markdown)).toEqual({
      name: 'vitest',
      description: 'Write tests',
    });
  });

  it('returns null when required fields are missing', () => {
    expect(parseSkillFrontmatter('No frontmatter here')).toBeNull();
    expect(parseSkillFrontmatter('---\nname: only-name\n---')).toBeNull();
  });
});

describe('readSkillsFromDirectory', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }));
  });

  it('reads skill metadata from subdirectories and sorts by name', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'skills-'));
    tempDirs.push(rootDir);

    const alphaDir = path.join(rootDir, 'alpha');
    const zetaDir = path.join(rootDir, 'zeta');
    const ignoredDir = path.join(rootDir, 'ignored');

    await Promise.all([
      mkdir(alphaDir),
      mkdir(zetaDir),
      mkdir(ignoredDir),
    ]);

    await Promise.all([
      writeFile(path.join(zetaDir, 'SKILL.md'), '---\nname: zeta\ndescription: Last skill\n---\n'),
      writeFile(path.join(alphaDir, 'SKILL.md'), '---\nname: alpha\ndescription: First skill\n---\n'),
      writeFile(path.join(ignoredDir, 'README.md'), '# nope\n'),
    ]);

    await expect(readSkillsFromDirectory(rootDir)).resolves.toEqual([
      {
        name: 'alpha',
        description: 'First skill',
        dir: alphaDir,
      },
      {
        name: 'zeta',
        description: 'Last skill',
        dir: zetaDir,
      },
    ]);
  });

  it('returns an empty list when the directory does not exist', async () => {
    const missingDir = path.join(tmpdir(), `missing-skills-${Date.now()}`);
    await expect(readSkillsFromDirectory(missingDir)).resolves.toEqual([]);
  });
});
