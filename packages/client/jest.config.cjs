/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    collectCoverage: true,
    preset: 'ts-jest/presets/js-with-ts-esm',
    resolver: 'jest-ts-webcompat-resolver',
    coveragePathIgnorePatterns: ['mock'],
    roots: ['src'],
};