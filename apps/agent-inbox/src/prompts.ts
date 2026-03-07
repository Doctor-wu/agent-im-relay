import { createInterface, type Interface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

export interface PromptContext {
  rl?: Interface;
  answers?: string[];
  output: Writable;
}

export type PromptStreams = {
  input?: Readable;
  output?: Writable;
  answers?: string[];
};

export function createPromptContext(streams: PromptStreams = {}): PromptContext {
  const output = streams.output ?? process.stdout;

  if (streams.answers) {
    return {
      answers: [...streams.answers],
      output,
    };
  }

  return {
    rl: createInterface({
      input: streams.input ?? process.stdin,
      output,
    }),
    output,
  };
}

export async function promptText(
  context: PromptContext,
  label: string,
  options: {
    optional?: boolean;
    defaultValue?: string;
  } = {},
): Promise<string> {
  const suffix = options.defaultValue ? ` [${options.defaultValue}]` : '';
  const prompt = `${label}${suffix}: `;

  if (context.answers) {
    context.output.write(prompt);
    const raw = (context.answers.shift() ?? '').trim();
    const value = raw || options.defaultValue || '';

    if (!value && !options.optional) {
      return promptText(context, label, options);
    }

    return value;
  }

  const raw = (await context.rl!.question(prompt)).trim();
  const value = raw || options.defaultValue || '';

  if (!value && !options.optional) {
    return promptText(context, label, options);
  }

  return value;
}

export async function promptSelect<T extends string>(
  context: PromptContext,
  label: string,
  options: Array<{ value: T; label: string }>,
): Promise<T> {
  context.output.write(`${label}\n`);
  options.forEach((option, index) => {
    context.output.write(`${index + 1}. ${option.label}\n`);
  });

  const answer = await promptText(context, 'Select');
  const choice = Number.parseInt(answer, 10);

  if (!Number.isFinite(choice) || choice < 1 || choice > options.length) {
    return promptSelect(context, label, options);
  }

  return options[choice - 1]!.value;
}
