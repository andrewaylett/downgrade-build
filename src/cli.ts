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

import path from 'node:path';
import { tmpdir } from 'node:os';

import { mkdtemp } from './fs.js';

import {
    copyProject,
    runNpmInstall,
    runNpmToBuild,
    writePackageFile,
} from './index.js';

const POST_BUILD_TESTS = 'POST_BUILD_TESTS';

export async function run() {
    if (process.env[POST_BUILD_TESTS]) {
        process.exit(0);
    }

    const dir = await mkdtemp(path.join(tmpdir(), 'downgrade-build-'));
    console.log(`Working in: ${dir}`);

    await copyProject(dir);

    await writePackageFile(dir);

    await runNpmInstall(dir);

    await runNpmToBuild(dir, POST_BUILD_TESTS);
}

await run();
