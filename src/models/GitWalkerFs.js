import { GitIndexManager } from '../managers/GitIndexManager.js'
import { compareStats } from '../utils/compareStats.js'
import { compareStrings } from '../utils/compareStrings.js'
import { log } from '../utils/log.js'
import { normalizeStats } from '../utils/normalizeStats.js'
import { shasum } from '../utils/shasum.js'
import { GitWalkerSymbol } from '../utils/symbols.js'
import { flatFileListToDirectoryStructure } from '../utils/flatFileListToDirectoryStructure.js'

import { FileSystem } from './FileSystem.js'
import { GitObject } from './GitObject.js'

class GitWalkerFs {
  constructor ({ fs: _fs, dir, gitdir }) {
    const fs = new FileSystem(_fs)
    let walker = this
    this.treePromise = (async () => {
      let result = (await fs.readdirDeep(dir)).map(path => {
        // +1 index for trailing slash
        return { path: path.slice(dir.length + 1) }
      })
      return flatFileListToDirectoryStructure(result)
    })()
    this.indexPromise = (async () => {
      let result
      await GitIndexManager.acquire(
        { fs, filepath: `${gitdir}/index` },
        async function (index) {
          result = index.entries
            .filter(entry => entry.flags.stage === 0)
            .reduce((index, entry) => {
              index[entry.path] = entry
              return index
            }, {})
        }
      )
      return result
    })()
    this.fs = fs
    this.dir = dir
    this.gitdir = gitdir
    this.ConstructEntry = class FSEntry {
      constructor (entry) {
        Object.assign(this, entry)
      }
      async populateStat () {
        if (!this.exists) return
        await walker.populateStat(this)
      }
      async populateContent () {
        if (!this.exists) return
        await walker.populateContent(this)
      }
      async populateHash () {
        if (!this.exists) return
        await walker.populateHash(this)
      }
    }
  }
  async readdir (entry) {
    if (!entry.exists) return []
    let filepath = entry.fullpath
    let tree = await this.treePromise
    let inode = tree.get(filepath)
    if (!inode) return null
    if (inode.type === 'blob') return null
    if (inode.type !== 'tree') {
      throw new Error(`ENOTDIR: not a directory, scandir '${filepath}'`)
    }
    return inode.children
      .map(inode => ({
        fullpath: inode.fullpath,
        basename: inode.basename,
        exists: true
        // TODO: Figure out why flatFileListToDirectoryStructure is not returning children
        // sorted correctly for "__tests__/__fixtures__/test-push.git"
      }))
      .sort((a, b) => compareStrings(a.fullpath, b.fullpath))
  }
  async populateStat (entry) {
    if (!entry.exists) return
    let { fs, dir } = this
    let stats = await fs.lstat(`${dir}/${entry.fullpath}`)
    let type = stats.isDirectory() ? 'tree' : 'blob'
    if (type === 'blob' && !stats.isFile() && !stats.isSymbolicLink()) {
      type = 'special'
    }
    if (!stats) {
      throw new Error(
        `ENOENT: no such file or directory, lstat '${entry.fullpath}'`
      )
    }
    stats = normalizeStats(stats)
    Object.assign(entry, { type }, stats)
  }
  async populateContent (entry) {
    if (!entry.exists) return
    let { fs, dir } = this
    let content = await fs.read(`${dir}/${entry.fullpath}`)
    // workaround for a BrowserFS edge case
    if (entry.size === -1) entry.size = content.length
    Object.assign(entry, { content })
  }
  async populateHash (entry) {
    if (!entry.exists) return
    let index = await this.indexPromise
    let stage = index[entry.fullpath]
    let oid
    if (!stage || compareStats(entry, stage)) {
      log(`INDEX CACHE MISS: calculating SHA for ${entry.fullpath}`)
      if (!entry.content) await entry.populateContent()
      oid = shasum(GitObject.wrap({ type: 'blob', object: entry.content }))
    } else {
      // Use the index SHA1 rather than compute it
      oid = stage.oid
    }
    Object.assign(entry, { oid })
  }
}

export function WORKDIR ({ fs, dir, gitdir }) {
  let o = Object.create(null)
  Object.defineProperty(o, GitWalkerSymbol, {
    value: function () {
      return new GitWalkerFs({ fs, dir, gitdir })
    }
  })
  Object.freeze(o)
  return o
}
