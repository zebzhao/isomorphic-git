// @ts-check
import { GitIgnoreManager } from '../managers/GitIgnoreManager.js'
import { GitIndexManager } from '../managers/GitIndexManager.js'

import { GitIndex } from '../models/GitIndex'

import { compareStats } from '../utils/compareStats.js'
import { hashObject } from '../utils/hashObject.js'
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'
import { getOidAtPath } from './getOidAtPath.js'

/**
 * Tell whether a file has been changed
 *
 * The possible resolve values are:
 *
 * | status          | description                                                              |
 * | --------------- | ------------------------------------------------------------------------ |
 * | `"ignored"`     | file ignored by a .gitignore rule                                        |
 * | `"unmodified"`  | file unchanged from HEAD commit                                          |
 * | `"*modified"`   | file has modifications, not yet staged                                   |
 * | `"*deleted"`    | file has been removed, but the removal is not yet staged                 |
 * | `"*added"`      | file is untracked, not yet staged                                        |
 * | `"absent"`      | file not present in HEAD commit, staging area, or working dir            |
 * | `"modified"`    | file has modifications, staged                                           |
 * | `"deleted"`     | file has been removed, staged                                            |
 * | `"added"`       | previously untracked file, staged                                        |
 * | `"*unmodified"` | working dir and HEAD commit match, but index differs                     |
 * | `"*absent"`     | file not present in working dir or HEAD commit, but present in the index |
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.filepath - The path to the file to query
 *
 * @returns {Promise<string>} Resolves successfully with the file's git status
 *
 * @example
 * let status = await git.status({ dir: '$input((/))', filepath: '$input((README.md))' })
 * console.log(status)
 *
 */
export async function status ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  filepath
}) {
  try {
    const ignored = await GitIgnoreManager.isIgnored({
      gitdir,
      dir,
      filepath,
      fs
    })
    if (ignored) {
      return 'ignored'
    }
    const treeOid = await getOidAtPath({
      fs,
      dir,
      gitdir,
      path: filepath
    })
    // Acquire a lock on the index
    const { indexEntry, conflictEntry } = await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      return {
        indexEntry: index.entriesMap.get(GitIndex.key(filepath, 0)),
        conflictEntry: index.entriesMap.get(GitIndex.key(filepath, 2))
      }
    })
    const stats = await fs.lstat(join(dir, filepath))

    const H = treeOid !== null // head
    const I = !!indexEntry // index
    const W = stats !== null // working dir
    const C = !!conflictEntry // in conflict

    const getWorkdirOid = async () => {
      if (I && !compareStats(indexEntry, stats)) {
        return indexEntry.oid
      } else {
        const object = await fs.read(join(dir, filepath))
        const workdirOid = await hashObject({
          gitdir,
          type: 'blob',
          object
        })
        // If the oid in the index === working dir oid but stats differed update cache
        if (I && indexEntry.oid === workdirOid) {
          // and as long as our fs.stats aren't bad.
          // size of -1 happens over a BrowserFS HTTP Backend that doesn't serve Content-Length headers
          // (like the Karma webserver) because BrowserFS HTTP Backend uses HTTP HEAD requests to do fs.stat
          if (stats.size !== -1) {
            // We don't await this so we can return faster for one-off cases.
            GitIndexManager.acquire({ fs, gitdir }, async function (index) {
              index.insert({ filepath, stats, oid: workdirOid })
            })
          }
        }
        return workdirOid
      }
    }

    const prefix = C ? '!' : ''
    if (!H && !W && !I) return prefix + 'absent' // ---
    if (!H && !W && I) return prefix + '*absent' // -A-
    if (!H && W && !I) return prefix + '*added' // --A
    if (!H && W && I) {
      const workdirOid = await getWorkdirOid()
      return prefix + (workdirOid === indexEntry.oid ? 'added' : '*added') // -AA : -AB
    }
    if (H && !W && !I) return prefix + 'deleted' // A--
    if (H && !W && I) {
      return prefix + (treeOid === indexEntry.oid ? '*deleted' : '*deleted') // AA- : AB-
    }
    if (H && W && !I) {
      const workdirOid = await getWorkdirOid()
      return prefix + (workdirOid === treeOid ? '*undeleted' : '*undeletemodified') // A-A : A-B
    }
    if (H && W && I) {
      const workdirOid = await getWorkdirOid()
      if (workdirOid === treeOid) {
        return prefix + (workdirOid === indexEntry.oid ? 'unmodified' : '*unmodified') // AAA : ABA
      } else {
        return prefix + (workdirOid === indexEntry.oid ? 'modified' : '*modified') // ABB : AAB
      }
    }
    /*
    ---
    -A-
    --A
    -AA
    -AB
    A--
    AA-
    AB-
    A-A
    A-B
    AAA
    ABA
    ABB
    AAB
    */
  } catch (err) {
    err.caller = 'git.status'
    throw err
  }
}
