const ts = require("typescript");
const fs = require('fs');
const path = require('path');
const get = require('lodash.get');
const axios = require('axios');
const download = require('download');

const Logger = {
  debug: (label, message) => {
    if (
      process.env?.W5MF_TYPES_DEBUG_LEVEL === 'INFO' ||
      process.env?.W5MF_TYPES_DEBUG_LEVEL === 'ERROR'
    ) {
      return;
    }
    console.log(`[W5MF-TYPES][DEBUG][${label}]`, message);
  },
  info: (label, message) => {
    if (
      process.env?.W5MF_TYPES_DEBUG_LEVEL === 'ERROR'
    ) {
      return;
    }
    console.log(`[W5MF-TYPES][INFO][${label}]`, message);
  },
  error: (label, message) => {
    console.log(`[W5MF-TYPES][ERROR][${label}]`, message);
  },
}

const getFileList = (dirName) => {
  let files = [];
  Logger.debug('getFileList:dirName', dirName);

  try {
    const items = fs.readdirSync(dirName, { withFileTypes: true });
    Logger.debug('getFileList:items', items);

    for (const item of items) {
      if (item.isDirectory()) {
        files = [...files, ...getFileList(`${dirName}/${item.name}`)];
      } else {
        files.push(`${dirName}/${item.name}`);
      }
    }
  } catch (e) {
    Logger.error(`Error read dirs and files: ${dirName}`, e);
  }

  Logger.debug('getFileList:files', files);
  return files;
}

module.exports = class W5MFTypesPlugin {
  constructor(options) {
    this.options = options; // exposes, remotes, rootDir, typesDir, typesFile, appName, installDir
    Logger.debug('constructor:options', this.options);
  }

  apply(compiler) {
    const wmfPlugin = compiler.options.plugins.find((plugin) => {
      return plugin.constructor.name === 'ModuleFederationPlugin';
    });
    const wmfOptions = get(wmfPlugin, '_options') || null;
    Logger.debug('apply:wmfOptions', wmfOptions);

    const rootDir = this.options?.rootDir || (process?.env?.NODE_ENV === 'development' ? 'public' : 'build');
    const typesDir = this.options?.typesDir || '@types';
    const typesFile = this.options?.typesFile || '@types.json';
    const exposedComponents = this.options?.exposes || wmfOptions.exposes || {};
    const remoteComponents = this.options?.remotes || wmfOptions.remotes || {};
    const appName = this.options?.appName || wmfOptions.name;
    const installDir = this.options?.installDir || './node_modules';

    const pathTypesDir = `${rootDir}/${typesDir}/${appName}`;
    const pathTypesFile = `${rootDir}/${typesFile}`;

    Logger.debug('apply:variables', `
      rootDir: ${rootDir};
      typesDir: ${typesDir};
      typesFile: ${typesFile};
      exposedComponents: ${exposedComponents};
      remoteComponents: ${remoteComponents};
      appName: ${appName};
      installDir: ${installDir};
      pathTypesDir: ${pathTypesDir};
      pathTypesFile: ${pathTypesFile};
    `);

    const run = (compilation) => {
      Logger.info('run', compilation);
      if (Object.keys(exposedComponents).length) {
        let exposedFiles = [];
        Object.values(exposedComponents).forEach(exposedPath => {
          const files = getFileList(exposedPath);
          exposedFiles = [...exposedFiles, ...files.map(file => {
            if (/\.(ts|tsx)$/.test(file)) {
              return file;
            }
          })];
        });
        Logger.debug('apply:run:exposedFiles', exposedFiles);

        ts.createProgram(exposedFiles.filter(file => !!file), {
          declaration: true,
          emitDeclarationOnly: true,
          outDir: pathTypesDir,
        }).emit();

        const files = getFileList(pathTypesDir);

        const declare = [];
        const pathsModule = [];

        files.forEach(file => {
          let pathModule = file.split('/');
          pathModule = pathModule.slice(2, pathModule.length - 1).join('/');

          if (pathModule === appName) return;
          if (pathsModule.includes(pathModule)) return;
          pathsModule.push(pathModule);

          const filesModule = getFileList(path.dirname(file));

          const fileData = filesModule.map(fileModule => {
            try {
              return fs.readFileSync(fileModule, 'utf8');
            } catch (e) {
              Logger.error('Error read file', e);
            }
          });

          declare.push(`declare module '${pathModule}' {\n${fileData.join('\n')}\n};\n`);
        });

        Logger.debug(`Write file: ${pathTypesDir}/index.d.ts`);
        Logger.debug('apply:run:declare', declare);

        fs.writeFileSync(
          `${pathTypesDir}/index.d.ts`,
          declare.join('\n'),
        );

        fs.writeFileSync(
          pathTypesFile,
          JSON.stringify(
            files.map(path => path.replace(new RegExp(`^${rootDir}/`), '')),
          ),
          (e) => {
            if (e) {
              Logger.error('Error saving the types index', e);
            }
          }
        );
      }

      if (Object.keys(remoteComponents).length) {
        const remoteUrls = Object.values(remoteComponents).map(remoteComponent => {
          const url = remoteComponent.split('@')[1].split('/');
          return url.slice(0, url.length - 1).join('/');
        });
        Logger.debug('apply:run:remoteUrls', remoteUrls);

        remoteUrls.forEach(remote => {
          axios.get(`${remote}/${typesFile}`)
            .then(indexFileResp => {
              Logger.debug(`apply.run.remote:${remote}/${typesFile}`, indexFileResp);
              indexFileResp.data?.forEach(file => {
                Logger.debug(`apply.run.remote:file:${remote}/${file}`, file);
                Logger.debug(`apply.run.remote:download:${remote}/${file}`, `${installDir}/${path.dirname(file)}`);
                download(`${remote}/${file}`, `${installDir}/${path.dirname(file)}`)
              });
            })
            .catch((e) => {
              Logger.error('Error fetching/writing types', e);
            });
        });
      }
    };

    compiler.hooks.beforeCompile.tap("W5MFTypes", (compilation) => {
      run(compilation);
    });
  }
};
