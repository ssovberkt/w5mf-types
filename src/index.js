const tar = require('tar');
const download = require('download');

module.exports = class W5MFTypesPlugin {
  constructor(options) {
    this.options = options; // appDir, publicDir, typesDir, archiveFile, type, remotes
  }

  apply(compiler) {
    const TYPE = this.options.type;
    const PUBLIC_DIR = this.options?.publicDir || (process.env.NODE_ENV === 'production' ? 'build' : 'public');
    const TYPES_DIR = this.options?.typesDir || 'types';
    const ARCHIVE_FILE = this.options?.archiveFile || 'types.tar';
    const REMOTES = this.options?.remotes || {};

    compiler.hooks.assetEmitted.tap("W5MFTypes", async (compilation) => {
      if (!TYPE) {
        console.log('[W5MF-TYPES][ERROR]', 'Type not specified');
        return;
      }

      if (TYPE === 'get') {
        const remotes = Object.values(REMOTES);
        for (let i in remotes) {
          const remote = remotes[i].split('@')[1].split('/');
          const url = remote.slice(0, remote.length - 1).join('/');
          await download(`${url}/${ARCHIVE_FILE}`, TYPES_DIR);
          tar.x({ file: 'types.tar' });
        }
      }

      if (TYPE === 'set') {
        tar.create({ gzip: false, file: `${PUBLIC_DIR}/${ARCHIVE_FILE}` }, [TYPES_DIR]);
        return;
      }

      console.log('[W5MF-TYPES][ERROR]', `Type ${TYPE} not found`);
    });
  }
};
