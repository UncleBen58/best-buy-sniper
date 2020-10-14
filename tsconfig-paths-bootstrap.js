const tsConfig = require('./tsconfig.json');
const tsConfigPaths = require('tsconfig-paths');

const paths = tsConfig.compilerOptions.paths;
const keys = Object.keys(paths);

const parsedPaths = {};

keys.forEach((key) => {
  parsedPaths[key] = paths[key].map((destination) => destination.replace('src', 'dist/src'));
});

tsConfigPaths.register({
  baseUrl: '.',
  paths: parsedPaths
});
