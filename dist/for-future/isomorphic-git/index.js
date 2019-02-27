import nick from 'nick';
import ignore from 'ignore';
import pify from 'pify';
import AsyncLock from 'async-lock';
import Hash from 'sha.js/sha1';
import pako from 'pako';
import cleanGitRef from 'clean-git-ref';
import crc32 from 'crc-32';
import applyDelta from 'git-apply-delta';
import { mark, stop } from 'marky';
import diff3 from 'node-diff3';
import globrex from 'globrex';
import globalyzer from 'globalyzer';

/**
 * Use with push and fetch to set Basic Authentication headers.
 *
 * @link https://isomorphic-git.github.io/docs/utils_auth.html
 */
function auth (username, password) {
  // Allow specifying it as one argument (mostly for CLI inputability)
  if (password === undefined) {
    let i = username.indexOf(':');
    if (i > -1) {
      password = username.slice(i + 1);
      username = username.slice(0, i);
    } else {
      password = ''; // Enables the .auth(GITHUB_TOKEN) no-username shorthand
    }
  }
  return { username, password }
}

// modeled after Therror https://github.com/therror/therror/

const messages = {
  FileReadError: `Could not read file "{ filepath }".`,
  MissingRequiredParameterError: `The function "{ function }" requires a "{ parameter }" parameter but none was provided.`,
  InvalidRefNameError: `Failed to { verb } { noun } "{ ref }" because that name would not be a valid git reference. A valid alternative would be "{ suggestion }".`,
  InvalidParameterCombinationError: `The function "{ function }" doesn't take these parameters simultaneously: { parameters.join(", ") }`,
  RefExistsError: `Failed to create { noun } "{ ref }" because { noun } "{ ref }" already exists.`,
  RefNotExistsError: `Failed to { verb } { noun } "{ ref }" because { noun } "{ ref }" does not exists.`,
  BranchDeleteError: `Failed to delete branch "{ ref }" because branch "{ ref }" checked out now.`,
  NoHeadCommitError: `Failed to create { noun } "{ ref }" because the HEAD ref could not be resolved to a commit.`,
  CommitNotFetchedError: `Failed to checkout "{ ref }" because commit { oid } is not available locally. Do a git fetch to make the branch available locally.`,
  CommitUnmergedConflictsFail: `Cannot commit because you have unmerged files:\\n{ paths.join("\\n") }`,
  ObjectTypeUnknownFail: `Object { oid } has unknown type "{ type }".`,
  ObjectTypeAssertionFail: `Object { oid } was anticipated to be a { expected } but it is a { type }. This is probably a bug deep in isomorphic-git!`,
  ObjectTypeAssertionInTreeFail: `Object { oid } in tree for "{ entrypath }" was an unexpected object type "{ type }".`,
  ObjectTypeAssertionInRefFail: `{ ref } is not pointing to a "{ expected }" object but a "{ type }" object.`,
  ObjectTypeAssertionInPathFail: `Found a blob { oid } in the path "{ path }" where a tree was expected.`,
  MissingAuthorError: `Author name and email must be specified as an argument or in the .git/config file.`,
  MissingCommitterError: `Committer name and email must be specified if a committer object is passed.`,
  MissingTaggerError: `Tagger name and email must be specified as an argument or in the .git/config file.`,
  GitRootNotFoundError: `Unable to find git root for { filepath }.`,
  UnparseableServerResponseFail: `Unparsable response from server! Expected "unpack ok" or "unpack [error message]" but received "{ line }".`,
  InvalidDepthParameterError: `Invalid value for depth parameter: { depth }`,
  RemoteDoesNotSupportShallowFail: `Remote does not support shallow fetches.`,
  RemoteDoesNotSupportDeepenSinceFail: `Remote does not support shallow fetches by date.`,
  RemoteDoesNotSupportDeepenNotFail: `Remote does not support shallow fetches excluding commits reachable by refs.`,
  RemoteDoesNotSupportDeepenRelativeFail: `Remote does not support shallow fetches relative to the current shallow depth.`,
  RemoteDoesNotSupportSmartHTTP: `Remote does not support the "smart" HTTP protocol, and isomorphic-git does not support the "dumb" HTTP protocol, so they are incompatible.`,
  CorruptShallowOidFail: `non-40 character shallow oid: { oid }`,
  FastForwardFail: `A simple fast-forward merge was not possible.`,
  DirectorySeparatorsError: `"filepath" parameter should not include leading or trailing directory separators because these can cause problems on some platforms`,
  ResolveTreeError: `Could not resolve { oid } to a tree.`,
  ResolveCommitError: `Could not resolve { oid } to a commit.`,
  DirectoryIsAFileError: `Unable to read "{ oid }:{ filepath }" because encountered a file where a directory was expected.`,
  TreeOrBlobNotFoundError: `No file or directory found at "{ oid }:{ filepath }".`,
  NotImplementedFail: `TODO: { thing } still needs to be implemented!`,
  ReadObjectFail: `Failed to read git object with oid { oid }`,
  NotAnOidFail: `Expected a 40-char hex object id but saw "{ value }".`,
  NoRefspecConfiguredError: `Could not find a fetch refspec for remote "{ remote }".\\nMake sure the config file has an entry like the following:\\n[remote "{ remote }"]\\nfetch = +refs/heads/*:refs/remotes/origin/*`,
  MismatchRefValueError: `Provided oldValue doesn\\'t match the actual value of "{ ref }".`,
  ResolveRefError: `Could not resolve reference "{ ref }".`,
  ExpandRefError: `Could not expand reference "{ ref }".`,
  EmptyServerResponseFail: `Empty response from git server.`,
  AssertServerResponseFail: `Expected "{ expected }" but got "{ actual }".`,
  HTTPError: `HTTP Error: { statusCode } { statusMessage }`,
  RemoteUrlParseError: `Cannot parse remote URL: "{ url }"`,
  UnknownTransportError: `Git remote "{ url }" uses an unrecognized transport protocol: "{ transport }"`,
  AcquireLockFileFail: `Unable to acquire lockfile "{ filename }". Exhausted tries.`,
  DoubleReleaseLockFileFail: `Cannot double-release lockfile "{ filename }".`,
  InternalFail: `An internal error caused this command to fail. Please file a bug report at https://github.com/isomorphic-git/isomorphic-git/issues with this error message: { message }`,
  UnknownOauth2Format: `I do not know how { company } expects its Basic Auth headers to be formatted for OAuth2 usage. If you do, you can use the regular username and password parameters to set the basic auth header yourself.`,
  MissingPasswordTokenError: `Missing password or token`,
  MissingUsernameError: `Missing username`,
  MixPasswordTokenError: `Cannot mix "password" with "token"`,
  MixUsernamePasswordTokenError: `Cannot mix "username" and "password" with "token"`,
  MissingTokenError: `Missing token`,
  MixUsernameOauth2formatMissingTokenError: `Cannot mix "username" with "oauth2format". Missing token.`,
  MixPasswordOauth2formatMissingTokenError: `Cannot mix "password" with "oauth2format". Missing token.`,
  MixUsernamePasswordOauth2formatMissingTokenError: `Cannot mix "username" and "password" with "oauth2format". Missing token.`,
  MixUsernameOauth2formatTokenError: `Cannot mix "username" with "oauth2format" and "token"`,
  MixPasswordOauth2formatTokenError: `Cannot mix "password" with "oauth2format" and "token"`,
  MixUsernamePasswordOauth2formatTokenError: `Cannot mix "username" and "password" with "oauth2format" and "token"`,
  MaxSearchDepthExceeded: `Maximum search depth of { depth } exceeded.`,
  PushRejectedNonFastForward: `Push rejected because it was not a simple fast-forward. Use "force: true" to override.`,
  PushRejectedTagExists: `Push rejected because tag already exists. Use "force: true" to override.`,
  PushRejectedNoCommonAncestry: `Push rejected because no common ancestor was found.`,
  MergeNoCommonAncestryError: `Merge failed because no common ancestor was found between { theirRef } and { ourRef }.`,
  AddingRemoteWouldOverwrite: `Adding remote { remote } would overwrite the existing remote. Use "force: true" to override.`,
  PluginUndefined: `A command required the "{ plugin }" plugin but it was undefined.`,
  CoreNotFound: `No plugin core with the name "{ core }" is registered.`,
  PluginSchemaViolation: `Schema check failed for "{ plugin }" plugin; missing { method } method.`,
  PluginUnrecognized: `Unrecognized plugin type "{ plugin }"`,
  AmbiguousShortOid: `Found multiple oids matching "{ short }" ({ matches }). Use a longer abbreviation length to disambiguate them.`,
  ShortOidNotFound: `Could not find an object matching "{ short }".`
};

const E = {
  FileReadError: `FileReadError`,
  MissingRequiredParameterError: `MissingRequiredParameterError`,
  InvalidRefNameError: `InvalidRefNameError`,
  InvalidParameterCombinationError: `InvalidParameterCombinationError`,
  RefExistsError: `RefExistsError`,
  RefNotExistsError: `RefNotExistsError`,
  BranchDeleteError: `BranchDeleteError`,
  NoHeadCommitError: `NoHeadCommitError`,
  CommitNotFetchedError: `CommitNotFetchedError`,
  CommitUnmergedConflictsFail: `CommitUnmergedConflictsFail`,
  ObjectTypeUnknownFail: `ObjectTypeUnknownFail`,
  ObjectTypeAssertionFail: `ObjectTypeAssertionFail`,
  ObjectTypeAssertionInTreeFail: `ObjectTypeAssertionInTreeFail`,
  ObjectTypeAssertionInRefFail: `ObjectTypeAssertionInRefFail`,
  ObjectTypeAssertionInPathFail: `ObjectTypeAssertionInPathFail`,
  MissingAuthorError: `MissingAuthorError`,
  MissingCommitterError: `MissingCommitterError`,
  MissingTaggerError: `MissingTaggerError`,
  GitRootNotFoundError: `GitRootNotFoundError`,
  UnparseableServerResponseFail: `UnparseableServerResponseFail`,
  InvalidDepthParameterError: `InvalidDepthParameterError`,
  RemoteDoesNotSupportShallowFail: `RemoteDoesNotSupportShallowFail`,
  RemoteDoesNotSupportDeepenSinceFail: `RemoteDoesNotSupportDeepenSinceFail`,
  RemoteDoesNotSupportDeepenNotFail: `RemoteDoesNotSupportDeepenNotFail`,
  RemoteDoesNotSupportDeepenRelativeFail: `RemoteDoesNotSupportDeepenRelativeFail`,
  RemoteDoesNotSupportSmartHTTP: `RemoteDoesNotSupportSmartHTTP`,
  CorruptShallowOidFail: `CorruptShallowOidFail`,
  FastForwardFail: `FastForwardFail`,
  DirectorySeparatorsError: `DirectorySeparatorsError`,
  ResolveTreeError: `ResolveTreeError`,
  ResolveCommitError: `ResolveCommitError`,
  DirectoryIsAFileError: `DirectoryIsAFileError`,
  TreeOrBlobNotFoundError: `TreeOrBlobNotFoundError`,
  NotImplementedFail: `NotImplementedFail`,
  ReadObjectFail: `ReadObjectFail`,
  NotAnOidFail: `NotAnOidFail`,
  NoRefspecConfiguredError: `NoRefspecConfiguredError`,
  MismatchRefValueError: `MismatchRefValueError`,
  ResolveRefError: `ResolveRefError`,
  ExpandRefError: `ExpandRefError`,
  EmptyServerResponseFail: `EmptyServerResponseFail`,
  AssertServerResponseFail: `AssertServerResponseFail`,
  HTTPError: `HTTPError`,
  RemoteUrlParseError: `RemoteUrlParseError`,
  UnknownTransportError: `UnknownTransportError`,
  AcquireLockFileFail: `AcquireLockFileFail`,
  DoubleReleaseLockFileFail: `DoubleReleaseLockFileFail`,
  InternalFail: `InternalFail`,
  UnknownOauth2Format: `UnknownOauth2Format`,
  MissingPasswordTokenError: `MissingPasswordTokenError`,
  MissingUsernameError: `MissingUsernameError`,
  MixPasswordTokenError: `MixPasswordTokenError`,
  MixUsernamePasswordTokenError: `MixUsernamePasswordTokenError`,
  MissingTokenError: `MissingTokenError`,
  MixUsernameOauth2formatMissingTokenError: `MixUsernameOauth2formatMissingTokenError`,
  MixPasswordOauth2formatMissingTokenError: `MixPasswordOauth2formatMissingTokenError`,
  MixUsernamePasswordOauth2formatMissingTokenError: `MixUsernamePasswordOauth2formatMissingTokenError`,
  MixUsernameOauth2formatTokenError: `MixUsernameOauth2formatTokenError`,
  MixPasswordOauth2formatTokenError: `MixPasswordOauth2formatTokenError`,
  MixUsernamePasswordOauth2formatTokenError: `MixUsernamePasswordOauth2formatTokenError`,
  MaxSearchDepthExceeded: `MaxSearchDepthExceeded`,
  PushRejectedNonFastForward: `PushRejectedNonFastForward`,
  PushRejectedTagExists: `PushRejectedTagExists`,
  PushRejectedNoCommonAncestry: `PushRejectedNoCommonAncestry`,
  MergeNoCommonAncestryError: `MergeNoCommonAncestryError`,
  AddingRemoteWouldOverwrite: `AddingRemoteWouldOverwrite`,
  PluginUndefined: `PluginUndefined`,
  CoreNotFound: `CoreNotFound`,
  PluginSchemaViolation: `PluginSchemaViolation`,
  PluginUnrecognized: `PluginUnrecognized`,
  AmbiguousShortOid: `AmbiguousShortOid`,
  ShortOidNotFound: `ShortOidNotFound`
};

class GitError extends Error {
  constructor (code, data) {
    super();
    this.name = code;
    this.code = code;
    this.data = data;
    this.message = nick(messages[code])(data || {});
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
  toJSON () {
    return {
      code: this.code,
      data: this.data,
      caller: this.caller,
      message: this.message
    }
  }
  toString () {
    return this.stack.toString()
  }
}

/**
 * Use with push and fetch to set Basic Authentication headers.
 *
 * @link https://isomorphic-git.github.io/docs/utils_oauth2.html
 */
function oauth2 (company, token) {
  switch (company) {
    case 'github':
      return {
        username: token,
        password: 'x-oauth-basic'
      }
    case 'githubapp':
      return {
        username: 'x-access-token',
        password: token
      }
    case 'bitbucket':
      return {
        username: 'x-token-auth',
        password: token
      }
    case 'gitlab':
      return {
        username: 'oauth2',
        password: token
      }
    default:
      throw new GitError(E.UnknownOauth2Format, { company })
  }
}

function compareStrings (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  return -(a < b) || +(a > b)
}

function dirname (path) {
  let last = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (last === -1) return '.'
  if (last === 0) return '/'
  return path.slice(0, last)
}

async function sleep (ms) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms))
}

const delayedReleases = new Map();
/**
 * This is just a collection of helper functions really. At least that's how it started.
 */
class FileSystem {
  constructor (fs) {
    // This is not actually the most logical place to put this, but in practice
    // putting the check here should work great.
    if (fs === undefined) {
      throw new GitError(E.PluginUndefined, { plugin: 'fs' })
    }
    if (typeof fs._readFile !== 'undefined') return fs
    this._readFile = pify(fs.readFile.bind(fs));
    this._writeFile = pify(fs.writeFile.bind(fs));
    this._mkdir = pify(fs.mkdir.bind(fs));
    this._rmdir = pify(fs.rmdir.bind(fs));
    this._unlink = pify(fs.unlink.bind(fs));
    this._stat = pify(fs.stat.bind(fs));
    this._lstat = pify(fs.lstat.bind(fs));
    this._readdir = pify(fs.readdir.bind(fs));
    this._readlink = pify(fs.readlink.bind(fs));
    this._symlink = pify(fs.symlink.bind(fs));
  }
  /**
   * Return true if a file exists, false if it doesn't exist.
   * Rethrows errors that aren't related to file existance.
   */
  async exists (filepath, options = {}) {
    try {
      await this._stat(filepath);
      return true
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return false
      } else {
        console.log('Unhandled error in "FileSystem.exists()" function', err);
        throw err
      }
    }
  }
  /**
   * Return the contents of a file if it exists, otherwise returns null.
   */
  async read (filepath, options = {}) {
    try {
      let buffer = await this._readFile(filepath, options);
      // Convert plain ArrayBuffers to Buffers
      if (typeof buffer !== 'string') {
        buffer = Buffer.from(buffer);
      }
      return buffer
    } catch (err) {
      return null
    }
  }
  /**
   * Write a file (creating missing directories if need be) without throwing errors.
   */
  async write (filepath, contents, options = {}) {
    try {
      await this._writeFile(filepath, contents, options);
      return
    } catch (err) {
      // Hmm. Let's try mkdirp and try again.
      await this.mkdir(dirname(filepath));
      await this._writeFile(filepath, contents, options);
    }
  }
  /**
   * Make a directory (or series of nested directories) without throwing an error if it already exists.
   */
  async mkdir (filepath, _selfCall = false) {
    try {
      await this._mkdir(filepath);
      return
    } catch (err) {
      // If err is null then operation succeeded!
      if (err === null) return
      // If the directory already exists, that's OK!
      if (err.code === 'EEXIST') return
      // Avoid infinite loops of failure
      if (_selfCall) throw err
      // If we got a "no such file or directory error" backup and try again.
      if (err.code === 'ENOENT') {
        let parent = dirname(filepath);
        // Check to see if we've gone too far
        if (parent === '.' || parent === '/' || parent === filepath) throw err
        // Infinite recursion, what could go wrong?
        await this.mkdir(parent);
        await this.mkdir(filepath, true);
      }
    }
  }
  /**
   * Delete a file without throwing an error if it is already deleted.
   */
  async rm (filepath) {
    try {
      await this._unlink(filepath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }
  /**
   * Read a directory without throwing an error is the directory doesn't exist
   */
  async readdir (filepath) {
    try {
      let names = await this._readdir(filepath);
      // Ordering is not guaranteed, and system specific (Windows vs Unix)
      // so we must sort them ourselves.
      names.sort(compareStrings);
      return names
    } catch (err) {
      if (err.code === 'ENOTDIR') return null
      return []
    }
  }
  /**
   * Return a flast list of all the files nested inside a directory
   *
   * Based on an elegant concurrent recursive solution from SO
   * https://stackoverflow.com/a/45130990/2168416
   */
  async readdirDeep (dir) {
    const subdirs = await this._readdir(dir);
    const files = await Promise.all(
      subdirs.map(async subdir => {
        const res = dir + '/' + subdir;
        return (await this._stat(res)).isDirectory()
          ? this.readdirDeep(res)
          : res
      })
    );
    return files.reduce((a, f) => a.concat(f), [])
  }
  /**
   * Return the Stats of a file/symlink if it exists, otherwise returns null.
   * Rethrows errors that aren't related to file existance.
   */
  async lstat (filename) {
    try {
      let stats = await this._lstat(filename);
      return stats
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null
      }
      throw err
    }
  }
  /**
   * Reads the contents of a symlink if it exists, otherwise returns null.
   * Rethrows errors that aren't related to file existance.
   */
  async readlink (filename, opts = { encoding: 'buffer' }) {
    // Note: FileSystem.readlink returns a buffer by default
    // so we can dump it into GitObject.write just like any other file.
    try {
      return this._readlink(filename, opts)
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null
      }
      throw err
    }
  }
  /**
   * Write the contents of buffer to a symlink.
   */
  async writelink (filename, buffer) {
    return this._symlink(buffer.toString('utf8'), filename)
  }

  async lock (filename, triesLeft = 3) {
    // check to see if we still have it
    if (delayedReleases.has(filename)) {
      clearTimeout(delayedReleases.get(filename));
      delayedReleases.delete(filename);
      return
    }
    if (triesLeft === 0) {
      throw new GitError(E.AcquireLockFileFail, { filename })
    }
    try {
      await this._mkdir(`${filename}.lock`);
    } catch (err) {
      if (err.code === 'EEXIST') {
        await sleep(100);
        await this.lock(filename, triesLeft - 1);
      }
    }
  }

  async unlock (filename, delayRelease = 50) {
    if (delayedReleases.has(filename)) {
      throw new GitError(E.DoubleReleaseLockFileFail, { filename })
    }
    // Basically, we lie and say it was deleted ASAP.
    // But really we wait a bit to see if you want to acquire it again.
    delayedReleases.set(
      filename,
      setTimeout(async () => {
        delayedReleases.delete(filename);
        await this._rmdir(`${filename}.lock`);
      }, delayRelease)
    );
  }
}

function basename (path) {
  let last = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (last > -1) {
    path = path.slice(last + 1);
  }
  return path
}

