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
import { spawn } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';

import semver from 'semver';

import { IgnoreStack } from './ignores.js';
import { PACKAGE_JSON, PackageFile } from './package.js';

async function* lslr(dir: string): AsyncGenerator<string> {
    const obj = await IgnoreStack.forDirectory(dir);
    yield* obj.traverse();
}

export async function copyProject(dir: string): Promise<void> {
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
    try {
        // If we have a .npmrc for the current project, we should use it even if ignored
        await cp('.npmrc', path.resolve(dir, './.npmrc'));
        console.log('Local .npmrc found and copied');
    } catch (error) {
        if (
            error !== null &&
            typeof error === 'object' &&
            (error as NodeJS.ErrnoException).errno === -2 // ENOENT
        ) {
            // If we don't have a .npmrc then hopefully that's fine too -- if not, we'll fail later
            console.log('No local .npmrc to copy');
        } else {
            console.log(error);
        }
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

function markVersionAsDowngradeBuild(version: string | undefined): string {
    if (version) {
        return `${version}-downgraded-build`;
    }
    return '0-downgraded-build';
}

export async function writePackageFile(dir: string) {
    const packageFile = await PACKAGE_JSON;
    const version = markVersionAsDowngradeBuild(packageFile['version']);
    const dependencies = strip(packageFile.dependencies);
    const devDependencies = strip(packageFile.devDependencies);
    const peerDependencies = strip(packageFile.peerDependencies);
    if (peerDependencies && devDependencies) {
        for (const [key, value] of Object.entries(peerDependencies)) {
            devDependencies[key] = value;
        }
    }
    const packageJson: PackageFile = {
        ...packageFile,
        version,
        dependencies,
        devDependencies,
        peerDependencies,
        overrides: {
            ...dependencies,
            ...devDependencies,
        },
    };
    await writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify(packageJson),
    );
}

export async function runNpmInstall(dir: string) {
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
}

export async function runNpmToBuild(dir: string, env: string) {
    const args = ['run', ...process.argv.slice(2)];

    const npm = spawn('npm', args, {
        cwd: dir,
        stdio: 'inherit',
        env: { ...process.env, [env]: '1' },
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
}
