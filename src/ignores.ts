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

import path from 'node:path';

import ignore from 'ignore';

import { readdir, readFile } from './fs.js';

import type { Dirent } from 'node:fs';
import type { Ignore } from 'ignore';

type StackEntry = {
    child: string;
    ignore: Ignore;
};

export class IgnoreStack {
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
            const ig = ignore.default();
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
        const entries: Dirent[] = await readdir(this.#root, {
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
                    const ig = ignore.default();
                    ig.add(ignoreFile.toString());
                    pushStack.push({ child: '.', ignore: ig });
                } catch (error) {
                    if (
                        error === null ||
                        typeof error !== 'object' ||
                        (error as NodeJS.ErrnoException).errno !== -2 // ENOENT
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
