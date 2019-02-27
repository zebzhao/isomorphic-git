import pify from 'pify';
import nick from 'nick';
import pako from 'pako';
import crc32 from 'crc-32';
import applyDelta from 'git-apply-delta';
import { mark, stop } from 'marky';
import Hash from 'sha.js/sha1';
import ignore from 'ignore';
import AsyncLock from 'async-lock';
import _path from 'path';

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

async function readObjectLoose ({ fs: _fs, gitdir, oid }) {
  const fs = new FileSystem(_fs);
  let source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  let file = await fs.read(`${gitdir}/${source}`);
  if (!file) {
    return null
  }
  return { object: file, format: 'deflated', source }
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

// This is modeled after @dominictarr's "shasum" module,
// but without the 'json-stable-stringify' dependency and
// extra type-casting features.
function shasum (buffer) {
  return new Hash().update(buffer).digest('hex')
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

function parseBuffer (buffer) {
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
      this._entries = parseBuffer(entries);
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

function padHex (b, n) {
  let s = n.toString(16);
  return '0'.repeat(b - s.length) + s
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

const pkg = {
  name: 'isomorphic-git',
  version: '0.0.0-development',
  agent: 'git/isomorphic-git@0.0.0-development'
};

async function writeRefsAdResponse ({ capabilities, refs, symrefs }) {
  let stream = [];
  // Compose capabilities string
  let syms = '';
  for (const [key, value] of Object.entries(symrefs)) {
    syms += `symref=${key}:${value} `;
  }
  let caps = `\x00${[...capabilities].join(' ')} ${syms}agent=${pkg.agent}`;
  // stream.write(GitPktLine.encode(`# service=${service}\n`))
  // stream.write(GitPktLine.flush())
  // Note: In the edge case of a brand new repo, zero refs (and zero capabilities)
  // are returned.
  for (const [key, value] of Object.entries(refs)) {
    stream.push(GitPktLine.encode(`${value} ${key}${caps}\n`));
    caps = '';
  }
  stream.push(GitPktLine.flush());
  return stream
}

async function uploadPack ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  advertiseRefs = false
}) {
  const fs = new FileSystem(_fs);
  try {
    if (advertiseRefs) {
      // Send a refs advertisement
      const capabilities = [
        'thin-pack',
        'side-band',
        'side-band-64k',
        'shallow',
        'deepen-since',
        'deepen-not',
        'allow-tip-sha1-in-want',
        'allow-reachable-sha1-in-want'
      ];
      let keys = await GitRefManager.listRefs({
        fs,
        gitdir,
        filepath: 'refs'
      });
      keys = keys.map(ref => `refs/${ref}`);
      const refs = {};
      keys.unshift('HEAD'); // HEAD must be the first in the list
      for (const key of keys) {
        refs[key] = await GitRefManager.resolve({ fs, gitdir, ref: key });
      }
      const symrefs = {};
      symrefs['HEAD'] = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: 'HEAD',
        depth: 2
      });
      return writeRefsAdResponse({
        capabilities,
        refs,
        symrefs
      })
    }
  } catch (err) {
    err.caller = 'git.uploadPack';
    throw err
  }
}

function basename (path) {
  let last = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (last > -1) {
    path = path.slice(last + 1);
  }
  return path
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

function parseBuffer$1 (buffer) {
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
      this._entries = parseBuffer$1(index);
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

function calculateBasicAuthHeader ({ username, password }) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
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

// This module is necessary because Webpack doesn't ship with

const path = _path.posix === undefined ? _path : _path.posix;

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

// This is part of an elaborate system to facilitate code-splitting / tree-shaking.
// commands/walk.js can depend on only this, and the actual Walker classes exported
// can be opaque - only having a single property (this symbol) that is not enumerable,
// and thus the constructor can be passed as an argument to walk while being "unusable"
// outside of it.
const GitWalkerSymbol = Symbol('GitWalkerSymbol');

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

async function parseUploadPackRequest (stream) {
  let read = GitPktLine.streamReader(stream);
  let done = false;
  let capabilities = null;
  let wants = [];
  let haves = [];
  let shallows = [];
  let depth;
  let since;
  let exclude = [];
  let relative = false;
  while (!done) {
    let line = await read();
    if (line === true) break
    if (line === null) continue
    let [key, value, ...rest] = line
      .toString('utf8')
      .trim()
      .split(' ');
    if (!capabilities) capabilities = rest;
    switch (key) {
      case 'want':
        wants.push(value);
        break
      case 'have':
        haves.push(value);
        break
      case 'shallow':
        shallows.push(value);
        break
      case 'deepen':
        depth = parseInt(value);
        break
      case 'deepen-since':
        since = parseInt(value);
        break
      case 'deepen-not':
        exclude.push(value);
        break
      case 'deepen-relative':
        relative = true;
        break
      case 'done':
        done = true;
        break
    }
  }
  return {
    capabilities,
    wants,
    haves,
    shallows,
    depth,
    since,
    exclude,
    relative,
    done
  }
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

export { listCommitsAndTags, listObjects, pack, uploadPack, GitConfigManager, GitIgnoreManager, GitIndexManager, GitRefManager, GitRemoteHTTP, GitRemoteManager, GitShallowManager, FileSystem, GitAnnotatedTag, GitCommit, GitConfig, E, GitError, GitIndex, GitObject, GitPackIndex, GitPktLine, GitRefSpec, GitRefSpecSet, GitSideBand, GitTree, SignedGitCommit, readObject, writeObject, auth, calculateBasicAuthHeader, calculateBasicAuthUsernamePasswordPair, collect, comparePath, http, flatFileListToDirectoryStructure, join, log, oauth2, padHex, path, pkg, plugins, cores, resolveTree, shasum, sleep, GitWalkerSymbol, parseReceivePackResponse, parseRefsAdResponse, parseUploadPackResponse, parseUploadPackRequest, writeReceivePackRequest, writeRefsAdResponse, writeUploadPackRequest };
