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

import { promisify } from 'node:util';
import fs from 'node:fs';

export const readFile = promisify(fs.readFile);
export const readdir = promisify(fs.readdir);
export const mkdtemp = promisify(fs.mkdtemp);
export const writeFile = promisify(fs.writeFile);
export const cp = promisify(fs.cp);
export const mkdir = promisify(fs.mkdir);
