/**
 * Config jest minimale pour exécuter les tests unitaires ai-agent sans
 * l'outillage complet du repo (enzyme, raf, react-intl...). Usage local :
 *   node_modules/.bin/jest -c jest.arena.config.js
 */
module.exports = {
    rootDir: '.',
    testMatch: ['<rootDir>/test/unit/util/ai-agent-*.test.js'],
    testEnvironment: 'node',
    transform: {
        '^.+\\.[jm]sx?$': ['babel-jest', {
            presets: [['@babel/preset-env', {targets: {node: 'current'}}], '@babel/preset-react'],
            babelrc: false,
            configFile: false
        }]
    }
};
