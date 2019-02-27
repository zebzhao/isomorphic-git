// @ts-check
import { FileSystem } from '../models/FileSystem.js'
import { GitCommit } from '../models/GitCommit.js'
import { readObject } from '../storage/readObject.js'
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'

/**
 * Find the merge base for a set of commits
 *
 * @link https://isomorphic-git.github.io/docs/findMergeBase.html
 */
export async function findMergeBase ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  oids
}) {
  // Note: right now, the tests are geared so that the output should match that of
  // `git merge-base --all --octopus`
  // because without the --octopus flag, git's output seems to depend on the ORDER of the oids,
  // and computing virtual merge bases is just too much for me to fathom right now.
  try {
    const fs = new FileSystem(_fs)
    // If we start N independent walkers, one at each of the given `oids`, and walk backwards
    // through ancestors, eventually we'll discover a commit where each one of these N walkers
    // has passed through. So we just need to keep tallies until we find one where we've walked
    // through N times.
    // Due to a single commit coming from multiple parents, it's possible for a single parent to
    // be double counted if identity of initial walkers are not tracked.
    const tracker = {}
    const passes = (1 << oids.length) - 1
    let heads = oids.map((oid, i) => ({ oid, i }))
    while (heads.length) {
      // Track number of passes through each commit by an initial walker
      let result = {}
      for (const { oid, i } of heads) {
        if (tracker[oid]) {
          tracker[oid] |= 1 << i
        } else {
          tracker[oid] = 1 << i
        }
        if (tracker[oid] === passes) {
          result[oid] = 1
        }
      }
      // It's possible to have 2 common ancestors, see https://git-scm.com/docs/git-merge-base
      result = Object.keys(result)
      if (result.length > 0) {
        return result
      }
      // We haven't found a common ancestor yet
      const newheads = []
      for (const { oid, i } of heads) {
        try {
          const { object } = await readObject({ fs, gitdir, oid })
          const commit = GitCommit.from(object)
          const { parent } = commit.parseHeaders()
          for (const oid of parent) {
            newheads.push({ oid, i })
          }
        } catch (err) {
          // do nothing
        }
      }
      heads = newheads
    }
    return []
  } catch (err) {
    err.caller = 'git.findMergeBase'
    throw err
  }
}
