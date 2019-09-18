const { cores, plugins } = require('isomorphic-git')
const { FileSystem } = require('isomorphic-git/internal-apis')

let i = 0

async function makeLightningFS (dir) {
  const FS = require('@isomorphic-git/lightning-fs')
  const fs = new FileSystem(new FS(`testfs`, {
    wipe: true,
    url: 'http://localhost:9876/base/__tests__/__fixtures__'
  }))
  const core = `core-lightningfs-${i++}`
  cores.create(core).set('fs', fs)
  plugins.set('fs', fs) // deprecated
  dir = `/${dir}`
  const gitdir = `/${dir}.git`
  await fs.mkdir(dir)
  await fs.mkdir(gitdir)
  return { fs, dir, gitdir, core }
}

module.exports.makeLightningFS = makeLightningFS