function normalizePath (path) {
  return path
    .replace(/\/\.\//g, '/') // Replace '/./' with '/'
    .replace(/\/{2,}/g, '/') // Replace consecutive '/'
    .replace(/^\/\.$/, '/') // if path === '/.' return '/'
    .replace(/^\.\/$/, '.') // if path === './' return '.'
    .replace(/^\.\//, '') // Remove leading './'
    .replace(/\/\.$/, '') // Remove trailing '/.'
    .replace(/(.+)\/$/, '$1') // Remove trailing '/'
    .replace(/^$/, '.') // if path === '' return '.'
}

// For some reason path.posix.join is undefined in webpack

function join (...parts) {
  return normalizePath(parts.map(normalizePath).join('/'))
}

// I'm putting this in a Manager because I reckon it could benefit
// from a LOT of cacheing.

// TODO: Implement .git/info/exclude

class GitIgnoreManager {
  static async isIgnored ({
    fs: _fs,
    dir,
    gitdir = join(dir, '.git'),
    filepath
  }) {
    const fs = new FileSystem(_fs);
    // ALWAYS ignore ".git" folders.
    if (basename(filepath) === '.git') return true
    // '.' is not a valid gitignore entry, so '.' is never ignored
    if (filepath === '.') return false
    // Find all the .gitignore files that could affect this file
    let pairs = [
      {
        gitignore: join(dir, '.gitignore'),
        filepath
      }
    ];
    let pieces = filepath.split('/');
    for (let i = 1; i < pieces.length; i++) {
      let folder = pieces.slice(0, i).join('/');
      let file = pieces.slice(i).join('/');
      pairs.push({
        gitignore: join(dir, folder, '.gitignore'),
        filepath: file
      });
    }
    let ignoredStatus = false;
    for (let p of pairs) {
      let file;
      try {
        file = await fs.read(p.gitignore, 'utf8');
      } catch (err) {
        if (err.code === 'NOENT') continue
      }
      let ign = ignore().add(file);
      // If the parent directory is excluded, we are done.
      // "It is not possible to re-include a file if a parent directory of that file is excluded. Git doesn’t list excluded directories for performance reasons, so any patterns on contained files have no effect, no matter where they are defined."
      // source: https://git-scm.com/docs/gitignore
      let parentdir = dirname(p.filepath);
      if (parentdir !== '.' && ign.ignores(parentdir)) return true
      // If the file is currently ignored, test for UNignoring.
      if (ignoredStatus) {
        ignoredStatus = !ign.test(p.filepath).unignored;
      } else {
        ignoredStatus = ign.test(p.filepath).ignored;
      }
    }
    return ignoredStatus
  }
}

// Modeled after https://github.com/tjfontaine/node-buffercursor
// but with the goal of being much lighter weight.
class BufferCursor {
  constructor (buffer) {
    this.buffer = buffer;
    this._start = 0;
  }
  eof () {
    return this._start >= this.buffer.length
  }
  tell () {
    return this._start
  }
  seek (n) {
    this._start = n;
  }
  slice (n) {
    const r = this.buffer.slice(this._start, this._start + n);
    this._start += n;
    return r
  }
  toString (enc, length) {
    const r = this.buffer.toString(enc, this._start, this._start + length);
    this._start += length;
    return r
  }
  write (value, length, enc) {
    const r = this.buffer.write(value, this._start, length, enc);
    this._start += length;
    return r
  }
  readUInt8 () {
    const r = this.buffer.readUInt8(this._start);
    this._start += 1;
    return r
  }
  writeUInt8 (value) {
    const r = this.buffer.writeUInt8(value, this._start);
    this._start += 1;
    return r
  }
  readUInt16BE () {
    const r = this.buffer.readUInt16BE(this._start);
    this._start += 2;
    return r
  }
  writeUInt16BE (value) {
    const r = this.buffer.writeUInt16BE(value, this._start);
    this._start += 2;
    return r
  }
  readUInt32BE () {
    const r = this.buffer.readUInt32BE(this._start);
    this._start += 4;
    return r
  }
  writeUInt32BE (value) {
    const r = this.buffer.writeUInt32BE(value, this._start);
    this._start += 4;
    return r
  }
}

/**
 * From https://github.com/git/git/blob/master/Documentation/technical/index-format.txt
 *
 * 32-bit mode, split into (high to low bits)
 *
 *  4-bit object type
 *    valid values in binary are 1000 (regular file), 1010 (symbolic link)
 *    and 1110 (gitlink)
 *
 *  3-bit unused
 *
 *  9-bit unix permission. Only 0755 and 0644 are valid for regular files.
 *  Symbolic links and gitlinks have value 0 in this field.
 */
function normalizeMode (mode) {
  // Note: BrowserFS will use -1 for "unknown"
  // I need to make it non-negative for these bitshifts to work.
  let type = mode > 0 ? mode >> 12 : 0;
  // If it isn't valid, assume it as a "regular file"
  // 0100 = directory
  // 1000 = regular file
  // 1010 = symlink
  // 1110 = gitlink
  if (
    type !== 0b0100 &&
    type !== 0b1000 &&
    type !== 0b1010 &&
    type !== 0b1110
  ) {
    type = 0b1000;
  }
  let permissions = mode & 0o777;
  // Is the file executable? then 755. Else 644.
  if (permissions & 0b001001001) {
    permissions = 0o755;
  } else {
    permissions = 0o644;
  }
  // If it's not a regular file, scrub all permissions
  if (type !== 0b1000) permissions = 0;
  return (type << 12) + permissions
}

const MAX_UINT32 = 2 ** 32;

function SecondsNanoseconds (
  givenSeconds,
  givenNanoseconds,
  milliseconds,
  date
) {
  if (givenSeconds !== undefined && givenNanoseconds !== undefined) {
    return [givenSeconds, givenNanoseconds]
  }
  if (milliseconds === undefined) {
    milliseconds = date.valueOf();
  }
  const seconds = Math.floor(milliseconds / 1000);
  const nanoseconds = (milliseconds - seconds * 1000) * 1000000;
  return [seconds, nanoseconds]
}

function normalizeStats (e) {
  const [ctimeSeconds, ctimeNanoseconds] = SecondsNanoseconds(
    e.ctimeSeconds,
    e.ctimeNanoseconds,
    e.ctimeMs,
    e.ctime
  );
  const [mtimeSeconds, mtimeNanoseconds] = SecondsNanoseconds(
    e.mtimeSeconds,
    e.mtimeNanoseconds,
    e.mtimeMs,
    e.mtime
  );

  return {
    ctimeSeconds: ctimeSeconds % MAX_UINT32,
    ctimeNanoseconds: ctimeNanoseconds % MAX_UINT32,
    mtimeSeconds: mtimeSeconds % MAX_UINT32,
    mtimeNanoseconds: mtimeNanoseconds % MAX_UINT32,
    dev: e.dev % MAX_UINT32,
    ino: e.ino % MAX_UINT32,
    mode: normalizeMode(e.mode % MAX_UINT32),
    uid: e.uid % MAX_UINT32,
    gid: e.gid % MAX_UINT32,
    // size of -1 happens over a BrowserFS HTTP Backend that doesn't serve Content-Length headers
    // (like the Karma webserver) because BrowserFS HTTP Backend uses HTTP HEAD requests to do fs.stat
    size: e.size > -1 ? e.size % MAX_UINT32 : 0
  }
}

// This is modeled after @dominictarr's "shasum" module,
// but without the 'json-stable-stringify' dependency and
// extra type-casting features.
function shasum (buffer) {
  return new Hash().update(buffer).digest('hex')
}

// Extract 1-bit assume-valid, 1-bit extended flag, 2-bit merge state flag, 12-bit path length flag
function parseCacheEntryFlags (bits) {
  return {
    assumeValid: Boolean(bits & 0b1000000000000000),
    extended: Boolean(bits & 0b0100000000000000),
    stage: (bits & 0b0011000000000000) >> 12,
    nameLength: bits & 0b0000111111111111
  }
}

function renderCacheEntryFlags (entry) {
  let flags = entry.flags;
  // 1-bit extended flag (must be zero in version 2)
  flags.extended = false;
  // 12-bit name length if the length is less than 0xFFF; otherwise 0xFFF
  // is stored in this field.
  flags.nameLength = Math.min(Buffer.from(entry.path).length, 0xfff);
  return (
    (flags.assumeValid ? 0b1000000000000000 : 0) +
    (flags.extended ? 0b0100000000000000 : 0) +
    ((flags.stage & 0b11) << 12) +
    (flags.nameLength & 0b111111111111)
  )
}

function parseBuffer (buffer) {
  // Verify shasum
  let shaComputed = shasum(buffer.slice(0, -20));
  let shaClaimed = buffer.slice(-20).toString('hex');
  if (shaClaimed !== shaComputed) {
    throw new GitError(E.InternalFail, {
      message: `Invalid checksum in GitIndex buffer: expected ${shaClaimed} but saw ${shaComputed}`
    })
  }
  let reader = new BufferCursor(buffer);
  let _entries = new Map();
  let magic = reader.toString('utf8', 4);
  if (magic !== 'DIRC') {
    throw new GitError(E.InternalFail, {
      message: `Invalid dircache magic file number: ${magic}`
    })
  }
  let version = reader.readUInt32BE();
  if (version !== 2) {
    throw new GitError(E.InternalFail, {
      message: `Unsupported dircache version: ${version}`
    })
  }
  let numEntries = reader.readUInt32BE();
  let i = 0;
  while (!reader.eof() && i < numEntries) {
    let entry = {};
    entry.ctimeSeconds = reader.readUInt32BE();
    entry.ctimeNanoseconds = reader.readUInt32BE();
    entry.mtimeSeconds = reader.readUInt32BE();
    entry.mtimeNanoseconds = reader.readUInt32BE();
    entry.dev = reader.readUInt32BE();
    entry.ino = reader.readUInt32BE();
    entry.mode = reader.readUInt32BE();
    entry.uid = reader.readUInt32BE();
    entry.gid = reader.readUInt32BE();
    entry.size = reader.readUInt32BE();
    entry.oid = reader.slice(20).toString('hex');
    let flags = reader.readUInt16BE();
    entry.flags = parseCacheEntryFlags(flags);
    // TODO: handle if (version === 3 && entry.flags.extended)
    let pathlength = buffer.indexOf(0, reader.tell() + 1) - reader.tell();
    if (pathlength < 1) {
      throw new GitError(E.InternalFail, {
        message: `Got a path length of: ${pathlength}`
      })
    }
    // TODO: handle pathnames larger than 12 bits
    entry.path = reader.toString('utf8', pathlength);
    // TODO: is this a good way to store stage entries?
    entry.key = GitIndex.key(entry.path, entry.flags.stage);
    // The next bit is awkward. We expect 1 to 8 null characters
    // such that the total size of the entry is a multiple of 8 bits.
    // (Hence subtract 12 bytes for the header.)
    let padding = 8 - ((reader.tell() - 12) % 8);
    if (padding === 0) padding = 8;
    while (padding--) {
      let tmp = reader.readUInt8();
      if (tmp !== 0) {
        throw new GitError(E.InternalFail, {
          message: `Expected 1-8 null characters but got '${tmp}' after ${entry.path}`
        })
      } else if (reader.eof()) {
        throw new GitError(E.InternalFail, {
          message: 'Unexpected end of file'
        })
      }
    }
    // end of awkward part
    _entries.set(entry.key, entry);
    i++;
  }
  return _entries
}

function compareKey (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  return compareStrings(a.path, b.path)
}

class GitIndex {
  /*::
   _entries: Map<string, CacheEntry>
   _dirty: boolean // Used to determine if index needs to be saved to filesystem
   */
  constructor (index) {
    this._dirty = false;
    if (Buffer.isBuffer(index)) {
      this._entries = parseBuffer(index);
    } else if (index === null) {
      this._entries = new Map();
    } else {
      throw new GitError(E.InternalFail, {
        message: 'invalid type passed to GitIndex constructor'
      })
    }
  }
  static from (buffer) {
    return new GitIndex(buffer)
  }
  static key (path, stage) {
    // No delimiter is needed as long as stage is always 1 char
    return path + stage
  }
  get entries () {
    return [...this._entries.values()].sort(compareKey)
  }
  get entriesMap () {
    return this._entries
  }
  get conflictedPaths () {
    return [...this._entries.keys()]
      .filter(k => k.charAt(k.length - 1) === '2')
      .map(k => k.slice(0, -1))
  }
  * [Symbol.iterator] () {
    for (let entry of this.entries) {
      yield entry;
    }
  }
  insert ({ filepath, stats, oid, stage = 0 }) {
    stats = normalizeStats(stats);
    let key = GitIndex.key(filepath, stage);
    let bfilepath = Buffer.from(filepath);
    let entry = {
      ctimeSeconds: stats.ctimeSeconds,
      ctimeNanoseconds: stats.ctimeNanoseconds,
      mtimeSeconds: stats.mtimeSeconds,
      mtimeNanoseconds: stats.mtimeNanoseconds,
      dev: stats.dev,
      ino: stats.ino,
      // We provide a fallback value for `mode` here because not all fs
      // implementations assign it, but we use it in GitTree.
      // '100644' is for a "regular non-executable file"
      mode: stats.mode || 0o100644,
      uid: stats.uid,
      gid: stats.gid,
      size: stats.size,
      path: filepath,
      key: key,
      oid: oid,
      flags: {
        assumeValid: false,
        extended: false,
        stage: stage,
        nameLength: bfilepath.length < 0xfff ? bfilepath.length : 0xfff
      }
    };
    this._entries.set(key, entry);
    this._dirty = true;
  }
  writeConflict ({ filepath, stats, ourOid, theirOid, baseOid }) {
    if (baseOid) this.insert({ filepath, stats, oid: baseOid, stage: 1 });
    this.insert({ filepath, stats, oid: ourOid, stage: 2 });
    this.insert({ filepath, stats, oid: theirOid, stage: 3 });
  }
  delete ({ filepath }) {
    for (let [key, entry] of this._entries.entries()) {
      if (entry.path === filepath || entry.path.startsWith(filepath + '/')) {
        this._entries.delete(key);
      }
    }
    this._dirty = true;
  }
  clear () {
    this._entries.clear();
    this._dirty = true;
  }
  render () {
    return this.entries
      .map(entry => `${entry.mode.toString(8)} ${entry.oid}    ${entry.path}`)
      .join('\n')
  }
  toObject () {
    let header = Buffer.alloc(12);
    let writer = new BufferCursor(header);
    writer.write('DIRC', 4, 'utf8');
    writer.writeUInt32BE(2);
    writer.writeUInt32BE(this.entries.length);
    let body = Buffer.concat(
      this.entries.map(entry => {
        const bpath = Buffer.from(entry.path);
        // the fixed length + the filename + at least one null char => align by 8
        let length = Math.ceil((62 + bpath.length + 1) / 8) * 8;
        let written = Buffer.alloc(length);
        let writer = new BufferCursor(written);
        const stat = normalizeStats(entry);
        writer.writeUInt32BE(stat.ctimeSeconds);
        writer.writeUInt32BE(stat.ctimeNanoseconds);
        writer.writeUInt32BE(stat.mtimeSeconds);
        writer.writeUInt32BE(stat.mtimeNanoseconds);
        writer.writeUInt32BE(stat.dev);
        writer.writeUInt32BE(stat.ino);
        writer.writeUInt32BE(stat.mode);
        writer.writeUInt32BE(stat.uid);
        writer.writeUInt32BE(stat.gid);
        writer.writeUInt32BE(stat.size);
        writer.write(entry.oid, 20, 'hex');
        writer.writeUInt16BE(renderCacheEntryFlags(entry));
        writer.write(entry.path, bpath.length, 'utf8');
        return written
      })
    );
    let main = Buffer.concat([header, body]);
    let sum = shasum(main);
    return Buffer.concat([main, Buffer.from(sum, 'hex')])
  }
}

// import LockManager from 'travix-lock-manager'

// import Lock from '../utils.js'

// TODO: replace with an LRU cache?
const map = new Map();
// const lm = new LockManager()
let lock = null;

class GitIndexManager {
  static async acquire ({ fs: _fs, filepath }, closure) {
    const fs = new FileSystem(_fs);
    if (lock === null) lock = new AsyncLock({ maxPending: Infinity });
    await lock.acquire(filepath, async function () {
      let index = map.get(filepath);
      if (index === undefined) {
        // Acquire a file lock while we're reading the index
        // to make sure other processes aren't writing to it
        // simultaneously, which could result in a corrupted index.
        // const fileLock = await Lock(filepath)
        const rawIndexFile = await fs.read(filepath);
        index = GitIndex.from(rawIndexFile);
        // cache the GitIndex object so we don't need to re-read it
        // every time.
        // TODO: save the stat data for the index so we know whether
        // the cached file is stale (modified by an outside process).
        map.set(filepath, index);
        // await fileLock.cancel()
      }
      await closure(index);
      if (index._dirty) {
        // Acquire a file lock while we're writing the index file
        // let fileLock = await Lock(filepath)
        const buffer = index.toObject();
        await fs.write(filepath, buffer);
        index._dirty = false;
      }
      // For now, discard our cached object so that external index
      // manipulation is picked up. TODO: use lstat and compare
      // file times to determine if our cached object should be
      // discarded.
      map.delete(filepath);
    });
  }
}

class GitObject {
  static wrap ({ type, object }) {
    return Buffer.concat([
      Buffer.from(`${type} ${object.byteLength.toString()}\x00`),
      Buffer.from(object)
    ])
  }
  static unwrap (buffer) {
    let s = buffer.indexOf(32); // first space
    let i = buffer.indexOf(0); // first null value
    let type = buffer.slice(0, s).toString('utf8'); // get type of object
    let length = buffer.slice(s + 1, i).toString('utf8'); // get type of object
    let actualLength = buffer.length - (i + 1);
    // verify length
    if (parseInt(length) !== actualLength) {
      throw new GitError(E.InternalFail, {
        message: `Length mismatch: expected ${length} bytes but got ${actualLength} instead.`
      })
    }
    return {
      type,
      object: Buffer.from(buffer.slice(i + 1))
    }
  }
}

async function writeObjectLoose ({
  fs: _fs,
  gitdir,
  type,
  object,
  format,
  oid
}) {
  const fs = new FileSystem(_fs);
  if (format !== 'deflated') {
    throw new GitError(E.InternalFail, {
      message:
        'GitObjectStoreLoose expects objects to write to be in deflated format'
    })
  }
  let source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  let filepath = `${gitdir}/${source}`;
  // Don't overwrite existing git objects - this helps avoid EPERM errors.
  // Although I don't know how we'd fix corrupted objects then. Perhaps delete them
  // on read?
  if (!(await fs.exists(filepath))) await fs.write(filepath, object);
}

async function writeObject ({
  fs: _fs,
  gitdir,
  type,
  object,
  format = 'content',
  oid
}) {
  const fs = new FileSystem(_fs);
  if (format !== 'deflated') {
    if (format !== 'wrapped') {
      object = GitObject.wrap({ type, object });
    }
    oid = shasum(object);
    object = Buffer.from(pako.deflate(object));
  }
  await writeObjectLoose({ fs, gitdir, object, format: 'deflated', oid });
  return oid
}

// A collection of plugins is called a core.
// 99.99% of the time you will only need a single core,
// Because if you load isomorphic-git in an entirely new execution context
// (say a WebWorker) you'll have an entirely separate instance of the module itself
// and therefore a separate core. HOWEVER, for testing purposes, or a weird
// multi-tenant environment where you need two distinct instances of isomorphic-git's
// plugin stack but they share the same module instance - IDK maybe you are writing
// a tool that copies git objects between different filesystems so you want two
// cores with different filesystem modules. Anyway, it is architected that way.

class PluginCore extends Map {
  set (key, value) {
    const verifySchema = (key, value) => {
      const pluginSchemas = {
        credentialManager: ['fill', 'approved', 'rejected'],
        emitter: ['emit'],
        fs: [
          'lstat',
          'mkdir',
          'readdir',
          'readFile',
          'rmdir',
          'stat',
          'unlink',
          'writeFile'
        ],
        pgp: ['sign', 'verify'],
        http: []
      };
      if (!pluginSchemas.hasOwnProperty(key)) {
        throw new GitError(E.PluginUnrecognized, { plugin: key })
      }
      for (let method of pluginSchemas[key]) {
        if (value[method] === undefined) {
          throw new GitError(E.PluginSchemaViolation, { plugin: key, method })
        }
      }
    };
    verifySchema(key, value);
    // There can be only one.
    super.set(key, value);
  }
  get (key) {
    // Critical plugins throw an error instead of returning undefined.
    const critical = new Set(['credentialManager', 'fs', 'pgp']);
    if (!super.has(key) && critical.has(key)) {
      throw new GitError(E.PluginUndefined, { plugin: key })
    }
    return super.get(key)
  }
}

// 99.99% of the time you can simply import { plugins } instead of cores.
const plugins = new PluginCore();

const _cores = new Map([['default', plugins]]);

const cores = {
  // 'get' validates that a core has been registered
  get (key) {
    if (_cores.has(key)) {
      return _cores.get(key)
    } else {
      throw new GitError(E.CoreNotFound, { core: key })
    }
  },
  // 'create' works just like get but will create the core if it doesn't exist yet
  create (key) {
    if (_cores.has(key)) {
      return _cores.get(key)
    } else {
      _cores.set(key, new Map());
      return _cores.get(key)
    }
  }
};

/**
 * Add a file to the git index (aka staging area)
 *
 * @link https://isomorphic-git.github.io/docs/add.html
 */

async function add ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  filepath
}) {
  try {
    const fs = new FileSystem(_fs);
    let added = [];
    await GitIndexManager.acquire(
      { fs, filepath: `${gitdir}/index` },
      async function (index) {
        await addToIndex({ dir, gitdir, fs, filepath, index, added });
      }
    );
    if (emitter) {
      emitter.emit(`${emitterPrefix}add`, {
        filepath,
        added
      });
    }
    return added
  } catch (err) {
    err.caller = 'git.add';
    throw err
  }
}

async function addToIndex ({ dir, gitdir, fs, filepath, index, added }) {
  const stage = index.entriesMap.get(GitIndex.key(filepath, 0)) ||
    index.entriesMap.get(GitIndex.key(filepath, 2));
  if (!stage) {
    // Should ignore UNLESS it's already in the index.
    const ignored = await GitIgnoreManager.isIgnored({
      fs,
      dir,
      gitdir,
      filepath
    });
    if (ignored) return
  }
  let stats = await fs.lstat(join(dir, filepath));
  if (!stats) throw new GitError(E.FileReadError, { filepath })
  if (stats.isDirectory()) {
    const children = await fs.readdir(join(dir, filepath));
    const promises = children.map(child =>
      addToIndex({ dir, gitdir, fs, filepath: join(filepath, child), index, added })
    );
    await Promise.all(promises);
  } else {
    const object = stats.isSymbolicLink()
      ? await fs.readlink(join(dir, filepath))
      : await fs.read(join(dir, filepath));
    if (object === null) throw new GitError(E.FileReadError, { filepath })
    const oid = await writeObject({ fs, gitdir, type: 'blob', object });
    if (stage) index.delete({ filepath });
    index.insert({ filepath, stats, oid });
    added.push({ filepath, oid });
  }
}

// This is straight from parse_unit_factor in config.c of canonical git
const num = val => {
  val = val.toLowerCase();
  let n = parseInt(val);
  if (val.endsWith('k')) n *= 1024;
  if (val.endsWith('m')) n *= 1024 * 1024;
  if (val.endsWith('g')) n *= 1024 * 1024 * 1024;
  return n
};

// This is straight from git_parse_maybe_bool_text in config.c of canonical git
const bool = val => {
  val = val.trim().toLowerCase();
  if (val === 'true' || val === 'yes' || val === 'on') return true
  if (val === 'false' || val === 'no' || val === 'off') return false
  throw Error(
    `Expected 'true', 'false', 'yes', 'no', 'on', or 'off', but got ${val}`
  )
};

const schema = {
  core: {
    filemode: bool,
    bare: bool,
    logallrefupdates: bool,
    symlinks: bool,
    ignorecase: bool,
    bigFileThreshold: num
  }
};

// https://git-scm.com/docs/git-config

// section starts with [ and ends with ]
// section is alphanumeric (ASCII) with _ and .
// section is case insensitive
// subsection is optionnal
// subsection is specified after section and one or more spaces
// subsection is specified between double quotes
const SECTION_LINE_REGEX = /^\[([A-Za-z0-9_.]+)(?: "(.*)")?\]$/;
const SECTION_REGEX = /^[A-Za-z0-9_.]+$/;

// variable lines contain a name, and equal sign and then a value
// variable lines can also only contain a name (the implicit value is a boolean true)
// variable name is alphanumeric (ASCII) with _
// variable name starts with an alphabetic character
// variable name is case insensitive
const VARIABLE_LINE_REGEX = /^([A-Za-z]\w*)(?: *= *(.*))?$/;
const VARIABLE_NAME_REGEX = /^[A-Za-z]\w*$/;

const VARIABLE_VALUE_COMMENT_REGEX = /^(.*?)( *[#;].*)$/;

const extractSectionLine = line => {
  const matches = SECTION_LINE_REGEX.exec(line);
  if (matches != null) {
    const [section, subsection] = matches.slice(1);
    return [section, subsection]
  }
  return null
};

const extractVariableLine = line => {
  const matches = VARIABLE_LINE_REGEX.exec(line);
  if (matches != null) {
    const [name, rawValue = 'true'] = matches.slice(1);
    const valueWithoutComments = removeComments(rawValue);
    const valueWithoutQuotes = removeQuotes(valueWithoutComments);
    return [name, valueWithoutQuotes]
  }
  return null
};

const removeComments = rawValue => {
  const commentMatches = VARIABLE_VALUE_COMMENT_REGEX.exec(rawValue);
  if (commentMatches == null) {
    return rawValue
  }
  const [valueWithoutComment, comment] = commentMatches.slice(1);
  // if odd number of quotes before and after comment => comment is escaped
  if (
    hasOddNumberOfQuotes(valueWithoutComment) &&
    hasOddNumberOfQuotes(comment)
  ) {
    return `${valueWithoutComment}${comment}`
  }
  return valueWithoutComment
};

const hasOddNumberOfQuotes = text => {
  const numberOfQuotes = (text.match(/(?:^|[^\\])"/g) || []).length;
  return numberOfQuotes % 2 !== 0
};

const removeQuotes = text => {
  return text.split('').reduce((newText, c, idx, text) => {
    const isQuote = c === '"' && text[idx - 1] !== '\\';
    const isEscapeForQuote = c === '\\' && text[idx + 1] === '"';
    if (isQuote || isEscapeForQuote) {
      return newText
    }
    return newText + c
  }, '')
};

const lower = text => {
  return text != null ? text.toLowerCase() : null
};

const getPath = (section, subsection, name) => {
  return [lower(section), subsection, lower(name)]
    .filter(a => a != null)
    .join('.')
};

const findLastIndex = (array, callback) => {
  return array.reduce((lastIndex, item, index) => {
    return callback(item) ? index : lastIndex
  }, -1)
};

// Note: there are a LOT of edge cases that aren't covered (e.g. keys in sections that also
// have subsections, [include] directives, etc.
class GitConfig {
  constructor (text) {
    let section = null;
    let subsection = null;
    this.parsedConfig = text.split('\n').map(line => {
      let name = null;
      let value = null;

      const trimmedLine = line.trim();
      const extractedSection = extractSectionLine(trimmedLine);
      const isSection = extractedSection != null;
      if (isSection) {
[section, subsection] = extractedSection;
      } else {
        const extractedVariable = extractVariableLine(trimmedLine);
        const isVariable = extractedVariable != null;
        if (isVariable) {
[name, value] = extractedVariable;
        }
      }

      const path = getPath(section, subsection, name);
      return { line, isSection, section, subsection, name, value, path }
    });
  }
  static from (text) {
    return new GitConfig(text)
  }
  async get (path, getall = false) {
    const allValues = this.parsedConfig
      .filter(config => config.path === path.toLowerCase())
      .map(({ section, name, value }) => {
        const fn = schema[section] && schema[section][name];
        return fn ? fn(value) : value
      });
    return getall ? allValues : allValues.pop()
  }
  async getall (path) {
    return this.get(path, true)
  }
  async getSubsections (section) {
    return this.parsedConfig
      .filter(config => config.section === section && config.isSection)
      .map(config => config.subsection)
  }
  async deleteSection (section, subsection) {
    this.parsedConfig = this.parsedConfig.filter(
      config =>
        !(config.section === section && config.subsection === subsection)
    );
  }
  async append (path, value) {
    return this.set(path, value, true)
  }
  async set (path, value, append = false) {
    const configIndex = findLastIndex(
      this.parsedConfig,
      config => config.path === path.toLowerCase()
    );
    if (value == null) {
      if (configIndex !== -1) {
        this.parsedConfig.splice(configIndex, 1);
      }
    } else {
      if (configIndex !== -1) {
        const config = this.parsedConfig[configIndex];
        const modifiedConfig = Object.assign({}, config, {
          value,
          modified: true
        });
        if (append) {
          this.parsedConfig.splice(configIndex + 1, 0, modifiedConfig);
        } else {
          this.parsedConfig[configIndex] = modifiedConfig;
        }
      } else {
        const sectionPath = path
          .split('.')
          .slice(0, -1)
          .join('.')
          .toLowerCase();
        const sectionIndex = this.parsedConfig.findIndex(
          config => config.path === sectionPath
        );
        const [section, subsection] = sectionPath.split('.');
        const name = path.split('.').pop();
        const newConfig = {
          section,
          subsection,
          name,
          value,
          modified: true,
          path: getPath(section, subsection, name)
        };
        if (SECTION_REGEX.test(section) && VARIABLE_NAME_REGEX.test(name)) {
          if (sectionIndex >= 0) {
            // Reuse existing section
            this.parsedConfig.splice(sectionIndex + 1, 0, newConfig);
          } else {
            // Add a new section
            const newSection = {
              section,
              subsection,
              modified: true,
              path: getPath(section, subsection, null)
            };
            this.parsedConfig.push(newSection, newConfig);
          }
        }
      }
    }
  }
  toString () {
    return this.parsedConfig
      .map(({ line, section, subsection, name, value, modified = false }) => {
        if (!modified) {
          return line
        }
        if (name != null && value != null) {
          return `\t${name} = ${value}`
        }
        if (subsection != null) {
          return `[${section} "${subsection}"]`
        }
        return `[${section}]`
      })
      .join('\n')
  }
}

class GitConfigManager {
  static async get ({ fs: _fs, gitdir }) {
    const fs = new FileSystem(_fs);
    // We can improve efficiency later if needed.
    // TODO: read from full list of git config files
    let text = await fs.read(`${gitdir}/config`, { encoding: 'utf8' });
    return GitConfig.from(text)
  }
  static async save ({ fs: _fs, gitdir, config }) {
    const fs = new FileSystem(_fs);
    // We can improve efficiency later if needed.
    // TODO: handle saving to the correct global/user/repo location
    await fs.write(`${gitdir}/config`, config.toString(), {
      encoding: 'utf8'
    });
  }
}

/**
 * Add a new remote
 *
 * @link https://isomorphic-git.github.io/docs/addRemote.html
 */
async function addRemote ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  remote,
  url,
  force = false
}) {
  try {
    const fs = new FileSystem(_fs);
    if (remote === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'addRemote',
        parameter: 'remote'
      })
    }
    if (url === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'addRemote',
        parameter: 'url'
      })
    }
    if (remote !== cleanGitRef.clean(remote)) {
      throw new GitError(E.InvalidRefNameError, {
        verb: 'add',
        noun: 'remote',
        ref: remote,
        suggestion: cleanGitRef.clean(remote)
      })
    }
    const config = await GitConfigManager.get({ fs, gitdir });
    if (!force) {
      // Check that setting it wouldn't overwrite.
      const remoteNames = await config.getSubsections('remote');
      if (remoteNames.includes(remote)) {
        // Throw an error if it would overwrite an existing remote,
        // but not if it's simply setting the same value again.
        if (url !== (await config.get(`remote.${remote}.url`))) {
          throw new GitError(E.AddingRemoteWouldOverwrite, { remote })
        }
      }
    }
    await config.set(`remote.${remote}.url`, url);
    await config.set(
      `remote.${remote}.fetch`,
      `+refs/heads/*:refs/remotes/${remote}/*`
    );
    await GitConfigManager.save({ fs, gitdir, config });
  } catch (err) {
    err.caller = 'git.addRemote';
    throw err
  }
}

class GitPackedRefs {
  constructor (text) {
    this.refs = new Map();
    this.parsedConfig = [];
    if (text) {
      let key = null;
      this.parsedConfig = text
        .trim()
        .split('\n')
        .map(line => {
          if (/^\s*#/.test(line)) {
            return { line, comment: true }
          }
          const i = line.indexOf(' ');
          if (line.startsWith('^')) {
            // This is a oid for the commit associated with the annotated tag immediately preceding this line.
            // Trim off the '^'
            const value = line.slice(1);
            // The tagname^{} syntax is based on the output of `git show-ref --tags -d`
            this.refs.set(key + '^{}', value);
            return { line, ref: key, peeled: value }
          } else {
            // This is an oid followed by the ref name
            const value = line.slice(0, i);
            key = line.slice(i + 1);
            this.refs.set(key, value);
            return { line, ref: key, oid: value }
          }
        });
    }
    return this
  }
  static from (text) {
    return new GitPackedRefs(text)
  }
  delete (ref) {
    this.parsedConfig = this.parsedConfig.filter(entry => entry.ref !== ref);
    this.refs.delete(ref);
  }
  toString () {
    return this.parsedConfig.map(({ line }) => line).join('\n') + '\n'
  }
}

class GitRefSpec {
  constructor ({ remotePath, localPath, force, matchPrefix }) {
    Object.assign(this, {
      remotePath,
      localPath,
      force,
      matchPrefix
    });
  }
  static from (refspec) {
    const [
      forceMatch,
      remotePath,
      remoteGlobMatch,
      localPath,
      localGlobMatch
    ] = refspec.match(/^(\+?)(.*?)(\*?):(.*?)(\*?)$/).slice(1);
    const force = forceMatch === '+';
    const remoteIsGlob = remoteGlobMatch === '*';
    const localIsGlob = localGlobMatch === '*';
    // validate
    // TODO: Make this check more nuanced, and depend on whether this is a fetch refspec or a push refspec
    if (remoteIsGlob !== localIsGlob) {
      throw new GitError(E.InternalFail, { message: 'Invalid refspec' })
    }
    return new GitRefSpec({
      remotePath,
      localPath,
      force,
      matchPrefix: remoteIsGlob
    })
    // TODO: We need to run resolveRef on both paths to expand them to their full name.
  }
  translate (remoteBranch) {
    if (this.matchPrefix) {
      if (remoteBranch.startsWith(this.remotePath)) {
        return this.localPath + remoteBranch.replace(this.remotePath, '')
      }
    } else {
      if (remoteBranch === this.remotePath) return this.localPath
    }
    return null
  }
}

class GitRefSpecSet {
  constructor (rules = []) {
    this.rules = rules;
  }
  static from (refspecs) {
    const rules = [];
    for (const refspec of refspecs) {
      rules.push(GitRefSpec.from(refspec)); // might throw
    }
    return new GitRefSpecSet(rules)
  }
  add (refspec) {
    const rule = GitRefSpec.from(refspec); // might throw
    this.rules.push(rule);
  }
  translate (remoteRefs) {
    const result = [];
    for (const rule of this.rules) {
      for (const remoteRef of remoteRefs) {
        const localRef = rule.translate(remoteRef);
        if (localRef) {
          result.push([remoteRef, localRef]);
        }
      }
    }
    return result
  }
  translateOne (remoteRef) {
    let result = null;
    for (const rule of this.rules) {
      const localRef = rule.translate(remoteRef);
      if (localRef) {
        result = localRef;
      }
    }
    return result
  }
}

function compareRefNames (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  let _a = a.replace(/\^\{\}$/, '');
  let _b = b.replace(/\^\{\}$/, '');
  let tmp = -(_a < _b) || +(_a > _b);
  if (tmp === 0) {
    return a.endsWith('^{}') ? 1 : -1
  }
  return tmp
}

// This is a convenience wrapper for reading and writing files in the 'refs' directory.

// @see https://git-scm.com/docs/git-rev-parse.html#_specifying_revisions
const refpaths = ref => [
  `${ref}`,
  `refs/${ref}`,
  `refs/tags/${ref}`,
  `refs/heads/${ref}`,
  `refs/remotes/${ref}`,
  `refs/remotes/${ref}/HEAD`
];

