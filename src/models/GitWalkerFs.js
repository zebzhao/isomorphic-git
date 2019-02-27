import { GitIndexManager } from '../managers/GitIndexManager.js'
import { compareStats } from '../utils/compareStats.js'
import { join } from '../utils/join'
import { log } from '../utils/log.js'
import { normalizeStats } from '../utils/normalizeStats.js'
import { shasum } from '../utils/shasum.js'
import { flatFileListToDirectoryStructure } from '../utils/flatFileListToDirectoryStructure.js'

import { FileSystem } from './FileSystem.js'
import { GitObject } from './GitObject.js'

export class GitWalkerFs {
  constructor ({ fs: _fs, dir, gitdir }) {
    const fs = new FileSystem(_fs)
    const walker = this
    this.treePromise = (async () => {
      const result = (await fs.readdirDeep(dir)).map(path => {
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
    const filepath = entry.fullpath
    const { fs, dir } = this
    const names = await fs.readdir(join(dir, filepath))
    if (names === null) return null
    return names.map(name => ({
      fullpath: join(filepath, name),
      basename: name,
      exists: true
    }))
  }

  async populateStat (entry) {
    if (!entry.exists) return
    const { fs, dir } = this
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
    const { fs, dir } = this
    const content = await fs.read(`${dir}/${entry.fullpath}`)
    // workaround for a BrowserFS edge case
    if (entry.size === -1) entry.size = content.length
    Object.assign(entry, { content })
  }

  async populateHash (entry) {
    if (!entry.exists) return
    const index = await this.indexPromise
    const stage = index[entry.fullpath]
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
