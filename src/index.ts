#!/usr/bin/env -S node --experimental-vm-modules

/*
 * Copyright 2022 Andrew Aylett
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { readFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

import semver from 'semver';
import { default as ignore } from 'ignore';

import type { Ignore } from 'ignore';

import ErrnoException = NodeJS.ErrnoException;

type StringOrStringRecord = string | Record<string, string>;
type NestedStringRecords =
    | number
    | boolean
    | string
    | { [s: string]: NestedStringRecords };

type PackageFile = Partial<
    Record<string, NestedStringRecords> & {
        source: string;
        main: string;
        types: string;
        bin: StringOrStringRecord;
        exports: Record<string, string>;
        imports: Record<string, StringOrStringRecord>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        peerDependencies: Record<string, string>;
    }
>;

const POST_BUILD_TESTS = 'POST_BUILD_TESTS';

if (process.env[POST_BUILD_TESTS]) {
    process.exit(0);
}

const PACKAGE_JSON: PackageFile = JSON.parse(
    readFileSync('./package.json').toString(),
);

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);

type StackEntry = {
    child: string;
    ignore: Ignore;
};

class IgnoreStack {
    readonly #stack: StackEntry[];
    readonly #root: string;

    private constructor(root: string, stack: StackEntry[]) {
        this.#root = root;
        this.#stack = stack;
    }

    static async forDirectory(dir: string): Promise<IgnoreStack> {
        const absolute = path.resolve(dir);
        const parsed = path.parse(absolute);
        const root = parsed.root;
        let body = parsed.dir.slice(root.length);
        if (path.sep === '\\') {
            body = body.replace('\\', '/');
        }
        const split = body.split('/');
        split.push(parsed.name);

        const [stack, _] = await IgnoreStack.buildIgnoreFiles(root, split);

        return new IgnoreStack(absolute, stack);
    }

    static async buildIgnoreFiles(
        root: string,
        split: string[],
    ): Promise<[StackEntry[], string]> {
        const child = split.shift() ?? '';

        const [stack, residual] = child
            ? await IgnoreStack.buildIgnoreFiles(path.join(root, child), split)
            : [[], ''];
        try {
            const buf = await readFile(path.join(root, '.gitignore'));
            const ig = ignore();
            ig.add(buf.toString());
            stack.unshift({ ignore: ig, child: path.join(child, residual) });
            return [stack, ''];
        } catch {
            return [stack, path.join(child, residual)];
        }
    }

    async *traverse(): AsyncGenerator<string> {
        yield* this.recurse(path.resolve(this.#root));
    }

    async *recurse(relative: string): AsyncGenerator<string> {
        const entries: fs.Dirent[] = await readdir(this.#root, {
            withFileTypes: true,
        });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const name = entry.name;
                if (name === '.git' || name === 'node_modules') {
                    continue;
                }
                const pushStack = [...this.#stack];
                const current = pushStack.pop();
                if (current) {
                    pushStack.push({
                        child: path.join(current.child, name),
                        ignore: current.ignore,
                    });
                }

                try {
                    const ignoreFile = await readFile(
                        path.join(this.#root, name, '.gitignore'),
                    );
                    const ig = ignore();
                    ig.add(ignoreFile.toString());
                    pushStack.push({ child: '.', ignore: ig });
                } catch (error) {
                    if (
                        error === null ||
                        typeof error !== 'object' ||
                        (error as ErrnoException).errno !== -2 // ENOENT
                    ) {
                        console.log(error);
                    }
                    // If it doesn't exist, that's fine.  If it does, we should
                    // read it or die trying.
                }
                yield* new IgnoreStack(
                    path.join(this.#root, name),
                    pushStack,
                ).recurse(relative);
            } else {
                if (!this.ignored(entry.name)) {
                    yield path.relative(
                        relative,
                        path.join(this.#root, entry.name),
                    );
                }
            }
        }
    }

    ignored(name: string): boolean {
        type TestResult = {
            name: string;
            ignored: boolean;
            unignored: boolean;
        };
        const result = this.#stack.reduceRight(
            (previous, current): TestResult => {
                const newName = path.join(current.child, previous.name);
                const r = current.ignore.test(newName);
                return {
                    name: newName,
                    ignored: r.ignored && !previous.unignored,
                    unignored: r.unignored && !previous.ignored,
                };
            },
            {
                name,
                ignored: false,
                unignored: false,
            },
        );
        return result.ignored;
    }
}

async function* lslr(dir: string): AsyncGenerator<string> {
    const obj = await IgnoreStack.forDirectory(dir);
    yield* obj.traverse();
}

const mkdtemp: typeof fs.mkdtemp.__promisify__ = promisify(fs.mkdtemp);
const writeFile: typeof fs.writeFile.__promisify__ = promisify(fs.writeFile);
const cp = promisify(fs.cp);
const mkdir = promisify(fs.mkdir);

const dir = await mkdtemp(path.join(os.tmpdir(), 'downgrade-build-'));
console.log(`Working in: ${dir}`);

for await (const file of lslr('.')) {
    if (path.parse(file).base === 'package-lock.json') {
        continue;
    }
    try {
        const target = path.resolve(dir, file);
        await mkdir(path.parse(target).dir, { recursive: true });
        await cp(file, target);
    } catch (error) {
        console.log(error);
    }
}

type VersionSpec = { [s: string]: string } | undefined;
const strip = <T extends VersionSpec>(deps: T): T => {
    if (!deps) {
        return deps;
    }
    return Object.fromEntries(
        Object.entries(deps).map(
            ([k, v]: [string, string]): [string, string] => {
                const min = semver.minVersion(v);
                if (!min) {
                    throw new Error(`No semver minimum for ${v}`);
                }
                return [k, min.format()];
            },
        ),
    ) as T;
};
const dependencies = strip(PACKAGE_JSON.dependencies);
const devDependencies = strip(PACKAGE_JSON.devDependencies);
const peerDependencies = strip(PACKAGE_JSON.peerDependencies);
if (peerDependencies && devDependencies) {
    for (const [key, value] of Object.entries(peerDependencies)) {
        devDependencies[key] = value;
    }
}
const packageJson: PackageFile = {
    ...PACKAGE_JSON,
    dependencies,
    devDependencies,
    peerDependencies,
    overrides: {
        ...dependencies,
        ...devDependencies,
    },
};
await writeFile(path.join(dir, 'package.json'), JSON.stringify(packageJson));

const install = spawn('npm', ['install'], { cwd: dir, stdio: 'inherit' });

await new Promise((resolve, reject) => {
    install.on('exit', (code, signal) => {
        if (code === 0) {
            resolve(code);
        }
        reject(
            new Error(
                `npm install exited with status code ${code} due to signal ${signal}`,
            ),
        );
    });
});

const args = ['run', ...process.argv.slice(2)];

const npm = spawn('npm', args, {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, [POST_BUILD_TESTS]: '1' },
});

await new Promise((resolve, reject) => {
    npm.on('exit', (code, signal) => {
        if (code === 0) {
            resolve(code);
        }
        reject(
            new Error(
                `npm ${args.join(
                    ' ',
                )} exited with status code ${code} due to signal ${signal}`,
            ),
        );
    });
});