class GitRefManager {
  static async updateRemoteRefs ({
    fs: _fs,
    gitdir,
    remote,
    refs,
    symrefs,
    tags,
    refspecs
  }) {
    const fs = new FileSystem(_fs);
    // Validate input
    for (let value of refs.values()) {
      if (!value.match(/[0-9a-f]{40}/)) {
        throw new GitError(E.NotAnOidFail, { value })
      }
    }
    const config = await GitConfigManager.get({ fs, gitdir });
    if (!refspecs) {
      refspecs = await config.getall(`remote.${remote}.fetch`);
      if (refspecs.length === 0) {
        throw new GitError(E.NoRefspecConfiguredError, { remote })
      }
      // There's some interesting behavior with HEAD that doesn't follow the refspec.
      refspecs.unshift(`+HEAD:refs/remotes/${remote}/HEAD`);
    }
    const refspec = GitRefSpecSet.from(refspecs);
    let actualRefsToWrite = new Map();
    // Add all tags if the fetch tags argument is true.
    if (tags) {
      for (const serverRef of refs.keys()) {
        if (serverRef.startsWith('refs/tags') && !serverRef.endsWith('^{}')) {
          const filename = join(gitdir, serverRef);
          // Git's behavior is to only fetch tags that do not conflict with tags already present.
          if (!(await fs.exists(filename))) {
            // If there is a dereferenced an annotated tag value available, prefer that.
            const oid = refs.get(serverRef + '^{}') || refs.get(serverRef);
            actualRefsToWrite.set(serverRef, oid);
          }
        }
      }
    }
    // Combine refs and symrefs giving symrefs priority
    let refTranslations = refspec.translate([...refs.keys()]);
    for (let [serverRef, translatedRef] of refTranslations) {
      let value = refs.get(serverRef);
      actualRefsToWrite.set(translatedRef, value);
    }
    let symrefTranslations = refspec.translate([...symrefs.keys()]);
    for (let [serverRef, translatedRef] of symrefTranslations) {
      let value = symrefs.get(serverRef);
      let symtarget = refspec.translateOne(value);
      if (symtarget) {
        actualRefsToWrite.set(translatedRef, `ref: ${symtarget}`);
      }
    }
    // Update files
    // TODO: For large repos with a history of thousands of pull requests
    // (i.e. gitlab-ce) it would be vastly more efficient to write them
    // to .git/packed-refs.
    // The trick is to make sure we a) don't write a packed ref that is
    // already shadowed by a loose ref and b) don't loose any refs already
    // in packed-refs. Doing this efficiently may be difficult. A
    // solution that might work is
    // a) load the current packed-refs file
    // b) add actualRefsToWrite, overriding the existing values if present
    // c) enumerate all the loose refs currently in .git/refs/remotes/${remote}
    // d) overwrite their value with the new value.
    // Examples of refs we need to avoid writing in loose format for efficieny's sake
    // are .git/refs/remotes/origin/refs/remotes/remote_mirror_3059
    // and .git/refs/remotes/origin/refs/merge-requests
    for (let [key, value] of actualRefsToWrite) {
      await fs.write(join(gitdir, key), `${value.trim()}\n`, 'utf8');
    }
  }
  // TODO: make this less crude?
  static async writeRef ({ fs: _fs, gitdir, ref, value }) {
    const fs = new FileSystem(_fs);
    // Validate input
    if (!value.match(/[0-9a-f]{40}/)) {
      throw new GitError(E.NotAnOidFail, { value })
    }
    await fs.write(join(gitdir, ref), `${value.trim()}\n`, 'utf8');
  }
  static async writeSymbolicRef ({ fs: _fs, gitdir, ref, value }) {
    const fs = new FileSystem(_fs);
    await fs.write(join(gitdir, ref), 'ref: ' + `${value.trim()}\n`, 'utf8');
  }
  static async deleteRef ({ fs: _fs, gitdir, ref }) {
    const fs = new FileSystem(_fs);
    // Delete regular ref
    await fs.rm(join(gitdir, ref));
    // Delete any packed ref
    let text = await fs.read(`${gitdir}/packed-refs`, { encoding: 'utf8' });
    const packed = GitPackedRefs.from(text);
    if (packed.refs.has(ref)) {
      packed.delete(ref);
      text = packed.toString();
      await fs.write(`${gitdir}/packed-refs`, text, { encoding: 'utf8' });
    }
  }
  static async resolve ({ fs: _fs, gitdir, ref, depth }) {
    const fs = new FileSystem(_fs);
    if (depth !== undefined) {
      depth--;
      if (depth === -1) {
        return ref
      }
    }
    let sha;
    // Is it a ref pointer?
    if (ref.startsWith('ref: ')) {
      ref = ref.slice('ref: '.length);
      return GitRefManager.resolve({ fs, gitdir, ref, depth })
    }
    // Is it a complete and valid SHA?
    if (ref.length === 40 && /[0-9a-f]{40}/.test(ref)) {
      return ref
    }
    // We need to alternate between the file system and the packed-refs
    let packedMap = await GitRefManager.packedRefs({ fs, gitdir });
    // Look in all the proper paths, in this order
    const allpaths = refpaths(ref);
    for (let ref of allpaths) {
      sha =
        (await fs.read(`${gitdir}/${ref}`, { encoding: 'utf8' })) ||
        packedMap.get(ref);
      if (sha) {
        return GitRefManager.resolve({ fs, gitdir, ref: sha.trim(), depth })
      }
    }
    // Do we give up?
    throw new GitError(E.ResolveRefError, { ref })
  }
  static async exists ({ fs, gitdir, ref }) {
    try {
      await GitRefManager.expand({ fs, gitdir, ref });
      return true
    } catch (err) {
      return false
    }
  }
  static async expand ({ fs: _fs, gitdir, ref }) {
    const fs = new FileSystem(_fs);
    // Is it a complete and valid SHA?
    if (ref.length === 40 && /[0-9a-f]{40}/.test(ref)) {
      return ref
    }
    // We need to alternate between the file system and the packed-refs
    let packedMap = await GitRefManager.packedRefs({ fs, gitdir });
    // Look in all the proper paths, in this order
    const allpaths = refpaths(ref);
    for (let ref of allpaths) {
      if (await fs.exists(`${gitdir}/${ref}`)) return ref
      if (packedMap.has(ref)) return ref
    }
    // Do we give up?
    throw new GitError(E.ExpandRefError, { ref })
  }
  static async expandAgainstMap ({ fs: _fs, gitdir, ref, map }) {
    // Look in all the proper paths, in this order
    const allpaths = refpaths(ref);
    for (let ref of allpaths) {
      if (await map.has(ref)) return ref
    }
    // Do we give up?
    throw new GitError(E.ExpandRefError, { ref })
  }
  static resolveAgainstMap ({ ref, fullref = ref, depth, map }) {
    if (depth !== undefined) {
      depth--;
      if (depth === -1) {
        return { fullref, oid: ref }
      }
    }
    // Is it a ref pointer?
    if (ref.startsWith('ref: ')) {
      ref = ref.slice('ref: '.length);
      return GitRefManager.resolveAgainstMap({ ref, fullref, depth, map })
    }
    // Is it a complete and valid SHA?
    if (ref.length === 40 && /[0-9a-f]{40}/.test(ref)) {
      return { fullref, oid: ref }
    }
    // Look in all the proper paths, in this order
    const allpaths = refpaths(ref);
    for (let ref of allpaths) {
      let sha = map.get(ref);
      if (sha) {
        return GitRefManager.resolveAgainstMap({
          ref: sha.trim(),
          fullref: ref,
          depth,
          map
        })
      }
    }
    // Do we give up?
    throw new GitError(E.ResolveRefError, { ref })
  }
  static async packedRefs ({ fs: _fs, gitdir }) {
    const fs = new FileSystem(_fs);
    const text = await fs.read(`${gitdir}/packed-refs`, { encoding: 'utf8' });
    const packed = GitPackedRefs.from(text);
    return packed.refs
  }
  // List all the refs that match the `filepath` prefix
  static async listRefs ({ fs: _fs, gitdir, filepath }) {
    const fs = new FileSystem(_fs);
    let packedMap = GitRefManager.packedRefs({ fs, gitdir });
    let files = null;
    try {
      files = await fs.readdirDeep(`${gitdir}/${filepath}`);
      files = files.map(x => x.replace(`${gitdir}/${filepath}/`, ''));
    } catch (err) {
      files = [];
    }

    for (let key of (await packedMap).keys()) {
      // filter by prefix
      if (key.startsWith(filepath)) {
        // remove prefix
        key = key.replace(filepath + '/', '');
        // Don't include duplicates; the loose files have precedence anyway
        if (!files.includes(key)) {
          files.push(key);
        }
      }
    }
    // since we just appended things onto an array, we need to sort them now
    files.sort(compareRefNames);
    return files
  }
  static async listBranches ({ fs: _fs, gitdir, remote }) {
    const fs = new FileSystem(_fs);
    if (remote) {
      return GitRefManager.listRefs({
        fs,
        gitdir,
        filepath: `refs/remotes/${remote}`
      })
    } else {
      return GitRefManager.listRefs({ fs, gitdir, filepath: `refs/heads` })
    }
  }
  static async listTags ({ fs: _fs, gitdir }) {
    const fs = new FileSystem(_fs);
    let tags = await GitRefManager.listRefs({
      fs,
      gitdir,
      filepath: `refs/tags`
    });
    return tags.filter(x => !x.endsWith('^{}'))
  }
}

function formatAuthor ({ name, email, timestamp, timezoneOffset }) {
  timezoneOffset = formatTimezoneOffset(timezoneOffset);
  return `${name} <${email}> ${timestamp} ${timezoneOffset}`
}

// The amount of effort that went into crafting these cases to handle
// -0 (just so we don't lose that information when parsing and reconstructing)
// but can also default to +0 was extraordinary.

function formatTimezoneOffset (minutes) {
  let sign = simpleSign(negateExceptForZero(minutes));
  minutes = Math.abs(minutes);
  let hours = Math.floor(minutes / 60);
  minutes -= hours * 60;
  let strHours = String(hours);
  let strMinutes = String(minutes);
  if (strHours.length < 2) strHours = '0' + strHours;
  if (strMinutes.length < 2) strMinutes = '0' + strMinutes;
  return (sign === -1 ? '-' : '+') + strHours + strMinutes
}

function simpleSign (n) {
  return Math.sign(n) || (Object.is(n, -0) ? -1 : 1)
}

function negateExceptForZero (n) {
  return n === 0 ? n : -n
}

function normalizeNewlines (str) {
  // remove all <CR>
  str = str.replace(/\r/g, '');
  // no extra newlines up front
  str = str.replace(/^\n+/, '');
  // and a single newline at the end
  str = str.replace(/\n+$/, '') + '\n';
  return str
}

function parseAuthor (author) {
  let [, name, email, timestamp, offset] = author.match(
    /^(.*) <(.*)> (.*) (.*)$/
  );
  return {
    name: name,
    email: email,
    timestamp: Number(timestamp),
    timezoneOffset: parseTimezoneOffset(offset)
  }
}

// The amount of effort that went into crafting these cases to handle
// -0 (just so we don't lose that information when parsing and reconstructing)
// but can also default to +0 was extraordinary.

function parseTimezoneOffset (offset) {
  let [, sign, hours, minutes] = offset.match(/(\+|-)(\d\d)(\d\d)/);
  minutes = (sign === '+' ? 1 : -1) * (Number(hours) * 60 + Number(minutes));
  return negateExceptForZero$1(minutes)
}

function negateExceptForZero$1 (n) {
  return n === 0 ? n : -n
}

class GitAnnotatedTag {
  constructor (tag) {
    if (typeof tag === 'string') {
      this._tag = tag;
    } else if (Buffer.isBuffer(tag)) {
      this._tag = tag.toString('utf8');
    } else if (typeof tag === 'object') {
      this._tag = GitAnnotatedTag.render(tag);
    } else {
      throw new GitError(E.InternalFail, {
        message: 'invalid type passed to GitAnnotatedTag constructor'
      })
    }
  }

  static from (tag) {
    return new GitAnnotatedTag(tag)
  }

  static render (obj) {
    return `object ${obj.object}
type ${obj.type}
tag ${obj.tag}
tagger ${formatAuthor(obj.tagger)}

${obj.message}
${obj.signature ? obj.signature : ''}`
  }

  justHeaders () {
    return this._tag.slice(0, this._tag.indexOf('\n\n'))
  }

  message () {
    let tag = this.withoutSignature();
    return tag.slice(tag.indexOf('\n\n') + 2)
  }

  parse () {
    return Object.assign(this.headers(), {
      message: this.message(),
      signature: this.signature()
    })
  }

  render () {
    return this._tag
  }

  headers () {
    let headers = this.justHeaders().split('\n');
    let hs = [];
    for (let h of headers) {
      if (h[0] === ' ') {
        // combine with previous header (without space indent)
        hs[hs.length - 1] += '\n' + h.slice(1);
      } else {
        hs.push(h);
      }
    }
    let obj = {};
    for (let h of hs) {
      let key = h.slice(0, h.indexOf(' '));
      let value = h.slice(h.indexOf(' ') + 1);
      if (Array.isArray(obj[key])) {
        obj[key].push(value);
      } else {
        obj[key] = value;
      }
    }
    if (obj.tagger) {
      obj.tagger = parseAuthor(obj.tagger);
    }
    if (obj.committer) {
      obj.committer = parseAuthor(obj.committer);
    }
    return obj
  }

  withoutSignature () {
    let tag = normalizeNewlines(this._tag);
    if (tag.indexOf('\n-----BEGIN PGP SIGNATURE-----') === -1) return tag
    return tag.slice(0, tag.lastIndexOf('\n-----BEGIN PGP SIGNATURE-----'))
  }

  signature () {
    let signature = this._tag.slice(
      this._tag.indexOf('-----BEGIN PGP SIGNATURE-----'),
      this._tag.indexOf('-----END PGP SIGNATURE-----') +
        '-----END PGP SIGNATURE-----'.length
    );
    return normalizeNewlines(signature)
  }

  toObject () {
    return Buffer.from(this._tag, 'utf8')
  }

  static async sign (tag, pgp, secretKey) {
    const payload = tag.withoutSignature() + '\n';
    let { signature } = await pgp.sign({ payload, secretKey });
    // renormalize the line endings to the one true line-ending
    signature = normalizeNewlines(signature);
    let signedTag = payload + signature;
    // return a new tag object
    return GitAnnotatedTag.from(signedTag)
  }

  static async verify (tag, pgp, publicKey) {
    const payload = tag.withoutSignature() + '\n';
    const signature = tag.signature();
    return pgp.verify({ payload, publicKey, signature })
  }
}

async function readObjectLoose ({ fs: _fs, gitdir, oid }) {
  const fs = new FileSystem(_fs);
  let source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  let file = await fs.read(`${gitdir}/${source}`);
  if (!file) {
    return null
  }
  return { object: file, format: 'deflated', source }
}

// Convert a web ReadableStream (not Node stream!) to an Async Iterator
// adapted from https://jakearchibald.com/2017/async-iterators-and-generators/
function fromStream (stream) {
  // Use native async iteration if it's available.
  if (stream[Symbol.asyncIterator]) return stream
  const reader = stream.getReader();
  return {
    next () {
      return reader.read()
    },
    return () {
      reader.releaseLock();
      return {}
    },
    [Symbol.asyncIterator] () {
      return this
    }
  }
}

// This will be easier with async generator functions.
function fromValue (value) {
  let queue = [value];
  return {
    next () {
      return Promise.resolve({ done: queue.length === 0, value: queue.pop() })
    },
    return () {
      queue = [];
      return {}
    },
    [Symbol.asyncIterator] () {
      return this
    }
  }
}

function getIterator (iterable) {
  if (iterable[Symbol.asyncIterator]) {
    return iterable[Symbol.asyncIterator]()
  }
  if (iterable[Symbol.iterator]) {
    return iterable[Symbol.iterator]()
  }
  if (iterable.next) {
    return iterable
  }
  return fromValue(iterable)
}

// inspired by 'gartal' but lighter-weight and more battle-tested.
class StreamReader {
  constructor (stream) {
    this.stream = getIterator(stream);
    this.buffer = null;
    this.cursor = 0;
    this.undoCursor = 0;
    this.started = false;
    this._ended = false;
    this._discardedBytes = 0;
  }
  eof () {
    return this._ended && this.cursor === this.buffer.length
  }
  tell () {
    return this._discardedBytes + this.cursor
  }
  async byte () {
    if (this.eof()) return
    if (!this.started) await this._init();
    if (this.cursor === this.buffer.length) {
      await this._loadnext();
      if (this._ended) return
    }
    this._moveCursor(1);
    return this.buffer[this.undoCursor]
  }
  async chunk () {
    if (this.eof()) return
    if (!this.started) await this._init();
    if (this.cursor === this.buffer.length) {
      await this._loadnext();
      if (this._ended) return
    }
    this._moveCursor(this.buffer.length);
    return this.buffer.slice(this.undoCursor, this.cursor)
  }
  async read (n) {
    if (this.eof()) return
    if (!this.started) await this._init();
    if (this.cursor + n > this.buffer.length) {
      this._trim();
      await this._accumulate(n);
    }
    this._moveCursor(n);
    return this.buffer.slice(this.undoCursor, this.cursor)
  }
  async skip (n) {
    if (this.eof()) return
    if (!this.started) await this._init();
    if (this.cursor + n > this.buffer.length) {
      this._trim();
      await this._accumulate(n);
    }
    this._moveCursor(n);
  }
  async undo () {
    this.cursor = this.undoCursor;
  }
  async _next () {
    this.started = true;
    let { done, value } = await this.stream.next();
    if (done) {
      this._ended = true;
    }
    if (value) {
      value = Buffer.from(value);
    }
    return value
  }
  _trim () {
    // Throw away parts of the buffer we don't need anymore
    // assert(this.cursor <= this.buffer.length)
    this.buffer = this.buffer.slice(this.undoCursor);
    this.cursor -= this.undoCursor;
    this._discardedBytes += this.undoCursor;
    this.undoCursor = 0;
  }
  _moveCursor (n) {
    this.undoCursor = this.cursor;
    this.cursor += n;
    if (this.cursor > this.buffer.length) {
      this.cursor = this.buffer.length;
    }
  }
  async _accumulate (n) {
    if (this._ended) return
    // Expand the buffer until we have N bytes of data
    // or we've reached the end of the stream
    let buffers = [this.buffer];
    while (this.cursor + n > lengthBuffers(buffers)) {
      let nextbuffer = await this._next();
      if (this._ended) break
      buffers.push(nextbuffer);
    }
    this.buffer = Buffer.concat(buffers);
  }
  async _loadnext () {
    this._discardedBytes += this.buffer.length;
    this.undoCursor = 0;
    this.cursor = 0;
    this.buffer = await this._next();
  }
  async _init () {
    this.buffer = await this._next();
  }
}

// This helper function helps us postpone concatenating buffers, which
// would create intermediate buffer objects,
function lengthBuffers (buffers) {
  return buffers.reduce((acc, buffer) => acc + buffer.length, 0)
}

// My version of git-list-pack - roughly 15x faster than the original

async function listpack (stream, onData) {
  let reader = new StreamReader(stream);
  let hash = new Hash();
  let PACK = await reader.read(4);
  hash.update(PACK);
  PACK = PACK.toString('utf8');
  if (PACK !== 'PACK') {
    throw new GitError(E.InternalFail, {
      message: `Invalid PACK header '${PACK}'`
    })
  }

  let version = await reader.read(4);
  hash.update(version);
  version = version.readUInt32BE(0);
  if (version !== 2) {
    throw new GitError(E.InternalFail, {
      message: `Invalid packfile version: ${version}`
    })
  }

  let numObjects = await reader.read(4);
  hash.update(numObjects);
  numObjects = numObjects.readUInt32BE(0);
  // If (for some godforsaken reason) this is an empty packfile, abort now.
  if (numObjects < 1) return

  while (!reader.eof() && numObjects--) {
    let offset = reader.tell();
    let { type, length, ofs, reference } = await parseHeader(reader, hash);
    let inflator = new pako.Inflate();
    while (!inflator.result) {
      let chunk = await reader.chunk();
      if (reader.ended) break
      inflator.push(chunk, false);
      if (inflator.err) {
        throw new GitError(E.InternalFail, {
          message: `Pako error: ${inflator.msg}`
        })
      }
      if (inflator.result) {
        if (inflator.result.length !== length) {
          throw new GitError(E.InternalFail, {
            message: `Inflated object size is different from that stated in packfile.`
          })
        }

        // Backtrack parser to where deflated data ends
        await reader.undo();
        let buf = await reader.read(chunk.length - inflator.strm.avail_in);
        hash.update(buf);
        let end = reader.tell();
        onData({
          data: inflator.result,
          type,
          num: numObjects,
          offset,
          end,
          reference,
          ofs
        });
      } else {
        hash.update(chunk);
      }
    }
  }
}

async function parseHeader (reader, hash) {
  // Object type is encoded in bits 654
  let byte = await reader.byte();
  hash.update(Buffer.from([byte]));
  let type = (byte >> 4) & 0b111;
  // The length encoding get complicated.
  // Last four bits of length is encoded in bits 3210
  let length = byte & 0b1111;
  // Whether the next byte is part of the variable-length encoded number
  // is encoded in bit 7
  if (byte & 0b10000000) {
    let shift = 4;
    do {
      byte = await reader.byte();
      hash.update(Buffer.from([byte]));
      length |= (byte & 0b01111111) << shift;
      shift += 7;
    } while (byte & 0b10000000)
  }
  // Handle deltified objects
  let ofs;
  let reference;
  if (type === 6) {
    let shift = 0;
    ofs = 0;
    let bytes = [];
    do {
      byte = await reader.byte();
      hash.update(Buffer.from([byte]));
      ofs |= (byte & 0b01111111) << shift;
      shift += 7;
      bytes.push(byte);
    } while (byte & 0b10000000)
    reference = Buffer.from(bytes);
  }
  if (type === 7) {
    let buf = await reader.read(20);
    hash.update(buf);
    reference = buf;
  }
  return { type, length, ofs, reference }
}

let shouldLog = null;

function log (...args) {
  if (shouldLog === null) {
    shouldLog =
      (process &&
        process.env &&
        process.env.DEBUG &&
        (process.env.DEBUG === '*' ||
          process.env.DEBUG === 'isomorphic-git')) ||
      (typeof window !== 'undefined' &&
        typeof window.localStorage !== 'undefined' &&
        (window.localStorage.debug === '*' ||
          window.localStorage.debug === 'isomorphic-git'));
  }
  if (shouldLog) {
    console.log(...args);
  }
}

function decodeVarInt (reader) {
  let bytes = [];
  let byte = 0;
  let multibyte = 0;
  do {
    byte = reader.readUInt8();
    // We keep bits 6543210
    const lastSeven = byte & 0b01111111;
    bytes.push(lastSeven);
    // Whether the next byte is part of the variable-length encoded number
    // is encoded in bit 7
    multibyte = byte & 0b10000000;
  } while (multibyte)
  // Now that all the bytes are in big-endian order,
  // alternate shifting the bits left by 7 and OR-ing the next byte.
  // And... do a weird increment-by-one thing that I don't quite understand.
  return bytes.reduce((a, b) => ((a + 1) << 7) | b, -1)
}

// I'm pretty much copying this one from the git C source code,
// because it makes no sense.
function otherVarIntDecode (reader, startWith) {
  let result = startWith;
  let shift = 4;
  let byte = null;
  do {
    byte = reader.readUInt8();
    result |= (byte & 0b01111111) << shift;
    shift += 7;
  } while (byte & 0b10000000)
  return result
}

class GitPackIndex {
  constructor (stuff) {
    Object.assign(this, stuff);
    this.offsetCache = {};
  }
  static async fromIdx ({ idx, getExternalRefDelta }) {
    mark('fromIdx');
    let reader = new BufferCursor(idx);
    let magic = reader.slice(4).toString('hex');
    // Check for IDX v2 magic number
    if (magic !== 'ff744f63') {
      return // undefined
    }
    let version = reader.readUInt32BE();
    if (version !== 2) {
      throw new GitError(E.InternalFail, {
        message: `Unable to read version ${version} packfile IDX. (Only version 2 supported)`
      })
    }
    if (idx.byteLength > 2048 * 1024 * 1024) {
      throw new GitError(E.InternalFail, {
        message: `To keep implementation simple, I haven't implemented the layer 5 feature needed to support packfiles > 2GB in size.`
      })
    }
    // Skip over fanout table
    reader.seek(reader.tell() + 4 * 255);
    // Get hashes
    let size = reader.readUInt32BE();
    mark('hashes');
    let hashes = [];
    for (let i = 0; i < size; i++) {
      let hash = reader.slice(20).toString('hex');
      hashes[i] = hash;
    }
    log(`hashes ${stop('hashes').duration}`);
    reader.seek(reader.tell() + 4 * size);
    // Skip over CRCs
    mark('offsets');
    // Get offsets
    let offsets = new Map();
    for (let i = 0; i < size; i++) {
      offsets.set(hashes[i], reader.readUInt32BE());
    }
    log(`offsets ${stop('offsets').duration}`);
    let packfileSha = reader.slice(20).toString('hex');
    log(`fromIdx ${stop('fromIdx').duration}`);
    return new GitPackIndex({
      hashes,
      crcs: {},
      offsets,
      packfileSha,
      getExternalRefDelta
    })
  }
  static async fromPack ({ pack, getExternalRefDelta, emitter, emitterPrefix }) {
    const listpackTypes = {
      1: 'commit',
      2: 'tree',
      3: 'blob',
      4: 'tag',
      6: 'ofs-delta',
      7: 'ref-delta'
    };
    let offsetToObject = {};

    // Older packfiles do NOT use the shasum of the pack itself,
    // so it is recommended to just use whatever bytes are in the trailer.
    // Source: https://github.com/git/git/commit/1190a1acf800acdcfd7569f87ac1560e2d077414
    let packfileSha = pack.slice(-20).toString('hex');

    let hashes = [];
    let crcs = {};
    let offsets = new Map();
    let totalObjectCount = null;
    let lastPercent = null;
    let times = {
      hash: 0,
      readSlice: 0,
      offsets: 0,
      crcs: 0,
      sort: 0
    };
    let histogram = {
      commit: 0,
      tree: 0,
      blob: 0,
      tag: 0,
      'ofs-delta': 0,
      'ref-delta': 0
    };
    let bytesProcessed = 0;

    log('Indexing objects');
    log(
      `percent\tmilliseconds\tbytesProcessed\tcommits\ttrees\tblobs\ttags\tofs-deltas\tref-deltas`
    );
    mark('total');
    mark('offsets');
    mark('percent');
    await listpack([pack], ({ data, type, reference, offset, num }) => {
      if (totalObjectCount === null) totalObjectCount = num;
      let percent = Math.floor(
        ((totalObjectCount - num) * 100) / totalObjectCount
      );
      if (percent !== lastPercent) {
        if (emitter) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: 'Receiving objects',
            loaded: totalObjectCount - num,
            total: totalObjectCount,
            lengthComputable: true
          });
        }
        log(
          `${percent}%\t${Math.floor(
            stop('percent').duration
          )}\t${bytesProcessed}\t${histogram.commit}\t${histogram.tree}\t${
            histogram.blob
          }\t${histogram.tag}\t${histogram['ofs-delta']}\t${
            histogram['ref-delta']
          }`
        );

        histogram = {
          commit: 0,
          tree: 0,
          blob: 0,
          tag: 0,
          'ofs-delta': 0,
          'ref-delta': 0
        };
        bytesProcessed = 0;
        mark('percent');
      }
      lastPercent = percent;
      // Change type from a number to a meaningful string
      type = listpackTypes[type];

      histogram[type]++;
      bytesProcessed += data.byteLength;

