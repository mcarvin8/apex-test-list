'use strict';
/* eslint-disable no-await-in-loop */

import * as fs from 'node:fs';
import { availableParallelism } from 'node:os';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { queue } from 'async';
import { Parser } from 'xml2js';

import { getPackageDirectories } from '../../helpers/getPackageDirectories.js';
import { validateTests } from '../../helpers/validateTests.js';

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
    format: Flags.string({
      summary: messages.getMessage('flags.format.summary'),
      description: messages.getMessage('flags.format.description'),
      char: 'f',
      required: false,
    }),
    manifest: Flags.string({
      summary: messages.getMessage('flags.manifest.summary'),
      description: messages.getMessage('flags.manifest.description'),
      char: 'x',
      required: false,
    }),
  };

  protected static getConcurrencyThreshold(): number {
    const AVAILABLE_PARALLELISM = availableParallelism ? availableParallelism() : Infinity;

    return Math.min(AVAILABLE_PARALLELISM, 6);
  }

  private static parseTestsNames(testNames: string[] | null): string[] {
    if (!testNames || testNames.length === 0) {
      return [];
    }

    // remove the prefix @Tests or @TestSuites
    return testNames
      .join(',')
      .split(',')
      .map((line) => line.replace(/(@Tests|@TestSuites):/, ''))
      .map((line) => line.trim())
      .filter((line) => line);
  }

  private static async searchTestClasses(directory: string, names: string[] | null): Promise<string[]> {
    const testMethodsNames: string[] = [];
    let readDir;

    try {
      readDir = fs.readdirSync(directory, { recursive: true }) as string[];
    } catch (error) {
      throw new Error('Invalid directory.');
    }

    const localFiles = readDir.filter((file) => {
      if (!file.endsWith('.cls') && !file.endsWith('.trigger')) {
        return false;
      }

      const fileFullName: string[] | undefined = file.split('/').pop()?.split('.');

      if (!names) {
        return fileFullName;
      }

      if (fileFullName && fileFullName.length > 0) {
        const formattedName = `${fileFullName[1] === 'cls' ? 'ApexClass' : 'ApexTrigger'}:${fileFullName[0]}`;
        return names.includes(formattedName);
      }
    });

    const handler = (fileName: string): void => {
      const path = `${directory}/${fileName}`;
      const data = fs.readFileSync(path, 'utf-8');
      const testMethods = data.match(TEST_NAME_REGEX);

      testMethodsNames.push(...ApextestsList.parseTestsNames(testMethods));
    };

    const processor = queue((f: string, cb: (error?: Error | undefined) => void) => {
      handler(f);
      cb();
    }, this.getConcurrencyThreshold());

    await processor.push(localFiles);

    if (processor.length() > 0) {
      await processor.drain();
    }

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

  private static async extractClassNamesFromManifestFile(manifestFile: string): Promise<string[]> {
    const result: string[] = [];

    if (!manifestFile || !fs.existsSync(manifestFile)) {
      return result;
    }

    const xmlParser: Parser = new Parser();
    await xmlParser
      .parseStringPromise(fs.readFileSync(manifestFile, 'utf-8'))
      .then((parsed: { Package: { types: Array<{ name: string; members: string[] }> } }) => {
        parsed.Package.types.forEach((type: { name: string; members: string[] }) => {
          if (type.name.includes('ApexClass') || type.name.includes('ApexTrigger')) {
            type.members.forEach((member) => {
              result.push(`${type.name}:${member}`);
            });
          }
        });
      })
      .catch((error) => {
        throw error;
      });

    return result.sort((a, b) => a.localeCompare(b));
  }

  public async run(): Promise<ApextestsListResult> {
    const { flags } = await this.parse(ApextestsList);

    const format = flags.format ?? 'sf';
    const manifest = flags.manifest ?? undefined;

    let result: Promise<ApextestsListResult> | null = null;
    let testClassesNames: string[] | null = null;

    // Get package directories
    const packageDirectories = await getPackageDirectories();

    if (manifest) {
      testClassesNames = await ApextestsList.extractClassNamesFromManifestFile(manifest);
    }

    const allTestMethods: string[] = [];

    // Loop through each directory and search for test classes
    for (const directory of packageDirectories) {
      const testMethodsInDir = await ApextestsList.searchTestClasses(directory, testClassesNames);
      allTestMethods.push(...testMethodsInDir);
    }

    // Validate the test methods after all are gathered
    const { validatedTests, warnings } = await validateTests(allTestMethods, packageDirectories);
    validatedTests.sort((a, b) => a.localeCompare(b));

    if (validatedTests.length > 0) {
      result = ApextestsList.formatList(format, validatedTests);
    }

    if (!result) {
      throw new Error('No test methods found');
    }

    this.log((await result).command);

    if (warnings.length > 0) {
      warnings.forEach((warning) => {
        this.warn(warning);
      });
    }

    return result;
  }
}
