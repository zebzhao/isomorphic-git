import { GitRefManager } from '../managers/GitRefManager.js'
import { GitRemoteManager } from '../managers/GitRemoteManager.js'
import { FileSystem } from '../models/FileSystem.js'
import { E, GitError } from '../models/GitError.js'
import { GitSideBand } from '../models/GitSideBand.js'
import { filterCapabilities } from '../utils/filterCapabilities.js'
import { forAwait } from '../utils/forAwait.js'
import { join } from '../utils/join.js'
import { pkg } from '../utils/pkg.js'
import { cores } from '../utils/plugins.js'
import { splitLines } from '../utils/splitLines.js'
import { parseReceivePackResponse } from '../wire/parseReceivePackResponse.js'
import { writeReceivePackRequest } from '../wire/writeReceivePackRequest.js'

import { config } from './config.js'
import { findMergeBase } from './findMergeBase.js'
import { isDescendent } from './isDescendent.js'
import { listCommitsAndTags } from './listCommitsAndTags.js'
import { listObjects } from './listObjects.js'
import { pack } from './pack.js'

/**
 * Push a branch or tag
 *
 * @link https://isomorphic-git.github.io/docs/push.html
 */
export async function push ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref,
  remoteRef,
  remote = 'origin',
  url,
  force = false,
  noGitSuffix = false,
  corsProxy,
  authUsername,
  authPassword,
  username = authUsername,
  password = authPassword,
  token,
  oauth2format,
  headers = {}
}) {
  try {
    const fs = new FileSystem(_fs)
    // TODO: Figure out how pushing tags works. (This only works for branches.)
    if (url === undefined) {
      url = await config({ fs, gitdir, path: `remote.${remote}.url` })
    }
    if (corsProxy === undefined) {
      corsProxy = await config({ fs, gitdir, path: 'http.corsProxy' })
    }
    let fullRef
    if (!ref) {
      fullRef = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: 'HEAD',
        depth: 2
      })
    } else {
      fullRef = await GitRefManager.expand({ fs, gitdir, ref })
    }
    let oid = await GitRefManager.resolve({ fs, gitdir, ref: fullRef })
    let auth = { username, password, token, oauth2format }
    let GitRemoteHTTP = GitRemoteManager.getRemoteHelperFor({ url })
    const httpRemote = await GitRemoteHTTP.discover({
      core,
      corsProxy,
      service: 'git-receive-pack',
      url,
      noGitSuffix,
      auth,
      headers
    })
    auth = httpRemote.auth // hack to get new credentials from CredentialManager API
    let fullRemoteRef
    if (!remoteRef) {
      fullRemoteRef = fullRef
    } else {
      try {
        fullRemoteRef = await GitRefManager.expandAgainstMap({
          ref: remoteRef,
          map: httpRemote.refs
        })
      } catch (err) {
        if (err.code === E.ExpandRefError) {
          // The remote reference doesn't exist yet.
          // If it is fully specified, use that value. Otherwise, treat it as a branch.
          fullRemoteRef = remoteRef.startsWith('refs/')
            ? remoteRef
            : `refs/heads/${remoteRef}`
        } else {
          throw err
        }
      }
    }
    let emptyOid = '0000000000000000000000000000000000000000'
    let oldoid =
      httpRemote.refs.get(fullRemoteRef) || emptyOid
    let finish = [...httpRemote.refs.values()]
    // hack to speed up common force push scenarios
    let mergebase = await findMergeBase({ fs, gitdir, oids: [oid, oldoid] })
    for (let baseOid of mergebase) finish.push(baseOid)
    // TODO: handle shallow depth cutoff gracefully
    if (
      mergebase.length === 0 &&
      oid !== emptyOid &&
      oldoid !== emptyOid
    ) {
      throw new GitError(E.PushRejectedNoCommonAncestry, {})
    } else if (!force) {
      // Is it a tag that already exists?
      if (
        fullRef.startsWith('refs/tags') &&
        oldoid !== emptyOid
      ) {
        throw new GitError(E.PushRejectedTagExists, {})
      }
      // Is it a non-fast-forward commit?
      if (
        oid !== emptyOid &&
        oldoid !== emptyOid &&
        !(await isDescendent({ fs, gitdir, oid, ancestor: oldoid }))
      ) {
        throw new GitError(E.PushRejectedNonFastForward, {})
      }
    }
    let commits = await listCommitsAndTags({
      fs,
      gitdir,
      start: [oid],
      finish
    })
    let objects = await listObjects({ fs, gitdir, oids: commits })
    // We can only safely use capabilities that the server also understands.
    // For instance, AWS CodeCommit aborts a push if you include the `agent`!!!
    const capabilities = filterCapabilities(
      [...httpRemote.capabilities],
      ['report-status', 'side-band-64k', `agent=${pkg.agent}`]
    )
    let packstream1 = await writeReceivePackRequest({
      capabilities,
      triplets: [{ oldoid, oid, fullRef: fullRemoteRef }]
    })
    let packstream2 = await pack({
      fs,
      gitdir,
      oids: [...objects]
    })
    let res = await GitRemoteHTTP.connect({
      core,
      emitter,
      emitterPrefix,
      corsProxy,
      service: 'git-receive-pack',
      url,
      noGitSuffix,
      auth,
      headers,
      body: [...packstream1, ...packstream2]
    })
    let { packfile, progress } = await GitSideBand.demux(res.body)
    if (emitter) {
      let lines = splitLines(progress)
      forAwait(lines, line => {
        emitter.emit(`${emitterPrefix}message`, line)
      })
    }
    // Parse the response!
    let result = await parseReceivePackResponse(packfile)
    if (res.headers) {
      result.headers = res.headers
    }
    if (!result.errors || result.errors.length === 0) {
      // no errors pushing
      let refs = new Map()
      refs.set(fullRemoteRef, oid)
      let symrefs = new Map()
      await GitRefManager.updateRemoteRefs({
        fs,
        gitdir,
        remote,
        refs,
        symrefs
      })
    }
    return result
  } catch (err) {
    err.caller = 'git.push'
    throw err
  }
}