      if (['commit', 'tree', 'blob', 'tag'].includes(type)) {
        offsetToObject[offset] = {
          type,
          offset
        };
      } else if (type === 'ofs-delta') {
        offsetToObject[offset] = {
          type,
          offset
        };
      } else if (type === 'ref-delta') {
        offsetToObject[offset] = {
          type,
          offset
        };
      }
    });
    times['offsets'] = Math.floor(stop('offsets').duration);

    log('Computing CRCs');
    mark('crcs');
    // We need to know the lengths of the slices to compute the CRCs.
    let offsetArray = Object.keys(offsetToObject).map(Number);
    for (let [i, start] of offsetArray.entries()) {
      let end =
        i + 1 === offsetArray.length ? pack.byteLength - 20 : offsetArray[i + 1];
      let o = offsetToObject[start];
      let crc = crc32.buf(pack.slice(start, end)) >>> 0;
      o.end = end;
      o.crc = crc;
    }
    times['crcs'] = Math.floor(stop('crcs').duration);

    // We don't have the hashes yet. But we can generate them using the .readSlice function!
    const p = new GitPackIndex({
      pack: Promise.resolve(pack),
      packfileSha,
      crcs,
      hashes,
      offsets,
      getExternalRefDelta
    });

    // Resolve deltas and compute the oids
    log('Resolving deltas');
    log(`percent2\tmilliseconds2\tcallsToReadSlice\tcallsToGetExternal`);
    mark('percent');
    lastPercent = null;
    let count = 0;
    let callsToReadSlice = 0;
    let callsToGetExternal = 0;
    let timeByDepth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let objectsByDepth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let offset in offsetToObject) {
      offset = Number(offset);
      let percent = Math.floor((count++ * 100) / totalObjectCount);
      if (percent !== lastPercent) {
        log(
          `${percent}%\t${Math.floor(
            stop('percent').duration
          )}\t${callsToReadSlice}\t${callsToGetExternal}`
        );
        if (emitter) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: 'Resolving deltas',
            loaded: count,
            total: totalObjectCount,
            lengthComputable: true
          });
        }
        mark('percent');
        callsToReadSlice = 0;
        callsToGetExternal = 0;
      }
      lastPercent = percent;

      let o = offsetToObject[offset];
      if (o.oid) continue
      try {
        p.readDepth = 0;
        p.externalReadDepth = 0;
        mark('readSlice');
        let { type, object } = await p.readSlice({ start: offset });
        let time = stop('readSlice').duration;
        times.readSlice += time;
        callsToReadSlice += p.readDepth;
        callsToGetExternal += p.externalReadDepth;
        timeByDepth[p.readDepth] += time;
        objectsByDepth[p.readDepth] += 1;
        mark('hash');
        let oid = shasum(GitObject.wrap({ type, object }));
        times.hash += stop('hash').duration;
        o.oid = oid;
        hashes.push(oid);
        offsets.set(oid, offset);
        crcs[oid] = o.crc;
      } catch (err) {
        log('ERROR', err);
        continue
      }
    }

    mark('sort');
    hashes.sort();
    times['sort'] = Math.floor(stop('sort').duration);
    let totalElapsedTime = stop('total').duration;
    times.hash = Math.floor(times.hash);
    times.readSlice = Math.floor(times.readSlice);
    times.misc = Math.floor(
      Object.values(times).reduce((a, b) => a - b, totalElapsedTime)
    );
    log(Object.keys(times).join('\t'));
    log(Object.values(times).join('\t'));
    log('by depth:');
    log([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].join('\t'));
    log(objectsByDepth.slice(0, 12).join('\t'));
    log(
      timeByDepth
        .map(Math.floor)
        .slice(0, 12)
        .join('\t')
    );
    return p
  }
  toBuffer () {
    let buffers = [];
    let write = (str, encoding) => {
      buffers.push(Buffer.from(str, encoding));
    };
    // Write out IDX v2 magic number
    write('ff744f63', 'hex');
    // Write out version number 2
    write('00000002', 'hex');
    // Write fanout table
    let fanoutBuffer = new BufferCursor(Buffer.alloc(256 * 4));
    for (let i = 0; i < 256; i++) {
      let count = 0;
      for (let hash of this.hashes) {
        if (parseInt(hash.slice(0, 2), 16) <= i) count++;
      }
      fanoutBuffer.writeUInt32BE(count);
    }
    buffers.push(fanoutBuffer.buffer);
    // Write out hashes
    for (let hash of this.hashes) {
      write(hash, 'hex');
    }
    // Write out crcs
    let crcsBuffer = new BufferCursor(Buffer.alloc(this.hashes.length * 4));
    for (let hash of this.hashes) {
      crcsBuffer.writeUInt32BE(this.crcs[hash]);
    }
    buffers.push(crcsBuffer.buffer);
    // Write out offsets
    let offsetsBuffer = new BufferCursor(Buffer.alloc(this.hashes.length * 4));
    for (let hash of this.hashes) {
      offsetsBuffer.writeUInt32BE(this.offsets.get(hash));
    }
    buffers.push(offsetsBuffer.buffer);
    // Write out packfile checksum
    write(this.packfileSha, 'hex');
    // Write out shasum
    let totalBuffer = Buffer.concat(buffers);
    let sha = shasum(totalBuffer);
    let shaBuffer = Buffer.alloc(20);
    shaBuffer.write(sha, 'hex');
    return Buffer.concat([totalBuffer, shaBuffer])
  }
  async load ({ pack }) {
    this.pack = pack;
  }
  async unload () {
    this.pack = null;
  }
  async read ({ oid }) {
    if (!this.offsets.get(oid)) {
      if (this.getExternalRefDelta) {
        this.externalReadDepth++;
        return this.getExternalRefDelta(oid)
      } else {
        throw new GitError(E.InternalFail, {
          message: `Could not read object ${oid} from packfile`
        })
      }
    }
    let start = this.offsets.get(oid);
    return this.readSlice({ start })
  }
  async readSlice ({ start }) {
    if (this.offsetCache[start]) {
      return Object.assign({}, this.offsetCache[start])
    }
    this.readDepth++;
    const types = {
      0b0010000: 'commit',
      0b0100000: 'tree',
      0b0110000: 'blob',
      0b1000000: 'tag',
      0b1100000: 'ofs_delta',
      0b1110000: 'ref_delta'
    };
    if (!this.pack) {
      throw new GitError(E.InternalFail, {
        message:
          'Tried to read from a GitPackIndex with no packfile loaded into memory'
      })
    }
    let raw = (await this.pack).slice(start);
    let reader = new BufferCursor(raw);
    let byte = reader.readUInt8();
    // Object type is encoded in bits 654
    let btype = byte & 0b1110000;
    let type = types[btype];
    if (type === undefined) {
      throw new GitError(E.InternalFail, {
        message: 'Unrecognized type: 0b' + btype.toString(2)
      })
    }
    // The length encoding get complicated.
    // Last four bits of length is encoded in bits 3210
    let lastFour = byte & 0b1111;
    let length = lastFour;
    // Whether the next byte is part of the variable-length encoded number
    // is encoded in bit 7
    let multibyte = byte & 0b10000000;
    if (multibyte) {
      length = otherVarIntDecode(reader, lastFour);
    }
    let base = null;
    let object = null;
    // Handle deltified objects
    if (type === 'ofs_delta') {
      let offset = decodeVarInt(reader);
      let baseOffset = start - offset
      ;({ object: base, type } = await this.readSlice({ start: baseOffset }));
    }
    if (type === 'ref_delta') {
      let oid = reader.slice(20).toString('hex')
      ;({ object: base, type } = await this.read({ oid }));
    }
    // Handle undeltified objects
    let buffer = raw.slice(reader.tell());
    object = Buffer.from(pako.inflate(buffer));
    // Assert that the object length is as expected.
    if (object.byteLength !== length) {
      throw new GitError(E.InternalFail, {
        message: `Packfile told us object would have length ${length} but it had length ${
          object.byteLength
        }`
      })
    }
    if (base) {
      object = Buffer.from(applyDelta(object, base));
    }
    // Cache the result based on depth.
    if (this.readDepth > 3) {
      // hand tuned for speed / memory usage tradeoff
      this.offsetCache[start] = { type, object };
    }
    return { type, format: 'content', object }
  }
}

const PackfileCache = new Map();

async function loadPackIndex ({
  fs,
  filename,
  getExternalRefDelta,
  emitter,
  emitterPrefix
}) {
  const idx = await fs.read(filename);
  return GitPackIndex.fromIdx({ idx, getExternalRefDelta })
}

function readPackIndex ({
  fs,
  filename,
  getExternalRefDelta,
  emitter,
  emitterPrefix
}) {
  // Try to get the packfile index from the in-memory cache
  let p = PackfileCache.get(filename);
  if (!p) {
    p = loadPackIndex({
      fs,
      filename,
      getExternalRefDelta,
      emitter,
      emitterPrefix
    });
    PackfileCache.set(filename, p);
  }
  return p
}

async function readObjectPacked ({
  fs: _fs,
  gitdir,
  oid,
  format = 'content',
  getExternalRefDelta
}) {
  const fs = new FileSystem(_fs);
  // Check to see if it's in a packfile.
  // Iterate through all the .idx files
  let list = await fs.readdir(join(gitdir, 'objects/pack'));
  list = list.filter(x => x.endsWith('.idx'));
  for (let filename of list) {
    const indexFile = `${gitdir}/objects/pack/${filename}`;
    let p = await readPackIndex({
      fs,
      filename: indexFile,
      getExternalRefDelta
    });
    if (p.error) throw new GitError(E.InternalFail, { message: p.error })
    // If the packfile DOES have the oid we're looking for...
    if (p.offsets.has(oid)) {
      // Get the resolved git object from the packfile
      if (!p.pack) {
        const packFile = indexFile.replace(/idx$/, 'pack');
        p.pack = fs.read(packFile);
      }
      let result = await p.read({ oid, getExternalRefDelta });
      result.format = 'content';
      result.source = `objects/pack/${filename.replace(/idx$/, 'pack')}`;
      return result
    }
  }
  // Failed to find it
  return null
}

async function readObject ({ fs: _fs, gitdir, oid, format = 'content' }) {
  const fs = new FileSystem(_fs);
  // Curry the current read method so that the packfile un-deltification
  // process can acquire external ref-deltas.
  const getExternalRefDelta = oid => readObject({ fs, gitdir, oid });

  // Look for it in the loose object directory.
  let result = await readObjectLoose({ fs, gitdir, oid });
  // Check to see if it's in a packfile.
  if (!result) {
    result = await readObjectPacked({ fs, gitdir, oid, getExternalRefDelta });
  }
  // Finally
  if (!result) {
    throw new GitError(E.ReadObjectFail, { oid })
  }
  if (format === 'deflated') {
    return result
  }
  // BEHOLD! THE ONLY TIME I'VE EVER WANTED TO USE A CASE STATEMENT WITH FOLLOWTHROUGH!
  // eslint-ignore
  /* eslint-disable no-fallthrough */
  switch (result.format) {
    case 'deflated':
      let buffer = Buffer.from(pako.inflate(result.object));
      result = { format: 'wrapped', object: buffer, source: result.source };
    case 'wrapped':
      if (format === 'wrapped' && result.format === 'wrapped') {
        return result
      }
      let sha = shasum(result.object);
      if (sha !== oid) {
        throw new GitError(E.InternalFail, {
          message: `SHA check failed! Expected ${oid}, computed ${sha}`
        })
      }
      let { object, type } = GitObject.unwrap(buffer);
      result = { type, format: 'content', object, source: result.source };
    case 'content':
      if (format === 'content') return result
      break
    default:
      throw new GitError(E.InternalFail, {
        message: `invalid format "${result.format}"`
      })
  }
  /* eslint-enable no-fallthrough */
}

/**
 * Read and/or write to the git config files.
 *
 * @link https://isomorphic-git.github.io/docs/config.html
 */
async function config (args) {
  // These arguments are not in the function signature but destructured separately
  // as a result of a bit of a design flaw that requires the un-destructured argument object
  // in order to call args.hasOwnProperty('value') later on.
  let {
    core = 'default',
    dir,
    gitdir = join(dir, '.git'),
    fs: _fs = cores.get(core).get('fs'),
    all = false,
    append = false,
    path,
    value
  } = args;
  try {
    const fs = new FileSystem(_fs);
    const config = await GitConfigManager.get({ fs, gitdir });
    // This carefully distinguishes between
    // 1) there is no 'value' argument (do a "get")
    // 2) there is a 'value' argument with a value of undefined (do a "set")
    // Because setting a key to undefined is how we delete entries from the ini.
    if (value === undefined && !args.hasOwnProperty('value')) {
      if (all) {
        return config.getall(path)
      } else {
        return config.get(path)
      }
    } else {
      if (append) {
        await config.append(path, value);
      } else {
        await config.set(path, value);
      }
      await GitConfigManager.save({ fs, gitdir, config });
    }
  } catch (err) {
    err.caller = 'git.config';
    throw err
  }
}

async function normalizeAuthorObject ({ fs, gitdir, author = {} }) {
  let { name, email, date, timestamp, timezoneOffset } = author;
  name = name || (await config({ fs, gitdir, path: 'user.name' }));
  email = email || (await config({ fs, gitdir, path: 'user.email' }));

  if (name === undefined || email === undefined) {
    return undefined
  }

  date = date || new Date();
  timestamp = timestamp != null ? timestamp : Math.floor(date.valueOf() / 1000);
  timezoneOffset =
    timezoneOffset != null ? timezoneOffset : date.getTimezoneOffset();

  return { name, email, date, timestamp, timezoneOffset }
}

/**
 * Create an annotated tag.
 *
 * @link https://isomorphic-git.github.io/docs/annotatedTag.html
 */
async function annotatedTag ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref,
  tagger,
  message = ref,
  signature,
  object,
  signingKey,
  force = false
}) {
  try {
    const fs = new FileSystem(_fs);

    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'annotatedTag',
        parameter: 'ref'
      })
    }

    ref = ref.startsWith('refs/tags/') ? ref : `refs/tags/${ref}`;

    if (!force && (await GitRefManager.exists({ fs, gitdir, ref }))) {
      throw new GitError(E.RefExistsError, { noun: 'tag', ref })
    }

    // Resolve passed value
    let oid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: object || 'HEAD'
    });

    if (signature && signingKey) {
      throw new GitError(E.InvalidParameterCombinationError, {
        function: 'annotatedTag',
        parameters: ['signature', 'signingKey']
      })
    }

    // Fill in missing arguments with default values
    tagger = await normalizeAuthorObject({ fs, gitdir, author: tagger });
    if (tagger === undefined) {
      throw new GitError(E.MissingTaggerError)
    }

    const { type } = await readObject({ fs, gitdir, oid });
    let tagObject = GitAnnotatedTag.from({
      object: oid,
      type,
      tag: ref.replace('refs/tags/', ''),
      tagger,
      message,
      signature
    });
    if (signingKey) {
      let pgp = cores.get(core).get('pgp');
      tagObject = await GitAnnotatedTag.sign(tagObject, pgp, signingKey);
    }
    let value = await writeObject({
      fs,
      gitdir,
      type: 'tag',
      object: tagObject.toObject()
    });

    await GitRefManager.writeRef({ fs, gitdir, ref, value });
  } catch (err) {
    err.caller = 'git.annotatedTag';
    throw err
  }
}

/**
 * Create a branch
 *
 * @link https://isomorphic-git.github.io/docs/branch.html
 */
async function branch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref,
  checkout = false
}) {
  try {
    const fs = new FileSystem(_fs);
    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'branch',
        parameter: 'ref'
      })
    }

    if (ref !== cleanGitRef.clean(ref)) {
      throw new GitError(E.InvalidRefNameError, {
        verb: 'create',
        noun: 'branch',
        ref,
        suggestion: cleanGitRef.clean(ref)
      })
    }

    const exist = await fs.exists(`${gitdir}/refs/heads/${ref}`);
    if (exist) {
      throw new GitError(E.RefExistsError, { noun: 'branch', ref })
    }
    // Get tree oid
    let oid;
    try {
      oid = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' });
    } catch (e) {
      throw new GitError(E.NoHeadCommitError, { noun: 'branch', ref })
    }
    // Create a new branch that points at that same commit
    await fs.write(`${gitdir}/refs/heads/${ref}`, oid + '\n');
    if (checkout) {
      // Update HEAD
      await fs.write(`${gitdir}/HEAD`, `ref: refs/heads/${ref}`);
    }
  } catch (err) {
    err.caller = 'git.branch';
    throw err
  }
}

function compareStats (entry, stats) {
  // Comparison based on the description in Paragraph 4 of
  // https://www.kernel.org/pub/software/scm/git/docs/technical/racy-git.txt
  const e = normalizeStats(entry);
  const s = normalizeStats(stats);
  const staleness =
    e.mode !== s.mode ||
    e.mtimeSeconds !== s.mtimeSeconds ||
    e.ctimeSeconds !== s.ctimeSeconds ||
    e.uid !== s.uid ||
    e.gid !== s.gid ||
    e.ino !== s.ino ||
    e.size !== s.size;
  // console.log(staleness ? 'stale:' : 'fresh:')
  if (staleness && log.enabled) {
    console.table([justWhatMatters(e), justWhatMatters(s)]);
  }
  return staleness
}

function justWhatMatters (e) {
  return {
    mode: e.mode,
    mtimeSeconds: e.mtimeSeconds,
    ctimeSeconds: e.ctimeSeconds,
    uid: e.uid,
    gid: e.gid,
    ino: e.ino,
    size: e.size
  }
}

// This is part of an elaborate system to facilitate code-splitting / tree-shaking.
// commands/walk.js can depend on only this, and the actual Walker classes exported
// can be opaque - only having a single property (this symbol) that is not enumerable,
// and thus the constructor can be passed as an argument to walk while being "unusable"
// outside of it.
const GitWalkerSymbol = Symbol('GitWalkerSymbol');

/*::
type Node = {
  type: string,
  fullpath: string,
  basename: string,
  metadata: Object, // mode, oid
  parent?: Node,
  children: Array<Node>
}
*/

function flatFileListToDirectoryStructure (files) {
  const inodes = new Map();
  const mkdir = function (name) {
    if (!inodes.has(name)) {
      let dir = {
        type: 'tree',
        fullpath: name,
        basename: basename(name),
        metadata: {},
        children: []
      };
      inodes.set(name, dir);
      // This recursively generates any missing parent folders.
      // We do it after we've added the inode to the set so that
      // we don't recurse infinitely trying to create the root '.' dirname.
      dir.parent = mkdir(dirname(name));
      if (dir.parent && dir.parent !== dir) dir.parent.children.push(dir);
    }
    return inodes.get(name)
  };

  const mkfile = function (name, metadata) {
    if (!inodes.has(name)) {
      let file = {
        type: 'blob',
        fullpath: name,
        basename: basename(name),
        metadata: metadata,
        // This recursively generates any missing parent folders.
        parent: mkdir(dirname(name)),
        children: []
      };
      if (file.parent) file.parent.children.push(file);
      inodes.set(name, file);
    }
    return inodes.get(name)
  };

  mkdir('.');
  for (let file of files) {
    mkfile(file.path, file);
  }
  return inodes
}

class GitWalkerFs {
  constructor ({ fs: _fs, dir, gitdir }) {
    const fs = new FileSystem(_fs);
    let walker = this;
    this.treePromise = (async () => {
      let result = (await fs.readdirDeep(dir)).map(path => {
        // +1 index for trailing slash
        return { path: path.slice(dir.length + 1) }
      });
      return flatFileListToDirectoryStructure(result)
    })();
    this.indexPromise = (async () => {
      let result;
      await GitIndexManager.acquire(
        { fs, filepath: `${gitdir}/index` },
        async function (index) {
          result = index.entries
            .filter(entry => entry.flags.stage === 0)
            .reduce((index, entry) => {
              index[entry.path] = entry;
              return index
            }, {});
        }
      );
      return result
    })();
    this.fs = fs;
    this.dir = dir;
    this.gitdir = gitdir;
    this.ConstructEntry = class FSEntry {
      constructor (entry) {
        Object.assign(this, entry);
      }
      async populateStat () {
        if (!this.exists) return
        await walker.populateStat(this);
      }
      async populateContent () {
        if (!this.exists) return
        await walker.populateContent(this);
      }
      async populateHash () {
        if (!this.exists) return
        await walker.populateHash(this);
      }
    };
  }
  async readdir (entry) {
    if (!entry.exists) return []
    let filepath = entry.fullpath;
    let tree = await this.treePromise;
    let inode = tree.get(filepath);
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
    let { fs, dir } = this;
    let stats = await fs.lstat(`${dir}/${entry.fullpath}`);
    let type = stats.isDirectory() ? 'tree' : 'blob';
    if (!stats) {
      throw new Error(
        `ENOENT: no such file or directory, lstat '${entry.fullpath}'`
      )
    }
    stats = normalizeStats(stats);
    Object.assign(entry, { type }, stats);
  }
  async populateContent (entry) {
    if (!entry.exists) return
    let { fs, dir } = this;
    let content = await fs.read(`${dir}/${entry.fullpath}`);
    // workaround for a BrowserFS edge case
    if (entry.size === -1) entry.size = content.length;
    Object.assign(entry, { content });
  }
  async populateHash (entry) {
    if (!entry.exists) return
    let index = await this.indexPromise;
    let stage = index[entry.fullpath];
    let oid;
    if (!stage || compareStats(entry, stage)) {
      log(`INDEX CACHE MISS: calculating SHA for ${entry.fullpath}`);
      if (!entry.content) await entry.populateContent();
      oid = shasum(GitObject.wrap({ type: 'blob', object: entry.content }));
    } else {
      // Use the index SHA1 rather than compute it
      oid = stage.oid;
    }
    Object.assign(entry, { oid });
  }
}

function WORKDIR ({ fs, dir, gitdir }) {
  let o = Object.create(null);
  Object.defineProperty(o, GitWalkerSymbol, {
    value: function () {
      return new GitWalkerFs({ fs, dir, gitdir })
    }
  });
  Object.freeze(o);
  return o
}

function indent (str) {
  return (
    str
      .trim()
      .split('\n')
      .map(x => ' ' + x)
      .join('\n') + '\n'
  )
}

function outdent (str) {
  return str
    .split('\n')
    .map(x => x.replace(/^ /, ''))
    .join('\n')
}

class GitCommit {
  constructor (commit) {
    if (typeof commit === 'string') {
      this._commit = commit;
    } else if (Buffer.isBuffer(commit)) {
      this._commit = commit.toString('utf8');
    } else if (typeof commit === 'object') {
      this._commit = GitCommit.render(commit);
    } else {
      throw new GitError(E.InternalFail, {
        message: 'invalid type passed to GitCommit constructor'
      })
    }
  }

  static fromPayloadSignature ({ payload, signature }) {
    let headers = GitCommit.justHeaders(payload);
    let message = GitCommit.justMessage(payload);
    let commit = normalizeNewlines(
      headers + '\ngpgsig' + indent(signature) + '\n' + message
    );
    return new GitCommit(commit)
  }

  static from (commit) {
    return new GitCommit(commit)
  }

  toObject () {
    return Buffer.from(this._commit, 'utf8')
  }

  // Todo: allow setting the headers and message
  headers () {
    return this.parseHeaders()
  }

  // Todo: allow setting the headers and message
  message () {
    return GitCommit.justMessage(this._commit)
  }

  parse () {
    return Object.assign({ message: this.message() }, this.headers())
  }

  static justMessage (commit) {
    return normalizeNewlines(commit.slice(commit.indexOf('\n\n') + 2))
  }

  static justHeaders (commit) {
    return commit.slice(0, commit.indexOf('\n\n'))
  }

  parseHeaders () {
    let headers = GitCommit.justHeaders(this._commit).split('\n');
    let hs = [];
    for (let h of headers) {
      if (h[0] === ' ') {
        // combine with previous header (without space indent)
        hs[hs.length - 1] += '\n' + h.slice(1);
      } else {
        hs.push(h);
      }
    }
    let obj = {
      parent: []
    };
    for (let h of hs) {
      let key = h.slice(0, h.indexOf(' '));
      let value = h.slice(h.indexOf(' ') + 1);
      if (Array.isArray(obj[key])) {
        obj[key].push(value);
      } else {
        obj[key] = value;
      }
    }
    if (obj.author) {
      obj.author = parseAuthor(obj.author);
    }
    if (obj.committer) {
      obj.committer = parseAuthor(obj.committer);
    }
    return obj
  }

  static renderHeaders (obj) {
    let headers = '';
    if (obj.tree) {
      headers += `tree ${obj.tree}\n`;
    } else {
      headers += `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n`; // the null tree
    }
    if (obj.parent) {
      if (obj.parent.length === undefined) {
        throw new GitError(E.InternalFail, {
          message: `commit 'parent' property should be an array`
        })
      }
      for (let p of obj.parent) {
        headers += `parent ${p}\n`;
      }
    }
    let author = obj.author;
    headers += `author ${formatAuthor(author)}\n`;
    let committer = obj.committer || obj.author;
    headers += `committer ${formatAuthor(committer)}\n`;
    if (obj.gpgsig) {
      headers += 'gpgsig' + indent(obj.gpgsig);
    }
    return headers
  }

  static render (obj) {
    return GitCommit.renderHeaders(obj) + '\n' + normalizeNewlines(obj.message)
  }

  render () {
    return this._commit
  }

  withoutSignature () {
    let commit = normalizeNewlines(this._commit);
    if (commit.indexOf('\ngpgsig') === -1) return commit
    let headers = commit.slice(0, commit.indexOf('\ngpgsig'));
    let message = commit.slice(
      commit.indexOf('-----END PGP SIGNATURE-----\n') +
        '-----END PGP SIGNATURE-----\n'.length
    );
    return normalizeNewlines(headers + '\n' + message)
  }

  isolateSignature () {
    let signature = this._commit.slice(
      this._commit.indexOf('-----BEGIN PGP SIGNATURE-----'),
      this._commit.indexOf('-----END PGP SIGNATURE-----') +
        '-----END PGP SIGNATURE-----'.length
    );
    return outdent(signature)
  }

  static async sign (commit, pgp, secretKey) {
    const payload = commit.withoutSignature();
    const message = GitCommit.justMessage(commit._commit);
    let { signature } = await pgp.sign({ payload, secretKey });
    // renormalize the line endings to the one true line-ending
    signature = normalizeNewlines(signature);
    const headers = GitCommit.justHeaders(commit._commit);
    let signedCommit =
      headers + '\n' + 'gpgsig' + indent(signature) + '\n' + message;
    // return a new commit object
    return GitCommit.from(signedCommit)
  }

  static async verify (commit, pgp, publicKey) {
    const payload = commit.withoutSignature();
    const signature = commit.isolateSignature();
    return pgp.verify({ payload, publicKey, signature })
  }
}

function comparePath (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  return compareStrings(a.path, b.path)
}

/*::
type TreeEntry = {
  mode: string,
  path: string,
  oid: string,
  type?: string
}
*/

function mode2type (mode) {
  // prettier-ignore
  switch (mode) {
    case '040000': return 'tree'
    case '100644': return 'blob'
    case '100755': return 'blob'
    case '120000': return 'blob'
    case '160000': return 'commit'
  }
  throw new GitError(E.InternalFail, {
    message: `Unexpected GitTree entry mode: ${mode}`
  })
}

function parseBuffer$1 (buffer) {
  let _entries = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    let space = buffer.indexOf(32, cursor);
    if (space === -1) {
      throw new GitError(E.InternalFail, {
        message: `GitTree: Error parsing buffer at byte location ${cursor}: Could not find the next space character.`
      })
    }
    let nullchar = buffer.indexOf(0, cursor);
    if (nullchar === -1) {
      throw new GitError(E.InternalFail, {
        message: `GitTree: Error parsing buffer at byte location ${cursor}: Could not find the next null character.`
      })
    }
    let mode = buffer.slice(cursor, space).toString('utf8');
    if (mode === '40000') mode = '040000'; // makes it line up neater in printed output
    let type = mode2type(mode);
    let path = buffer.slice(space + 1, nullchar).toString('utf8');
    let oid = buffer.slice(nullchar + 1, nullchar + 21).toString('hex');
    cursor = nullchar + 21;
    _entries.push({ mode, path, oid, type });
  }
  return _entries
}

function limitModeToAllowed (mode) {
  if (typeof mode === 'number') {
    mode = mode.toString(8);
  }
  // tree
  if (mode.match(/^0?4.*/)) return '040000' // Directory
  if (mode.match(/^1006.*/)) return '100644' // Regular non-executable file
  if (mode.match(/^1007.*/)) return '100755' // Regular executable file
  if (mode.match(/^120.*/)) return '120000' // Symbolic link
  if (mode.match(/^160.*/)) return '160000' // Commit (git submodule reference)
  throw new GitError(E.InternalFail, {
    message: `Could not understand file mode: ${mode}`
  })
}

function nudgeIntoShape (entry) {
  if (!entry.oid && entry.sha) {
    entry.oid = entry.sha; // Github
  }
  entry.mode = limitModeToAllowed(entry.mode); // index
  if (!entry.type) {
    entry.type = 'blob'; // index
  }
  return entry
}

