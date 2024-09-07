import * as fs from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('apextestlist', 'apextests.list');
const TEST_NAME_REGEX = /(@(Tests|TestSuites)).+/g;

export type ApextestsListResult = {
  tests: string[];
  command: string;
  // TODO: in the future, return the test suites as well
};

export default class ApextestsList extends SfCommand<ApextestsListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    directory: Flags.string({
      summary: messages.getMessage('flags.directory.summary'),
      description: messages.getMessage('flags.directory.description'),
      char: 'd',
      required: false,
    }),
    format: Flags.string({
      summary: messages.getMessage('flags.format.summary'),
      description: messages.getMessage('flags.format.description'),
      char: 'f',
      required: false,
    }),
    // TODO: add manifest flag
  };

  private static parseTestsNames(data: string): string[] {
    // remove the prefix @Tests or @TestSuites
    return data
      .split(',')
      .map((line) => line.replace(/(@Tests|@TestSuites):/, ''))
      .map((line) => line.trim());
      .filter((line) => line);
  }

  private static async listTestsInDirectory(directory: string): Promise<string[]> {
    // check if the provided directory exists
    if (!directory) {
      throw new Error('Invalid directory.');
    }

    let readDir;

    try {
      readDir = fs.readdirSync(directory, { recursive: true }) as string[];
    } catch (error) {
      throw new Error('Invalid directory.');
    }

    const files = readDir.filter((file) => file.endsWith('.cls') || file.endsWith('.trigger'));
    const testMethodsNames: string[] = [];

    const readPromises = files.map(async (file) => {
      try {
        const data = await fs.promises.readFile(`${directory}/${file}`, 'utf-8');
        // try to find, with a RegEx, the test methods listed at the top of the
        // file with @Tests or @TestSuites
        const testMethods = data.match(TEST_NAME_REGEX);
        // for each entry, parse the names
        testMethodsNames.push(...(testMethods ? ApextestsList.parseTestsNames(testMethods.join(',')) : []));
      } catch (error) {
        throw new Error('Invalid file.');
      }
    });

    await Promise.all(readPromises);

    return testMethodsNames.sort();
  }

  private static formatList(format: string, tests: string[]): Promise<ApextestsListResult> {
    switch (format) {
      case 'sf':
        return Promise.resolve({
          tests,
          command: '--tests ' + tests.join(' '),
        });
      case 'csv':
        return Promise.resolve({
          tests,
          command: tests.join(','),
        });
      default:
        throw new Error('Invalid format.');
    }
  }

  public async run(): Promise<ApextestsListResult> {
    const { flags } = await this.parse(ApextestsList);

    const directory = flags.directory ?? '.';
    const format = flags.format ?? 'sf';

    if (!directory) {
      throw new Error('Directory must be provided.');
    }

    let result: Promise<ApextestsListResult> | null = null;

    if (directory) {
      result = ApextestsList.formatList(format, await ApextestsList.listTestsInDirectory(directory));
    }

    if (!result) {
      throw new Error('No directory or manifest provided');
    }

    this.log((await result).command);

    return result;
  }
}
