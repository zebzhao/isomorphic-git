// @ts-check
import { GitIgnoreManager } from '../managers/GitIgnoreManager.js'
import { GitIndexManager } from '../managers/GitIndexManager.js'
import { GitIndex } from '../models/GitIndex'
import { FileSystem } from '../models/FileSystem.js'
import { E, GitError } from '../models/GitError.js'
import { writeObject } from '../storage/writeObject.js'
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'

/**
 * Add a file to the git index (aka staging area)
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin_fs.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.filepath - The path to the file to add to the index
 *
 * @returns {Promise<void>} Resolves successfully once the git index has been updated
 *
 * @example
 * await new Promise((resolve, reject) => fs.writeFile(
 *   '$input((/README.md))',
 *   `$textarea((# TEST))`,
 *   (err) => err ? reject(err) : resolve()
 * ))
 * await git.add({ dir: '$input((/))', filepath: '$input((README.md))' })
 * console.log('done')
 *
 */
export async function add ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  filepath
}) {
  try {
    const fs = new FileSystem(_fs)
    let added = []
    await GitIndexManager.acquire(
      { fs, filepath: `${gitdir}/index` },
      async function (index) {
        await addToIndex({ dir, gitdir, fs, filepath, index, added })
      }
    )
    if (emitter) {
      emitter.emit(`${emitterPrefix}add`, {
        filepath,
        added
      })
    }
    return added
  } catch (err) {
    err.caller = 'git.add'
    throw err
  }
}

async function addToIndex ({ dir, gitdir, fs, filepath, index, added }) {
  const stage = index.entriesMap.get(GitIndex.key(filepath, 0)) ||
    index.entriesMap.get(GitIndex.key(filepath, 2))
  if (!stage) {
    // Should ignore UNLESS it's already in the index.
    const ignored = await GitIgnoreManager.isIgnored({
      fs,
      dir,
      gitdir,
      filepath
    })
    if (ignored) return
  }
  const stats = await fs.lstat(join(dir, filepath))
  if (!stats) throw new GitError(E.FileReadError, { filepath })
  if (stats.isDirectory()) {
    const children = await fs.readdir(join(dir, filepath))
    const promises = children.map(child =>
      addToIndex({ dir, gitdir, fs, filepath: join(filepath, child), index, added })
    )
    await Promise.all(promises)
  } else {
    const object = stats.isSymbolicLink()
      ? await fs.readlink(join(dir, filepath))
      : await fs.read(join(dir, filepath))
    if (object === null) throw new GitError(E.FileReadError, { filepath })
    const oid = await writeObject({ fs, gitdir, type: 'blob', object })
    if (stage) index.delete({ filepath })
    index.insert({ filepath, stats, oid })
    added.push({ filepath, oid })
  }
}