class GitTree {
  /*::
  _entries: Array<TreeEntry>
  */
  constructor (entries) {
    if (Buffer.isBuffer(entries)) {
      this._entries = parseBuffer$1(entries);
      // There appears to be an edge case (in this repo no less) where
      // the tree is NOT sorted as expected if some directories end with ".git"
      this._entries.sort(comparePath);
    } else if (Array.isArray(entries)) {
      this._entries = entries.map(nudgeIntoShape);
    } else {
      throw new GitError(E.InternalFail, {
        message: 'invalid type passed to GitTree constructor'
      })
    }
  }
  static from (tree) {
    return new GitTree(tree)
  }
  render () {
    return this._entries
      .map(entry => `${entry.mode} ${entry.type} ${entry.oid}    ${entry.path}`)
      .join('\n')
  }
  toObject () {
    return Buffer.concat(
      this._entries.map(entry => {
        let mode = Buffer.from(entry.mode.replace(/^0/, ''));
        let space = Buffer.from(' ');
        let path = Buffer.from(entry.path, { encoding: 'utf8' });
        let nullchar = Buffer.from([0]);
        let oid = Buffer.from(entry.oid.match(/../g).map(n => parseInt(n, 16)));
        return Buffer.concat([mode, space, path, nullchar, oid])
      })
    )
  }
  entries () {
    return this._entries
  }
  * [Symbol.iterator] () {
    for (let entry of this._entries) {
      yield entry;
    }
  }
}

async function resolveTree ({ fs, gitdir, oid }) {
  let { type, object } = await readObject({ fs, gitdir, oid });
  // Resolve annotated tag objects to whatever
  if (type === 'tag') {
    oid = GitAnnotatedTag.from(object).parse().object;
    return resolveTree({ fs, gitdir, oid })
  }
  // Resolve commits to trees
  if (type === 'commit') {
    oid = GitCommit.from(object).parse().tree;
    return resolveTree({ fs, gitdir, oid })
  }
  if (type !== 'tree') {
    throw new GitError(E.ResolveTreeError, { oid })
  }
  return { tree: GitTree.from(object), oid }
}

class GitWalkerRepo {
  constructor ({ fs: _fs, gitdir, ref }) {
    const fs = new FileSystem(_fs);
    this.fs = fs;
    this.gitdir = gitdir;
    this.mapPromise = (async () => {
      let map = new Map();
      let oid = await GitRefManager.resolve({ fs, gitdir, ref });
      let tree = await resolveTree({ fs, gitdir, oid });
      map.set('.', tree);
      return map
    })();
    let walker = this;
    this.ConstructEntry = class RepoEntry {
      constructor (entry) {
        Object.assign(this, entry);
      }
      async populateStat () {
        if (!this.exists) return
        await walker.populateStat(this);
      }
      async populateContent () {
        if (!this.exists) return
        await walker.populateContent(this);
      }
      async populateHash () {
        if (!this.exists) return
        await walker.populateHash(this);
      }
    };
  }
  async readdir (entry) {
    if (!entry.exists) return []
    let filepath = entry.fullpath;
    let { fs, gitdir } = this;
    let map = await this.mapPromise;
    let obj = map.get(filepath);
    if (!obj) throw new Error(`No obj for ${filepath}`)
    let oid = obj.oid;
    if (!oid) throw new Error(`No oid for obj ${JSON.stringify(obj)}`)
    let { type, object } = await readObject({ fs, gitdir, oid });
    if (type === 'blob') return null
    if (type !== 'tree') {
      throw new Error(`ENOTDIR: not a directory, scandir '${filepath}'`)
    }
    let tree = GitTree.from(object);
    // cache all entries
    for (const entry of tree) {
      map.set(join(filepath, entry.path), entry);
    }
    return tree.entries().map(entry => ({
      fullpath: join(filepath, entry.path),
      basename: entry.path,
      exists: true
    }))
  }
  async populateStat (entry) {
    // All we can add here is mode and type.
    let map = await this.mapPromise;
    let stats = map.get(entry.fullpath);
    if (!stats) {
      throw new Error(
        `ENOENT: no such file or directory, lstat '${entry.fullpath}'`
      )
    }
    let { mode, type } = stats;
    Object.assign(entry, { mode, type });
  }
  async populateContent (entry) {
    let map = await this.mapPromise;
    let { fs, gitdir } = this;
    let obj = map.get(entry.fullpath);
    if (!obj) throw new Error(`No obj for ${entry.fullpath}`)
    let oid = obj.oid;
    if (!oid) throw new Error(`No oid for entry ${JSON.stringify(obj)}`)
    let { type, object } = await readObject({ fs, gitdir, oid });
    if (type === 'tree') {
      throw new Error(`EISDIR: illegal operation on a directory, read`)
    }
    Object.assign(entry, { content: object });
  }
  async populateHash (entry) {
    let map = await this.mapPromise;
    let obj = map.get(entry.fullpath);
    if (!obj) {
      throw new Error(
        `ENOENT: no such file or directory, open '${entry.fullpath}'`
      )
    }
    let oid = obj.oid;
    Object.assign(entry, { oid });
  }
}

function TREE ({ fs, gitdir, ref }) {
  let o = Object.create(null);
  Object.defineProperty(o, GitWalkerSymbol, {
    value: function () {
      return new GitWalkerRepo({ fs, gitdir, ref })
    }
  });
  Object.freeze(o);
  return o
}

// https://dev.to/namirsab/comment/2050
function arrayRange (start, end) {
  const length = end - start;
  return Array.from({ length }, (_, i) => start + i)
}

// This is convenient for computing unions/joins of sorted lists.
class RunningMinimum {
  constructor () {
    // Using a getter for 'value' would just bloat the code.
    // You know better than to set it directly right?
    this.value = null;
  }
  consider (value) {
    if (value === null || value === undefined) return
    if (this.value === null) {
      this.value = value;
    } else if (value < this.value) {
      this.value = value;
    }
  }
  reset () {
    this.value = null;
  }
}

// Take an array of length N of
//   iterators of length Q_n
//     of objects with a property 'fullname'
// and return an iterator of length max(Q_n) for all n
//   of arrays of length N
//     of objects who all have the same value for 'fullname'
function * unionOfIterators (sets) {
  /* NOTE: We can assume all arrays are sorted.
   * Indexes are sorted because they are defined that way:
   *
   * > Index entries are sorted in ascending order on the name field,
   * > interpreted as a string of unsigned bytes (i.e. memcmp() order, no
   * > localization, no special casing of directory separator '/'). Entries
   * > with the same name are sorted by their stage field.
   *
   * Trees should be sorted because they are created directly from indexes.
   * They definitely should be sorted, or else they wouldn't have a unique SHA1.
   * So that would be very naughty on the part of the tree-creator.
   *
   * Lastly, the working dir entries are sorted because I choose to sort them
   * in my FileSystem.readdir() implementation.
   */

  // Init
  let min = new RunningMinimum();
  let minimum;
  let heads = [];
  const numsets = sets.length;
  for (let i = 0; i < numsets; i++) {
    // Abuse the fact that iterators continue to return 'undefined' for value
    // once they are done
    heads[i] = sets[i].next().value;
    if (heads[i] !== undefined) {
      min.consider(heads[i].fullpath);
    }
  }
  if (min.value === null) return
  // Iterate
  while (true) {
    let result = [];
    minimum = min.value;
    min.reset();
    for (let i = 0; i < numsets; i++) {
      if (heads[i] !== undefined && heads[i].fullpath === minimum) {
        result[i] = heads[i];
        heads[i] = sets[i].next().value;
      } else {
        // A little hacky, but eh
        result[i] = {
          fullpath: minimum,
          basename: basename(minimum),
          exists: false
        };
      }
      if (heads[i] !== undefined) {
        min.consider(heads[i].fullpath);
      }
    }
    // if (result.reduce((y, a) => y && (a === null), true)) {
    //   return
    // }
    yield result;
    if (min.value === null) return
  }
}

/**
 * A powerful recursive tree-walking utility.
 *
 * @link https://isomorphic-git.org/docs/en/walkBeta1
 */
async function walkBeta1 ({
  core = 'default',
  trees,
  filter = async () => true,
  map = async entry => entry,
  // The default reducer is a flatmap that filters out undefineds.
  reduce = async (parent, children) => {
    // TODO: replace with `[parent, children].flat()` once that gets standardized
    let flatten = children.reduce((acc, x) => acc.concat(x), []);
    if (parent !== undefined) flatten.unshift(parent);
    return flatten
  },
  // The default iterate function walks all children concurrently
  iterate = (walk, children) => Promise.all([...children].map(walk))
}) {
  try {
    let walkers = trees.map(proxy => proxy[GitWalkerSymbol]());

    let root = new Array(walkers.length).fill({
      fullpath: '.',
      basename: '.',
      exists: true
    });
    const range = arrayRange(0, walkers.length);
    const unionWalkerFromReaddir = async entry => {
      const subdirs = await Promise.all(
        range.map(i => walkers[i].readdir(entry[i]))
      );
      range.map(i => {
        entry[i] = new walkers[i].ConstructEntry(entry[i]);
      });
      // Now process child directories
      let iterators = subdirs
        .map(array => (array === null ? [] : array))
        .map(array => array[Symbol.iterator]());
      return {
        entry,
        children: unionOfIterators(iterators)
      }
    };

    const walk = async root => {
      let { children, entry } = await unionWalkerFromReaddir(root);
      if (await filter(entry)) {
        let parent = await map(entry);
        children = await iterate(walk, children);
        children = children.filter(x => x !== undefined);
        return reduce(parent, children)
      }
    };
    return walk(root)
  } catch (err) {
    err.caller = 'git.walk';
    throw err
  }
}

/**
 * Checkout a branch
 *
 * @link https://isomorphic-git.github.io/docs/checkout.html
 */
async function checkout ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  remote = 'origin',
  ref,
  noCheckout = false
}) {
  try {
    const fs = new FileSystem(_fs);
    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'checkout',
        parameter: 'ref'
      })
    }
    // Get tree oid
    let oid;
    try {
      oid = await GitRefManager.resolve({ fs, gitdir, ref });
      // TODO: Figure out what to do if both 'ref' and 'remote' are specified, ref already exists,
      // and is configured to track a different remote.
    } catch (err) {
      // If `ref` doesn't exist, create a new remote tracking branch
      // Figure out the commit to checkout
      let remoteRef = `${remote}/${ref}`;
      oid = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: remoteRef
      });
      // Set up remote tracking branch
      await config({
        gitdir,
        fs,
        path: `branch.${ref}.remote`,
        value: `${remote}`
      });
      await config({
        gitdir,
        fs,
        path: `branch.${ref}.merge`,
        value: `refs/heads/${ref}`
      });
      // Create a new branch that points at that same commit
      await fs.write(`${gitdir}/refs/heads/${ref}`, oid + '\n');
    }
    let fullRef = await GitRefManager.expand({ fs, gitdir, ref });

    if (!noCheckout) {
      let count = 0;
      let gitdirBasename = gitdir.slice(dir.length + 1);
      // Acquire a lock on the index
      await GitIndexManager.acquire(
        { fs, filepath: `${gitdir}/index` },
        async function (index) {
          // Instead of deleting and rewriting everything, only delete files
          // that are not present in the new branch, and only write files that
          // are not in the index or are in the index but have the wrong SHA.
          try {
            await walkBeta1({
              fs,
              dir,
              gitdir,
              trees: [TREE({ fs, gitdir, ref }), WORKDIR({ fs, dir, gitdir })],
              map: async function ([head, workdir]) {
                if (head.fullpath === '.') return
                let workdirPath = workdir.fullpath;
                if (workdirPath === gitdirBasename) return
                let stage = index.entriesMap.get(GitIndex.key(workdirPath, 0));
                if (!head.exists) {
                  // if file is not staged, ignore it
                  if (workdir.exists && stage) {
                    await fs.rm(join(dir, workdirPath));
                    // remove from index
                    index.delete(workdirPath);
                    if (emitter) {
                      emitter.emit(`${emitterPrefix}progress`, {
                        phase: 'Updating workdir',
                        loaded: ++count,
                        lengthComputable: false
                      });
                    }
                  }
                  return
                }
                await head.populateStat();
                const filepath = `${dir}/${head.fullpath}`;
                switch (head.type) {
                  case 'tree': {
                    // ignore directories for now
                    if (!workdir.exists) await fs.mkdir(filepath);
                    break
                  }
                  case 'commit': {
                    // gitlinks
                    console.log(
                      new GitError(E.NotImplementedFail, {
                        thing: 'submodule support'
                      })
                    );
                    break
                  }
                  case 'blob': {
                    await head.populateHash();
                    let { fullpath, oid, mode } = head;
                    if (!stage || stage.oid !== oid || !workdir.exists) {
                      await head.populateContent();
                      switch (mode) {
                        case '100644':
                          // regular file
                          await fs.write(filepath, head.content);
                          break
                        case '100755':
                          // executable file
                          await fs.write(filepath, head.content, { mode: 0o777 });
                          break
                        case '120000':
                          // symlink
                          await fs.writelink(filepath, head.content);
                          break
                        default:
                          throw new GitError(E.InternalFail, {
                            message: `Invalid mode "${mode}" detected in blob ${oid}`
                          })
                      }
                      let stats = await fs.lstat(filepath);
                      // We can't trust the executable bit returned by lstat on Windows,
                      // so we need to preserve this value from the TREE.
                      // TODO: Figure out how git handles this internally.
                      if (mode === '100755') {
                        stats.mode = 0o755;
                      }
                      index.insert({
                        filepath: fullpath,
                        stats,
                        oid
                      });
                    }
                    if (emitter) {
                      emitter.emit(`${emitterPrefix}progress`, {
                        phase: 'Updating workdir',
                        loaded: ++count,
                        lengthComputable: false
                      });
                    }
                    break
                  }
                  default: {
                    throw new GitError(E.ObjectTypeAssertionInTreeFail, {
                      type: head.type,
                      oid: head.oid,
                      entrypath: head.fullpath
                    })
                  }
                }
              }
            });
          } catch (err) {
            // Throw a more helpful error message for this common mistake.
            if (err.code === E.ReadObjectFail && err.data.oid === oid) {
              throw new GitError(E.CommitNotFetchedError, { ref, oid })
            } else {
              throw err
            }
          }
        }
      );
    }
    // Update HEAD
    const content = fullRef.startsWith('refs/heads') ? `ref: ${fullRef}` : oid;
    await fs.write(`${gitdir}/HEAD`, `${content}\n`);
  } catch (err) {
    err.caller = 'git.checkout';
    throw err
  }
}

function calculateBasicAuthHeader ({ username, password }) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function calculateBasicAuthUsernamePasswordPair ({
  username,
  password,
  token,
  oauth2format
} = {}) {
  // This checks for the presense and/or absense of each of the 4 parameters,
  // converts that to a 4-bit binary representation, and then handles
  // every possible combination (2^4 or 16 cases) with a lookup table.
  const key = [!!username, !!password, !!token, !!oauth2format]
    .map(Number)
    .join('');
  // See the truth table on https://isomorphic-git.github.io/docs/authentication.html
  // prettier-ignore
  switch (key) {
    case '0000': return null
    case '1000': throw new GitError(E.MissingPasswordTokenError)
    case '0100': throw new GitError(E.MissingUsernameError)
    case '1100': return { username, password }
    case '0010': return { username: token, password: '' } // Github's alternative format
    case '1010': return { username, password: token }
    case '0110': throw new GitError(E.MixPasswordTokenError)
    case '1110': throw new GitError(E.MixUsernamePasswordTokenError)
    case '0001': throw new GitError(E.MissingTokenError)
    case '1001': throw new GitError(E.MixUsernameOauth2formatMissingTokenError)
    case '0101': throw new GitError(E.MixPasswordOauth2formatMissingTokenError)
    case '1101': throw new GitError(E.MixUsernamePasswordOauth2formatMissingTokenError)
    case '0011': return oauth2(oauth2format, token)
    case '1011': throw new GitError(E.MixUsernameOauth2formatTokenError)
    case '0111': throw new GitError(E.MixPasswordOauth2formatTokenError)
    case '1111': throw new GitError(E.MixUsernamePasswordOauth2formatTokenError)
  }
}

function extractAuthFromUrl (url) {
  // For whatever reason, the `fetch` API does not convert credentials embedded in the URL
  // into Basic Authentication headers automatically. Instead it throws an error!
  // So we must manually parse the URL, rip out the user:password portion if it is present
  // and compute the Authorization header.
  // Note: I tried using new URL(url) but that throws a security exception in Edge. :rolleyes:
  let userpass = url.match(/^https?:\/\/([^/]+)@/);
  if (userpass == null) return null
  userpass = userpass[1];
  let [username, password] = userpass.split(':');
  url = url.replace(`${userpass}@`, '');
  return { url, username, password }
}

// Currently 'for await' upsets my linters.
async function forAwait (iterable, cb) {
  let iter = getIterator(iterable);
  while (true) {
    let { value, done } = await iter.next();
    if (value) await cb(value);
    if (done) break
  }
  if (iter.return) iter.return();
}

async function collect (iterable) {
  let buffers = [];
  // This will be easier once `for await ... of` loops are available.
  await forAwait(iterable, value => buffers.push(Buffer.from(value)));
  return Buffer.concat(buffers)
}

async function http ({
  core,
  emitter,
  emitterPrefix,
  url,
  method = 'GET',
  headers = {},
  body
}) {
  // streaming uploads aren't possible yet in the browser
  if (body) {
    body = await collect(body);
  }
  let res = await global.fetch(url, { method, headers, body });
  let iter =
    res.body && res.body.getReader
      ? fromStream(res.body)
      : [new Uint8Array(await res.arrayBuffer())];
  return {
    url: res.url,
    method: res.method,
    statusCode: res.status,
    statusMessage: res.statusText,
    body: iter,
    headers: res.headers
  }
}

const pkg = {
  name: 'isomorphic-git',
  version: '0.0.0-development',
  agent: 'git/isomorphic-git@0.0.0-development'
};

function padHex (b, n) {
  let s = n.toString(16);
  return '0'.repeat(b - s.length) + s
}

/**
pkt-line Format
---------------

Much (but not all) of the payload is described around pkt-lines.

A pkt-line is a variable length binary string.  The first four bytes
of the line, the pkt-len, indicates the total length of the line,
in hexadecimal.  The pkt-len includes the 4 bytes used to contain
the length's hexadecimal representation.

A pkt-line MAY contain binary data, so implementors MUST ensure
pkt-line parsing/formatting routines are 8-bit clean.

A non-binary line SHOULD BE terminated by an LF, which if present
MUST be included in the total length. Receivers MUST treat pkt-lines
with non-binary data the same whether or not they contain the trailing
LF (stripping the LF if present, and not complaining when it is
missing).

The maximum length of a pkt-line's data component is 65516 bytes.
Implementations MUST NOT send pkt-line whose length exceeds 65520
(65516 bytes of payload + 4 bytes of length data).

Implementations SHOULD NOT send an empty pkt-line ("0004").

A pkt-line with a length field of 0 ("0000"), called a flush-pkt,
is a special case and MUST be handled differently than an empty
pkt-line ("0004").

----
  pkt-line     =  data-pkt / flush-pkt

  data-pkt     =  pkt-len pkt-payload
  pkt-len      =  4*(HEXDIG)
  pkt-payload  =  (pkt-len - 4)*(OCTET)

  flush-pkt    = "0000"
----

Examples (as C-style strings):

----
  pkt-line          actual value
  ---------------------------------
  "0006a\n"         "a\n"
  "0005a"           "a"
  "000bfoobar\n"    "foobar\n"
  "0004"            ""
----
*/

// I'm really using this more as a namespace.
// There's not a lot of "state" in a pkt-line

class GitPktLine {
  static flush () {
    return Buffer.from('0000', 'utf8')
  }

  static encode (line) {
    if (typeof line === 'string') {
      line = Buffer.from(line);
    }
    let length = line.length + 4;
    let hexlength = padHex(4, length);
    return Buffer.concat([Buffer.from(hexlength, 'utf8'), line])
  }

  static streamReader (stream) {
    const reader = new StreamReader(stream);
    return async function read () {
      try {
        let length = await reader.read(4);
        if (length == null) return true
        length = parseInt(length.toString('utf8'), 16);
        if (length === 0) return null
        let buffer = await reader.read(length - 4);
        if (buffer == null) return true
        return buffer
      } catch (err) {
        console.log('error', err);
        return true
      }
    }
  }
}

async function parseRefsAdResponse (stream, { service }) {
  const capabilities = new Set();
  const refs = new Map();
  const symrefs = new Map();

  // There is probably a better way to do this, but for now
  // let's just throw the result parser inline here.
  let read = GitPktLine.streamReader(stream);
  let lineOne = await read();
  // skip past any flushes
  while (lineOne === null) lineOne = await read();
  if (lineOne === true) throw new GitError(E.EmptyServerResponseFail)
  // Clients MUST ignore an LF at the end of the line.
  if (lineOne.toString('utf8').replace(/\n$/, '') !== `# service=${service}`) {
    throw new GitError(E.AssertServerResponseFail, {
      expected: `# service=${service}\\n`,
      actual: lineOne.toString('utf8')
    })
  }
  let lineTwo = await read();
  // skip past any flushes
  while (lineTwo === null) lineTwo = await read();
  // In the edge case of a brand new repo, zero refs (and zero capabilities)
  // are returned.
  if (lineTwo === true) return { capabilities, refs, symrefs }
  let [firstRef, capabilitiesLine] = lineTwo
    .toString('utf8')
    .trim()
    .split('\x00');
  capabilitiesLine.split(' ').map(x => capabilities.add(x));
  let [ref, name] = firstRef.split(' ');
  refs.set(name, ref);
  while (true) {
    let line = await read();
    if (line === true) break
    if (line !== null) {
      let [ref, name] = line
        .toString('utf8')
        .trim()
        .split(' ');
      refs.set(name, ref);
    }
  }
  // Symrefs are thrown into the "capabilities" unfortunately.
  for (let cap of capabilities) {
    if (cap.startsWith('symref=')) {
      let m = cap.match(/symref=([^:]+):(.*)/);
      if (m.length === 3) {
        symrefs.set(m[1], m[2]);
      }
    }
  }
  return { capabilities, refs, symrefs }
}

// Try to accomodate known CORS proxy implementations:
// - https://jcubic.pl/proxy.php?  <-- uses query string
// - https://cors.isomorphic-git.org  <-- uses path
const corsProxify = (corsProxy, url) =>
  corsProxy.endsWith('?')
    ? `${corsProxy}${url}`
    : `${corsProxy}/${url.replace(/^https?:\/\//, '')}`;

class GitRemoteHTTP {
  static async capabilities () {
    return ['discover', 'connect']
  }
  static async discover ({
    core,
    corsProxy,
    service,
    url,
    noGitSuffix,
    auth,
    headers
  }) {
    const _origUrl = url;
    // Auto-append the (necessary) .git if it's missing.
    if (!url.endsWith('.git') && !noGitSuffix) url = url += '.git';
    let urlAuth = extractAuthFromUrl(url);
    if (urlAuth) {
      url = urlAuth.url;
      // To try to be backwards compatible with simple-get's behavior, which uses Node's http.request
      // setting an Authorization header will override what is in the URL.
      // Ergo manually specified auth parameters will override those in the URL.
      auth.username = auth.username || urlAuth.username;
      auth.password = auth.password || urlAuth.password;
    }
    if (corsProxy) {
      url = corsProxify(corsProxy, url);
    }
    // Get the 'http' plugin
    const http$$1 = cores.get(core).get('http') || http;
    // headers['Accept'] = `application/x-${service}-advertisement`
    // Only send a user agent in Node and to CORS proxies by default,
    // because Gogs and others might not whitelist 'user-agent' in allowed headers.
    // Solutions using 'process.browser' can't be used as they rely on bundler shims,
    // ans solutions using 'process.versions.node' had to be discarded because the
    // BrowserFS 'process' shim is too complete.
    if (typeof window === 'undefined' || corsProxy) {
      headers['user-agent'] = headers['user-agent'] || pkg.agent;
    }
    let _auth = calculateBasicAuthUsernamePasswordPair(auth);
    if (_auth) {
      headers['Authorization'] = calculateBasicAuthHeader(_auth);
    }
    let res = await http$$1({
      core,
      method: 'GET',
      url: `${url}/info/refs?service=${service}`,
      headers
    });
    if (res.statusCode === 401 && cores.get(core).has('credentialManager')) {
      // Acquire credentials and try again
      const credentialManager = cores.get(core).get('credentialManager');
      auth = await credentialManager.fill({ url: _origUrl });
      let _auth = calculateBasicAuthUsernamePasswordPair(auth);
      if (_auth) {
        headers['Authorization'] = calculateBasicAuthHeader(_auth);
      }
      res = await http$$1({
        core,
        method: 'GET',
        url: `${url}/info/refs?service=${service}`,
        headers
      });
      // Tell credential manager if the credentials were no good
      if (res.statusCode === 401) {
        await credentialManager.rejected({ url: _origUrl, auth });
      } else if (res.statusCode === 200) {
        await credentialManager.approved({ url: _origUrl, auth });
      }
    }
    if (res.statusCode !== 200) {
      throw new GitError(E.HTTPError, {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage
      })
    }
    // I'm going to be nice and ignore the content-type requirement unless there is a problem.
    try {
      let remoteHTTP = await parseRefsAdResponse(res.body, {
        service
      });
      remoteHTTP.auth = auth;
      return remoteHTTP
    } catch (err) {
      // Detect "dumb" HTTP protocol responses and throw more specific error message
      if (
        err.code === E.AssertServerResponseFail &&
        err.data.expected === `# service=${service}\\n` &&
        res.headers['content-type'] !== `application/x-${service}-advertisement`
      ) {
        // Ooooooh that's why it failed.
        throw new GitError(E.RemoteDoesNotSupportSmartHTTP, {})
      }
      throw err
    }
  }
  static async connect ({
    core,
    emitter,
    emitterPrefix,
    corsProxy,
    service,
    url,
    noGitSuffix,
    auth,
    body,
    headers
  }) {
    // Auto-append the (necessary) .git if it's missing.
    if (!url.endsWith('.git') && !noGitSuffix) url = url += '.git';
    let urlAuth = extractAuthFromUrl(url);
    if (urlAuth) {
      url = urlAuth.url;
      // To try to be backwards compatible with simple-get's behavior, which uses Node's http.request
      // setting an Authorization header will override what is in the URL.
      // Ergo manually specified auth parameters will override those in the URL.
      auth.username = auth.username || urlAuth.username;
      auth.password = auth.password || urlAuth.password;
    }
    if (corsProxy) {
      url = corsProxify(corsProxy, url);
    }
    headers['content-type'] = `application/x-${service}-request`;
    headers['accept'] = `application/x-${service}-result`;
    // Get the 'http' plugin
    const http$$1 = cores.get(core).get('http') || http;
    // Only send a user agent in Node and to CORS proxies by default,
    // because Gogs and others might not whitelist 'user-agent' in allowed headers.
    // Solutions using 'process.browser' can't be used as they rely on bundler shims,
    // ans solutions using 'process.versions.node' had to be discarded because the
    // BrowserFS 'process' shim is too complete.
    if (typeof window === 'undefined' || corsProxy) {
      headers['user-agent'] = headers['user-agent'] || pkg.agent;
    }
    auth = calculateBasicAuthUsernamePasswordPair(auth);
    if (auth) {
      headers['Authorization'] = calculateBasicAuthHeader(auth);
    }
    let res = await http$$1({
      core,
      emitter,
      emitterPrefix,
      method: 'POST',
      url: `${url}/${service}`,
      body,
      headers
    });
    if (res.statusCode !== 200) {
      throw new GitError(E.HTTPError, {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage
      })
    }
    return res
  }
}

function parseRemoteUrl ({ url }) {
  let matches = url.match(/(\w+)(:\/\/|::)(.*)/);
  if (matches === null) return
  /*
   * When git encounters a URL of the form <transport>://<address>, where <transport> is
   * a protocol that it cannot handle natively, it automatically invokes git remote-<transport>
   * with the full URL as the second argument.
   *
   * @see https://git-scm.com/docs/git-remote-helpers
   */
  if (matches[2] === '://') {
    return {
      transport: matches[1],
      address: matches[0]
    }
  }
  /*
   * A URL of the form <transport>::<address> explicitly instructs git to invoke
   * git remote-<transport> with <address> as the second argument.
   *
   * @see https://git-scm.com/docs/git-remote-helpers
   */
  if (matches[2] === '::') {
    return {
      transport: matches[1],
      address: matches[3]
    }
  }
}

class GitRemoteManager {
  static getRemoteHelperFor ({ url }) {
    // TODO: clean up the remoteHelper API and move into PluginCore
    const remoteHelpers = new Map();
    remoteHelpers.set('http', GitRemoteHTTP);
    remoteHelpers.set('https', GitRemoteHTTP);

    let parts = parseRemoteUrl({ url });
    if (!parts) {
      throw new GitError(E.RemoteUrlParseError, { url })
    }
    if (remoteHelpers.has(parts.transport)) {
      return remoteHelpers.get(parts.transport)
    }
    throw new GitError(E.UnknownTransportError, {
      url,
      transport: parts.transport
    })
  }
}

