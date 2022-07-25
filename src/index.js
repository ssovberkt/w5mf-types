const ts = require("typescript");
const fs = require('fs');
const path = require('path');
const get = require('lodash.get');
const axios = require('axios');
const download = require('download');

const getFileList = (dirName) => {
  let files = [];
  try {
    const items = fs.readdirSync(dirName, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        files = [...files, ...getFileList(`${dirName}/${item.name}`)];
      } else {
        files.push(`${dirName}/${item.name}`);
      }
    }
  } catch (e) {
    console.log('Error read dirs and files', e);
  }

  return files;
}

module.exports = class W5MFTypesPlugin {
  constructor(options) {
    this.options = options; // exposes, remotes, rootDir, typesDir, typesFile, appName, installDir
  }

  apply(compiler) {
    const wmfPlugin = compiler.options.plugins.find((plugin) => {
      return plugin.constructor.name === 'ModuleFederationPlugin'
    });
    const wmfOptions = get(wmfPlugin, '_options') || null

    const rootDir = this.options?.rootDir || (process?.env?.NODE_ENV === 'development' ? 'public' : 'build')
    const typesDir = this.options?.typesDir || '@types'
    const typesFile = this.options?.typesFile || '@types.json'
    const exposedComponents = this.options?.exposes || wmfOptions.exposes || {}
    const remoteComponents = this.options?.remotes || wmfOptions.remotes || {}
    const appName = this.options?.appName || wmfOptions.name
    const installDir = this.options?.installDir || './node_modules'

    const pathTypesDir = `${rootDir}/${typesDir}/${appName}`
    const pathTypesFile = `${rootDir}/${typesFile}`

    const run = () => {
      if (Object.keys(exposedComponents).length) {
        let exposedFiles = []
        Object.values(exposedComponents).forEach(exposedPath => {
          const files = getFileList(exposedPath)
          exposedFiles = [...exposedFiles, ...files.map(file => {
            if (/\.(ts|tsx)$/.test(file)) {
              return file
            }
          })]
        })

        ts.createProgram(exposedFiles.filter(file => !!file), {
          declaration: true,
          emitDeclarationOnly: true,
          outDir: pathTypesDir,
        }).emit();

        const files = getFileList(pathTypesDir)

        const declare = []
        const pathsModule = []

        files.forEach(file => {
          let pathModule = file.split('/')
          pathModule = pathModule.slice(2, pathModule.length - 1).join('/')

          if (pathModule === appName) return
          if (pathsModule.includes(pathModule)) return
          pathsModule.push(pathModule)

          const filesModule = getFileList(path.dirname(file))

          const fileData = filesModule.map(fileModule => {
            try {
              return fs.readFileSync(fileModule, 'utf8')
            } catch (e) {
              console.log('Error read file', e)
            }
          })

          declare.push(`declare module '${pathModule}' {\n${fileData.join('\n')}\n};\n`)
        })

        fs.writeFileSync(
          `${pathTypesDir}/index.d.ts`,
          declare.join('\n'),
        )

        fs.writeFileSync(pathTypesFile, JSON.stringify(files.map(path => path.replace(new RegExp(`^${rootDir}/`), ''))), (e) => {
          if (e) {
            console.log('Error saving the types index', e)
          }
        })
      }

      if (Object.keys(remoteComponents).length) {
        const remoteUrls = Object.values(remoteComponents).map(remoteComponent => {
          const url = new URL(remoteComponent.split('@')[1])
          return url.origin
        })

        remoteUrls.forEach(remote => {
          axios.get(`${remote}/${typesFile}`)
            .then(indexFileResp => {
              indexFileResp.data?.forEach(file => {
                download(`${remote}/${file}`, `${installDir}/${path.dirname(file)}`)
              })
            })
            .catch(e => console.log('Error fetching / writing types', e))
        })
      }
    };

    compiler.hooks.afterCompile.tap("W5MFTypes", (compilation) => {
      run(compilation);
    });
  }
};
