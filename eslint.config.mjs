import { defineConfig, globalIgnores } from 'eslint/config';
import andrewaylett from 'eslint-config-andrewaylett';

export default defineConfig([
    globalIgnores(['**/dist', '**/build']),
    ...andrewaylett,
    {
        rules: {
            'jest/no-deprecated-functions': 0,
        },
    },
]);