let lock$1 = null;

class GitShallowManager {
  static async read ({ fs: _fs, gitdir }) {
    const fs = new FileSystem(_fs);
    if (lock$1 === null) lock$1 = new AsyncLock();
    const filepath = join(gitdir, 'shallow');
    let oids = new Set();
    await lock$1.acquire(filepath, async function () {
      let text = await fs.read(filepath, { encoding: 'utf8' });
      if (text === null) return oids // no file
      if (text.trim() === '') return oids // empty file
      text
        .trim()
        .split('\n')
        .map(oid => oids.add(oid));
    });
    return oids
  }
  static async write ({ fs: _fs, gitdir, oids }) {
    const fs = new FileSystem(_fs);
    if (lock$1 === null) lock$1 = new AsyncLock();
    const filepath = join(gitdir, 'shallow');
    if (oids.size > 0) {
      let text = [...oids].join('\n') + '\n';
      await lock$1.acquire(filepath, async function () {
        await fs.write(filepath, text, {
          encoding: 'utf8'
        });
      });
    } else {
      // No shallows
      await lock$1.acquire(filepath, async function () {
        await fs.rm(filepath);
      });
    }
  }
}

async function hasObjectLoose ({ fs: _fs, gitdir, oid }) {
  const fs = new FileSystem(_fs);
  let source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  return fs.exists(`${gitdir}/${source}`)
}

async function hasObjectPacked ({
  fs: _fs,
  gitdir,
  oid,
  getExternalRefDelta
}) {
  const fs = new FileSystem(_fs);
  // Check to see if it's in a packfile.
  // Iterate through all the .idx files
  let list = await fs.readdir(join(gitdir, '/objects/pack'));
  list = list.filter(x => x.endsWith('.idx'));
  for (let filename of list) {
    const indexFile = `${gitdir}/objects/pack/${filename}`;
    let p = await readPackIndex({
      fs,
      filename: indexFile,
      getExternalRefDelta
    });
    if (p.error) throw new GitError(E.InternalFail, { message: p.error })
    // If the packfile DOES have the oid we're looking for...
    if (p.offsets.has(oid)) {
      return true
    }
  }
  // Failed to find it
  return false
}

async function hasObject ({ fs: _fs, gitdir, oid, format = 'content' }) {
  const fs = new FileSystem(_fs);
  // Curry the current read method so that the packfile un-deltification
  // process can acquire external ref-deltas.
  const getExternalRefDelta = oid => readObject({ fs, gitdir, oid });

  // Look for it in the loose object directory.
  let result = await hasObjectLoose({ fs, gitdir, oid });
  // Check to see if it's in a packfile.
  if (!result) {
    result = await hasObjectPacked({ fs, gitdir, oid, getExternalRefDelta });
  }
  // Finally
  return result
}

// TODO: make a function that just returns obCount. then emptyPackfile = () => sizePack(pack) === 0
function emptyPackfile (pack) {
  const pheader = '5041434b';
  const version = '00000002';
  const obCount = '00000000';
  const header = pheader + version + obCount;
  return pack.slice(0, 12).toString('hex') === header
}

function filterCapabilities (server, client) {
  let serverNames = server.map(cap => cap.split('=', 1)[0]);
  return client.filter(cap => {
    let name = cap.split('=', 1)[0];
    return serverNames.includes(name)
  })
}

class FIFO {
  constructor () {
    this._queue = [];
  }
  write (chunk) {
    if (this._ended) {
      throw Error('You cannot write to a FIFO that has already been ended!')
    }
    if (this._waiting) {
      let resolve = this._waiting;
      this._waiting = null;
      resolve({ value: chunk });
    } else {
      this._queue.push(chunk);
    }
  }
  end () {
    this._ended = true;
    if (this._waiting) {
      let resolve = this._waiting;
      this._waiting = null;
      resolve({ done: true });
    }
  }
  destroy (err) {
    this._ended = true;
    this.error = err;
  }
  async next () {
    if (this._queue.length > 0) {
      return { value: this._queue.shift() }
    }
    if (this._ended) {
      return { done: true }
    }
    if (this._waiting) {
      throw Error(
        'You cannot call read until the previous call to read has returned!'
      )
    }
    return new Promise(resolve => {
      this._waiting = resolve;
    })
  }
}

// Note: progress messages are designed to be written directly to the terminal,
// so they are often sent with just a carriage return to overwrite the last line of output.
// But there are also messages delimited with newlines.
// I also include CRLF just in case.
function findSplit (str) {
  let r = str.indexOf('\r');
  let n = str.indexOf('\n');
  if (r === -1 && n === -1) return -1
  if (r === -1) return n + 1 // \n
  if (n === -1) return r + 1 // \r
  if (n === r + 1) return n + 1 // \r\n
  return Math.min(r, n) + 1 // \r or \n
}

function splitLines (input) {
  let output = new FIFO();
  let tmp = ''
  ;(async () => {
    await forAwait(input, chunk => {
      chunk = chunk.toString('utf8');
      tmp += chunk;
      while (true) {
        let i = findSplit(tmp);
        if (i === -1) break
        output.write(tmp.slice(0, i));
        tmp = tmp.slice(i);
      }
    });
    if (tmp.length > 0) {
      output.write(tmp);
    }
    output.end();
  })();
  return output
}

/*
If 'side-band' or 'side-band-64k' capabilities have been specified by
the client, the server will send the packfile data multiplexed.

Each packet starting with the packet-line length of the amount of data
that follows, followed by a single byte specifying the sideband the
following data is coming in on.

In 'side-band' mode, it will send up to 999 data bytes plus 1 control
code, for a total of up to 1000 bytes in a pkt-line.  In 'side-band-64k'
mode it will send up to 65519 data bytes plus 1 control code, for a
total of up to 65520 bytes in a pkt-line.

The sideband byte will be a '1', '2' or a '3'. Sideband '1' will contain
packfile data, sideband '2' will be used for progress information that the
client will generally print to stderr and sideband '3' is used for error
information.

If no 'side-band' capability was specified, the server will stream the
entire packfile without multiplexing.
*/

class GitSideBand {
  static demux (input) {
    let read = GitPktLine.streamReader(input);
    // And now for the ridiculous side-band or side-band-64k protocol
    let packetlines = new FIFO();
    let packfile = new FIFO();
    let progress = new FIFO();
    // TODO: Use a proper through stream?
    const nextBit = async function () {
      let line = await read();
      // Skip over flush packets
      if (line === null) return nextBit()
      // A made up convention to signal there's no more to read.
      if (line === true) {
        packetlines.end();
        progress.end();
        packfile.end();
        return
      }
      // Examine first byte to determine which output "stream" to use
      switch (line[0]) {
        case 1: // pack data
          packfile.write(line.slice(1));
          break
        case 2: // progress message
          progress.write(line.slice(1));
          break
        case 3: // fatal error message just before stream aborts
          let error = line.slice(1);
          progress.write(error);
          packfile.destroy(new Error(error.toString('utf8')));
          return
        default:
          // Not part of the side-band-64k protocol
          packetlines.write(line.slice(0));
      }
      // Careful not to blow up the stack.
      // I think Promises in a tail-call position should be OK.
      nextBit();
    };
    nextBit();
    return {
      packetlines,
      packfile,
      progress
    }
  }
  // static mux ({
  //   protocol, // 'side-band' or 'side-band-64k'
  //   packetlines,
  //   packfile,
  //   progress,
  //   error
  // }) {
  //   const MAX_PACKET_LENGTH = protocol === 'side-band-64k' ? 999 : 65519
  //   let output = new PassThrough()
  //   packetlines.on('data', data => {
  //     if (data === null) {
  //       output.write(GitPktLine.flush())
  //     } else {
  //       output.write(GitPktLine.encode(data))
  //     }
  //   })
  //   let packfileWasEmpty = true
  //   let packfileEnded = false
  //   let progressEnded = false
  //   let errorEnded = false
  //   let goodbye = Buffer.concat([
  //     GitPktLine.encode(Buffer.from('010A', 'hex')),
  //     GitPktLine.flush()
  //   ])
  //   packfile
  //     .on('data', data => {
  //       packfileWasEmpty = false
  //       const buffers = splitBuffer(data, MAX_PACKET_LENGTH)
  //       for (const buffer of buffers) {
  //         output.write(
  //           GitPktLine.encode(Buffer.concat([Buffer.from('01', 'hex'), buffer]))
  //         )
  //       }
  //     })
  //     .on('end', () => {
  //       packfileEnded = true
  //       if (!packfileWasEmpty) output.write(goodbye)
  //       if (progressEnded && errorEnded) output.end()
  //     })
  //   progress
  //     .on('data', data => {
  //       const buffers = splitBuffer(data, MAX_PACKET_LENGTH)
  //       for (const buffer of buffers) {
  //         output.write(
  //           GitPktLine.encode(Buffer.concat([Buffer.from('02', 'hex'), buffer]))
  //         )
  //       }
  //     })
  //     .on('end', () => {
  //       progressEnded = true
  //       if (packfileEnded && errorEnded) output.end()
  //     })
  //   error
  //     .on('data', data => {
  //       const buffers = splitBuffer(data, MAX_PACKET_LENGTH)
  //       for (const buffer of buffers) {
  //         output.write(
  //           GitPktLine.encode(Buffer.concat([Buffer.from('03', 'hex'), buffer]))
  //         )
  //       }
  //     })
  //     .on('end', () => {
  //       errorEnded = true
  //       if (progressEnded && packfileEnded) output.end()
  //     })
  //   return output
  // }
}

async function parseUploadPackResponse (stream) {
  const { packetlines, packfile, progress } = GitSideBand.demux(stream);
  let shallows = [];
  let unshallows = [];
  let acks = [];
  let nak = false;
  let done = false;
  return new Promise((resolve, reject) => {
    // Parse the response
    forAwait(packetlines, data => {
      let line = data.toString('utf8').trim();
      if (line.startsWith('shallow')) {
        let oid = line.slice(-41).trim();
        if (oid.length !== 40) {
          reject(new GitError(E.CorruptShallowOidFail, { oid }));
        }
        shallows.push(oid);
      } else if (line.startsWith('unshallow')) {
        let oid = line.slice(-41).trim();
        if (oid.length !== 40) {
          reject(new GitError(E.CorruptShallowOidFail, { oid }));
        }
        unshallows.push(oid);
      } else if (line.startsWith('ACK')) {
        let [, oid, status] = line.split(' ');
        acks.push({ oid, status });
        if (!status) done = true;
      } else if (line.startsWith('NAK')) {
        nak = true;
        done = true;
      }
      if (done) {
        resolve({ shallows, unshallows, acks, nak, packfile, progress });
      }
    });
  })
}

function writeUploadPackRequest ({
  capabilities = [],
  wants = [],
  haves = [],
  shallows = [],
  depth = null,
  since = null,
  exclude = []
}) {
  let packstream = [];
  wants = [...new Set(wants)]; // remove duplicates
  let firstLineCapabilities = ` ${capabilities.join(' ')}`;
  for (const oid of wants) {
    packstream.push(GitPktLine.encode(`want ${oid}${firstLineCapabilities}\n`));
    firstLineCapabilities = '';
  }
  for (const oid of shallows) {
    packstream.push(GitPktLine.encode(`shallow ${oid}\n`));
  }
  if (depth !== null) {
    packstream.push(GitPktLine.encode(`deepen ${depth}\n`));
  }
  if (since !== null) {
    packstream.push(
      GitPktLine.encode(`deepen-since ${Math.floor(since.valueOf() / 1000)}\n`)
    );
  }
  for (const oid of exclude) {
    packstream.push(GitPktLine.encode(`deepen-not ${oid}\n`));
  }
  packstream.push(GitPktLine.flush());
  for (const oid of haves) {
    packstream.push(GitPktLine.encode(`have ${oid}\n`));
  }
  packstream.push(GitPktLine.encode(`done\n`));
  return packstream
}

/**
 * Fetch commits from a remote repository
 *
 * @link https://isomorphic-git.github.io/docs/fetch.html
 */
async function fetch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref = 'HEAD',
  refs,
  remote,
  url,
  noGitSuffix = false,
  corsProxy,
  authUsername,
  authPassword,
  username = authUsername,
  password = authPassword,
  token,
  oauth2format,
  depth = null,
  since = null,
  exclude = [],
  relative = false,
  tags = false,
  singleBranch = false,
  headers = {},
  onprogress // deprecated
}) {
  try {
    if (onprogress !== undefined) {
      console.warn(
        'The `onprogress` callback has been deprecated. Please use the more generic `emitter` EventEmitter argument instead.'
      );
    }
    const fs = new FileSystem(_fs);
    let response = await fetchPackfile({
      core,
      gitdir,
      fs,
      emitter,
      emitterPrefix,
      ref,
      refs,
      remote,
      url,
      noGitSuffix,
      corsProxy,
      username,
      password,
      token,
      oauth2format,
      depth,
      since,
      exclude,
      relative,
      tags,
      singleBranch,
      headers
    });
    if (response === null) {
      return {
        fetchHead: null
      }
    }
    if (emitter) {
      let lines = splitLines(response.progress);
      forAwait(lines, line => {
        // As a historical accident, 'message' events were trimmed removing valuable information,
        // such as \r by itself which was a single to update the existing line instead of appending a new one.
        // TODO NEXT BREAKING RELEASE: make 'message' behave like 'rawmessage' and remove 'rawmessage'.
        emitter.emit(`${emitterPrefix}message`, line.trim());
        emitter.emit(`${emitterPrefix}rawmessage`, line);
        let matches = line.match(/([^:]*).*\((\d+?)\/(\d+?)\)/);
        if (matches) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: matches[1].trim(),
            loaded: parseInt(matches[2], 10),
            total: parseInt(matches[3], 10),
            lengthComputable: true
          });
        }
      });
    }
    let packfile = await collect(response.packfile);
    let packfileSha = packfile.slice(-20).toString('hex');
    // TODO: Return more metadata?
    let res = {
      defaultBranch: response.HEAD,
      fetchHead: response.FETCH_HEAD
    };
    if (response.headers) {
      res.headers = response.headers;
    }
    // This is a quick fix for the empty .git/objects/pack/pack-.pack file error,
    // which due to the way `git-list-pack` works causes the program to hang when it tries to read it.
    // TODO: Longer term, we should actually:
    // a) NOT concatenate the entire packfile into memory (line 78),
    // b) compute the SHA of the stream except for the last 20 bytes, using the same library used in push.js, and
    // c) compare the computed SHA with the last 20 bytes of the stream before saving to disk, and throwing a "packfile got corrupted during download" error if the SHA doesn't match.
    if (packfileSha !== '' && !emptyPackfile(packfile)) {
      res.packfile = `objects/pack/pack-${packfileSha}.pack`;
      const fullpath = join(gitdir, res.packfile);
      await fs.write(fullpath, packfile);
      const getExternalRefDelta = oid => readObject({ fs, gitdir, oid });
      const idx = await GitPackIndex.fromPack({
        pack: packfile,
        getExternalRefDelta,
        emitter,
        emitterPrefix
      });
      await fs.write(fullpath.replace(/\.pack$/, '.idx'), idx.toBuffer());
    }
    return res
  } catch (err) {
    err.caller = 'git.fetch';
    throw err
  }
}

async function fetchPackfile ({
  core,
  gitdir,
  fs: _fs,
  emitter,
  emitterPrefix,
  ref,
  refs = [ref],
  remote,
  url,
  noGitSuffix,
  corsProxy,
  username,
  password,
  token,
  oauth2format,
  depth,
  since,
  exclude,
  relative,
  tags,
  singleBranch,
  headers
}) {
  const fs = new FileSystem(_fs);
  // Sanity checks
  if (depth !== null) {
    if (Number.isNaN(parseInt(depth))) {
      throw new GitError(E.InvalidDepthParameterError, { depth })
    }
    depth = parseInt(depth);
  }
  // Set missing values
  remote = remote || 'origin';
  if (url === undefined) {
    url = await config({
      fs,
      gitdir,
      path: `remote.${remote}.url`
    });
  }
  if (corsProxy === undefined) {
    corsProxy = await config({ fs, gitdir, path: 'http.corsProxy' });
  }
  let auth = { username, password, token, oauth2format };
  let GitRemoteHTTP = GitRemoteManager.getRemoteHelperFor({ url });
  let remoteHTTP = await GitRemoteHTTP.discover({
    core,
    corsProxy,
    service: 'git-upload-pack',
    url,
    noGitSuffix,
    auth,
    headers
  });
  auth = remoteHTTP.auth; // hack to get new credentials from CredentialManager API
  const remoteRefs = remoteHTTP.refs;
  // For the special case of an empty repository with no refs, return null.
  if (remoteRefs.size === 0) {
    return null
  }
  // Check that the remote supports the requested features
  if (depth !== null && !remoteHTTP.capabilities.has('shallow')) {
    throw new GitError(E.RemoteDoesNotSupportShallowFail)
  }
  if (since !== null && !remoteHTTP.capabilities.has('deepen-since')) {
    throw new GitError(E.RemoteDoesNotSupportDeepenSinceFail)
  }
  if (exclude.length > 0 && !remoteHTTP.capabilities.has('deepen-not')) {
    throw new GitError(E.RemoteDoesNotSupportDeepenNotFail)
  }
  if (relative === true && !remoteHTTP.capabilities.has('deepen-relative')) {
    throw new GitError(E.RemoteDoesNotSupportDeepenRelativeFail)
  }
  // Figure out the SHA for the requested ref
  let { oid, fullref } = GitRefManager.resolveAgainstMap({
    ref,
    map: remoteRefs
  });
  // Filter out refs we want to ignore: only keep ref we're cloning, HEAD, branches, and tags (if we're keeping them)
  for (let remoteRef of remoteRefs.keys()) {
    if (
      remoteRef === fullref ||
      remoteRef === 'HEAD' ||
      remoteRef.startsWith('refs/heads/') ||
      (tags && remoteRef.startsWith('refs/tags/'))
    ) {
      continue
    }
    remoteRefs.delete(remoteRef);
  }
  // Assemble the application/x-git-upload-pack-request
  const capabilities = filterCapabilities(
    [...remoteHTTP.capabilities],
    [
      'multi_ack_detailed',
      'no-done',
      'side-band-64k',
      'thin-pack',
      'ofs-delta',
      `agent=${pkg.agent}`
    ]
  );
  if (relative) capabilities.push('deepen-relative');
  // Start figuring out which oids from the remote we want to request
  let wants = singleBranch ? [oid] : remoteRefs.values();
  // Come up with a reasonable list of oids to tell the remote we already have
  // (preferably oids that are close ancestors of the branch heads we're fetching)
  let haveRefs = singleBranch
    ? refs
    : await GitRefManager.listRefs({
      fs,
      gitdir,
      filepath: `refs`
    });
  let haves = new Set();
  for (let ref of haveRefs) {
    try {
      ref = await GitRefManager.expand({ fs, gitdir, ref });
      const oid = await GitRefManager.resolve({ fs, gitdir, ref });
      if (await hasObject({ fs, gitdir, oid })) {
        haves.add(oid);
      }
    } catch (err) {}
  }
  haves = haves.values();
  let oids = await GitShallowManager.read({ fs, gitdir });
  let shallows = remoteHTTP.capabilities.has('shallow') ? [...oids] : [];
  let packstream = writeUploadPackRequest({
    capabilities,
    wants,
    haves,
    shallows,
    depth,
    since,
    exclude
  });
  // CodeCommit will hang up if we don't send a Content-Length header
  // so we can't stream the body.
  let packbuffer = await collect(packstream);
  let raw = await GitRemoteHTTP.connect({
    core,
    emitter,
    emitterPrefix,
    corsProxy,
    service: 'git-upload-pack',
    url,
    noGitSuffix,
    auth,
    body: [packbuffer],
    headers
  });
  let response = await parseUploadPackResponse(raw.body);
  if (raw.headers) {
    response.headers = raw.headers;
  }
  // Apply all the 'shallow' and 'unshallow' commands
  for (const oid of response.shallows) {
    oids.add(oid);
  }
  for (const oid of response.unshallows) {
    oids.delete(oid);
  }
  await GitShallowManager.write({ fs, gitdir, oids });
  // Update local remote refs
  if (singleBranch) {
    const refs = new Map([[fullref, oid]]);
    // But wait, maybe it was a symref, like 'HEAD'!
    // We need to save all the refs in the symref chain (sigh).
    const symrefs = new Map();
    let bail = 10;
    let key = fullref;
    while (bail--) {
      let value = remoteHTTP.symrefs.get(key);
      if (value === undefined) break
      symrefs.set(key, value);
      key = value;
    }
    // final value must not be a symref but a real ref
    refs.set(key, remoteRefs.get(key));
    await GitRefManager.updateRemoteRefs({
      fs,
      gitdir,
      remote,
      refs,
      symrefs,
      tags
    });
  } else {
    await GitRefManager.updateRemoteRefs({
      fs,
      gitdir,
      remote,
      refs: remoteRefs,
      symrefs: remoteHTTP.symrefs,
      tags
    });
  }
  // We need this value later for the `clone` command.
  response.HEAD = remoteHTTP.symrefs.get('HEAD');
  // AWS CodeCommit doesn't list HEAD as a symref, but we can reverse engineer it
  // Find the SHA of the branch called HEAD
  if (response.HEAD === undefined) {
    let { oid } = GitRefManager.resolveAgainstMap({
      ref: 'HEAD',
      map: remoteRefs
    });
    // Use the name of the first branch that's not called HEAD that has
    // the same SHA as the branch called HEAD.
    for (let [key, value] of remoteRefs.entries()) {
      if (key !== 'HEAD' && value === oid) {
        response.HEAD = key;
        break
      }
    }
  }
  response.FETCH_HEAD = oid;
  return response
}

/**
 * Initialize a new repository
 *
 * @link https://isomorphic-git.github.io/docs/init.html
 */
async function init ({
  core = 'default',
  bare = false,
  dir,
  gitdir = bare ? dir : join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs')
}) {
  try {
    const fs = new FileSystem(_fs);
    let folders = [
      'hooks',
      'info',
      'objects/info',
      'objects/pack',
      'refs/heads',
      'refs/tags'
    ];
    folders = folders.map(dir => gitdir + '/' + dir);
    for (let folder of folders) {
      await fs.mkdir(folder);
    }
    await fs.write(
      gitdir + '/config',
      '[core]\n' +
        '\trepositoryformatversion = 0\n' +
        '\tfilemode = false\n' +
        `\tbare = ${bare}\n` +
        (bare ? '' : '\tlogallrefupdates = true\n') +
        '\tsymlinks = false\n' +
        '\tignorecase = true\n'
    );
    await fs.write(gitdir + '/HEAD', 'ref: refs/heads/master\n');
  } catch (err) {
    err.caller = 'git.init';
    throw err
  }
}

/**
 * Clone a repository
 *
 * @link https://isomorphic-git.github.io/docs/clone.html
 */
async function clone ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  url,
  noGitSuffix = false,
  corsProxy,
  ref,
  remote,
  authUsername,
  authPassword,
  username = authUsername,
  password = authPassword,
  token,
  oauth2format,
  depth,
  since,
  exclude,
  relative,
  singleBranch,
  noCheckout = false,
  noTags = false,
  headers = {},
  onprogress
}) {
  try {
    if (onprogress !== undefined) {
      console.warn(
        'The `onprogress` callback has been deprecated. Please use the more generic `emitter` EventEmitter argument instead.'
      );
    }
    const fs = new FileSystem(_fs);
    remote = remote || 'origin';
    await init({ gitdir, fs });
    // Add remote
    await config({
      gitdir,
      fs,
      path: `remote.${remote}.url`,
      value: url
    });
    await config({
      gitdir,
      fs,
      path: `remote.${remote}.fetch`,
      value: `+refs/heads/*:refs/remotes/${remote}/*`
    });
    if (corsProxy) {
      await config({
        gitdir,
        fs,
        path: `http.corsProxy`,
        value: corsProxy
      });
    }
    // Fetch commits
    const { defaultBranch, fetchHead } = await fetch({
      core,
      gitdir,
      fs,
      emitter,
      emitterPrefix,
      noGitSuffix,
      ref,
      remote,
      username,
      password,
      token,
      oauth2format,
      depth,
      since,
      exclude,
      relative,
      singleBranch,
      headers,
      tags: !noTags
    });
    if (fetchHead === null) return
    ref = ref || defaultBranch;
    ref = ref.replace('refs/heads/', '');
    // Checkout that branch
    await checkout({
      dir,
      gitdir,
      fs,
      emitter,
      emitterPrefix,
      ref,
      remote,
      noCheckout
    });
  } catch (err) {
    err.caller = 'git.clone';
    throw err
  }
}

/**
 * Create a new commit
 *
 * @link https://isomorphic-git.github.io/docs/commit.html
 */
async function commit ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  message,
  author,
  committer,
  signingKey
}) {
  try {
    const fs = new FileSystem(_fs);

    if (message === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'commit',
        parameter: 'message'
      })
    }

    // Fill in missing arguments with default values
    author = await normalizeAuthorObject({ fs, gitdir, author });
    if (author === undefined) {
      throw new GitError(E.MissingAuthorError)
    }

    committer = Object.assign({}, committer || author);
    // Match committer's date to author's one, if omitted
    committer.date = committer.date || author.date;
    committer = await normalizeAuthorObject({ fs, gitdir, author: committer });
    if (committer === undefined) {
      throw new GitError(E.MissingCommitterError)
    }

    let oid;
    await GitIndexManager.acquire(
      { fs, filepath: `${gitdir}/index` },
      async function (index) {
        let parents;
        try {
          let parent = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' });
          parents = [parent];
        } catch (err) {
          // Probably an initial commit
          parents = [];
        }

        let mergeHash;
        try {
          mergeHash = await GitRefManager.resolve({ fs, gitdir, ref: 'MERGE_HEAD' });
        } catch (err) {
          // No merge hash
        }

        if (mergeHash) {
          const conflictedPaths = index.conflictedPaths;
          if (conflictedPaths.length > 0) {
            throw new GitError(E.CommitUnmergedConflictsFail, { paths: conflictedPaths })
          }
          if (parents.length) {
            parents.push(mergeHash);
          } else {
            throw new GitError(E.NoHeadCommitError, { noun: 'merge commit', ref: mergeHash })
          }
        }

        const inodes = flatFileListToDirectoryStructure(index.entries);
        const inode = inodes.get('.');
        const treeRef = await constructTree({ fs, gitdir, inode });

        let comm = GitCommit.from({
          tree: treeRef,
          parent: parents,
          author,
          committer,
          message
        });
        if (signingKey) {
          let pgp = cores.get(core).get('pgp');
          comm = await GitCommit.sign(comm, pgp, signingKey);
        }
        oid = await writeObject({
          fs,
          gitdir,
          type: 'commit',
          object: comm.toObject()
        });
        // Update branch pointer
        const branch = await GitRefManager.resolve({
          fs,
          gitdir,
          ref: 'HEAD',
          depth: 2
        });
        await fs.write(join(gitdir, branch), oid + '\n');
        if (mergeHash) {
          await GitRefManager.deleteRef({ fs, gitdir, ref: 'MERGE_HEAD' });
          await fs.rm(join(gitdir, 'MERGE_MSG'));
        }
      }
    );
    return oid
  } catch (err) {
    err.caller = 'git.commit';
    throw err
  }
}

async function constructTree ({ fs, gitdir, inode }) {
  // use depth first traversal
  let children = inode.children;
  for (let inode of children) {
    if (inode.type === 'tree') {
      inode.metadata.mode = '040000';
      inode.metadata.oid = await constructTree({ fs, gitdir, inode });
    }
  }
  let entries = children.map(inode => ({
    mode: inode.metadata.mode,
    path: inode.basename,
    oid: inode.metadata.oid,
    type: inode.type
  }));
  const tree = GitTree.from(entries);
  let oid = await writeObject({
    fs,
    gitdir,
    type: 'tree',
    object: tree.toObject()
  });
  return oid
}

// @see https://git-scm.com/docs/git-rev-parse.html#_specifying_revisions
const abbreviateRx = new RegExp('^refs/(heads/|tags/|remotes/)?(.*)');

function abbreviate (ref) {
  const match = abbreviateRx.exec(ref);
  if (match) {
    if (match[1] === 'remotes/' && ref.endsWith('/HEAD')) {
      return match[2].slice(0, -5)
    } else {
      return match[2]
    }
  }
  return ref
}

/**
 * Get the name of the branch currently pointed to by .git/HEAD
 *
 * @link https://isomorphic-git.github.io/docs/currentBranch.html
 */
async function currentBranch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  fullname = false
}) {
  try {
    const fs = new FileSystem(_fs);
    let ref = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: 'HEAD',
      depth: 2
    });
    // Return `undefined` for detached HEAD
    if (!ref.startsWith('refs/')) return
    return fullname ? ref : abbreviate(ref)
  } catch (err) {
    err.caller = 'git.currentBranch';
    throw err
  }
}

/**
 * Delete a branch
 *
 * @link https://isomorphic-git.github.io/docs/deleteBranch.html
 */
async function deleteBranch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref
}) {
  try {
    const fs = new FileSystem(_fs);
    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'deleteBranch',
        parameter: 'ref'
      })
    }

    if (ref !== cleanGitRef.clean(ref)) {
      throw new GitError(E.InvalidRefNameError, {
        verb: 'delete',
        noun: 'branch',
        ref,
        suggestion: cleanGitRef.clean(ref)
      })
    }

    const exist = await fs.exists(`${gitdir}/refs/heads/${ref}`);
    if (!exist) {
      throw new GitError(E.RefNotExistsError, {
        verb: 'delete',
        noun: 'branch',
        ref
      })
    }

    const currentRef = await currentBranch({ fs, gitdir });
    if (ref === currentRef) {
      throw new GitError(E.BranchDeleteError, { ref })
    }

    // Delete a specified branch
    await fs.rm(`${gitdir}/refs/heads/${ref}`);
  } catch (err) {
    err.caller = 'git.deleteBranch';
    throw err
  }
}

/**
 * Delete a ref.
 *
 * @link https://isomorphic-git.github.io/docs/deleteRef.html
 */
async function deleteRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref
}) {
  try {
    const fs = new FileSystem(_fs);
    await GitRefManager.deleteRef({ fs, gitdir, ref });
  } catch (err) {
    err.caller = 'git.deleteRef';
    throw err
  }
}

/**
 * Delete an existing remote
 *
 * @link https://isomorphic-git.github.io/docs/deleteRemote.html
 */
async function deleteRemote ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  remote
}) {
  try {
    const fs = new FileSystem(_fs);
    if (remote === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'deleteRemote',
        parameter: 'remote'
      })
    }
    const config = await GitConfigManager.get({ fs, gitdir });
    await config.deleteSection('remote', remote);
    await GitConfigManager.save({ fs, gitdir, config });
  } catch (err) {
    err.caller = 'git.deleteRemote';
    throw err
  }
}

/**
 * Delete a tag ref.
 *
 * @link https://isomorphic-git.github.io/docs/deleteTag.html
 */
async function deleteTag ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref
}) {
  try {
    const fs = new FileSystem(_fs);
    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'deleteTag',
        parameter: 'ref'
      })
    }
    ref = ref.startsWith('refs/tags/') ? ref : `refs/tags/${ref}`;
    await deleteRef({ fs, gitdir, ref });
  } catch (err) {
    err.caller = 'git.deleteTag';
    throw err
  }
}

async function expandOidLoose ({ fs: _fs, gitdir, oid: short }) {
  const fs = new FileSystem(_fs);
  const prefix = short.slice(0, 2);
  const objectsSuffixes = await fs.readdir(`${gitdir}/objects/${prefix}`);
  return objectsSuffixes
    .map(suffix => `${prefix}${suffix}`)
    .filter(_oid => _oid.startsWith(short))
}

async function expandOidPacked ({
  fs: _fs,
  gitdir,
  oid: short,
  getExternalRefDelta
}) {
  const fs = new FileSystem(_fs);
  // Iterate through all the .pack files
  let results = [];
  let list = await fs.readdir(join(gitdir, 'objects/pack'));
  list = list.filter(x => x.endsWith('.idx'));
  for (let filename of list) {
    const indexFile = `${gitdir}/objects/pack/${filename}`;
    let p = await readPackIndex({
      fs,
      filename: indexFile,
      getExternalRefDelta
    });
    if (p.error) throw new GitError(E.InternalFail, { message: p.error })
    // Search through the list of oids in the packfile
    for (let oid of p.offsets.keys()) {
      if (oid.startsWith(short)) results.push(oid);
    }
  }
  return results
}

async function expandOid ({ fs: _fs, gitdir, oid: short }) {
  const fs = new FileSystem(_fs);
  // Curry the current read method so that the packfile un-deltification
  // process can acquire external ref-deltas.
  const getExternalRefDelta = oid => readObject({ fs: _fs, gitdir, oid });

  const results1 = await expandOidLoose({ fs, gitdir, oid: short });
  const results2 = await expandOidPacked({
    fs,
    gitdir,
    oid: short,
    getExternalRefDelta
  });
  const results = results1.concat(results2);

  if (results.length === 1) {
    return results[0]
  }
  if (results.length > 1) {
    throw new GitError(E.AmbiguousShortOid, {
      short,
      matches: results.join(', ')
    })
  }
  throw new GitError(E.ShortOidNotFound, { short })
}

/**
 * Expand and resolve a short oid into a full oid
 *
 * @link https://isomorphic-git.github.io/docs/expandOid.html
 */
async function expandOid$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  oid
}) {
  try {
    const fs = new FileSystem(_fs);
    const fullOid = await expandOid({
      fs,
      gitdir,
      oid
    });
    return fullOid
  } catch (err) {
    err.caller = 'git.expandOid';
    throw err
  }
}

/**
 * Expand an abbreviated ref to its full name
 *
 * @link https://isomorphic-git.github.io/docs/expandRef.html
 */
async function expandRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref
}) {
  try {
    const fs = new FileSystem(_fs);
    const fullref = await GitRefManager.expand({
      fs,
      gitdir,
      ref
    });
    return fullref
  } catch (err) {
    err.caller = 'git.expandRef';
    throw err
  }
}

/**
 * Find the merge base for a set of commits
 *
 * @link https://isomorphic-git.github.io/docs/findMergeBase.html
 */
// TODO: Should I rename this nearestCommonAncestor?
async function findMergeBase ({
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
    const fs = new FileSystem(_fs);
    // If we start N independent walkers, one at each of the given `oids`, and walk backwards
    // through ancestors, eventually we'll discover a commit where each one of these N walkers
    // has passed through. So we just need to keep tallies until we find one where we've walked
    // through N times.
    // Due to a single commit coming from multiple parents, it's possible for a single parent to
    // be double counted if identity of initial walkers are not tracked.
    const tracker = {};
    let passes = (1 << oids.length) - 1;
    let heads = oids.map((oid, i) => ({ oid, i }));
    while (heads.length) {
      // Track number of passes through each commit by an initial walker
      let result = {};
      for (let { oid, i } of heads) {
        if (tracker[oid]) {
          tracker[oid] |= 1 << i;
        } else {
          tracker[oid] = 1 << i;
        }
        if (tracker[oid] === passes) {
          result[oid] = 1;
        }
      }
      // It's possible to have 2 common ancestors, see https://git-scm.com/docs/git-merge-base
      result = Object.keys(result);
      if (result.length > 0) {
        return result
      }
      // We haven't found a common ancestor yet
      let newheads = [];
      for (let { oid, i } of heads) {
        try {
          let { object } = await readObject({ fs, gitdir, oid });
          let commit = GitCommit.from(object);
          let { parent } = commit.parseHeaders();
          for (let oid of parent) {
            newheads.push({ oid, i });
          }
        } catch (err) {
          // do nothing
        }
      }
      heads = newheads;
    }
    return []
  } catch (err) {
    err.caller = 'git.findMergeBase';
    throw err
  }
}

/**
 * Find the root git directory
 *
 * @link https://isomorphic-git.github.io/docs/findRoot.html
 */
async function findRoot ({
  core = 'default',
  fs: _fs = cores.get(core).get('fs'),
  filepath
}) {
  try {
    const fs = new FileSystem(_fs);
    return _findRoot(fs, filepath)
  } catch (err) {
    err.caller = 'git.findRoot';
    throw err
  }
}

async function _findRoot (fs, filepath) {
  if (await fs.exists(join(filepath, '.git'))) {
    return filepath
  } else {
    let parent = dirname(filepath);
    if (parent === filepath) {
      throw new GitError(E.GitRootNotFoundError, { filepath })
    }
    return _findRoot(fs, parent)
  }
}

/**
 * List a remote servers branches, tags, and capabilities.
 *
 * @link https://isomorphic-git.github.io/docs/getRemoteInfo.html
 */
async function getRemoteInfo ({
  core = 'default',
  corsProxy,
  url,
  authUsername,
  authPassword,
  noGitSuffix = false,
  username = authUsername,
  password = authPassword,
  token,
  oauth2format,
  headers = {},
  forPush = false
}) {
  try {
    let auth = { username, password, token, oauth2format };
    const remote = await GitRemoteHTTP.discover({
      core,
      corsProxy,
      service: forPush ? 'git-receive-pack' : 'git-upload-pack',
      url,
      noGitSuffix,
      auth,
      headers
    });
    auth = remote.auth; // hack to get new credentials from CredentialManager API
    const result = {};
    // Note: remote.capabilities, remote.refs, and remote.symrefs are Set and Map objects,
    // but one of the objectives of the public API is to always return JSON-compatible objects
    // so we must JSONify them.
    result.capabilities = [...remote.capabilities];
    // Convert the flat list into an object tree, because I figure 99% of the time
    // that will be easier to use.
    for (const [ref, oid] of remote.refs) {
      let parts = ref.split('/');
      let last = parts.pop();
      let o = result;
      for (let part of parts) {
        o[part] = o[part] || {};
        o = o[part];
      }
      o[last] = oid;
    }
    // Merge symrefs on top of refs to more closely match actual git repo layouts
    for (const [symref, ref] of remote.symrefs) {
      let parts = symref.split('/');
      let last = parts.pop();
      let o = result;
      for (let part of parts) {
        o[part] = o[part] || {};
        o = o[part];
      }
      o[last] = ref;
    }
    return result
  } catch (err) {
    err.caller = 'git.getRemoteInfo';
    throw err
  }
}

/**
 * Create the .idx file for a given .pack file
 *
 * @link https://isomorphic-git.github.io/docs/indexPack.html
 */
async function indexPack ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  filepath
}) {
  try {
    const fs = new FileSystem(_fs);
    filepath = join(dir, filepath);
    const pack = await fs.read(filepath);
    const getExternalRefDelta = oid => readObject({ fs, gitdir, oid });
    const idx = await GitPackIndex.fromPack({
      pack,
      getExternalRefDelta,
      emitter,
      emitterPrefix
    });
    await fs.write(filepath.replace(/\.pack$/, '.idx'), idx.toBuffer());
  } catch (err) {
    err.caller = 'git.indexPack';
    throw err
  }
}

/**
 * Check whether a git commit is descended from another
 *
 * @link https://isomorphic-git.github.io/docs/isDescendent.html
 */
async function isDescendent ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  oid,
  ancestor,
  depth = -1
}) {
  try {
    const fs = new FileSystem(_fs);
    if (!oid) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'isDescendent',
        parameter: 'oid'
      })
    }
    if (!ancestor) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'isDescendent',
        parameter: 'ancestor'
      })
    }
    // If you don't like this behavior, add your own check.
    // Edge cases are hard to define a perfect solution.
    if (oid === ancestor) return false
    // We do not use recursion here, because that would lead to depth-first traversal,
    // and we want to maintain a breadth-first traversal to avoid hitting shallow clone depth cutoffs.
    const queue = [oid];
    let visited = new Set();
    let searchdepth = 0;
    while (queue.length) {
      if (searchdepth++ === depth) {
        throw new GitError(E.MaxSearchDepthExceeded, { depth })
      }
      let oid = queue.shift();
      let { type, object } = await readObject({
        fs,
        gitdir,
        oid
      });
      if (type !== 'commit') {
        throw new GitError(E.ResolveCommitError, { oid })
      }
      const commit = GitCommit.from(object).parse();
      // Are any of the parents the sought-after ancestor?
      for (const parent of commit.parent) {
        if (parent === ancestor) return true
      }
      // If not, add them to heads
      for (const parent of commit.parent) {
        if (!visited.has(parent)) {
          queue.push(parent);
          visited.add(parent);
        }
      }
      // Eventually, we'll travel entire tree to the roots where all the parents are empty arrays,
      // or hit the shallow depth and throw an error. Excluding the possibility of grafts, or
      // different branches cloned to different depths, you would hit this error at the same time
      // for all parents, so trying to continue is futile.
    }
    return false
  } catch (err) {
    err.caller = 'git.isDescendent';
    throw err
  }
}

/**
 * List branches
 *
 * @link https://isomorphic-git.github.io/docs/listBranches.html
 */
async function listBranches ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  remote = undefined
}) {
  try {
    const fs = new FileSystem(_fs);
    return GitRefManager.listBranches({ fs, gitdir, remote })
  } catch (err) {
    err.caller = 'git.listBranches';
    throw err
  }
}

/**
 * Read a git object directly by its SHA1 object id
 *
 * @link https://isomorphic-git.github.io/docs/readObject.html
 */
async function readObject$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  oid,
  format = 'parsed',
  filepath = undefined,
  encoding = undefined
}) {
  try {
    const fs = new FileSystem(_fs);
    if (filepath !== undefined) {
      // Ensure there are no leading or trailing directory separators.
      // I was going to do this automatically, but then found that the Git Terminal for Windows
      // auto-expands --filepath=/src/utils to --filepath=C:/Users/Will/AppData/Local/Programs/Git/src/utils
      // so I figured it would be wise to promote the behavior in the application layer not just the library layer.
      if (filepath.startsWith('/') || filepath.endsWith('/')) {
        throw new GitError(E.DirectorySeparatorsError)
      }
      const _oid = oid;
      let result = await resolveTree({ fs, gitdir, oid });
      let tree = result.tree;
      if (filepath === '') {
        oid = result.oid;
      } else {
        let pathArray = filepath.split('/');
        oid = await resolveFile({
          fs,
          gitdir,
          tree,
          pathArray,
          oid: _oid,
          filepath
        });
      }
    }
    // GitObjectManager does not know how to parse content, so we tweak that parameter before passing it.
    const _format = format === 'parsed' ? 'content' : format;
    let result = await readObject({
      fs,
      gitdir,
      oid,
      format: _format
    });
    result.oid = oid;
    if (format === 'parsed') {
      result.format = 'parsed';
      switch (result.type) {
        case 'commit':
          result.object = GitCommit.from(result.object).parse();
          break
        case 'tree':
          result.object = { entries: GitTree.from(result.object).entries() };
          break
        case 'blob':
          // Here we consider returning a raw Buffer as the 'content' format
          // and returning a string as the 'parsed' format
          if (encoding) {
            result.object = result.object.toString(encoding);
          } else {
            result.format = 'content';
          }
          break
        case 'tag':
          result.object = GitAnnotatedTag.from(result.object).parse();
          break
        default:
          throw new GitError(E.ObjectTypeUnknownFail, { type: result.type })
      }
    }
    return result
  } catch (err) {
    err.caller = 'git.readObject';
    throw err
  }
}

async function resolveFile ({ fs, gitdir, tree, pathArray, oid, filepath }) {
  let name = pathArray.shift();
  for (let entry of tree) {
    if (entry.path === name) {
      if (pathArray.length === 0) {
        return entry.oid
      } else {
        let { type, object } = await readObject({
          fs,
          gitdir,
          oid: entry.oid
        });
        if (type === 'blob') {
          throw new GitError(E.DirectoryIsAFileError, { oid, filepath })
        }
        if (type !== 'tree') {
          throw new GitError(E.ObjectTypeAssertionInTreeFail, {
            oid: entry.oid,
            entrypath: filepath,
            type
          })
        }
        tree = GitTree.from(object);
        return resolveFile({ fs, gitdir, tree, pathArray, oid, filepath })
      }
    }
  }
  throw new GitError(E.TreeOrBlobNotFoundError, { oid, filepath })
}

/**
 * Get the value of a symbolic ref or resolve a ref to its object id
 *
 * @link https://isomorphic-git.github.io/docs/resolveRef.html
 */
async function resolveRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref,
  depth
}) {
  try {
    const fs = new FileSystem(_fs);
    const oid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref,
      depth
    });
    return oid
  } catch (err) {
    err.caller = 'git.resolveRef';
    throw err
  }
}

/**
 * List all the files in the git index
 *
 * @link https://isomorphic-git.github.io/docs/listFiles.html
 */
async function listFiles ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref
}) {
  try {
    const fs = new FileSystem(_fs);
    let filenames;
    if (ref) {
      const oid = await resolveRef({ gitdir, fs, ref });
      filenames = [];
      await accumulateFilesFromOid({ gitdir, fs, oid, filenames, prefix: '' });
    } else {
      await GitIndexManager.acquire(
        { fs, filepath: `${gitdir}/index` },
        async function (index) {
          filenames = index.entries.map(x => x.path);
        }
      );
    }
    return filenames
  } catch (err) {
    err.caller = 'git.listFiles';
    throw err
  }
}

async function accumulateFilesFromOid ({ gitdir, fs, oid, filenames, prefix }) {
  const { object } = await readObject$1({ gitdir, fs, oid, filepath: '' });
  // Note: this isn't parallelized because I'm too lazy to figure that out right now
  for (const entry of object.entries) {
    if (entry.type === 'tree') {
      await accumulateFilesFromOid({
        gitdir,
        fs,
        oid: entry.oid,
        filenames,
        prefix: join(prefix, entry.path)
      });
    } else {
      filenames.push(join(prefix, entry.path));
    }
  }
}

/**
 * List remotes
 *
 * @link https://isomorphic-git.github.io/docs/listRemotes.html
 */
async function listRemotes ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs')
}) {
  try {
    const fs = new FileSystem(_fs);
    const config = await GitConfigManager.get({ fs, gitdir });
    const remoteNames = await config.getSubsections('remote');
    const remotes = Promise.all(
      remoteNames.map(async remote => {
        const url = await config.get(`remote.${remote}.url`);
        return { remote, url }
      })
    );
    return remotes
  } catch (err) {
    err.caller = 'git.listRemotes';
    throw err
  }
}

/**
 * List tags
 *
 * @link https://isomorphic-git.github.io/docs/listTags.html
 */
async function listTags ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs')
}) {
  try {
    const fs = new FileSystem(_fs);
    return GitRefManager.listTags({ fs, gitdir })
  } catch (err) {
    err.caller = 'git.listTags';
    throw err
  }
}

function compareAge (a, b) {
  return a.committer.timestamp - b.committer.timestamp
}

async function logCommit ({ fs, gitdir, oid, signing }) {
  try {
    let { type, object } = await readObject({ fs, gitdir, oid });
    if (type !== 'commit') {
      throw new GitError(E.ObjectTypeAssertionFail, {
        oid,
        expected: 'commit',
        type
      })
    }
    const commit = GitCommit.from(object);
    const result = Object.assign({ oid }, commit.parse());
    if (signing) {
      result.payload = commit.withoutSignature();
    }
    return result
  } catch (err) {
    return {
      oid,
      error: err
    }
  }
}

/**
 * Get commit descriptions from the git history
 *
 * @link https://isomorphic-git.github.io/docs/log.html
 */
async function log$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref = 'HEAD',
  depth,
  since, // Date
  signing = false
}) {
  try {
    const fs = new FileSystem(_fs);
    let sinceTimestamp =
      since === undefined ? undefined : Math.floor(since.valueOf() / 1000);
    // TODO: In the future, we may want to have an API where we return a
    // async iterator that emits commits.
    let commits = [];
    let shallowCommits = await GitShallowManager.read({ fs, gitdir });
    let oid = await GitRefManager.resolve({ fs, gitdir, ref });
    let tips /*: Array */ = [await logCommit({ fs, gitdir, oid, signing })];

    while (true) {
      let commit = tips.pop();

      // Stop the loop if we encounter an error
      if (commit.error) {
        commits.push(commit);
        break
      }

      // Stop the log if we've hit the age limit
      if (
        sinceTimestamp !== undefined &&
        commit.committer.timestamp <= sinceTimestamp
      ) {
        break
      }

      commits.push(commit);

      // Stop the loop if we have enough commits now.
      if (depth !== undefined && commits.length === depth) break

      // If this is not a shallow commit...
      if (!shallowCommits.has(commit.oid)) {
        // Add the parents of this commit to the queue
        // Note: for the case of a commit with no parents, it will concat an empty array, having no net effect.
        for (const oid of commit.parent) {
          let commit = await logCommit({ fs, gitdir, oid, signing });
          if (!tips.map(commit => commit.oid).includes(commit.oid)) {
            tips.push(commit);
          }
        }
      }

      // Stop the loop if there are no more commit parents
      if (tips.length === 0) break

      // Process tips in order by age
      tips.sort(compareAge);
    }
    return commits
  } catch (err) {
    err.caller = 'git.log';
    throw err
  }
}

async function hashObject ({ gitdir, type, object }) {
  return shasum(GitObject.wrap({ type, object }))
}

/**
 * Find diff of files between two trees with a common ancestor.
 *
 */
async function findChangedFiles ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourOid,
  theirOid,
  baseOid
}) {
  // Adapted from: http://gitlet.maryrosecook.com/docs/gitlet.html#section-220
  try {
    const fs = new FileSystem(_fs);
    let count = 0;
    return await walkBeta1({
      fs,
      dir,
      gitdir,
      trees: [
        TREE({ fs, gitdir, ref: ourOid }),
        TREE({ fs, gitdir, ref: theirOid }),
        TREE({ fs, gitdir, ref: baseOid })
      ],
      map: async function ([ours, theirs, base]) {
        if (ours.fullpath === '.') return

        if (emitter) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: 'Counting changes',
            loaded: ++count,
            lengthComputable: false
          });
        }

        return {
          status: await fileStatus(ours, theirs, base),
          ours: ours,
          theirs: theirs,
          base: base
        }
      }
    })
  } catch (err) {
    err.caller = 'git.findChangedFiles';
    throw err
  }
}

async function fileStatus (receiver, giver, base) {
  const receiverPresent = receiver.exists;
  const basePresent = base.exists;
  const giverPresent = base.exists;

  if ((!receiverPresent && !basePresent && giverPresent) ||
    (receiverPresent && !basePresent && !giverPresent)) {
    return 'added'
  } else if ((receiverPresent && basePresent && !giverPresent) ||
    (!receiverPresent && basePresent && giverPresent)) {
    return 'deleted'
  } else {
    if (receiverPresent) await receiver.populateHash();
    if (giverPresent) await giver.populateHash();

    if (receiver.oid === giver.oid) {
      return 'unmodified'
    } else {
      if (basePresent) await base.populateHash();
      if (receiverPresent && giverPresent && receiver.oid !== giver.oid) {
        if (receiver.oid !== base.oid && giver.oid !== base.oid) {
          return 'conflict'
        } else {
          return 'modified'
        }
      }
    }
  }
}

/**
 * Merge one or more branches (Currently, only fast-forward merges are implemented.)
 *
 * @link https://isomorphic-git.github.io/docs/merge.html
 */
async function merge ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourRef,
  theirRef,
  fastForwardOnly
}) {
  try {
    const fs = new FileSystem(_fs);
    if (ourRef === undefined) {
      ourRef = await currentBranch({ fs, gitdir, fullname: true });
    }
    ourRef = await GitRefManager.expand({
      fs,
      gitdir,
      ref: ourRef
    });
    theirRef = await GitRefManager.expand({
      fs,
      gitdir,
      ref: theirRef
    });
    let ourOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: ourRef
    });
    let theirOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: theirRef
    });
    // find most recent common ancestor of ref a and ref b (if there's more than 1, pick 1)
    let baseOid = (await findMergeBase({ gitdir, fs, oids: [ourOid, theirOid] }))[0];
    // handle fast-forward case
    if (!baseOid) {
      throw new GitError(E.MergeNoCommonAncestryError, { theirRef, ourRef })
    } else if (baseOid === theirOid) {
      return {
        oid: ourOid,
        alreadyMerged: true
      }
    } else if (baseOid === ourOid) {
      await GitRefManager.writeRef({ fs, gitdir, ref: ourRef, value: theirOid });
      await checkout({
        dir,
        gitdir,
        fs,
        ref: ourRef,
        emitter,
        emitterPrefix
      });
      return {
        oid: theirOid,
        fastForward: true
      }
    } else {
      // not a simple fast-forward
      if (fastForwardOnly) {
        throw new GitError(E.FastForwardFail)
      }

      await GitRefManager.writeRef({ fs, gitdir, ref: 'MERGE_HEAD', value: theirOid });

      // for each file, determine whether it is present or absent or modified (see http://gitlet.maryrosecook.com/docs/gitlet.html#section-217)
      let mergeDiff = await findChangedFiles({
        fs,
        gitdir,
        dir,
        emitter,
        emitterPrefix,
        ourOid,
        theirOid,
        baseOid
      });

      await fs.write(join(gitdir, 'MERGE_MSG'), mergeMessage(ourRef, theirRef, mergeDiff), 'utf8');

      await GitIndexManager.acquire(
        { fs, filepath: `${gitdir}/index` },
        async function (index) {
          const total = mergeDiff.length;
          let count = 0;

          for (let diff of mergeDiff) {
            let { ours, theirs, base } = diff;
            // for simple cases of add, remove, or modify files
            switch (diff.status) {
              case 'added':
                let added = ours.exists ? ours : theirs;
                await added.populateHash();
                await added.populateStat();
                await added.populateContent();
                const { fullpath, stats, contents, oid } = added;
                index.insert({ filepath: fullpath, stats, oid });
                await fs.write(`${dir}/${fullpath}`, contents);
                break
              case 'deleted':
                index.delete({ filepath: base.fullpath });
                await fs.rm(`${dir}/${base.fullpath}`);
                break
              case 'modified':
                if (theirs.oid !== base.oid) {
                  await theirs.populateStat();
                  await theirs.populateContent();
                  let { fullpath, stats, contents, oid } = theirs;
                  index.insert({ filepath: fullpath, stats, oid });
                  await fs.write(`${dir}/${fullpath}`, contents);
                }
                break
              case 'conflict':
                await ours.populateContent();
                await theirs.populateContent();
                await base.populateContent();
                await base.populateStat();

                let merged = await diff3.merge(ours.content, base.content, theirs.content);
                let { baseFullpath, baseOid, baseStats } = base;
                let mergedText = merged.result.join('\n');

                if (merged.conflict) {
                  index.writeConflict({
                    filepath: baseFullpath,
                    stats: baseStats,
                    ourOid: ours.oid,
                    theirOid: theirs.oid,
                    baseOid
                  });
                  emitter.emit(`${emitterPrefix}conflict`, {
                    filepath: baseFullpath,
                    ourOid: ours.oid,
                    theirOid: theirs.oid,
                    baseOid
                  });
                } else {
                  let oid = await hashObject({
                    gitdir,
                    type: 'blob',
                    object: mergedText
                  });
                  index.insert({ filepath: baseFullpath, stats, oid });
                }
                await fs.write(`${dir}/${baseFullpath}`, mergedText);
                break
            }

            if (emitter) {
              emitter.emit(`${emitterPrefix}progress`, {
                phase: 'Applying changes',
                loaded: ++count,
                total,
                lengthComputable: true
              });
            }
          }
        }
      );
    }
  } catch (err) {
    err.caller = 'git.merge';
    throw err
  }
}

async function mergeMessage ({ ourRef, theirRef, mergeDiff }) {
  let msg = `Merge ${theirRef} into ${ourRef}`;
  let conflicts = mergeDiff.filter(function (d) { return d.status === 'conflict' });
  if (conflicts.length > 0) {
    msg += '\nConflicts:\n' + conflicts.join('\n');
  }
  return msg
}

// import diff3 from 'node-diff3'

/**
 * Fetch and merge commits from a remote repository
 *
 * @link https://isomorphic-git.github.io/docs/pull.html
 */
async function pull ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref,
  fastForwardOnly = false,
  noGitSuffix = false,
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  authUsername,
  authPassword,
  username = authUsername,
  password = authPassword,
  token,
  oauth2format,
  singleBranch,
  headers = {}
}) {
  try {
    const fs = new FileSystem(_fs);
    // If ref is undefined, use 'HEAD'
    if (!ref) {
      ref = await currentBranch({ fs, gitdir });
    }
    // Fetch from the correct remote.
    let remote = await config({
      gitdir,
      fs,
      path: `branch.${ref}.remote`
    });
    let { fetchHead } = await fetch({
      dir,
      gitdir,
      fs,
      emitter,
      emitterPrefix,
      noGitSuffix,
      ref,
      remote,
      username,
      password,
      token,
      oauth2format,
      singleBranch,
      headers
    });
    // Merge the remote tracking branch into the local one.
    await merge({
      dir,
      gitdir,
      fs,
      ourRef: ref,
      theirRef: fetchHead,
      fastForwardOnly,
      emitter,
      emitterPrefix
    });
  } catch (err) {
    err.caller = 'git.pull';
    throw err
  }
}

async function parseReceivePackResponse (packfile) {
  let result = {};
  let response = '';
  let read = GitPktLine.streamReader(packfile);
  let line = await read();
  while (line !== true) {
    if (line !== null) response += line.toString('utf8') + '\n';
    line = await read();
  }

  let lines = response.toString('utf8').split('\n');
  // We're expecting "unpack {unpack-result}"
  line = lines.shift();
  if (!line.startsWith('unpack ')) {
    throw new GitError(E.UnparseableServerResponseFail, { line })
  }
  if (line === 'unpack ok') {
    result.ok = ['unpack'];
  } else {
    result.errors = [line.trim()];
  }
  for (let line of lines) {
    let status = line.slice(0, 2);
    let refAndMessage = line.slice(3);
    if (status === 'ok') {
      result.ok = result.ok || [];
      result.ok.push(refAndMessage);
    } else if (status === 'ng') {
      result.errors = result.errors || [];
      result.errors.push(refAndMessage);
    }
  }
  return result
}

async function writeReceivePackRequest ({
  capabilities = [],
  triplets = []
}) {
  let packstream = [];
  let capsFirstLine = `\x00 ${capabilities.join(' ')}`;
  for (let trip of triplets) {
    packstream.push(
      GitPktLine.encode(
        `${trip.oldoid} ${trip.oid} ${trip.fullRef}${capsFirstLine}\n`
      )
    );
    capsFirstLine = '';
  }
  packstream.push(GitPktLine.flush());
  return packstream
}

async function listCommitsAndTags ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  start,
  finish
}) {
  const fs = new FileSystem(_fs);
  let startingSet = new Set();
  let finishingSet = new Set();
  for (let ref of start) {
    startingSet.add(await GitRefManager.resolve({ fs, gitdir, ref }));
  }
  for (let ref of finish) {
    // We may not have these refs locally so we must try/catch
    try {
      let oid = await GitRefManager.resolve({ fs, gitdir, ref });
      finishingSet.add(oid);
    } catch (err) {}
  }
  let visited = new Set();
  // Because git commits are named by their hash, there is no
  // way to construct a cycle. Therefore we won't worry about
  // setting a default recursion limit.
  async function walk (oid) {
    visited.add(oid);
    let { type, object } = await readObject({ fs, gitdir, oid });
    // Recursively resolve annotated tags
    if (type === 'tag') {
      let tag = GitAnnotatedTag.from(object);
      let commit = tag.headers().object;
      return walk(commit)
    }
    if (type !== 'commit') {
      throw new GitError(E.ObjectTypeAssertionFail, {
        oid,
        type,
        expected: 'commit'
      })
    }
    let commit = GitCommit.from(object);
    let parents = commit.headers().parent;
    for (oid of parents) {
      if (!finishingSet.has(oid) && !visited.has(oid)) {
        await walk(oid);
      }
    }
  }
  // Let's go walking!
  for (let oid of startingSet) {
    await walk(oid);
  }
  return visited
}

async function listObjects ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  oids
}) {
  const fs = new FileSystem(_fs);
  let visited = new Set();
  // We don't do the purest simplest recursion, because we can
  // avoid reading Blob objects entirely since the Tree objects
  // tell us which oids are Blobs and which are Trees.
  async function walk (oid) {
    visited.add(oid);
    let { type, object } = await readObject({ fs, gitdir, oid });
    if (type === 'tag') {
      let tag = GitAnnotatedTag.from(object);
      let obj = tag.headers().object;
      await walk(obj);
    } else if (type === 'commit') {
      let commit = GitCommit.from(object);
      let tree = commit.headers().tree;
      await walk(tree);
    } else if (type === 'tree') {
      let tree = GitTree.from(object);
      for (let entry of tree) {
        // only add blobs and trees to the set,
        // skipping over submodules whose type is 'commit'
        if (entry.type === 'blob' || entry.type === 'tree') {
          visited.add(entry.oid);
        }
        // only recurse for trees
        if (entry.type === 'tree') {
          await walk(entry.oid);
        }
      }
    }
  }
  // Let's go walking!
  for (let oid of oids) {
    await walk(oid);
  }
  return visited
}

const types = {
  commit: 0b0010000,
  tree: 0b0100000,
  blob: 0b0110000,
  tag: 0b1000000,
  ofs_delta: 0b1100000,
  ref_delta: 0b1110000
};

async function pack ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  oids
}) {
  const fs = new FileSystem(_fs);
  let hash = new Hash();
  let outputStream = [];
  function write (chunk, enc) {
    let buff = Buffer.from(chunk, enc);
    outputStream.push(buff);
    hash.update(buff);
  }
  function writeObject ({ stype, object }) {
    let lastFour, multibyte, length;
    // Object type is encoded in bits 654
    let type = types[stype];
    // The length encoding gets complicated.
    length = object.length;
    // Whether the next byte is part of the variable-length encoded number
    // is encoded in bit 7
    multibyte = length > 0b1111 ? 0b10000000 : 0b0;
    // Last four bits of length is encoded in bits 3210
    lastFour = length & 0b1111;
    // Discard those bits
    length = length >>> 4;
    // The first byte is then (1-bit multibyte?), (3-bit type), (4-bit least sig 4-bits of length)
    let byte = (multibyte | type | lastFour).toString(16);
    write(byte, 'hex');
    // Now we keep chopping away at length 7-bits at a time until its zero,
    // writing out the bytes in what amounts to little-endian order.
    while (multibyte) {
      multibyte = length > 0b01111111 ? 0b10000000 : 0b0;
      byte = multibyte | (length & 0b01111111);
      write(padHex(2, byte), 'hex');
      length = length >>> 7;
    }
    // Lastly, we can compress and write the object.
    write(Buffer.from(pako.deflate(object)));
  }
  write('PACK');
  write('00000002', 'hex');
  // Write a 4 byte (32-bit) int
  write(padHex(8, oids.length), 'hex');
  for (let oid of oids) {
    let { type, object } = await readObject({ fs, gitdir, oid });
    writeObject({ write, object, stype: type });
  }
  // Write SHA1 checksum
  let digest = hash.digest();
  outputStream.push(digest);
  return outputStream
}

/**
 * Push a branch or tag
 *
 * @link https://isomorphic-git.github.io/docs/push.html
 */
async function push ({
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
    const fs = new FileSystem(_fs);
    // TODO: Figure out how pushing tags works. (This only works for branches.)
    if (url === undefined) {
      url = await config({ fs, gitdir, path: `remote.${remote}.url` });
    }
    if (corsProxy === undefined) {
      corsProxy = await config({ fs, gitdir, path: 'http.corsProxy' });
    }
    let fullRef;
    if (!ref) {
      fullRef = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: 'HEAD',
        depth: 2
      });
    } else {
      fullRef = await GitRefManager.expand({ fs, gitdir, ref });
    }
    let oid = await GitRefManager.resolve({ fs, gitdir, ref: fullRef });
    let auth = { username, password, token, oauth2format };
    let GitRemoteHTTP = GitRemoteManager.getRemoteHelperFor({ url });
    const httpRemote = await GitRemoteHTTP.discover({
      core,
      corsProxy,
      service: 'git-receive-pack',
      url,
      noGitSuffix,
      auth,
      headers
    });
    auth = httpRemote.auth; // hack to get new credentials from CredentialManager API
    let fullRemoteRef;
    if (!remoteRef) {
      fullRemoteRef = fullRef;
    } else {
      try {
        fullRemoteRef = await GitRefManager.expandAgainstMap({
          ref: remoteRef,
          map: httpRemote.refs
        });
      } catch (err) {
        if (err.code === E.ExpandRefError) {
          // The remote reference doesn't exist yet.
          // If it is fully specified, use that value. Otherwise, treat it as a branch.
          fullRemoteRef = remoteRef.startsWith('refs/')
            ? remoteRef
            : `refs/heads/${remoteRef}`;
        } else {
          throw err
        }
      }
    }
    let emptyOid = '0000000000000000000000000000000000000000';
    let oldoid =
      httpRemote.refs.get(fullRemoteRef) || emptyOid;
    let finish = [...httpRemote.refs.values()];
    // hack to speed up common force push scenarios
    let mergebase = await findMergeBase({ fs, gitdir, oids: [oid, oldoid] });
    for (let oid of mergebase) finish.push(oid);
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
    });
    let objects = await listObjects({ fs, gitdir, oids: commits });
    // We can only safely use capabilities that the server also understands.
    // For instance, AWS CodeCommit aborts a push if you include the `agent`!!!
    const capabilities = filterCapabilities(
      [...httpRemote.capabilities],
      ['report-status', 'side-band-64k', `agent=${pkg.agent}`]
    );
    let packstream1 = await writeReceivePackRequest({
      capabilities,
      triplets: [{ oldoid, oid, fullRef: fullRemoteRef }]
    });
    let packstream2 = await pack({
      fs,
      gitdir,
      oids: [...objects]
    });
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
    });
    let { packfile, progress } = await GitSideBand.demux(res.body);
    if (emitter) {
      let lines = splitLines(progress);
      forAwait(lines, line => {
        emitter.emit(`${emitterPrefix}message`, line);
      });
    }
    // Parse the response!
    let result = await parseReceivePackResponse(packfile);
    if (res.headers) {
      result.headers = res.headers;
    }
    return result
  } catch (err) {
    err.caller = 'git.push';
    throw err
  }
}

/**
 * Remove a file from the git index (aka staging area)
 *
 * Note that this does NOT delete the file in the working directory.
 *
 * @link https://isomorphic-git.github.io/docs/remove.html
 */
async function remove ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  filepath
}) {
  try {
    const fs = new FileSystem(_fs);
    await GitIndexManager.acquire(
      { fs, filepath: `${gitdir}/index` },
      async function (index) {
        index.delete({ filepath });
      }
    );
    // TODO: return oid?
  } catch (err) {
    err.caller = 'git.remove';
    throw err
  }
}

/**
 * Reset a file in the git index (aka staging area)
 *
 * @link https://isomorphic-git.github.io/docs/resetIndex.html
 */
async function resetIndex ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  filepath,
  ref = 'HEAD'
}) {
  try {
    const fs = new FileSystem(_fs);
    // Resolve commit
    let oid = await GitRefManager.resolve({ fs, gitdir, ref });
    let workdirOid;
    try {
      // Resolve blob
      const obj = await readObject$1({
        gitdir,
        fs,
        oid,
        filepath,
        format: 'deflated'
      });
      oid = obj && obj.oid;
    } catch (e) {
      // This means we're resetting the file to a "deleted" state
      oid = null;
    }
    // For files that aren't in the workdir use zeros
    let stats = {
      ctime: new Date(0),
      mtime: new Date(0),
      dev: 0,
      ino: 0,
      mode: 0,
      uid: 0,
      gid: 0,
      size: 0
    };
    // If the file exists in the workdir...
    const object = dir && (await fs.read(join(dir, filepath)));
    if (object) {
      // ... and has the same hash as the desired state...
      workdirOid = await hashObject({
        gitdir,
        type: 'blob',
        object
      });
      if (oid === workdirOid) {
        // ... use the workdir Stats object
        stats = await fs.lstat(join(dir, filepath));
      }
    }
    await GitIndexManager.acquire(
      { fs, filepath: `${gitdir}/index` },
      async function (index) {
        index.delete({ filepath });
        if (oid) {
          index.insert({ filepath, stats, oid });
        }
      }
    );
  } catch (err) {
    err.caller = 'git.reset';
    throw err
  }
}

class SignedGitCommit extends GitCommit {
  static from (commit) {
    return new SignedGitCommit(commit)
  }
  async sign (openpgp, privateKeys) {
    let commit = this.withoutSignature();
    let headers = GitCommit.justHeaders(this._commit);
    let message = GitCommit.justMessage(this._commit);
    let privKeyObj = openpgp.key.readArmored(privateKeys).keys;
    let { signature } = await openpgp.sign({
      data: openpgp.util.str2Uint8Array(commit),
      privateKeys: privKeyObj,
      detached: true,
      armor: true
    });
    // renormalize the line endings to the one true line-ending
    signature = normalizeNewlines(signature);
    let signedCommit =
      headers + '\n' + 'gpgsig' + indent(signature) + '\n' + message;
    // return a new commit object
    return GitCommit.from(signedCommit)
  }

  async listSigningKeys (openpgp) {
    let msg = openpgp.message.readSignedContent(
      this.withoutSignature(),
      this.isolateSignature()
    );
    return msg.getSigningKeyIds().map(keyid => keyid.toHex())
  }

  async verify (openpgp, publicKeys) {
    let pubKeyObj = openpgp.key.readArmored(publicKeys).keys;
    let msg = openpgp.message.readSignedContent(
      this.withoutSignature(),
      this.isolateSignature()
    );
    let results = msg.verify(pubKeyObj);
    let validity = results.reduce((a, b) => a.valid && b.valid, { valid: true });
    return validity
  }
}

/**
 * Create a signed commit
 *
 * @link https://isomorphic-git.github.io/docs/sign.html
 */
async function sign ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  privateKeys,
  openpgp
}) {
  try {
    const fs = new FileSystem(_fs);
    const oid = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' });
    const { type, object } = await readObject({ fs, gitdir, oid });
    if (type !== 'commit') {
      throw new GitError(E.ObjectTypeAssertionInRefFail, {
        expected: 'commit',
        ref: 'HEAD',
        type
      })
    }
    let commit;
    if (openpgp) {
      // Old API
      commit = SignedGitCommit.from(object);
      commit = await commit.sign(openpgp, privateKeys);
    } else {
      // Newer plugin API
      let pgp = cores.get(core).get('pgp');
      commit = GitCommit.from(object);
      commit = await GitCommit.sign(commit, pgp, privateKeys);
    }
    const newOid = await writeObject({
      fs,
      gitdir,
      type: 'commit',
      object: commit.toObject()
    });
    // Update branch pointer
    // TODO: Use an updateBranch function instead of this.
    const branch = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: 'HEAD',
      depth: 2
    });
    await fs.write(join(gitdir, branch), newOid + '\n');
  } catch (err) {
    err.caller = 'git.sign';
    throw err
  }
}

/**
 * Tell whether a file has been changed
 *
 * @link https://isomorphic-git.github.io/docs/status.html
 */
async function status ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  filepath
}) {
  try {
    const fs = new FileSystem(_fs);
    let ignored = await GitIgnoreManager.isIgnored({
      gitdir,
      dir,
      filepath,
      fs
    });
    if (ignored) {
      return 'ignored'
    }
    let headTree = await getHeadTree({ fs, gitdir });
    let treeOid = await getOidAtPath({
      fs,
      gitdir,
      tree: headTree,
      path: filepath
    });
    let indexEntry;
    let conflictEntry;
    // Acquire a lock on the index
    await GitIndexManager.acquire(
      { fs, filepath: `${gitdir}/index` },
      async function (index) {
        indexEntry = index.entriesMap.get(GitIndex.key(filepath, 0));
        conflictEntry = index.entriesMap.get(GitIndex.key(filepath, 2));
      }
    );
    let stats = await fs.lstat(join(dir, filepath));

    let H = treeOid !== null; // head
    let I = !!indexEntry; // index
    let W = stats !== null; // working dir
    let C = !!conflictEntry; // in conflict

    const getWorkdirOid = async () => {
      if (I && !compareStats(indexEntry, stats)) {
        return indexEntry.oid
      } else {
        let object = await fs.read(join(dir, filepath));
        let workdirOid = await hashObject({
          gitdir,
          type: 'blob',
          object
        });
        // If the oid in the index === working dir oid but stats differed update cache
        if (I && indexEntry.oid === workdirOid) {
          // and as long as our fs.stats aren't bad.
          // size of -1 happens over a BrowserFS HTTP Backend that doesn't serve Content-Length headers
          // (like the Karma webserver) because BrowserFS HTTP Backend uses HTTP HEAD requests to do fs.stat
          if (stats.size !== -1) {
            // We don't await this so we can return faster for one-off cases.
            GitIndexManager.acquire(
              { fs, filepath: `${gitdir}/index` },
              async function (index) {
                index.insert({ filepath, stats, oid: workdirOid });
              }
            );
          }
        }
        return workdirOid
      }
    };

    let prefix = C ? '!' : '';
    if (!H && !W && !I) return prefix + 'absent' // ---
    if (!H && !W && I) return prefix + '*absent' // -A-
    if (!H && W && !I) return prefix + '*added' // --A
    if (!H && W && I) {
      let workdirOid = await getWorkdirOid();
      return prefix + (workdirOid === indexEntry.oid ? 'added' : '*added') // -AA : -AB
    }
    if (H && !W && !I) return prefix + 'deleted' // A--
    if (H && !W && I) {
      return prefix + (treeOid === indexEntry.oid ? '*deleted' : '*deleted') // AA- : AB-
    }
    if (H && W && !I) {
      let workdirOid = await getWorkdirOid();
      return prefix + (workdirOid === treeOid ? '*undeleted' : '*undeletemodified') // A-A : A-B
    }
    if (H && W && I) {
      let workdirOid = await getWorkdirOid();
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
    err.caller = 'git.status';
    throw err
  }
}

async function getOidAtPath ({ fs, gitdir, tree, path }) {
  if (typeof path === 'string') path = path.split('/');
  let dirname = path.shift();
  for (let entry of tree) {
    if (entry.path === dirname) {
      if (path.length === 0) {
        return entry.oid
      }
      let { type, object } = await readObject({
        fs,
        gitdir,
        oid: entry.oid
      });
      if (type === 'tree') {
        let tree = GitTree.from(object);
        return getOidAtPath({ fs, gitdir, tree, path })
      }
      if (type === 'blob') {
        throw new GitError(E.ObjectTypeAssertionInPathFail, {
          oid: entry.oid,
          path: path.join('/')
        })
      }
    }
  }
  return null
}

async function getHeadTree ({ fs, gitdir }) {
  // Get the tree from the HEAD commit.
  let oid = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' });
  let { type, object } = await readObject({ fs, gitdir, oid });
  if (type !== 'commit') {
    throw new GitError(E.ResolveCommitError, { oid })
  }
  let commit = GitCommit.from(object);
  oid = commit.parseHeaders().tree;
  return getTree({ fs, gitdir, oid })
}

async function getTree ({ fs, gitdir, oid }) {
  let { type, object } = await readObject({
    fs,
    gitdir,
    oid
  });
  if (type !== 'tree') {
    throw new GitError(E.ResolveTreeError, { oid })
  }
  let tree = GitTree.from(object).entries();
  return tree
}

class GitWalkerIndex {
  constructor ({ fs: _fs, gitdir }) {
    const fs = new FileSystem(_fs);
    this.treePromise = (async () => {
      let result;
      await GitIndexManager.acquire(
        { fs, filepath: `${gitdir}/index` },
        async function (index) {
          result = flatFileListToDirectoryStructure(index.entries);
          const conflicts = index.conflictedPaths;
          for (let path of conflicts) {
            let inode = result.get(path);
            if (inode) inode.conflict = true;
          }
        }
      );
      return result
    })();
    let walker = this;
    this.ConstructEntry = class IndexEntry {
      constructor (entry) {
        Object.assign(this, entry);
      }
      async populateStat () {
        if (!this.exists) return
        await walker.populateStat(this);
      }
      async populateContent () {
        if (!this.exists) return
        await walker.populateContent(this);
      }
      async populateHash () {
        if (!this.exists) return
        await walker.populateHash(this);
      }
    };
  }
  async readdir (entry) {
    if (!entry.exists) return []
    let filepath = entry.fullpath;
    let tree = await this.treePromise;
    let inode = tree.get(filepath);
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
    let tree = await this.treePromise;
    let inode = tree.get(entry.fullpath);
    if (!inode) {
      throw new Error(
        `ENOENT: no such file or directory, lstat '${entry.fullpath}'`
      )
    }
    let stats = inode.type === 'tree' ? {} : normalizeStats(inode.metadata);
    Object.assign(entry, { type: inode.type }, stats);
  }
  async populateContent (entry) {
    // Cannot get content for an index entry
  }
  async populateHash (entry) {
    let tree = await this.treePromise;
    let inode = tree.get(entry.fullpath);
    if (!inode) return null
    if (inode.type === 'tree') {
      throw new Error(`EISDIR: illegal operation on a directory, read`)
    }
    Object.assign(entry, {
      oid: inode.metadata.oid
    });
  }
}

function STAGE ({ fs, gitdir }) {
  let o = Object.create(null);
  Object.defineProperty(o, GitWalkerSymbol, {
    value: function () {
      return new GitWalkerIndex({ fs, gitdir })
    }
  });
  Object.freeze(o);
  return o
}

const patternRoot = pattern => {
  // return pattern.split('*', 1)[0]
  const base = globalyzer(pattern).base;
  return base === '.' ? '' : base
};

const worthWalking = (filepath, root) => {
  if (root.length === 0) return true
  if (root.length >= filepath.length) {
    return root.startsWith(filepath)
  } else {
    return filepath.startsWith(root)
  }
};

/**
 * Summarize the differences between a commit, the working dir, and the stage
 *
 * @link https://isomorphic-git.github.io/docs/statusMatrix.html
 */
async function statusMatrix ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref = 'HEAD',
  pattern = null
}) {
  try {
    const fs = new FileSystem(_fs);
    let count = 0;
    let patternGlobrex =
      pattern && globrex(pattern, { globstar: true, extended: true });
    let patternBase = pattern && patternRoot(pattern);
    let results = await walkBeta1({
      fs,
      dir,
      gitdir,
      trees: [
        TREE({ fs, gitdir, ref }),
        WORKDIR({ fs, dir, gitdir }),
        STAGE({ fs, gitdir })
      ],
      filter: async function ([head, workdir, stage]) {
        // We need an awkward exception for the root directory
        if (head.fullpath === '.') return true
        // Ignore ignored files, but only if they are not already tracked.
        if (!head.exists && !stage.exists && workdir.exists) {
          if (
            await GitIgnoreManager.isIgnored({
              fs,
              dir,
              filepath: workdir.fullpath
            })
          ) {
            return false
          }
        }
        // match against 'pattern' parameter
        if (pattern === null) return true
        return worthWalking(head.fullpath, patternBase)
      },
      map: async function ([head, workdir, stage]) {
        // Late filter against file names
        if (patternGlobrex && !patternGlobrex.regex.test(head.fullpath)) return
        // For now, just bail on directories
        await stage.populateStat();
        if (stage.type === 'tree') return
        await workdir.populateStat();
        if (workdir.type === 'tree') return
        await head.populateStat();
        if (head.type === 'tree') return
        // Figure out the oids, using the staged oid for the working dir oid if the stats match.
        await head.populateHash();
        await stage.populateHash();
        if (!head.exists && workdir.exists && !stage.exists) {
          // We don't actually NEED the sha. Any sha will do
          // TODO: update this logic to handle N trees instead of just 3.
          workdir.oid = 42;
        } else if (workdir.exists) {
          await workdir.populateHash();
        }
        if (emitter) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: 'Calculating status',
            loaded: ++count,
            lengthComputable: false
          });
        }
        let entry = [undefined, head.oid, workdir.oid, stage.oid];
        let result = entry.map(value => entry.indexOf(value));
        result.shift(); // remove leading undefined entry
        let fullpath = head.fullpath || workdir.fullpath || stage.fullpath;
        return [fullpath, ...result, !!stage.conflict]
      }
    });
    return results
  } catch (err) {
    err.caller = 'git.statusMatrix';
    throw err
  }
}

/**
 * Create a lightweight tag.
 *
 * @link https://isomorphic-git.github.io/docs/tag.html
 */
async function tag ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref,
  object,
  force = false
}) {
  try {
    const fs = new FileSystem(_fs);

    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'tag',
        parameter: 'ref'
      })
    }

    ref = ref.startsWith('refs/tags/') ? ref : `refs/tags/${ref}`;

    // Resolve passed object
    let value = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: object || 'HEAD'
    });

    if (!force && (await GitRefManager.exists({ fs, gitdir, ref }))) {
      throw new GitError(E.RefExistsError, { noun: 'tag', ref })
    }

    await GitRefManager.writeRef({ fs, gitdir, ref, value });
  } catch (err) {
    err.caller = 'git.tag';
    throw err
  }
}

/**
 * Verify a signed commit or tag
 *
 * @link https://isomorphic-git.github.io/docs/verify.html
 */
async function verify ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref,
  publicKeys,
  openpgp
}) {
  try {
    const fs = new FileSystem(_fs);
    const oid = await GitRefManager.resolve({ fs, gitdir, ref });
    const { type, object } = await readObject({ fs, gitdir, oid });
    if (type !== 'commit' && type !== 'tag') {
      throw new GitError(E.ObjectTypeAssertionInRefFail, {
        expected: 'commit/tag',
        ref,
        type
      })
    }
    if (openpgp) {
      // Old API
      let commit = SignedGitCommit.from(object);
      let keys = await commit.listSigningKeys(openpgp);
      let validity = await commit.verify(openpgp, publicKeys);
      if (!validity) return false
      return keys
    } else {
      // Newer plugin API
      let pgp = cores.get(core).get('pgp');
      if (type === 'commit') {
        let commit = GitCommit.from(object);
        let { valid, invalid } = await GitCommit.verify(commit, pgp, publicKeys);
        if (invalid.length > 0) return false
        return valid
      } else if (type === 'tag') {
        let tag = GitAnnotatedTag.from(object);
        let { valid, invalid } = await GitAnnotatedTag.verify(
          tag,
          pgp,
          publicKeys
        );
        if (invalid.length > 0) return false
        return valid
      }
    }
  } catch (err) {
    err.caller = 'git.verify';
    throw err
  }
}

/**
 * Return the version number of isomorphic-git
 *
 * @link https://isomorphic-git.github.io/docs/version.html
 */
function version () {
  try {
    return pkg.version
  } catch (err) {
    err.caller = 'git.version';
    throw err
  }
}

/**
 * Write a git object directly to a repository
 *
 * @link https://isomorphic-git.github.io/docs/writeObject.html
 */
async function writeObject$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  type,
  object,
  format = 'parsed',
  oid,
  encoding = undefined
}) {
  try {
    const fs = new FileSystem(_fs);
    // Convert object to buffer
    if (format === 'parsed') {
      switch (type) {
        case 'commit':
          object = GitCommit.from(object).toObject();
          break
        case 'tree':
          object = GitTree.from(object.entries).toObject();
          break
        case 'blob':
          object = Buffer.from(object, encoding);
          break
        case 'tag':
          object = GitAnnotatedTag.from(object).toObject();
          break
        default:
          throw new GitError(E.ObjectTypeUnknownFail, { type })
      }
    }
    // GitObjectManager does not know how to parse content, so we tweak that parameter before passing it.
    const _format = format === 'parsed' ? 'content' : format;
    oid = await writeObject({
      fs,
      gitdir,
      type,
      object,
      oid,
      format: _format
    });
    return oid
  } catch (err) {
    err.caller = 'git.writeObject';
    throw err
  }
}

/**
 * Write a ref.
 *
 * @link https://isomorphic-git.github.io/docs/writeRef.html
 */
async function writeRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref,
  value,
  force = false,
  symbolic = false
}) {
  try {
    const fs = new FileSystem(_fs);

    if (ref !== cleanGitRef.clean(ref)) {
      throw new GitError(E.InvalidRefNameError, {
        verb: 'write',
        noun: 'ref',
        ref,
        suggestion: cleanGitRef.clean(ref)
      })
    }

    if (!force && (await GitRefManager.exists({ fs, gitdir, ref }))) {
      throw new GitError(E.RefExistsError, { noun: 'ref', ref })
    }

    if (symbolic) {
      await GitRefManager.writeSymbolicRef({
        fs,
        gitdir,
        ref,
        value
      });
    } else {
      value = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: value
      });
      await GitRefManager.writeRef({
        fs,
        gitdir,
        ref,
        value
      });
    }
  } catch (err) {
    err.caller = 'git.writeRef';
    throw err
  }
}

const utils = { auth, oauth2 };

export { utils, E, add, addRemote, annotatedTag, branch, checkout, clone, commit, config, currentBranch, deleteBranch, deleteRef, deleteRemote, deleteTag, expandOid$1 as expandOid, expandRef, fetch, findMergeBase, findRoot, getRemoteInfo, indexPack, init, isDescendent, listBranches, listFiles, listRemotes, listTags, log$1 as log, merge, pull, push, readObject$1 as readObject, remove, resetIndex, resolveRef, sign, status, statusMatrix, tag, verify, version, walkBeta1, writeObject$1 as writeObject, writeRef, WORKDIR, STAGE, TREE, plugins, cores };
