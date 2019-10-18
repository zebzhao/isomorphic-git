'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var ignore = _interopDefault(require('ignore'));
var AsyncLock = _interopDefault(require('async-lock'));
var Hash = _interopDefault(require('sha.js/sha1'));
var pako = _interopDefault(require('pako'));
var cleanGitRef = _interopDefault(require('clean-git-ref'));
var crc32 = _interopDefault(require('crc-32'));
var applyDelta = _interopDefault(require('git-apply-delta'));
var marky = require('marky');
var globrex = _interopDefault(require('globrex'));
var globalyzer = _interopDefault(require('globalyzer'));
var diff3Merge = _interopDefault(require('diff3'));

/**
 * Use with push and fetch to set Basic Authentication headers.
 *
 * @link https://isomorphic-git.github.io/docs/utils_auth.html
 */
function auth (username, password) {
  // Allow specifying it as one argument (mostly for CLI inputability)
  if (password === undefined) {
    const i = username.indexOf(':');
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
// but with the goal of being much lighter weight.

const messages = {
  FileReadError: `Could not read file "{ filepath }".`,
  MissingRequiredParameterError: `The function "{ function }" requires a "{ parameter }" parameter but none was provided.`,
  InvalidRefNameError: `Failed to { verb } { noun } "{ ref }" because that name would not be a valid git reference. A valid alternative would be "{ suggestion }".`,
  InvalidParameterCombinationError: `The function "{ function }" doesn't take these parameters simultaneously: { parameters }`,
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

function renderTemplate (template, values) {
  let result = template;
  for (const key of Object.keys(values)) {
    let subs;
    if (Array.isArray(values[key])) {
      subs = values[key].join(', ');
    } else {
      subs = String(values[key]);
    }
    result = result.replace(new RegExp(`{ ${key} }`, 'g'), subs);
  }
  return result
}

class GitError extends Error {
  constructor (code, data) {
    super();
    this.name = code;
    this.code = code;
    this.data = data;
    this.message = renderTemplate(messages[code], data || {});
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

function basename (path) {
  const last = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (last > -1) {
    path = path.slice(last + 1);
  }
  return path
}

function dirname (path) {
  const last = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (last === -1) return '.'
  if (last === 0) return '/'
  return path.slice(0, last)
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
    fs,
    dir,
    gitdir = join(dir, '.git'),
    filepath
  }) {
    // ALWAYS ignore ".git" folders.
    if (basename(filepath) === '.git') return true
    // '.' is not a valid gitignore entry, so '.' is never ignored
    if (filepath === '.') return false
    // Find all the .gitignore files that could affect this file
    const pairs = [
      {
        gitignore: join(dir, '.gitignore'),
        filepath
      }
    ];
    const pieces = filepath.split('/');
    for (let i = 1; i < pieces.length; i++) {
      const folder = pieces.slice(0, i).join('/');
      const file = pieces.slice(i).join('/');
      pairs.push({
        gitignore: join(dir, folder, '.gitignore'),
        filepath: file
      });
    }
    let ignoredStatus = false;
    for (const p of pairs) {
      let file;
      try {
        file = await fs.read(p.gitignore, 'utf8');
      } catch (err) {
        if (err.code === 'NOENT') continue
      }
      const ign = ignore().add(file);
      // If the parent directory is excluded, we are done.
      // "It is not possible to re-include a file if a parent directory of that file is excluded. Git doesn’t list excluded directories for performance reasons, so any patterns on contained files have no effect, no matter where they are defined."
      // source: https://git-scm.com/docs/gitignore
      const parentdir = dirname(p.filepath);
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

function compareStrings (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  return -(a < b) || +(a > b)
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
  const flags = entry.flags;
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
  const shaComputed = shasum(buffer.slice(0, -20));
  const shaClaimed = buffer.slice(-20).toString('hex');
  if (shaClaimed !== shaComputed) {
    throw new GitError(E.InternalFail, {
      message: `Invalid checksum in GitIndex buffer: expected ${shaClaimed} but saw ${shaComputed}`
    })
  }
  const reader = new BufferCursor(buffer);
  const _entries = new Map();
  const magic = reader.toString('utf8', 4);
  if (magic !== 'DIRC') {
    throw new GitError(E.InternalFail, {
      message: `Invalid dircache magic file number: ${magic}`
    })
  }
  const version = reader.readUInt32BE();
  if (version !== 2) {
    throw new GitError(E.InternalFail, {
      message: `Unsupported dircache version: ${version}`
    })
  }
  const numEntries = reader.readUInt32BE();
  let i = 0;
  while (!reader.eof() && i < numEntries) {
    const entry = {};
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
    const flags = reader.readUInt16BE();
    entry.flags = parseCacheEntryFlags(flags);
    // TODO: handle if (version === 3 && entry.flags.extended)
    const pathlength = buffer.indexOf(0, reader.tell() + 1) - reader.tell();
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
      const tmp = reader.readUInt8();
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
    for (const entry of this.entries) {
      yield entry;
    }
  }

  insert ({ filepath, stats, oid, stage = 0 }) {
    stats = normalizeStats(stats);
    const key = GitIndex.key(filepath, stage);
    const bfilepath = Buffer.from(filepath);
    const entry = {
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
    for (const [key, entry] of this._entries.entries()) {
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
    const header = Buffer.alloc(12);
    const writer = new BufferCursor(header);
    writer.write('DIRC', 4, 'utf8');
    writer.writeUInt32BE(2);
    writer.writeUInt32BE(this.entries.length);
    const body = Buffer.concat(
      this.entries.map(entry => {
        const bpath = Buffer.from(entry.path);
        // the fixed length + the filename + at least one null char => align by 8
        const length = Math.ceil((62 + bpath.length + 1) / 8) * 8;
        const written = Buffer.alloc(length);
        const writer = new BufferCursor(written);
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
    const main = Buffer.concat([header, body]);
    const sum = shasum(main);
    return Buffer.concat([main, Buffer.from(sum, 'hex')])
  }
}

const deepget = (keys, map) => {
  for (const key of keys) {
    if (!map.has(key)) map.set(key, new Map());
    map = map.get(key);
  }
  return map
};

class DeepMap {
  constructor () {
    this._root = new Map();
  }

  set (keys, value) {
    const lastKey = keys.pop();
    const lastMap = deepget(keys, this._root);
    lastMap.set(lastKey, value);
  }

  get (keys) {
    const lastKey = keys.pop();
    const lastMap = deepget(keys, this._root);
    return lastMap.get(lastKey)
  }

  has (keys) {
    const lastKey = keys.pop();
    const lastMap = deepget(keys, this._root);
    return lastMap.has(lastKey)
  }
}

let shouldLog = null;

function log (...args) {
  if (shouldLog === null) {
    // Reading localStorage can throw a SECURITY_ERR in Chrome Mobile if "Block third-party cookies and site data" is enabled
    // and maybe in other scenarios too. I started seeing this error doing Karma testing on my Android phone via local WLAN.
    // Using the Object.getPropertyDescriptor(window, 'localStorage').enumerable trick didn't avoid the error so using try/catch.
    try {
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
    } catch (_) {
      shouldLog = false;
    }
  }
  if (shouldLog) {
    console.log(...args);
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
      const dir = {
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
      const file = {
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
  for (const file of files) {
    mkfile(file.path, file);
  }
  return inodes
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
  const _entries = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const space = buffer.indexOf(32, cursor);
    if (space === -1) {
      throw new GitError(E.InternalFail, {
        message: `GitTree: Error parsing buffer at byte location ${cursor}: Could not find the next space character.`
      })
    }
    const nullchar = buffer.indexOf(0, cursor);
    if (nullchar === -1) {
      throw new GitError(E.InternalFail, {
        message: `GitTree: Error parsing buffer at byte location ${cursor}: Could not find the next null character.`
      })
    }
    let mode = buffer.slice(cursor, space).toString('utf8');
    if (mode === '40000') mode = '040000'; // makes it line up neater in printed output
    const type = mode2type(mode);
    const path = buffer.slice(space + 1, nullchar).toString('utf8');
    const oid = buffer.slice(nullchar + 1, nullchar + 21).toString('hex');
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
        const mode = Buffer.from(entry.mode.replace(/^0/, ''));
        const space = Buffer.from(' ');
        const path = Buffer.from(entry.path, 'utf8');
        const nullchar = Buffer.from([0]);
        const oid = Buffer.from(entry.oid, 'hex');
        return Buffer.concat([mode, space, path, nullchar, oid])
      })
    )
  }

  entries () {
    return this._entries
  }

  * [Symbol.iterator] () {
    for (const entry of this._entries) {
      yield entry;
    }
  }
}

class GitObject {
  static wrap ({ type, object }) {
    const buffer = typeof object === 'string' ? Buffer.from(object, 'utf8') : Buffer.from(object);
    return Buffer.concat([
      Buffer.from(`${type} ${buffer.byteLength.toString()}\x00`),
      buffer
    ])
  }

  static unwrap (buffer) {
    const s = buffer.indexOf(32); // first space
    const i = buffer.indexOf(0); // first null value
    const type = buffer.slice(0, s).toString('utf8'); // get type of object
    const length = buffer.slice(s + 1, i).toString('utf8'); // get type of object
    const actualLength = buffer.length - (i + 1);
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
  fs,
  gitdir,
  type,
  object,
  format,
  oid
}) {
  if (format !== 'deflated') {
    throw new GitError(E.InternalFail, {
      message:
        'GitObjectStoreLoose expects objects to write to be in deflated format'
    })
  }
  const source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  const filepath = `${gitdir}/${source}`;
  // Don't overwrite existing git objects - this helps avoid EPERM errors.
  // Although I don't know how we'd fix corrupted objects then. Perhaps delete them
  // on read?
  if (!(await fs.exists(filepath))) await fs.write(filepath, object);
}

async function writeObject ({
  fs,
  gitdir,
  type,
  object,
  format = 'content',
  oid = undefined,
  dryRun = false
}) {
  if (format !== 'deflated') {
    if (format !== 'wrapped') {
      object = GitObject.wrap({ type, object });
    }
    oid = shasum(object);
    object = Buffer.from(pako.deflate(object));
  }
  if (!dryRun) {
    await writeObjectLoose({ fs, gitdir, object, format: 'deflated', oid });
  }
  return oid
}

// import LockManager from 'travix-lock-manager'

// import Lock from '../utils.js'

// TODO: replace with an LRU cache?
const map = new DeepMap();
const stats = new DeepMap();
// const lm = new LockManager()
let lock = null;

async function updateCachedIndexFile (fs, filepath) {
  const stat = await fs.lstat(filepath);
  const rawIndexFile = await fs.read(filepath);
  const index = GitIndex.from(rawIndexFile);
  // cache the GitIndex object so we don't need to re-read it
  // every time.
  map.set([fs, filepath], index);
  // Save the stat data for the index so we know whether
  // the cached file is stale (modified by an outside process).
  stats.set([fs, filepath], stat);
}

// Determine whether our copy of the index file is stale
async function isIndexStale (fs, filepath) {
  const savedStats = stats.get([fs, filepath]);
  if (savedStats === undefined) return true
  const currStats = await fs.lstat(filepath);
  if (savedStats === null) return false
  if (currStats === null) return false
  return compareStats(savedStats, currStats)
}

class GitIndexManager {
  static async acquire ({ fs, gitdir }, closure) {
    const filepath = `${gitdir}/index`;
    if (lock === null) lock = new AsyncLock({ maxPending: Infinity });
    let result;
    await lock.acquire(filepath, async function () {
      // Acquire a file lock while we're reading the index
      // to make sure other processes aren't writing to it
      // simultaneously, which could result in a corrupted index.
      // const fileLock = await Lock(filepath)
      if (await isIndexStale(fs, filepath)) {
        await updateCachedIndexFile(fs, filepath);
      }
      const index = map.get([fs, filepath]);
      result = await closure(index);
      if (index._dirty) {
        // Acquire a file lock while we're writing the index file
        // let fileLock = await Lock(filepath)
        const buffer = index.toObject();
        await fs.write(filepath, buffer);
        // Update cached stat value
        stats.set([fs, filepath], await fs.lstat(filepath));
        index._dirty = false;
      }
    });
    return result
  }

  static async constructTree ({ fs, gitdir, dryRun, index }) {
    const inodes = flatFileListToDirectoryStructure(index.entries);
    const inode = inodes.get('.');
    const tree = await constructTree({ fs, gitdir, inode, dryRun });
    return tree
  }
}

async function constructTree ({ fs, gitdir, inode, dryRun }) {
  // use depth first traversal
  const children = inode.children;
  for (const inode of children) {
    if (inode.type === 'tree') {
      inode.metadata.mode = '040000';
      inode.metadata.oid = await constructTree({ fs, gitdir, inode, dryRun });
    }
  }
  const entries = children.map(inode => ({
    mode: inode.metadata.mode,
    path: inode.basename,
    oid: inode.metadata.oid,
    type: inode.type
  }));
  const tree = GitTree.from(entries);
  const oid = await writeObject({
    fs,
    gitdir,
    type: 'tree',
    object: tree.toObject(),
    dryRun
  });
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
      // ugh. this sucks
      if (
        key === 'fs' &&
        Object.getOwnPropertyDescriptor(value, 'promises') &&
        Object.getOwnPropertyDescriptor(value, 'promises').enumerable
      ) {
        value = value.promises;
      }
      const pluginSchemas = {
        credentialManager: ['fill', 'approved', 'rejected'],
        emitter: ['emit'],
        fs: [
          'lstat',
          'mkdir',
          'readdir',
          'read',
          'rm',
          'write'
        ],
        pgp: ['sign', 'verify'],
        http: []
      };
      if (!Object.prototype.hasOwnProperty.call(pluginSchemas, key)) {
        throw new GitError(E.PluginUnrecognized, { plugin: key })
      }
      for (const method of pluginSchemas[key]) {
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

// @ts-check

/**
 * Add a file to the git index (aka staging area)
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.filepath - The path to the file to add to the index
 *
 * @returns {Promise<string[]>} Resolves successfully once the git index has been updated
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
async function add ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  filepath
}) {
  try {
    const added = [];
    await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      await addToIndex({ dir, gitdir, fs, filepath, index, added });
    });
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
  const stats = await fs.lstat(join(dir, filepath));
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
  static async get ({ fs, gitdir }) {
    // We can improve efficiency later if needed.
    // TODO: read from full list of git config files
    const text = await fs.read(`${gitdir}/config`, { encoding: 'utf8' });
    return GitConfig.from(text)
  }

  static async save ({ fs, gitdir, config }) {
    // We can improve efficiency later if needed.
    // TODO: handle saving to the correct global/user/repo location
    await fs.write(`${gitdir}/config`, config.toString(), {
      encoding: 'utf8'
    });
  }
}

// @ts-check

/**
 * Add or update a remote
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.remote - The name of the remote
 * @param {string} args.url - The URL of the remote
 * @param {boolean} [args.force = false] - Instead of throwing an error if a remote named `remote` already exists, overwrite the existing remote.
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.addRemote({ dir: '$input((/))', remote: '$input((upstream))', url: '$input((https://github.com/isomorphic-git/isomorphic-git))' })
 * console.log('done')
 *
 */
async function addRemote ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  remote,
  url,
  force = false
}) {
  try {
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

  reverseTranslate (localBranch) {
    if (this.matchPrefix) {
      if (localBranch.startsWith(this.localPath)) {
        return this.remotePath + localBranch.replace(this.localPath, '')
      }
    } else {
      if (localBranch === this.localPath) return this.remotePath
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

  localNamespaces () {
    return this.rules
      .filter(rule => rule.matchPrefix)
      .map(rule => rule.localPath.replace(/\/$/, ''))
  }
}

function compareRefNames (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  const _a = a.replace(/\^\{\}$/, '');
  const _b = b.replace(/\^\{\}$/, '');
  const tmp = -(_a < _b) || +(_a > _b);
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

// @see https://git-scm.com/docs/gitrepository-layout
const GIT_FILES = ['config', 'description', 'index', 'shallow', 'commondir'];

class GitRefManager {
  static async updateRemoteRefs ({
    fs,
    gitdir,
    remote,
    refs,
    symrefs,
    tags,
    refspecs = undefined,
    prune = false,
    pruneTags = false
  }) {
    // Validate input
    for (const value of refs.values()) {
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
    const actualRefsToWrite = new Map();
    // Delete all current tags if the pruneTags argument is true.
    if (pruneTags) {
      const tags = await GitRefManager.listRefs({
        fs,
        gitdir,
        filepath: 'refs/tags'
      });
      await GitRefManager.deleteRefs({
        fs,
        gitdir,
        refs: tags.map(tag => `refs/tags/${tag}`)
      });
    }
    // Add all tags if the fetch tags argument is true.
    if (tags) {
      for (const serverRef of refs.keys()) {
        if (serverRef.startsWith('refs/tags') && !serverRef.endsWith('^{}')) {
          // Git's behavior is to only fetch tags that do not conflict with tags already present.
          if (!(await GitRefManager.exists({ fs, gitdir, ref: serverRef }))) {
            // If there is a dereferenced an annotated tag value available, prefer that.
            const oid = refs.get(serverRef + '^{}') || refs.get(serverRef);
            actualRefsToWrite.set(serverRef, oid);
          }
        }
      }
    }
    // Combine refs and symrefs giving symrefs priority
    const refTranslations = refspec.translate([...refs.keys()]);
    for (const [serverRef, translatedRef] of refTranslations) {
      const value = refs.get(serverRef);
      actualRefsToWrite.set(translatedRef, value);
    }
    const symrefTranslations = refspec.translate([...symrefs.keys()]);
    for (const [serverRef, translatedRef] of symrefTranslations) {
      const value = symrefs.get(serverRef);
      const symtarget = refspec.translateOne(value);
      if (symtarget) {
        actualRefsToWrite.set(translatedRef, `ref: ${symtarget}`);
      }
    }
    // If `prune` argument is true, clear out the existing local refspec roots
    const pruned = [];
    if (prune) {
      for (const filepath of refspec.localNamespaces()) {
        const refs = (await GitRefManager.listRefs({
          fs,
          gitdir,
          filepath
        })).map(file => `${filepath}/${file}`);
        for (const ref of refs) {
          if (!actualRefsToWrite.has(ref)) {
            pruned.push(ref);
          }
        }
      }
      if (pruned.length > 0) {
        await GitRefManager.deleteRefs({ fs, gitdir, refs: pruned });
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
    for (const [key, value] of actualRefsToWrite) {
      await fs.write(join(gitdir, key), `${value.trim()}\n`, 'utf8');
    }
    return { pruned }
  }

  // TODO: make this less crude?
  static async writeRef ({ fs, gitdir, ref, value }) {
    // Validate input
    if (!value.match(/[0-9a-f]{40}/)) {
      throw new GitError(E.NotAnOidFail, { value })
    }
    await fs.write(join(gitdir, ref), `${value.trim()}\n`, 'utf8');
  }

  static async writeSymbolicRef ({ fs, gitdir, ref, value }) {
    await fs.write(join(gitdir, ref), 'ref: ' + `${value.trim()}\n`, 'utf8');
  }

  static async deleteRef ({ fs, gitdir, ref }) {
    return GitRefManager.deleteRefs({ fs, gitdir, refs: [ref] })
  }

  static async deleteRefs ({ fs, gitdir, refs }) {
    // Delete regular ref
    await Promise.all(refs.map(ref => fs.rm(join(gitdir, ref))));
    // Delete any packed ref
    let text = await fs.read(`${gitdir}/packed-refs`, { encoding: 'utf8' });
    const packed = GitPackedRefs.from(text);
    const beforeSize = packed.refs.size;
    for (const ref of refs) {
      if (packed.refs.has(ref)) {
        packed.delete(ref);
      }
    }
    if (packed.refs.size < beforeSize) {
      text = packed.toString();
      await fs.write(`${gitdir}/packed-refs`, text, { encoding: 'utf8' });
    }
  }

  static async resolve ({ fs, gitdir, ref, depth = undefined }) {
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
    const packedMap = await GitRefManager.packedRefs({ fs, gitdir });
    // Look in all the proper paths, in this order
    const allpaths = refpaths(ref).filter(p => !GIT_FILES.includes(p)); // exclude git system files (#709)

    for (const ref of allpaths) {
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

  static async expand ({ fs, gitdir, ref }) {
    // Is it a complete and valid SHA?
    if (ref.length === 40 && /[0-9a-f]{40}/.test(ref)) {
      return ref
    }
    // We need to alternate between the file system and the packed-refs
    const packedMap = await GitRefManager.packedRefs({ fs, gitdir });
    // Look in all the proper paths, in this order
    const allpaths = refpaths(ref);
    for (const ref of allpaths) {
      if (await fs.exists(`${gitdir}/${ref}`)) return ref
      if (packedMap.has(ref)) return ref
    }
    // Do we give up?
    throw new GitError(E.ExpandRefError, { ref })
  }

  static async expandAgainstMap ({ ref, map }) {
    // Look in all the proper paths, in this order
    const allpaths = refpaths(ref);
    for (const ref of allpaths) {
      if (await map.has(ref)) return ref
    }
    // Do we give up?
    throw new GitError(E.ExpandRefError, { ref })
  }

  static resolveAgainstMap ({ ref, fullref = ref, depth = undefined, map }) {
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
    for (const ref of allpaths) {
      const sha = map.get(ref);
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

  static async packedRefs ({ fs, gitdir }) {
    const text = await fs.read(`${gitdir}/packed-refs`, { encoding: 'utf8' });
    const packed = GitPackedRefs.from(text);
    return packed.refs
  }

  // List all the refs that match the `filepath` prefix
  static async listRefs ({ fs, gitdir, filepath }) {
    const packedMap = GitRefManager.packedRefs({ fs, gitdir });
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

  static async listBranches ({ fs, gitdir, remote }) {
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

  static async listTags ({ fs, gitdir }) {
    const tags = await GitRefManager.listRefs({
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
  const sign = simpleSign(negateExceptForZero(minutes));
  minutes = Math.abs(minutes);
  const hours = Math.floor(minutes / 60);
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
  const [, name, email, timestamp, offset] = author.match(
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
    const tag = this.withoutSignature();
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
    const headers = this.justHeaders().split('\n');
    const hs = [];
    for (const h of headers) {
      if (h[0] === ' ') {
        // combine with previous header (without space indent)
        hs[hs.length - 1] += '\n' + h.slice(1);
      } else {
        hs.push(h);
      }
    }
    const obj = {};
    for (const h of hs) {
      const key = h.slice(0, h.indexOf(' '));
      const value = h.slice(h.indexOf(' ') + 1);
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
    const tag = normalizeNewlines(this._tag);
    if (tag.indexOf('\n-----BEGIN PGP SIGNATURE-----') === -1) return tag
    return tag.slice(0, tag.lastIndexOf('\n-----BEGIN PGP SIGNATURE-----'))
  }

  signature () {
    const signature = this._tag.slice(
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
    const signedTag = payload + signature;
    // return a new tag object
    return GitAnnotatedTag.from(signedTag)
  }

  static async verify (tag, pgp, publicKey) {
    const payload = tag.withoutSignature() + '\n';
    const signature = tag.signature();
    return pgp.verify({ payload, publicKey, signature })
  }
}

async function readObjectLoose ({ fs, gitdir, oid }) {
  const source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  const file = await fs.read(`${gitdir}/${source}`);
  if (!file) {
    return null
  }
  return { object: file, format: 'deflated', source }
}

// Convert a web ReadableStream (not Node stream!) to an Async Iterator

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

// Convert a Node stream to an Async Iterator
function fromNodeStream (stream) {
  // Use native async iteration if it's available.
  if (
    Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator) &&
    Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator).enumerable
  ) {
    return stream
  }
  // Author's Note
  // I tried many MANY ways to do this.
  // I tried two npm modules (stream-to-async-iterator and streams-to-async-iterator) with no luck.
  // I tried using 'readable' and .read(), and .pause() and .resume()
  // It took me two loooong evenings to get to this point.
  // So if you are horrified that this solution just builds up a queue with no backpressure,
  // and turns Promises inside out, too bad. This is the first code that worked reliably.
  let ended = false;
  const queue = [];
  let defer = {};
  stream.on('data', chunk => {
    queue.push(chunk);
    if (defer.resolve) {
      defer.resolve({ value: queue.shift(), done: false });
      defer = {};
    }
  });
  stream.on('error', err => {
    if (defer.reject) {
      defer.reject(err);
      defer = {};
    }
  });
  stream.on('end', () => {
    ended = true;
    if (defer.resolve) {
      defer.resolve({ done: true });
      defer = {};
    }
  });
  return {
    next () {
      return new Promise((resolve, reject) => {
        if (queue.length === 0 && ended) {
          return resolve({ done: true })
        } else if (queue.length > 0) {
          return resolve({ value: queue.shift(), done: false })
        } else if (queue.length === 0 && !ended) {
          defer = { resolve, reject };
        }
      })
    },
    return () {
      stream.removeAllListeners();
      if (stream.destroy) stream.destroy();
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
    const buffers = [this.buffer];
    while (this.cursor + n > lengthBuffers(buffers)) {
      const nextbuffer = await this._next();
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
  const reader = new StreamReader(stream);
  const hash = new Hash();
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
    const offset = reader.tell();
    const { type, length, ofs, reference } = await parseHeader(reader, hash);
    const inflator = new pako.Inflate();
    while (!inflator.result) {
      const chunk = await reader.chunk();
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
        const buf = await reader.read(chunk.length - inflator.strm.avail_in);
        hash.update(buf);
        const end = reader.tell();
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
  const type = (byte >> 4) & 0b111;
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
    const bytes = [];
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
    const buf = await reader.read(20);
    hash.update(buf);
    reference = buf;
  }
  return { type, length, ofs, reference }
}

function decodeVarInt (reader) {
  const bytes = [];
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
    marky.mark('fromIdx');
    const reader = new BufferCursor(idx);
    const magic = reader.slice(4).toString('hex');
    // Check for IDX v2 magic number
    if (magic !== 'ff744f63') {
      return // undefined
    }
    const version = reader.readUInt32BE();
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
    const size = reader.readUInt32BE();
    marky.mark('hashes');
    const hashes = [];
    for (let i = 0; i < size; i++) {
      const hash = reader.slice(20).toString('hex');
      hashes[i] = hash;
    }
    log(`hashes ${marky.stop('hashes').duration}`);
    reader.seek(reader.tell() + 4 * size);
    // Skip over CRCs
    marky.mark('offsets');
    // Get offsets
    const offsets = new Map();
    for (let i = 0; i < size; i++) {
      offsets.set(hashes[i], reader.readUInt32BE());
    }
    log(`offsets ${marky.stop('offsets').duration}`);
    const packfileSha = reader.slice(20).toString('hex');
    log(`fromIdx ${marky.stop('fromIdx').duration}`);
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
    const offsetToObject = {};

    // Older packfiles do NOT use the shasum of the pack itself,
    // so it is recommended to just use whatever bytes are in the trailer.
    // Source: https://github.com/git/git/commit/1190a1acf800acdcfd7569f87ac1560e2d077414
    const packfileSha = pack.slice(-20).toString('hex');

    const hashes = [];
    const crcs = {};
    const offsets = new Map();
    let totalObjectCount = null;
    let lastPercent = null;
    const times = {
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
    marky.mark('total');
    marky.mark('offsets');
    marky.mark('percent');
    await listpack([pack], ({ data, type, reference, offset, num }) => {
      if (totalObjectCount === null) totalObjectCount = num;
      const percent = Math.floor(
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
            marky.stop('percent').duration
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
        marky.mark('percent');
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
    times['offsets'] = Math.floor(marky.stop('offsets').duration);

    log('Computing CRCs');
    marky.mark('crcs');
    // We need to know the lengths of the slices to compute the CRCs.
    const offsetArray = Object.keys(offsetToObject).map(Number);
    for (const [i, start] of offsetArray.entries()) {
      const end =
        i + 1 === offsetArray.length ? pack.byteLength - 20 : offsetArray[i + 1];
      const o = offsetToObject[start];
      const crc = crc32.buf(pack.slice(start, end)) >>> 0;
      o.end = end;
      o.crc = crc;
    }
    times['crcs'] = Math.floor(marky.stop('crcs').duration);

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
    marky.mark('percent');
    lastPercent = null;
    let count = 0;
    let callsToReadSlice = 0;
    let callsToGetExternal = 0;
    const timeByDepth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const objectsByDepth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let offset in offsetToObject) {
      offset = Number(offset);
      const percent = Math.floor((count++ * 100) / totalObjectCount);
      if (percent !== lastPercent) {
        log(
          `${percent}%\t${Math.floor(
            marky.stop('percent').duration
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
        marky.mark('percent');
        callsToReadSlice = 0;
        callsToGetExternal = 0;
      }
      lastPercent = percent;

      const o = offsetToObject[offset];
      if (o.oid) continue
      try {
        p.readDepth = 0;
        p.externalReadDepth = 0;
        marky.mark('readSlice');
        const { type, object } = await p.readSlice({ start: offset });
        const time = marky.stop('readSlice').duration;
        times.readSlice += time;
        callsToReadSlice += p.readDepth;
        callsToGetExternal += p.externalReadDepth;
        timeByDepth[p.readDepth] += time;
        objectsByDepth[p.readDepth] += 1;
        marky.mark('hash');
        const oid = shasum(GitObject.wrap({ type, object }));
        times.hash += marky.stop('hash').duration;
        o.oid = oid;
        hashes.push(oid);
        offsets.set(oid, offset);
        crcs[oid] = o.crc;
      } catch (err) {
        log('ERROR', err);
        continue
      }
    }

    marky.mark('sort');
    hashes.sort();
    times['sort'] = Math.floor(marky.stop('sort').duration);
    const totalElapsedTime = marky.stop('total').duration;
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
    const buffers = [];
    const write = (str, encoding) => {
      buffers.push(Buffer.from(str, encoding));
    };
    // Write out IDX v2 magic number
    write('ff744f63', 'hex');
    // Write out version number 2
    write('00000002', 'hex');
    // Write fanout table
    const fanoutBuffer = new BufferCursor(Buffer.alloc(256 * 4));
    for (let i = 0; i < 256; i++) {
      let count = 0;
      for (const hash of this.hashes) {
        if (parseInt(hash.slice(0, 2), 16) <= i) count++;
      }
      fanoutBuffer.writeUInt32BE(count);
    }
    buffers.push(fanoutBuffer.buffer);
    // Write out hashes
    for (const hash of this.hashes) {
      write(hash, 'hex');
    }
    // Write out crcs
    const crcsBuffer = new BufferCursor(Buffer.alloc(this.hashes.length * 4));
    for (const hash of this.hashes) {
      crcsBuffer.writeUInt32BE(this.crcs[hash]);
    }
    buffers.push(crcsBuffer.buffer);
    // Write out offsets
    const offsetsBuffer = new BufferCursor(Buffer.alloc(this.hashes.length * 4));
    for (const hash of this.hashes) {
      offsetsBuffer.writeUInt32BE(this.offsets.get(hash));
    }
    buffers.push(offsetsBuffer.buffer);
    // Write out packfile checksum
    write(this.packfileSha, 'hex');
    // Write out shasum
    const totalBuffer = Buffer.concat(buffers);
    const sha = shasum(totalBuffer);
    const shaBuffer = Buffer.alloc(20);
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
    const start = this.offsets.get(oid);
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
    const raw = (await this.pack).slice(start);
    const reader = new BufferCursor(raw);
    const byte = reader.readUInt8();
    // Object type is encoded in bits 654
    const btype = byte & 0b1110000;
    let type = types[btype];
    if (type === undefined) {
      throw new GitError(E.InternalFail, {
        message: 'Unrecognized type: 0b' + btype.toString(2)
      })
    }
    // The length encoding get complicated.
    // Last four bits of length is encoded in bits 3210
    const lastFour = byte & 0b1111;
    let length = lastFour;
    // Whether the next byte is part of the variable-length encoded number
    // is encoded in bit 7
    const multibyte = byte & 0b10000000;
    if (multibyte) {
      length = otherVarIntDecode(reader, lastFour);
    }
    let base = null;
    let object = null;
    // Handle deltified objects
    if (type === 'ofs_delta') {
      const offset = decodeVarInt(reader);
      const baseOffset = start - offset
      ;({ object: base, type } = await this.readSlice({ start: baseOffset }));
    }
    if (type === 'ref_delta') {
      const oid = reader.slice(20).toString('hex')
      ;({ object: base, type } = await this.read({ oid }));
    }
    // Handle undeltified objects
    const buffer = raw.slice(reader.tell());
    object = Buffer.from(pako.inflate(buffer));
    // Assert that the object length is as expected.
    if (object.byteLength !== length) {
      throw new GitError(E.InternalFail, {
        message: `Packfile told us object would have length ${length} but it had length ${object.byteLength}`
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
  fs,
  gitdir,
  oid,
  format = 'content',
  getExternalRefDelta
}) {
  // Check to see if it's in a packfile.
  // Iterate through all the .idx files
  let list = await fs.readdir(join(gitdir, 'objects/pack'));
  list = list.filter(x => x.endsWith('.idx'));
  for (const filename of list) {
    const indexFile = `${gitdir}/objects/pack/${filename}`;
    const p = await readPackIndex({
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
      const result = await p.read({ oid, getExternalRefDelta });
      result.format = 'content';
      result.source = `objects/pack/${filename.replace(/idx$/, 'pack')}`;
      return result
    }
  }
  // Failed to find it
  return null
}

async function readObject ({ fs, gitdir, oid, format = 'content' }) {
  // Curry the current read method so that the packfile un-deltification
  // process can acquire external ref-deltas.
  const getExternalRefDelta = oid => readObject({ fs, gitdir, oid });

  let result;
  // Empty tree - hard-coded so we can use it as a shorthand.
  // Note: I think the canonical git implementation must do this too because
  // `git cat-file -t 4b825dc642cb6eb9a060e54bf8d69288fbee4904` prints "tree" even in empty repos.
  if (oid === '4b825dc642cb6eb9a060e54bf8d69288fbee4904') {
    result = { format: 'wrapped', object: Buffer.from(`tree 0\x00`) };
  }
  // Look for it in the loose object directory.
  if (!result) {
    result = await readObjectLoose({ fs, gitdir, oid });
  }
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
      result.object = Buffer.from(pako.inflate(result.object));
      result.format = 'wrapped';
    case 'wrapped':
      if (format === 'wrapped' && result.format === 'wrapped') {
        return result
      }
      const sha = shasum(result.object);
      if (sha !== oid) {
        throw new GitError(E.InternalFail, {
          message: `SHA check failed! Expected ${oid}, computed ${sha}`
        })
      }
      const { object, type } = GitObject.unwrap(result.object);
      result.type = type;
      result.object = object;
      result.format = 'content';
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

// @ts-check

/**
 * Read and/or write to the git config files.
 *
 * *Caveats:*
 * - Currently only the local `$GIT_DIR/config` file can be read or written. However support for the global `~/.gitconfig` and system `$(prefix)/etc/gitconfig` will be added in the future.
 * - The current parser does not support the more exotic features of the git-config file format such as `[include]` and `[includeIf]`.
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.path - The key of the git config entry
 * @param {string} [args.value] - (Optional) A value to store at that path
 * @param {boolean} [args.all = false] - If the config file contains multiple values, return them all as an array.
 * @param {boolean} [args.append = false] - If true, will append rather than replace when setting (use with multi-valued config options).
 *
 * @returns {Promise<any>} Resolves with the config value
 *
 * @example
 * // Write config value
 * await git.config({
 *   dir: '$input((/))',
 *   path: '$input((user.name))',
 *   value: '$input((Mr. Test))'
 * })
 *
 * // Read config value
 * let value = await git.config({
 *   dir: '$input((/))',
 *   path: '$input((user.name))'
 * })
 * console.log(value)
 *
 */
async function config (args) {
  // These arguments are not in the function signature but destructured separately
  // as a result of a bit of a design flaw that requires the un-destructured argument object
  // in order to call args.hasOwnProperty('value') later on.
  const {
    core = 'default',
    dir,
    gitdir = join(dir, '.git'),
    fs = cores.get(core).get('fs'),
    all = false,
    append = false,
    path,
    value
  } = args;
  try {
    const config = await GitConfigManager.get({ fs, gitdir });
    // This carefully distinguishes between
    // 1) there is no 'value' argument (do a "get")
    // 2) there is a 'value' argument with a value of undefined (do a "set")
    // Because setting a key to undefined is how we delete entries from the ini.
    if (
      value === undefined &&
      !Object.prototype.hasOwnProperty.call(args, 'value')
    ) {
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

// @ts-check

/**
 * Create an annotated tag.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - What to name the tag
 * @param {string} [args.message = ''] - The tag message to use.
 * @param {string} [args.object = 'HEAD'] - The SHA-1 object id the tag points to. (Will resolve to a SHA-1 object id if value is a ref.) By default, the commit object which is referred by the current `HEAD` is used.
 * @param {object} [args.tagger] - The details about the tagger.
 * @param {string} [args.tagger.name] - Default is `user.name` config.
 * @param {string} [args.tagger.email] - Default is `user.email` config.
 * @param {string} [args.tagger.date] - Set the tagger timestamp field. Default is the current date.
 * @param {string} [args.tagger.timestamp] - Set the tagger timestamp field. This is an alternative to using `date` using an integer number of seconds since the Unix epoch instead of a JavaScript date object.
 * @param {string} [args.tagger.timezoneOffset] - Set the tagger timezone offset field. This is the difference, in minutes, from the current timezone to UTC. Default is `(new Date()).getTimezoneOffset()`.
 * @param {string} [args.signature] - The signature attatched to the tag object. (Mutually exclusive with the `signingKey` option.)
 * @param {string} [args.signingKey] - Sign the tag object using this private PGP key. (Mutually exclusive with the `signature` option.)
 * @param {boolean} [args.force = false] - Instead of throwing an error if a tag named `ref` already exists, overwrite the existing tag. Note that this option does not modify the original tag object itself.
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.annotatedTag({
 *   dir: '$input((/))',
 *   ref: '$input((test-tag))',
 *   message: '$input((This commit is awesome))',
 *   tagger: {
 *     name: '$input((Mr. Test))',
 *     email: '$input((mrtest@example.com))'
 *   }
 * })
 * console.log('done')
 *
 */
async function annotatedTag ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref,
  tagger,
  message = ref,
  signature,
  object,
  signingKey,
  force = false
}) {
  try {
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
    const oid = await GitRefManager.resolve({
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
      const pgp = cores.get(core).get('pgp');
      tagObject = await GitAnnotatedTag.sign(tagObject, pgp, signingKey);
    }
    const value = await writeObject({
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

// @ts-check

/**
 * Create a branch
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - What to name the branch
 * @param {boolean} [args.checkout = false] - Update `HEAD` to point at the newly created branch
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.branch({ dir: '$input((/))', ref: '$input((develop))' })
 * console.log('done')
 *
 */
async function branch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref,
  checkout = false
}) {
  try {
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

    const fullref = `refs/heads/${ref}`;

    const exist = await GitRefManager.exists({ fs, gitdir, ref: fullref });
    if (exist) {
      throw new GitError(E.RefExistsError, { noun: 'branch', ref })
    }

    // Get current HEAD tree oid
    let oid;
    try {
      oid = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' });
    } catch (e) {
      // Probably an empty repo
    }

    // Create a new ref that points at the current commit
    if (oid) {
      await GitRefManager.writeRef({ fs, gitdir, ref: fullref, value: oid });
    }

    if (checkout) {
      // Update HEAD
      await GitRefManager.writeSymbolicRef({
        fs,
        gitdir,
        ref: 'HEAD',
        value: fullref
      });
    }
  } catch (err) {
    err.caller = 'git.branch';
    throw err
  }
}

const patternRoot = pattern => {
  // return pattern.split('*', 1)[0]
  const base = globalyzer(pattern).base;
  return base === '.' ? '' : base
};

const worthWalking = (filepath, root) => {
  if (filepath === '.' || root == null || root.length === 0 || root === '.') {
    return true
  }
  if (root.length >= filepath.length) {
    return root.startsWith(filepath)
  } else {
    return filepath.startsWith(root)
  }
};

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
    const headers = GitCommit.justHeaders(payload);
    const message = GitCommit.justMessage(payload);
    const commit = normalizeNewlines(
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
    const headers = GitCommit.justHeaders(this._commit).split('\n');
    const hs = [];
    for (const h of headers) {
      if (h[0] === ' ') {
        // combine with previous header (without space indent)
        hs[hs.length - 1] += '\n' + h.slice(1);
      } else {
        hs.push(h);
      }
    }
    const obj = {
      parent: []
    };
    for (const h of hs) {
      const key = h.slice(0, h.indexOf(' '));
      const value = h.slice(h.indexOf(' ') + 1);
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
      for (const p of obj.parent) {
        headers += `parent ${p}\n`;
      }
    }
    const author = obj.author;
    headers += `author ${formatAuthor(author)}\n`;
    const committer = obj.committer || obj.author;
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
    const commit = normalizeNewlines(this._commit);
    if (commit.indexOf('\ngpgsig') === -1) return commit
    const headers = commit.slice(0, commit.indexOf('\ngpgsig'));
    const message = commit.slice(
      commit.indexOf('-----END PGP SIGNATURE-----\n') +
        '-----END PGP SIGNATURE-----\n'.length
    );
    return normalizeNewlines(headers + '\n' + message)
  }

  isolateSignature () {
    const signature = this._commit.slice(
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
    const signedCommit =
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

async function resolveTree ({ fs, gitdir, oid }) {
  // Empty tree - bypass `readObject`
  if (oid === '4b825dc642cb6eb9a060e54bf8d69288fbee4904') {
    return { tree: GitTree.from([]), oid }
  }
  const { type, object } = await readObject({ fs, gitdir, oid });
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
  constructor ({ fs, gitdir, ref }) {
    this.fs = fs;
    this.gitdir = gitdir;
    this.mapPromise = (async () => {
      const map = new Map();
      let oid;
      try {
        oid = await GitRefManager.resolve({ fs, gitdir, ref });
      } catch (e) {
        // Handle fresh branches with no commits
        if (e.code === E.ResolveRefError) {
          oid = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
        }
      }
      const tree = await resolveTree({ fs, gitdir, oid });
      tree.type = 'tree';
      map.set('.', tree);
      return map
    })();
    const walker = this;
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
    const filepath = entry.fullpath;
    const { fs, gitdir } = this;
    const map = await this.mapPromise;
    const obj = map.get(filepath);
    if (!obj) throw new Error(`No obj for ${filepath}`)
    const oid = obj.oid;
    if (!oid) throw new Error(`No oid for obj ${JSON.stringify(obj)}`)
    if (obj.type !== 'tree') {
      // TODO: support submodules (type === 'commit')
      return null
    }
    const { type, object } = await readObject({ fs, gitdir, oid });
    if (type !== obj.type) {
      throw new GitError(E.ObjectTypeAssertionFail, {
        oid,
        expected: obj.type,
        type
      })
    }
    const tree = GitTree.from(object);
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
    const map = await this.mapPromise;
    const stats = map.get(entry.fullpath);
    if (!stats) {
      throw new Error(
        `ENOENT: no such file or directory, lstat '${entry.fullpath}'`
      )
    }
    const { mode, type } = stats;
    Object.assign(entry, { mode, type, stats });
  }

  async populateContent (entry) {
    const map = await this.mapPromise;
    const { fs, gitdir } = this;
    const obj = map.get(entry.fullpath);
    if (!obj) throw new Error(`No obj for ${entry.fullpath}`)
    const oid = obj.oid;
    if (!oid) throw new Error(`No oid for entry ${JSON.stringify(obj)}`)
    const { type, object } = await readObject({ fs, gitdir, oid });
    if (type === 'tree') {
      throw new Error(`EISDIR: illegal operation on a directory, read`)
    }
    Object.assign(entry, { content: object });
  }

  async populateHash (entry) {
    const map = await this.mapPromise;
    const obj = map.get(entry.fullpath);
    if (!obj) {
      throw new Error(
        `ENOENT: no such file or directory, open '${entry.fullpath}'`
      )
    }
    const oid = obj.oid;
    Object.assign(entry, { oid });
  }
}

// This is part of an elaborate system to facilitate code-splitting / tree-shaking.
// commands/walk.js can depend on only this, and the actual Walker classes exported
// can be opaque - only having a single property (this symbol) that is not enumerable,
// and thus the constructor can be passed as an argument to walk while being "unusable"
// outside of it.
const GitWalkerSymbol = Symbol('GitWalkerSymbol');

// @ts-check

/**
 *
 * @typedef Walker
 * @property {Symbol} Symbol('GitWalkerSymbol')
 */

/**
 * Get a git commit Walker
 *
 * See [walkBeta1](./walkBeta1.md)
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ref='HEAD'] - [required] The commit to walk
 *
 * @returns {Walker} Returns a git commit Walker
 *
 */
function TREE ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref = 'HEAD'
}) {
  const o = Object.create(null);
  Object.defineProperty(o, GitWalkerSymbol, {
    value: function () {
      return new GitWalkerRepo({ fs, gitdir, ref })
    }
  });
  Object.freeze(o);
  return o
}

class GitWalkerFs {
  constructor ({ fs, dir, gitdir }) {
    const walker = this;
    this.treePromise = (async () => {
      const result = (await fs.readdirDeep(dir)).map(path => {
        // +1 index for trailing slash
        return { path: path.slice(dir.length + 1) }
      });
      return flatFileListToDirectoryStructure(result)
    })();
    this.indexPromise = (async () => {
      const result = await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
        return index.entries
          .filter(entry => entry.flags.stage === 0)
          .reduce((index, entry) => {
            index[entry.path] = entry;
            return index
          }, {})
      });
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
    const filepath = entry.fullpath;
    const { fs, dir } = this;
    const names = await fs.readdir(join(dir, filepath));
    if (names === null) return null
    return names.map(name => ({
      fullpath: join(filepath, name),
      basename: name,
      exists: true
    }))
  }

  async populateStat (entry) {
    if (!entry.exists) return
    const { fs, dir } = this;
    let stats = await fs.lstat(`${dir}/${entry.fullpath}`);
    let type = stats.isDirectory() ? 'tree' : 'blob';
    if (type === 'blob' && !stats.isFile() && !stats.isSymbolicLink()) {
      type = 'special';
    }
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
    const { fs, dir } = this;
    const content = await fs.read(`${dir}/${entry.fullpath}`);
    // workaround for a BrowserFS edge case
    if (entry.size === -1) entry.size = content.length;
    Object.assign(entry, { content });
  }

  async populateHash (entry) {
    if (!entry.exists) return
    const index = await this.indexPromise;
    const stage = index[entry.fullpath];
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

// @ts-check

/**
 *
 * @typedef Walker
 * @property {Symbol} Symbol('GitWalkerSymbol')
 */

/**
 * Get a working directory Walker
 *
 * See [walkBeta1](./walkBeta1.md)
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - The [git directory](dir-vs-gitdir.md) path
 *
 * @returns {Walker} Returns a working directory Walker
 *
 */
function WORKDIR ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs')
}) {
  const o = Object.create(null);
  Object.defineProperty(o, GitWalkerSymbol, {
    value: function () {
      return new GitWalkerFs({ fs, dir, gitdir })
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

// TODO: Should I just polyfill Array.flat?
const flat =
  typeof Array.prototype.flat === 'undefined'
    ? entries => entries.reduce((acc, x) => acc.concat(x), [])
    : entries => entries.flat();

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
  const min = new RunningMinimum();
  let minimum;
  const heads = [];
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
    const result = [];
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

// @ts-check

/**
 *
 * @typedef {Object} Walker
 * @property {Symbol} Symbol('GitWalkerSymbol')
 */

/**
 *
 * @typedef {Object} WalkerEntry The `WalkerEntry` is an interface that abstracts computing many common tree / blob stats.
 * @property {string} fullpath
 * @property {string} basename
 * @property {boolean} exists
 * @property {Function} populateStat
 * @property {'tree'|'blob'|'special'|'commit'} [type]
 * @property {number} [ctimeSeconds]
 * @property {number} [ctimeNanoseconds]
 * @property {number} [mtimeSeconds]
 * @property {number} [mtimeNanoseconds]
 * @property {number} [dev]
 * @property {number} [ino]
 * @property {number|string} [mode] WORKDIR and STAGE return numbers, TREE returns a string... I'll fix this in walkBeta2
 * @property {number} [uid]
 * @property {number} [gid]
 * @property {number} [size]
 * @property {Function} populateContent
 * @property {Buffer} [content]
 * @property {Function} populateHash
 * @property {string} [oid]
 */

/**
 * A powerful recursive tree-walking utility.
 *
 * The `walk` API (tentatively named `walkBeta1`) simplifies gathering detailed information about a tree or comparing all the filepaths in two or more trees.
 * Trees can be file directories, git commits, or git indexes (aka staging areas).
 * So you can compare two file directories, or 10 commits, or the stage of one repo with the working directory of another repo... etc.
 * As long as a file or directory is present in at least one of the trees, it will be traversed.
 * Entries are traversed in alphabetical order.
 *
 * The arguments to `walk` are the `trees` you want to traverse, and 4 optional transform functions:
 *  `filter`, `map`, `reduce`, and `iterate`.
 *
 * The trees are represented by three magic functions that can be imported:
 * ```js
 * import { TREE, WORKDIR, STAGE } from 'isomorphic-git'
 * ```
 *
 * These functions return objects that implement the `Walker` interface.
 * The only thing they are good for is passing into `walkBeta1`'s `trees` argument.
 * Here are the three `Walker`s passed into `walkBeta1` by the `statusMatrix` command for example:
 *
 * ```js
 * let gitdir = '.git'
 * let dir = '.'
 * let ref = 'HEAD'
 *
 * let trees = [
 *   TREE({fs, gitdir, ref}),
 *   WORKDIR({fs, dir, gitdir}),
 *   STAGE({fs, gitdir})
 * ]
 * ```
 *
 * See the doc pages for [TREE](./TREE.md), [WORKDIR](./WORKDIR.md), and [STAGE](./STAGE.md).
 *
 * `filter`, `map`, `reduce`, and `iterate` allow you control the recursive walk by pruning and transforming `WalkerTree`s into the desired result.
 *
 * ## WalkerEntry
 * The `WalkerEntry` is an interface that abstracts computing many common tree / blob stats.
 * `filter` and `map` each receive an array of `WalkerEntry[]` as their main argument, one `WalkerEntry` for each `Walker` in the `trees` argument.
 *
 * By default, `WalkerEntry`s only have three properties:
 * ```js
 * {
 *   fullpath: string;
 *   basename: string;
 *   exists: boolean;
 * }
 * ```
 *
 * Additional properties can be computed only when needed. This lets you build lean, mean, efficient walking machines.
 * ```js
 * await entry.populateStat()
 * // populates
 * entry.type // 'tree', 'blob'
 * // and where applicable, these properties:
 * entry.ctimeSeconds // number;
 * entry.ctimeNanoseconds // number;
 * entry.mtimeSeconds // number;
 * entry.mtimeNanoseconds // number;
 * entry.dev // number;
 * entry.ino // number;
 * entry.mode // number;
 * entry.uid // number;
 * entry.gid // number;
 * entry.size // number;
 * ```
 *
 * ```js
 * await entry.populateContent()
 * // populates
 * entry.content // Buffer
 * // except for STAGE which does not currently provide content
 * ```
 *
 * ```js
 * await entry.populateHash()
 * // populates
 * entry.oid // SHA1 string
 * ```
 *
 * ## filter(WalkerEntry[]) => boolean
 *
 * Default: `async () => true`.
 *
 * This is a good place to put limiting logic such as skipping entries with certain filenames.
 * If you return false for directories, then none of the children of that directory will be walked.
 *
 * Example:
 * ```js
 * let path = require('path')
 * let cwd = 'src/app'
 * // Only examine files in the directory `cwd`
 * async function filter ([head, workdir, stage]) {
 *   // It doesn't matter which tree (head, workdir, or stage) you use here.
 *   return (
 *     // return true for the root directory
 *     head.fullpath === '.' ||
 *     // return true for 'src' and 'src/app'
 *     cwd.startsWith(head.fullpath) ||
 *     // return true for 'src/app/*'
 *     path.dirname(head.fullpath) === cwd
 *   )
 * }
 * ```
 *
 * ## map(WalkerEntry[]) => any
 *
 * Default: `async entry => entry`
 *
 * This is a good place for query logic, such as examining the contents of a file.
 * Ultimately, compare all the entries and return any values you are interested in.
 * If you do not return a value (or return undefined) that entry will be filtered from the results.
 *
 * Example 1: Find all the files containing the word 'foo'.
 * ```js
 * async function map([head, workdir]) {
 *   await workdir.populateContent()
 *   let content = workdir.content.toString('utf8')
 *   if (content.contains('foo')) {
 *     return {
 *       fullpath: workdir.fullpath,
 *       content
 *     }
 *   }
 * }
 *
 * ```
 *
 * Example 2: Return the difference between the working directory and the HEAD commit
 * ```js
 * const diff = require('diff-lines')
 * async function map([head, workdir]) {
 *   await head.populateContent()
 *   await head.populateHash()
 *   await workdir.populateContent()
 *   return {
 *     filename: head.fullpath,
 *     oid: head.oid,
 *     diff: diff(head.content.toString('utf8'), workdir.content.toString('utf8'))
 *   }
 * }
 * ```
 *
 * ## reduce(parent, children)
 *
 * Default: `async (parent, children) => parent === undefined ? children.flat() : [parent, children].flat()`
 *
 * The default implementation of this function returns all directories and children in a giant flat array.
 * You can define a different accumulation method though.
 *
 * Example: Return a hierarchical structure
 * ```js
 * async function reduce (parent, children) {
 *   return Object.assign(parent, { children })
 * }
 * ```
 *
 * ## iterate(walk, children)
 *
 * Default: `(walk, children) => Promise.all([...children].map(walk))`
 *
 * The default implementation recurses all children concurrently using Promise.all.
 * However you could use a custom function to traverse children serially or use a global queue to throttle recursion.
 *
 * > Note: For a complete example, look at the implementation of `statusMatrix`.
 *
 * @param {object} args
 * @param {Walker[]} args.trees - The trees you want to traverse
 * @param {function(WalkerEntry[]): Promise<boolean>} [args.filter] - Filter which `WalkerEntry`s to process
 * @param {function(WalkerEntry[]): Promise<any>} [args.map] - Transform `WalkerEntry`s into a result form
 * @param {function(any, any[]): Promise<any>} [args.reduce] - Control how mapped entries are combined with their parent result
 * @param {function(function(WalkerEntry[]): Promise<any[]>, IterableIterator<WalkerEntry[]>): Promise<any[]>} [args.iterate] - Fine-tune how entries within a tree are iterated over
 *
 * @returns {Promise<any>} The finished tree-walking result
 *
 * @see WalkerEntry
 *
 */
async function walkBeta1 ({
  trees,
  filter = async () => true,
  // @ts-ignore
  map = async entry => entry,
  // The default reducer is a flatmap that filters out undefineds.
  reduce = async (parent, children) => {
    const flatten = flat(children);
    if (parent !== undefined) flatten.unshift(parent);
    return flatten
  },
  // The default iterate function walks all children concurrently
  iterate = (walk, children) => Promise.all([...children].map(walk))
}) {
  try {
    const walkers = trees.map(proxy => proxy[GitWalkerSymbol]());

    const root = new Array(walkers.length).fill({
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
      const iterators = subdirs
        .map(array => (array === null ? [] : array))
        .map(array => array[Symbol.iterator]());
      return {
        entry,
        children: unionOfIterators(iterators)
      }
    };

    const walk = async root => {
      const { children, entry } = await unionWalkerFromReaddir(root);
      if (await filter(entry)) {
        const parent = await map(entry);
        let walkedChildren = await iterate(walk, children);
        walkedChildren = walkedChildren.filter(x => x !== undefined);
        return reduce(parent, walkedChildren)
      }
    };
    return walk(root)
  } catch (err) {
    err.caller = 'git.walk';
    throw err
  }
}

// @ts-check

/**
 * Checkout a branch
 *
 * If the branch already exists it will check out that branch. Otherwise, it will create a new remote tracking branch set to track the remote branch of that name.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md)
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name
 * @param {string} args.ref - Which branch to checkout
 * @param {string[]} [args.filepaths = ['.']] - Limit the checkout to the given files and directories
 * @param {string} [args.pattern = null] - Only checkout the files that match a glob pattern. (Pattern is relative to `filepaths` if `filepaths` is provided.)
 * @param {string} [args.remote = 'origin'] - Which remote repository to use
 * @param {boolean} [args.noCheckout = false] - If true, will update HEAD but won't update the working directory
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * // checkout the master branch
 * await git.checkout({ dir: '$input((/))', ref: '$input((master))' })
 * console.log('done')
 *
 * @example
 * // checkout only JSON and Markdown files from master branch
 * await git.checkout({ dir: '$input((/))', ref: '$input((master))', pattern: '$input((**\/*.{json,md}))' })
 * console.log('done')
 *
 */
async function checkout ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  remote = 'origin',
  ref,
  filepaths = ['.'],
  pattern = null,
  noCheckout = false
}) {
  try {
    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'checkout',
        parameter: 'ref'
      })
    }
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: `Checking out ${remote}/${ref}`,
        loaded: 0,
        lengthComputable: false
      });
    }
    let patternPart = '';
    let patternGlobrex;
    if (pattern) {
      patternPart = patternRoot(pattern);
      if (patternPart) {
        pattern = pattern.replace(patternPart + '/', '');
      }
      patternGlobrex = globrex(pattern, { globstar: true, extended: true });
    }
    const bases = filepaths.map(filepath => join(filepath, patternPart));
    // Get tree oid
    let oid;
    try {
      oid = await GitRefManager.resolve({ fs, gitdir, ref });
      // TODO: Figure out what to do if both 'ref' and 'remote' are specified, ref already exists,
      // and is configured to track a different remote.
    } catch (err) {
      // If `ref` doesn't exist, create a new remote tracking branch
      // Figure out the commit to checkout
      const remoteRef = `${remote}/${ref}`;
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
    const fullRef = await GitRefManager.expand({ fs, gitdir, ref });

    if (!noCheckout) {
      let count = 0;
      const gitdirBasename = dir ? gitdir.replace(dir + '/', '') : gitdir;
      // Acquire a lock on the index
      await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
        // Instead of deleting and rewriting everything, only delete files
        // that are not present in the new branch, and only write files that
        // are not in the index or are in the index but have the wrong SHA.
        try {
          await walkBeta1({
            trees: [TREE({ fs, dir, gitdir, ref }), WORKDIR({ fs, dir, gitdir })],
            filter: async function ([head, workdir]) {
              // match against base paths
              return bases.some(base => worthWalking(head.fullpath, base))
            },
            map: async function ([head, workdir]) {
              if (head.fullpath === '.') return
              const workdirPath = workdir.fullpath;
              if (workdirPath === gitdirBasename) return
              // Late filter against file names
              if (patternGlobrex) {
                let match = false;
                for (const base of bases) {
                  const partToMatch = head.fullpath.replace(base + '/', '');
                  if (patternGlobrex.regex.test(partToMatch)) {
                    match = true;
                    break
                  }
                }
                if (!match) return
              }
              const stage = index.entriesMap.get(GitIndex.key(workdirPath, 0));
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
                  const { fullpath, oid, mode } = head;
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
                    const stats = await fs.lstat(filepath);
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
                    if (emitter) {
                      emitter.emit(`${emitterPrefix}progress`, {
                        phase: 'Updating workdir',
                        loaded: ++count,
                        lengthComputable: false
                      });
                    }
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
      });
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

function calculateBasicAuthUsernamePasswordPair (
  { username, password, token, oauth2format } = {},
  allowEmptyPassword = false
) {
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
    case '1000':
      if (allowEmptyPassword) return { username, password: '' }
      else throw new GitError(E.MissingPasswordTokenError)
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
  const [username, password] = userpass.split(':');
  url = url.replace(`${userpass}@`, '');
  return { url, username, password }
}

// Currently 'for await' upsets my linters.
async function forAwait (iterable, cb) {
  const iter = getIterator(iterable);
  while (true) {
    const { value, done } = await iter.next();
    if (value) await cb(value);
    if (done) break
  }
  if (iter.return) iter.return();
}

function asyncIteratorToStream (iter) {
  const { PassThrough } = require('readable-stream');
  const stream = new PassThrough();
  setTimeout(async () => {
    await forAwait(iter, chunk => stream.write(chunk));
    stream.end();
  }, 1);
  return stream
}

async function collect (iterable) {
  const buffers = [];
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
  // If we can, we should send it as a single buffer so it sets a Content-Length header.
  if (body && Array.isArray(body)) {
    body = await collect(body);
  } else if (body) {
    body = asyncIteratorToStream(body);
  }
  return new Promise((resolve, reject) => {
    const get = require('simple-get');
    get(
      {
        url,
        method,
        headers,
        body
      },
      (err, res) => {
        if (err) return reject(err)
        const iter = fromNodeStream(res);
        resolve({
          url: res.url,
          method: res.method,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          body: iter,
          headers: res.headers
        });
      }
    );
  })
}

const pkg = {
  name: 'isomorphic-git',
  version: '0.0.0-development',
  agent: 'git/isomorphic-git@0.0.0-development'
};

function padHex (b, n) {
  const s = n.toString(16);
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
    const length = line.length + 4;
    const hexlength = padHex(4, length);
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
        const buffer = await reader.read(length - 4);
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
  const read = GitPktLine.streamReader(stream);
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
  const [firstRef, capabilitiesLine] = lineTwo
    .toString('utf8')
    .trim()
    .split('\x00');
  capabilitiesLine.split(' ').map(x => capabilities.add(x));
  const [ref, name] = firstRef.split(' ');
  refs.set(name, ref);
  while (true) {
    const line = await read();
    if (line === true) break
    if (line !== null) {
      const [ref, name] = line
        .toString('utf8')
        .trim()
        .split(' ');
      refs.set(name, ref);
    }
  }
  // Symrefs are thrown into the "capabilities" unfortunately.
  for (const cap of capabilities) {
    if (cap.startsWith('symref=')) {
      const m = cap.match(/symref=([^:]+):(.*)/);
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
    const urlAuth = extractAuthFromUrl(url);
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
    const http$1 = cores.get(core).get('http') || http;
    // headers['Accept'] = `application/x-${service}-advertisement`
    // Only send a user agent in Node and to CORS proxies by default,
    // because Gogs and others might not whitelist 'user-agent' in allowed headers.
    // Solutions using 'process.browser' can't be used as they rely on bundler shims,
    // ans solutions using 'process.versions.node' had to be discarded because the
    // BrowserFS 'process' shim is too complete.
    if (typeof window === 'undefined' || corsProxy) {
      headers['user-agent'] = headers['user-agent'] || pkg.agent;
    }
    // If the username came from the URL, we want to allow the password to be missing.
    // This is because Github allows using the token as the username with an empty password
    // so that is a style of git clone URL we might encounter and we don't want to throw a "Missing password or token" error.
    // Also, we don't want to prematurely throw an error before the credentialManager plugin has
    // had an opportunity to provide the password.
    const _auth = calculateBasicAuthUsernamePasswordPair(auth, !!urlAuth);
    if (_auth) {
      headers['Authorization'] = calculateBasicAuthHeader(_auth);
    }
    let res = await http$1({
      core,
      method: 'GET',
      url: `${url}/info/refs?service=${service}`,
      headers
    });
    if (res.statusCode === 401 && cores.get(core).has('credentialManager')) {
      // Acquire credentials and try again
      const credentialManager = cores.get(core).get('credentialManager');
      auth = await credentialManager.fill({ url: _origUrl });
      const _auth = calculateBasicAuthUsernamePasswordPair(auth);
      if (_auth) {
        headers['Authorization'] = calculateBasicAuthHeader(_auth);
      }
      res = await http$1({
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
      const remoteHTTP = await parseRefsAdResponse(res.body, {
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
    const urlAuth = extractAuthFromUrl(url);
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
    const http$1 = cores.get(core).get('http') || http;
    // Only send a user agent in Node and to CORS proxies by default,
    // because Gogs and others might not whitelist 'user-agent' in allowed headers.
    // Solutions using 'process.browser' can't be used as they rely on bundler shims,
    // ans solutions using 'process.versions.node' had to be discarded because the
    // BrowserFS 'process' shim is too complete.
    if (typeof window === 'undefined' || corsProxy) {
      headers['user-agent'] = headers['user-agent'] || pkg.agent;
    }
    // If the username came from the URL, we want to allow the password to be missing.
    // This is because Github allows using the token as the username with an empty password
    // so that is a style of git clone URL we might encounter and we don't want to throw a "Missing password or token" error.
    // Also, we don't want to prematurely throw an error before the credentialManager plugin has
    // had an opportunity to provide the password.
    auth = calculateBasicAuthUsernamePasswordPair(auth, !!urlAuth);
    if (auth) {
      headers['Authorization'] = calculateBasicAuthHeader(auth);
    }
    const res = await http$1({
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
  const matches = url.match(/(\w+)(:\/\/|::)(.*)/);
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

    const parts = parseRemoteUrl({ url });
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
  static async read ({ fs, gitdir }) {
    if (lock$1 === null) lock$1 = new AsyncLock();
    const filepath = join(gitdir, 'shallow');
    const oids = new Set();
    await lock$1.acquire(filepath, async function () {
      const text = await fs.read(filepath, { encoding: 'utf8' });
      if (text === null) return oids // no file
      if (text.trim() === '') return oids // empty file
      text
        .trim()
        .split('\n')
        .map(oid => oids.add(oid));
    });
    return oids
  }

  static async write ({ fs, gitdir, oids }) {
    if (lock$1 === null) lock$1 = new AsyncLock();
    const filepath = join(gitdir, 'shallow');
    if (oids.size > 0) {
      const text = [...oids].join('\n') + '\n';
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

async function hasObjectLoose ({ fs, gitdir, oid }) {
  const source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  return fs.exists(`${gitdir}/${source}`)
}

async function hasObjectPacked ({
  fs,
  gitdir,
  oid,
  getExternalRefDelta
}) {
  // Check to see if it's in a packfile.
  // Iterate through all the .idx files
  let list = await fs.readdir(join(gitdir, 'objects/pack'));
  list = list.filter(x => x.endsWith('.idx'));
  for (const filename of list) {
    const indexFile = `${gitdir}/objects/pack/${filename}`;
    const p = await readPackIndex({
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

async function hasObject ({ fs, gitdir, oid, format = 'content' }) {
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

// @see https://git-scm.com/docs/git-rev-parse.html#_specifying_revisions
const abbreviateRx = new RegExp('^refs/(heads/|tags/|remotes/)?(.*)');

function abbreviateRef (ref) {
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

// TODO: make a function that just returns obCount. then emptyPackfile = () => sizePack(pack) === 0
function emptyPackfile (pack) {
  const pheader = '5041434b';
  const version = '00000002';
  const obCount = '00000000';
  const header = pheader + version + obCount;
  return pack.slice(0, 12).toString('hex') === header
}

function filterCapabilities (server, client) {
  const serverNames = server.map(cap => cap.split('=', 1)[0]);
  return client.filter(cap => {
    const name = cap.split('=', 1)[0];
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
      const resolve = this._waiting;
      this._waiting = null;
      resolve({ value: chunk });
    } else {
      this._queue.push(chunk);
    }
  }

  end () {
    this._ended = true;
    if (this._waiting) {
      const resolve = this._waiting;
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
  const r = str.indexOf('\r');
  const n = str.indexOf('\n');
  if (r === -1 && n === -1) return -1
  if (r === -1) return n + 1 // \n
  if (n === -1) return r + 1 // \r
  if (n === r + 1) return n + 1 // \r\n
  return Math.min(r, n) + 1 // \r or \n
}

function splitLines (input) {
  const output = new FIFO();
  let tmp = ''
  ;(async () => {
    await forAwait(input, chunk => {
      chunk = chunk.toString('utf8');
      tmp += chunk;
      while (true) {
        const i = findSplit(tmp);
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
    const read = GitPktLine.streamReader(input);
    // And now for the ridiculous side-band or side-band-64k protocol
    const packetlines = new FIFO();
    const packfile = new FIFO();
    const progress = new FIFO();
    // TODO: Use a proper through stream?
    const nextBit = async function () {
      const line = await read();
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
          const error = line.slice(1);
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
  const shallows = [];
  const unshallows = [];
  const acks = [];
  let nak = false;
  let done = false;
  return new Promise((resolve, reject) => {
    // Parse the response
    forAwait(packetlines, data => {
      const line = data.toString('utf8').trim();
      if (line.startsWith('shallow')) {
        const oid = line.slice(-41).trim();
        if (oid.length !== 40) {
          reject(new GitError(E.CorruptShallowOidFail, { oid }));
        }
        shallows.push(oid);
      } else if (line.startsWith('unshallow')) {
        const oid = line.slice(-41).trim();
        if (oid.length !== 40) {
          reject(new GitError(E.CorruptShallowOidFail, { oid }));
        }
        unshallows.push(oid);
      } else if (line.startsWith('ACK')) {
        const [, oid, status] = line.split(' ');
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
  const packstream = [];
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

// @ts-check

/**
 *
 * @typedef {object} FetchResponse - The object returned has the following schema:
 * @property {string | null} defaultBranch - The branch that is cloned if no branch is specified (typically "master")
 * @property {string | null} fetchHead - The SHA-1 object id of the fetched head commit
 * @property {string | null} fetchHeadDescription - a textual description of the branch that was fetched
 * @property {object} [headers] - The HTTP response headers returned by the git server
 * @property {string[]} [pruned] - A list of branches that were pruned, if you provided the `prune` parameter
 *
 */

/**
 * Fetch commits from a remote repository
 *
 * Future versions of isomorphic-git might return additional metadata.
 *
 * To monitor progress events, see the documentation for the [`'emitter'` plugin](./plugin_emitter.md).
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.url] - The URL of the remote repository. Will be gotten from gitconfig if absent.
 * @param {string} [args.corsProxy] - Optional [CORS proxy](https://www.npmjs.com/%40isomorphic-git/cors-proxy). Overrides value in repo config.
 * @param {string} [args.ref = 'HEAD'] - Which branch to fetch. By default this is the currently checked out branch.
 * @param {boolean} [args.singleBranch = false] - Instead of the default behavior of fetching all the branches, only fetch a single branch.
 * @param {boolean} [args.noGitSuffix = false] - If true, clone will not auto-append a `.git` suffix to the `url`. (**AWS CodeCommit needs this option**)
 * @param {boolean} [args.tags = false] - Also fetch tags
 * @param {string} [args.remote] - What to name the remote that is created.
 * @param {number} [args.depth] - Integer. Determines how much of the git repository's history to retrieve
 * @param {Date} [args.since] - Only fetch commits created after the given date. Mutually exclusive with `depth`.
 * @param {string[]} [args.exclude = []] - A list of branches or tags. Instructs the remote server not to send us any commits reachable from these refs.
 * @param {boolean} [args.relative = false] - Changes the meaning of `depth` to be measured from the current shallow depth rather than from the branch tip.
 * @param {string} [args.username] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.password] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.token] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.oauth2format] - See the [Authentication](./authentication.html) documentation
 * @param {object} [args.headers] - Additional headers to include in HTTP requests, similar to git's `extraHeader` config
 * @param {boolean} [args.prune] - Delete local remote-tracking branches that are not present on the remote
 * @param {boolean} [args.pruneTags] - Prune local tags that don’t exist on the remote, and force-update those tags that differ
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md).
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name.
 *
 * @returns {Promise<FetchResponse>} Resolves successfully when fetch completes
 * @see FetchResponse
 *
 * @example
 * await git.fetch({
 *   dir: '$input((/))',
 *   corsProxy: 'https://cors.isomorphic-git.org',
 *   url: '$input((https://github.com/isomorphic-git/isomorphic-git))',
 *   ref: '$input((master))',
 *   depth: $input((1)),
 *   singleBranch: $input((true)),
 *   tags: $input((false))
 * })
 * console.log('done')
 *
 */
async function fetch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref = 'HEAD',
  // @ts-ignore
  refs,
  remote,
  url,
  noGitSuffix = false,
  corsProxy,
  // @ts-ignore
  authUsername,
  // @ts-ignore
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
  prune = false,
  pruneTags = false,
  // @ts-ignore
  onprogress // deprecated
}) {
  try {
    if (onprogress !== undefined) {
      console.warn(
        'The `onprogress` callback has been deprecated. Please use the more generic `emitter` EventEmitter argument instead.'
      );
    }
    const response = await fetchPackfile({
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
      headers,
      prune,
      pruneTags
    });
    if (response === null) {
      return {
        defaultBranch: null,
        fetchHead: null,
        fetchHeadDescription: null
      }
    }
    if (emitter) {
      const lines = splitLines(response.progress);
      forAwait(lines, line => {
        // As a historical accident, 'message' events were trimmed removing valuable information,
        // such as \r by itself which was a single to update the existing line instead of appending a new one.
        // TODO NEXT BREAKING RELEASE: make 'message' behave like 'rawmessage' and remove 'rawmessage'.
        emitter.emit(`${emitterPrefix}message`, line.trim());
        emitter.emit(`${emitterPrefix}rawmessage`, line);
        const matches = line.match(/([^:]*).*\((\d+?)\/(\d+?)\)/);
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
    const packfile = await collect(response.packfile);
    const packfileSha = packfile.slice(-20).toString('hex');
    const res = {
      defaultBranch: response.HEAD,
      fetchHead: response.FETCH_HEAD.oid,
      fetchHeadDescription: response.FETCH_HEAD.description
    };
    if (response.headers) {
      res.headers = response.headers;
    }
    if (prune) {
      res.pruned = response.pruned;
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
  fs,
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
  headers,
  prune,
  pruneTags
}) {
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
  const GitRemoteHTTP = GitRemoteManager.getRemoteHelperFor({ url });
  const remoteHTTP = await GitRemoteHTTP.discover({
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
  const { oid, fullref } = GitRefManager.resolveAgainstMap({
    ref,
    map: remoteRefs
  });
  // Filter out refs we want to ignore: only keep ref we're cloning, HEAD, branches, and tags (if we're keeping them)
  for (const remoteRef of remoteRefs.keys()) {
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
      // Note: I removed 'thin-pack' option since our code doesn't "fatten" packfiles,
      // which is necessary for compatibility with git. It was the cause of mysterious
      // 'fatal: pack has [x] unresolved deltas' errors that plagued us for some time.
      // isomorphic-git is perfectly happy with thin packfiles in .git/objects/pack but
      // canonical git it turns out is NOT.
      'ofs-delta',
      `agent=${pkg.agent}`
    ]
  );
  if (relative) capabilities.push('deepen-relative');
  // Start figuring out which oids from the remote we want to request
  const wants = singleBranch ? [oid] : remoteRefs.values();
  // Come up with a reasonable list of oids to tell the remote we already have
  // (preferably oids that are close ancestors of the branch heads we're fetching)
  const haveRefs = singleBranch
    ? refs
    : await GitRefManager.listRefs({
      fs,
      gitdir,
      filepath: `refs`
    });
  let haves = [];
  for (let ref of haveRefs) {
    try {
      ref = await GitRefManager.expand({ fs, gitdir, ref });
      const oid = await GitRefManager.resolve({ fs, gitdir, ref });
      if (await hasObject({ fs, gitdir, oid })) {
        haves.push(oid);
      }
    } catch (err) {}
  }
  haves = [...new Set(haves)];
  const oids = await GitShallowManager.read({ fs, gitdir });
  const shallows = remoteHTTP.capabilities.has('shallow') ? [...oids] : [];
  const packstream = writeUploadPackRequest({
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
  const packbuffer = await collect(packstream);
  const raw = await GitRemoteHTTP.connect({
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
  const response = await parseUploadPackResponse(raw.body);
  if (raw.headers) {
    response.headers = raw.headers;
  }
  // Apply all the 'shallow' and 'unshallow' commands
  for (const oid of response.shallows) {
    if (!oids.has(oid)) {
      // this is in a try/catch mostly because my old test fixtures are missing objects
      try {
        // server says it's shallow, but do we have the parents?
        const { object } = await readObject({ fs, gitdir, oid });
        const commit = new GitCommit(object);
        const hasParents = await Promise.all(
          commit.headers().parent.map(oid => hasObject({ fs, gitdir, oid }))
        );
        const haveAllParents =
          hasParents.length === 0 || hasParents.every(has => has);
        if (!haveAllParents) {
          oids.add(oid);
        }
      } catch (err) {
        oids.add(oid);
      }
    }
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
      const value = remoteHTTP.symrefs.get(key);
      if (value === undefined) break
      symrefs.set(key, value);
      key = value;
    }
    // final value must not be a symref but a real ref
    refs.set(key, remoteRefs.get(key));
    const { pruned } = await GitRefManager.updateRemoteRefs({
      fs,
      gitdir,
      remote,
      refs,
      symrefs,
      tags,
      prune
    });
    if (prune) {
      response.pruned = pruned;
    }
  } else {
    const { pruned } = await GitRefManager.updateRemoteRefs({
      fs,
      gitdir,
      remote,
      refs: remoteRefs,
      symrefs: remoteHTTP.symrefs,
      tags,
      prune,
      pruneTags
    });
    if (prune) {
      response.pruned = pruned;
    }
  }
  // We need this value later for the `clone` command.
  response.HEAD = remoteHTTP.symrefs.get('HEAD');
  // AWS CodeCommit doesn't list HEAD as a symref, but we can reverse engineer it
  // Find the SHA of the branch called HEAD
  if (response.HEAD === undefined) {
    const { oid } = GitRefManager.resolveAgainstMap({
      ref: 'HEAD',
      map: remoteRefs
    });
    // Use the name of the first branch that's not called HEAD that has
    // the same SHA as the branch called HEAD.
    for (const [key, value] of remoteRefs.entries()) {
      if (key !== 'HEAD' && value === oid) {
        response.HEAD = key;
        break
      }
    }
  }
  const noun = fullref.startsWith('refs/tags') ? 'tag' : 'branch';
  response.FETCH_HEAD = {
    oid,
    description: `${noun} '${abbreviateRef(fullref)}' of ${url}`
  };
  return response
}

// @ts-check

/**
 * Initialize a new repository
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {boolean} [args.bare = false] - Initialize a bare repository
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md)
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name
 * @returns {Promise<void>}  Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.init({ dir: '$input((/))' })
 * console.log('done')
 *
 */
async function init ({
  core = 'default',
  bare = false,
  dir,
  gitdir = bare ? dir : join(dir, '.git'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  fs = cores.get(core).get('fs')
}) {
  try {
    let count = 0;
    let folders = [
      'hooks',
      'info',
      'objects/info',
      'objects/pack',
      'refs/heads',
      'refs/tags'
    ];
    const total = folders.length;
    folders = folders.map(dir => gitdir + '/' + dir);
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Initializing repo',
        loaded: 0,
        total,
        lengthComputable: true
      });
    }
    for (const folder of folders) {
      await fs.mkdir(folder);
      if (emitter) {
        emitter.emit(`${emitterPrefix}progress`, {
          phase: 'Initializing repo',
          loaded: ++count,
          total,
          lengthComputable: true
        });
      }
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

// @ts-check

/**
 * Clone a repository
 *
 * To monitor progress events, see the documentation for the [`'emitter'` plugin](./plugin_emitter.md).
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.url - The URL of the remote repository
 * @param {string} [args.corsProxy] - Optional [CORS proxy](https://www.npmjs.com/%40isomorphic-git/cors-proxy). Value is stored in the git config file for that repo.
 * @param {string} [args.ref] - Which branch to clone. By default this is the designated "main branch" of the repository.
 * @param {boolean} [args.singleBranch = false] - Instead of the default behavior of fetching all the branches, only fetch a single branch.
 * @param {boolean} [args.noCheckout = false] - If true, clone will only fetch the repo, not check out a branch. Skipping checkout can save a lot of time normally spent writing files to disk.
 * @param {boolean} [args.noGitSuffix = false] - If true, clone will not auto-append a `.git` suffix to the `url`. (**AWS CodeCommit needs this option**.)
 * @param {boolean} [args.noTags = false] - By default clone will fetch all tags. `noTags` disables that behavior.
 * @param {string} [args.remote = 'origin'] - What to name the remote that is created.
 * @param {number} [args.depth] - Integer. Determines how much of the git repository's history to retrieve
 * @param {Date} [args.since] - Only fetch commits created after the given date. Mutually exclusive with `depth`.
 * @param {string[]} [args.exclude = []] - A list of branches or tags. Instructs the remote server not to send us any commits reachable from these refs.
 * @param {boolean} [args.relative = false] - Changes the meaning of `depth` to be measured from the current shallow depth rather than from the branch tip.
 * @param {string} [args.username] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.password] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.token] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.oauth2format] - See the [Authentication](./authentication.html) documentation
 * @param {object} [args.headers = {}] - Additional headers to include in HTTP requests, similar to git's `extraHeader` config
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md)
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name
 *
 * @returns {Promise<void>} Resolves successfully when clone completes
 *
 * @example
 * await git.clone({
 *   dir: '$input((/))',
 *   corsProxy: 'https://cors.isomorphic-git.org',
 *   url: '$input((https://github.com/isomorphic-git/isomorphic-git))',
 *   $textarea((singleBranch: true,
 *   depth: 1))
 * })
 * console.log('done')
 *
 */
async function clone ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  url,
  noGitSuffix = false,
  corsProxy = undefined,
  ref = undefined,
  remote = 'origin',
  // @ts-ignore
  authUsername,
  // @ts-ignore
  authPassword,
  username = undefined,
  password = undefined,
  token = undefined,
  oauth2format = undefined,
  depth = undefined,
  since = undefined,
  exclude = [],
  relative = false,
  singleBranch = false,
  noCheckout = false,
  noTags = false,
  headers = {},
  // @ts-ignore
  onprogress
}) {
  try {
    if (onprogress !== undefined) {
      console.warn(
        'The `onprogress` callback has been deprecated. Please use the more generic `emitter` EventEmitter argument instead.'
      );
    }
    username = username === undefined ? authUsername : username;
    password = password === undefined ? authPassword : password;
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

// @ts-check

/**
 * Create a new commit
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.message - The commit message to use.
 * @param {Object} [args.author] - The details about the author.
 * @param {string} [args.author.name] - Default is `user.name` config.
 * @param {string} [args.author.email] - Default is `user.email` config.
 * @param {string} [args.author.date] - Set the author timestamp field. Default is the current date.
 * @param {string} [args.author.timestamp] - Set the author timestamp field. This is an alternative to using `date` using an integer number of seconds since the Unix epoch instead of a JavaScript date object.
 * @param {string} [args.author.timezoneOffset] - Set the author timezone offset field. This is the difference, in minutes, from the current timezone to UTC. Default is `(new Date()).getTimezoneOffset()`.
 * @param {Object} [args.committer = author] - The details about the commit committer, in the same format as the author parameter. If not specified, the author details are used.
 * @param {string} [args.signingKey] - Sign the tag object using this private PGP key.
 * @param {boolean} [args.dryRun = false] - If true, simulates making a commit so you can test whether it would succeed. Implies `noUpdateBranch`.
 * @param {boolean} [args.noUpdateBranch = false] - If true, does not update the branch pointer after creating the commit.
 * @param {string} [args.ref] - The fully expanded name of the branch to commit to. Default is the current branch pointed to by HEAD. (TODO: fix it so it can expand branch names without throwing if the branch doesn't exist yet.)
 * @param {string[]} [args.parent] - The SHA-1 object ids of the commits to use as parents. If not specified, the commit pointed to by `ref` is used.
 * @param {string} [args.tree] - The SHA-1 object id of the tree to use. If not specified, a new tree object is created from the current git index.
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md)
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name
 *
 * @returns {Promise<string>} Resolves successfully with the SHA-1 object id of the newly created commit.
 *
 * @example
 * let sha = await git.commit({
 *   dir: '$input((/))',
 *   author: {
 *     name: '$input((Mr. Test))',
 *     email: '$input((mrtest@example.com))'
 *   },
 *   message: '$input((Added the a.txt file))'
 * })
 * console.log(sha)
 *
 */
async function commit ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  message,
  author,
  committer,
  signingKey,
  dryRun = false,
  noUpdateBranch = false,
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref,
  parent,
  tree
}) {
  try {
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Creating commit',
        loaded: 0,
        lengthComputable: false
      });
    }
    if (!ref) {
      ref = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: 'HEAD',
        depth: 2
      });
    }

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

    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Creating commit tree',
        loaded: 0,
        lengthComputable: false
      });
    }

    return GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      if (!parent) {
        try {
          parent = [
            await GitRefManager.resolve({
              fs,
              gitdir,
              ref
            })
          ];
        } catch (err) {
          // Probably an initial commit
          parent = [];
        }
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
        if (parent.length) {
          if (!parent.includes(mergeHash)) parent.push(mergeHash);
        } else {
          throw new GitError(E.NoHeadCommitError, { noun: 'merge commit', ref: mergeHash })
        }
      }

      if (!tree) {
        tree = await GitIndexManager.constructTree({ fs, gitdir, dryRun, index });
      }

      if (emitter) {
        emitter.emit(`${emitterPrefix}progress`, {
          phase: 'Writing commit',
          loaded: 0,
          lengthComputable: false
        });
      }

      let comm = GitCommit.from({
        tree,
        parent,
        author,
        committer,
        message
      });
      if (signingKey) {
        const pgp = cores.get(core).get('pgp');
        comm = await GitCommit.sign(comm, pgp, signingKey);
      }
      const oid = await writeObject({
        fs,
        gitdir,
        type: 'commit',
        object: comm.toObject(),
        dryRun
      });
      if (!noUpdateBranch && !dryRun) {
        // Update branch pointer
        await GitRefManager.writeRef({
          fs,
          gitdir,
          ref,
          value: oid
        });
        if (mergeHash) {
          await GitRefManager.deleteRef({ fs, gitdir, ref: 'MERGE_HEAD' });
          await fs.rm(join(gitdir, 'MERGE_MSG'));
        }
      }
      return oid
    })
  } catch (err) {
    err.caller = 'git.commit';
    throw err
  }
}

// @ts-check

/**
 * Get the name of the branch currently pointed to by .git/HEAD
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {boolean} [args.fullname = false] - Return the full path (e.g. "refs/heads/master") instead of the abbreviated form.
 *
 * @returns {Promise<string|undefined>} The name of the current branch or undefined if the HEAD is detached.
 *
 * @example
 * // Get the current branch name
 * let branch = await git.currentBranch({ dir: '$input((/))', fullname: $input((false)) })
 * console.log(branch)
 *
 */
async function currentBranch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  fullname = false
}) {
  try {
    const ref = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: 'HEAD',
      depth: 2
    });
    // Return `undefined` for detached HEAD
    if (!ref.startsWith('refs/')) return
    return fullname ? ref : abbreviateRef(ref)
  } catch (err) {
    err.caller = 'git.currentBranch';
    throw err
  }
}

// @ts-check

/**
 * Delete a local branch
 *
 * > Note: This only deletes loose branches - it should be fixed in the future to delete packed branches as well.
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - The branch to delete
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.deleteBranch({ dir: '$input((/))', ref: '$input((local-branch))' })
 * console.log('done')
 *
 */
async function deleteBranch ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref
}) {
  try {
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

// @ts-check

/**
 * Delete a local ref
 *
 * > Note: This only deletes loose refs - it should be fixed in the future to delete packed refs as well.
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - The ref to delete
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.deleteRef({ dir: '$input((/))', ref: '$input((refs/tags/test-tag))' })
 * console.log('done')
 *
 */
async function deleteRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref
}) {
  try {
    await GitRefManager.deleteRef({ fs, gitdir, ref });
  } catch (err) {
    err.caller = 'git.deleteRef';
    throw err
  }
}

// @ts-check

/**
 * Removes the local config entry for a given remote
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.remote - The name of the remote to delete
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.deleteRemote({ dir: '$input((/))', remote: '$input((upstream))' })
 * console.log('done')
 *
 */
async function deleteRemote ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  remote
}) {
  try {
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

// @ts-check

/**
 * Delete a local tag ref
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - The tag to delete
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.deleteTag({ dir: '$input((/))', ref: '$input((test-tag))' })
 * console.log('done')
 *
 */
async function deleteTag ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref
}) {
  try {
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

async function expandOidLoose ({ fs, gitdir, oid: short }) {
  const prefix = short.slice(0, 2);
  const objectsSuffixes = await fs.readdir(`${gitdir}/objects/${prefix}`);
  return objectsSuffixes
    .map(suffix => `${prefix}${suffix}`)
    .filter(_oid => _oid.startsWith(short))
}

async function expandOidPacked ({
  fs,
  gitdir,
  oid: short,
  getExternalRefDelta
}) {
  // Iterate through all the .pack files
  const results = [];
  let list = await fs.readdir(join(gitdir, 'objects/pack'));
  list = list.filter(x => x.endsWith('.idx'));
  for (const filename of list) {
    const indexFile = `${gitdir}/objects/pack/${filename}`;
    const p = await readPackIndex({
      fs,
      filename: indexFile,
      getExternalRefDelta
    });
    if (p.error) throw new GitError(E.InternalFail, { message: p.error })
    // Search through the list of oids in the packfile
    for (const oid of p.offsets.keys()) {
      if (oid.startsWith(short)) results.push(oid);
    }
  }
  return results
}

async function expandOid ({ fs, gitdir, oid: short }) {
  // Curry the current read method so that the packfile un-deltification
  // process can acquire external ref-deltas.
  const getExternalRefDelta = oid => readObject({ fs, gitdir, oid });

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

// @ts-check

/**
 * Expand and resolve a short oid into a full oid
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.oid - The shortened oid prefix to expand (like "0414d2a")
 *
 * @returns {Promise<string>} Resolves successfully with the full oid (like "0414d2a286d7bbc7a4a326a61c1f9f888a8ab87f")
 *
 * @example
 * let oid = await git.expandOid({ dir: '$input((/))', oid: '$input((0414d2a))'})
 * console.log(oid)
 *
 */
async function expandOid$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  oid
}) {
  try {
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

// @ts-check

/**
 * Expand an abbreviated ref to its full name
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - The ref to expand (like "v1.0.0")
 *
 * @returns {Promise<string>} Resolves successfully with a full ref name ("refs/tags/v1.0.0")
 *
 * @example
 * let fullRef = await git.expandRef({ dir: '$input((/))', ref: '$input((master))'})
 * console.log(fullRef)
 *
 */
async function expandRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref
}) {
  try {
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

// @ts-check

/**
 * Find the merge base for a set of commits
 *
 * @link https://isomorphic-git.github.io/docs/findMergeBase.html
 */
async function findMergeBase ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  oids
}) {
  // Note: right now, the tests are geared so that the output should match that of
  // `git merge-base --all --octopus`
  // because without the --octopus flag, git's output seems to depend on the ORDER of the oids,
  // and computing virtual merge bases is just too much for me to fathom right now.
  try {
    // If we start N independent walkers, one at each of the given `oids`, and walk backwards
    // through ancestors, eventually we'll discover a commit where each one of these N walkers
    // has passed through. So we just need to keep tallies until we find one where we've walked
    // through N times.
    // Due to a single commit coming from multiple parents, it's possible for a single parent to
    // be double counted if identity of initial walkers are not tracked.
    const tracker = {};
    const passes = (1 << oids.length) - 1;
    let heads = oids.map((oid, i) => ({ oid, i }));
    while (heads.length) {
      // Track number of passes through each commit by an initial walker
      let result = {};
      for (const { oid, i } of heads) {
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
      const newheads = [];
      for (const { oid, i } of heads) {
        try {
          const { object } = await readObject({ fs, gitdir, oid });
          const commit = GitCommit.from(object);
          const { parent } = commit.parseHeaders();
          for (const oid of parent) {
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

// @ts-check

/**
 * Find the root git directory
 *
 * Starting at `filepath`, walks upward until it finds a directory that contains a subdirectory called '.git'.
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.filepath - The file directory to start searching in.
 *
 * @returns {Promise<string>} Resolves successfully with a root git directory path
 * @throws {GitRootNotFoundError}
 *
 * @example
 * let gitroot = await git.findRoot({
 *   filepath: '$input((/path/to/some/gitrepo/path/to/some/file.txt))'
 * })
 * console.log(gitroot) // '/path/to/some/gitrepo'
 *
 */
async function findRoot ({
  core = 'default',
  fs = cores.get(core).get('fs'),
  filepath
}) {
  try {
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
    const parent = dirname(filepath);
    if (parent === filepath) {
      throw new GitError(E.GitRootNotFoundError, { filepath })
    }
    return _findRoot(fs, parent)
  }
}

/**
 * Find the root git directory
 *
 * Starting at `filepath`, walks upward until it finds a directory that contains a subdirectory called '.git'.
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {GitTree} [args.tree] - The tree to start searching in.
 * @param {string} args.path - The file path to search for.
 *
 * @returns {Promise<string>} Resolves successfully with a root git directory path
 * @throws {GitRootNotFoundError}
 *
 * @example
 * let gitroot = await git.findRoot({
  *   filepath: '$input((/path/to/some/gitrepo/path/to/some/file.txt))'
  * })
  * console.log(gitroot) // '/path/to/some/gitrepo'
  *
  */
async function getOidAtPath ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  tree = null,
  path
}) {
  if (typeof path === 'string') path = path.split('/');
  if (!tree) tree = await getHeadTree({ fs, gitdir });
  const dirname = path.shift();
  for (const entry of tree) {
    if (entry.path === dirname) {
      if (path.length === 0) {
        return entry.oid
      }
      const { type, object } = await readObject({
        fs,
        gitdir,
        oid: entry.oid
      });
      if (type === 'tree') {
        const tree = GitTree.from(object);
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
  let oid;
  try {
    oid = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' });
  } catch (e) {
    // Handle fresh branches with no commits
    if (e.code === E.ResolveRefError) {
      return []
    }
  }
  const { type, object } = await readObject({ fs, gitdir, oid });
  if (type !== 'commit') {
    throw new GitError(E.ResolveCommitError, { oid })
  }
  const commit = GitCommit.from(object);
  oid = commit.parseHeaders().tree;
  return getTree({ fs, gitdir, oid })
}

async function getTree ({ fs, gitdir, oid }) {
  const { type, object } = await readObject({
    fs,
    gitdir,
    oid
  });
  if (type !== 'tree') {
    throw new GitError(E.ResolveTreeError, { oid })
  }
  const tree = GitTree.from(object).entries();
  return tree
}

// @ts-check

/**
 *
 * @typedef {Object} RemoteDescription - The object returned has the following schema:
 * @property {string[]} capabilities - The list of capabilities returned by the server (part of the Git protocol)
 * @property {Object} [refs]
 * @property {Object<string, string>} [refs.heads] - The branches on the remote
 * @property {Object<string, string>} [refs.pull] - The special branches representing pull requests (non-standard)
 * @property {Object<string, string>} [refs.tags] - The tags on the remote
 *
 */

/**
 * List a remote servers branches, tags, and capabilities.
 *
 * This is a rare command that doesn't require an `fs`, `dir`, or even `gitdir` argument.
 * It just communicates to a remote git server, using the first step of the `git-upload-pack` handshake, but stopping short of fetching the packfile.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {string} args.url - The URL of the remote repository. Will be gotten from gitconfig if absent.
 * @param {string} [args.corsProxy] - Optional [CORS proxy](https://www.npmjs.com/%40isomorphic-git/cors-proxy). Overrides value in repo config.
 * @param {boolean} [args.forPush = false] - By default, the command queries the 'fetch' capabilities. If true, it will ask for the 'push' capabilities.
 * @param {boolean} [args.noGitSuffix = false] - If true, clone will not auto-append a `.git` suffix to the `url`. (**AWS CodeCommit needs this option**)
 * @param {string} [args.username] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.password] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.token] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.oauth2format] - See the [Authentication](./authentication.html) documentation
 * @param {object} [args.headers] - Additional headers to include in HTTP requests, similar to git's `extraHeader` config
 *
 * @returns {Promise<RemoteDescription>} Resolves successfully with an object listing the branches, tags, and capabilities of the remote.
 * @see RemoteDescription
 *
 * @example
 * let info = await git.getRemoteInfo({
 *   url:
 *     "$input((https://cors.isomorphic-git.org/github.com/isomorphic-git/isomorphic-git.git))"
 * });
 * console.log(info);
 *
 */
async function getRemoteInfo ({
  core = 'default',
  corsProxy,
  url,
  // @ts-ignore
  authUsername,
  // @ts-ignore
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
    // Note: remote.capabilities, remote.refs, and remote.symrefs are Set and Map objects,
    // but one of the objectives of the public API is to always return JSON-compatible objects
    // so we must JSONify them.
    const result = {
      capabilities: [...remote.capabilities]
    };
    // Convert the flat list into an object tree, because I figure 99% of the time
    // that will be easier to use.
    for (const [ref, oid] of remote.refs) {
      const parts = ref.split('/');
      const last = parts.pop();
      let o = result;
      for (const part of parts) {
        o[part] = o[part] || {};
        o = o[part];
      }
      o[last] = oid;
    }
    // Merge symrefs on top of refs to more closely match actual git repo layouts
    for (const [symref, ref] of remote.symrefs) {
      const parts = symref.split('/');
      const last = parts.pop();
      let o = result;
      for (const part of parts) {
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

async function hashObject ({
  type,
  object,
  format = 'content',
  oid = undefined
}) {
  if (format !== 'deflated') {
    if (format !== 'wrapped') {
      object = GitObject.wrap({ type, object });
    }
    oid = shasum(object);
  }
  return { oid, object }
}

// @ts-check

/**
 *
 * @typedef {object} HashBlobResult - The object returned has the following schema:
 * @property {string} oid - The SHA-1 object id
 * @property {'blob'} type - The type of the object
 * @property {Buffer} object - The wrapped git object (the thing that is hashed)
 * @property {'wrapped'} format - The format of the object
 *
 */

/**
 * Compute what the SHA-1 object id of a file would be
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {Buffer|string} args.object - The object to write. If `object` is a String then it will be converted to a Buffer using UTF-8 encoding.
 *
 * @returns {Promise<{HashBlobResult}>} Resolves successfully with the SHA-1 object id and the wrapped object Buffer.
 * @see HashBlobResult
 *
 * @example
 * let { oid, type, object, format } = await git.hashBlob({
 *   object: '$input((Hello world!))',
 * })
 *
 * console.log('oid', oid)
 * console.log('type', type)
 * console.log('object', object)
 * console.log('format', format)
 *
 */
async function hashBlob ({ core = 'default', object }) {
  try {
    // Convert object to buffer
    if (typeof object === 'string') {
      object = Buffer.from(object, 'utf8');
    }

    const type = 'blob';
    const { oid, object: _object } = await hashObject({
      type: 'blob',
      format: 'content',
      object
    });
    return { oid, type, object: _object, format: 'wrapped' }
  } catch (err) {
    err.caller = 'git.hashBlob';
    throw err
  }
}

// @ts-check

/**
 * Create the .idx file for a given .pack file
 *
 * To monitor progress events, see the documentation for the [`'emitter'` plugin](./plugin_emitter.md).
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.filepath - The path to the .pack file to index
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md).
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name.
 *
 * @returns {Promise<void>} Resolves when filesystem operations are complete
 *
 * @example
 * await git.indexPack({ dir: '$input((/))', filepath: '$input((pack-9cbd243a1caa4cb4bef976062434a958d82721a9.pack))' })
 * console.log('done')
 *
 */
async function indexPack ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  filepath
}) {
  try {
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

// @ts-check

/**
 * Check whether a git commit is descended from another
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.oid - The descendent commit
 * @param {string} args.ancestor - The (proposed) ancestor commit
 * @param {number} [args.depth = -1] - Maximum depth to search before giving up. -1 means no maximum depth.
 *
 * @returns {Promise<boolean>} Resolves to true if `oid` is a descendent of `ancestor`
 *
 * @example
 * let oid = await git.resolveRef({ dir: '$input((/))', ref: '$input((master))' })
 * let ancestor = await git.resolveRef({ dir: '$input((/))', ref: '$input((v0.20.0))' })
 * console.log(oid, ancestor)
 * await git.isDescendent({ dir: '$input((/))', oid, ancestor, depth: $input((-1)) })
 *
 */
async function isDescendent ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  oid,
  ancestor,
  depth = -1
}) {
  try {
    const shallows = await GitShallowManager.read({ fs, gitdir });
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
    const visited = new Set();
    let searchdepth = 0;
    while (queue.length) {
      if (searchdepth++ === depth) {
        throw new GitError(E.MaxSearchDepthExceeded, { depth })
      }
      const oid = queue.shift();
      const { type, object } = await readObject({
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
      // If not, add them to heads (unless we know this is a shallow commit)
      if (!shallows.has(oid)) {
        for (const parent of commit.parent) {
          if (!visited.has(parent)) {
            queue.push(parent);
            visited.add(parent);
          }
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

// @ts-check

/**
 * List branches
 *
 * By default it lists local branches. If a 'remote' is specified, it lists the remote's branches. When listing remote branches, the HEAD branch is not filtered out, so it may be included in the list of results.
 *
 * Note that specifying a remote does not actually contact the server and update the list of branches.
 * If you want an up-to-date list, first do a `fetch` to that remote.
 * (Which branch you fetch doesn't matter - the list of branches available on the remote is updated during the fetch handshake.)
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.remote] - Instead of the branches in `refs/heads`, list the branches in `refs/remotes/${remote}`.
 *
 * @returns {Promise<Array<string>>} Resolves successfully with an array of branch names
 *
 * @example
 * let branches = await git.listBranches({ dir: '$input((/))' })
 * console.log(branches)
 * let remoteBranches = await git.listBranches({ dir: '$input((/))', remote: '$input((origin))' })
 * console.log(remoteBranches)
 *
 */
async function listBranches ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  remote = undefined
}) {
  try {
    return GitRefManager.listBranches({ fs, gitdir, remote })
  } catch (err) {
    err.caller = 'git.listBranches';
    throw err
  }
}

async function listCommitsAndTags ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  start,
  finish
}) {
  const shallows = await GitShallowManager.read({ fs, gitdir });
  const startingSet = new Set();
  const finishingSet = new Set();
  for (const ref of start) {
    startingSet.add(await GitRefManager.resolve({ fs, gitdir, ref }));
  }
  for (const ref of finish) {
    // We may not have these refs locally so we must try/catch
    try {
      const oid = await GitRefManager.resolve({ fs, gitdir, ref });
      finishingSet.add(oid);
    } catch (err) {}
  }
  const visited = new Set();
  // Because git commits are named by their hash, there is no
  // way to construct a cycle. Therefore we won't worry about
  // setting a default recursion limit.
  async function walk (oid) {
    visited.add(oid);
    const { type, object } = await readObject({ fs, gitdir, oid });
    // Recursively resolve annotated tags
    if (type === 'tag') {
      const tag = GitAnnotatedTag.from(object);
      const commit = tag.headers().object;
      return walk(commit)
    }
    if (type !== 'commit') {
      throw new GitError(E.ObjectTypeAssertionFail, {
        oid,
        type,
        expected: 'commit'
      })
    }
    if (!shallows.has(oid)) {
      const commit = GitCommit.from(object);
      const parents = commit.headers().parent;
      for (oid of parents) {
        if (!finishingSet.has(oid) && !visited.has(oid)) {
          await walk(oid);
        }
      }
    }
  }
  // Let's go walking!
  for (const oid of startingSet) {
    await walk(oid);
  }
  return visited
}

// @ts-check

/**
 *
 * @typedef {Object} CommitDescription
 * @property {string} oid - SHA-1 object id of this commit
 * @property {string} message - commit message
 * @property {string} tree - SHA-1 object id of corresponding file tree
 * @property {string[]} parent - an array of zero or more SHA-1 object ids
 * @property {Object} author
 * @property {string} author.name - the author's name
 * @property {string} author.email - the author's email
 * @property {number} author.timestamp - UTC Unix timestamp in seconds
 * @property {number} author.timezoneOffset - timezone difference from UTC in minutes
 * @property {Object} committer
 * @property {string} committer.name - the committer's name
 * @property {string} committer.email - the committer's email
 * @property {number} committer.timestamp - UTC Unix timestamp in seconds
 * @property {number} committer.timezoneOffset - timezone difference from UTC in minutes
 * @property {string} [gpgsig] - PGP signature (if present)
 */

/**
 *
 * @typedef {Object} TreeEntry
 * @property {string} mode
 * @property {string} path
 * @property {string} oid
 * @property {string} [type]
 */

/**
 *
 * @typedef {Object} TreeDescription
 * @property {TreeEntry[]} entries
 */

/**
 *
 * @typedef {Object} GitObjectDescription - The object returned has the following schema:
 * @property {string} oid
 * @property {'blob' | 'tree' | 'commit' | 'tag'} [type]
 * @property {'deflated' | 'wrapped' | 'content' | 'parsed'} format
 * @property {Buffer | String | CommitDescription | TreeDescription} object
 * @property {string} [source]
 *
 */

/**
 * Read a git object directly by its SHA-1 object id
 *
 * Regarding `GitObjectDescription`:
 *
 * - `oid` will be the same as the `oid` argument unless the `filepath` argument is provided, in which case it will be the oid of the tree or blob being returned.
 * - `type` is not included for 'deflated' and 'wrapped' formatted objects because you likely don't care or plan to decode that information yourself.
 * - `format` is usually, but not always, the format you requested. Packfiles do not store each object individually compressed so if you end up reading the object from a packfile it will be returned in format 'content' even if you requested 'deflated' or 'wrapped'.
 * - `object` will be an actual Object if format is 'parsed' and the object is a commit, tree, or annotated tag. Blobs are still formatted as Buffers unless an encoding is provided in which case they'll be strings. If format is anything other than 'parsed', object will be a Buffer.
 * - `source` is the name of the packfile or loose object file where the object was found.
 *
 * The `format` parameter can have the following values:
 *
 * | param      | description                                                                                                                                                                                               |
 * | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
 * | 'deflated' | Return the raw deflate-compressed buffer for an object if possible. Useful for efficiently shuffling around loose objects when you don't care about the contents and can save time by not inflating them. |
 * | 'wrapped'  | Return the inflated object buffer wrapped in the git object header if possible. This is the raw data used when calculating the SHA-1 object id of a git object.                                           |
 * | 'content'  | Return the object buffer without the git header.                                                                                                                                                          |
 * | 'parsed'   | Returns a parsed representation of the object.                                                                                                                                                            |
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.oid - The SHA-1 object id to get
 * @param {'deflated' | 'wrapped' | 'content' | 'parsed'} [args.format = 'parsed'] - What format to return the object in. The choices are described in more detail below.
 * @param {string} [args.filepath] - Don't return the object with `oid` itself, but resolve `oid` to a tree and then return the object at that filepath. To return the root directory of a tree set filepath to `''`
 * @param {string} [args.encoding] - A convenience argument that only affects blobs. Instead of returning `object` as a buffer, it returns a string parsed using the given encoding.
 *
 * @returns {Promise<GitObjectDescription>} Resolves successfully with a git object description
 * @see GitObjectDescription
 *
 * @example
 * // Get the contents of 'README.md' in the master branch.
 * let sha = await git.resolveRef({ dir: '$input((/))', ref: '$input((master))' })
 * console.log(sha)
 * let { object: blob } = await git.readObject({
 *   dir: '$input((/))',
 *   oid: $input((sha)),
 *   $textarea((filepath: 'README.md',
 *   encoding: 'utf8'))
 * })
 * console.log(blob)
 *
 * @example
 * // Find all the .js files in the current master branch containing the word 'commit'
 * let sha = await git.resolveRef({ dir: '$input((/))', ref: '$input((master))' })
 * console.log(sha)
 * let { object: commit } = await git.readObject({ dir: '$input((/))', oid: sha })
 * console.log(commit)
 *
 * const searchTree = async ({oid, prefix = ''}) => {
 *   let { object: tree } = await git.readObject({ dir: '$input((/))', oid })
 *   for (let entry of tree.entries) {
 *     if (entry.type === 'tree') {
 *       await searchTree({oid: entry.oid, prefix: `${prefix}/${entry.path}`})
 *     } else if (entry.type === 'blob') {
 *       if ($input((entry.path.endsWith('.js')))) {
 *         let { object: blob } = await git.readObject({ dir: '$input((/))', oid: entry.oid })
 *         if ($input((blob.toString('utf8').includes('commit')))) {
 *           console.log(`${prefix}/${entry.path}`)
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * await searchTree({oid: commit.tree})
 * console.log('done')
 *
 */
async function readObject$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  oid,
  format = 'parsed',
  filepath = undefined,
  encoding = undefined
}) {
  try {
    if (filepath !== undefined) {
      // Ensure there are no leading or trailing directory separators.
      // I was going to do this automatically, but then found that the Git Terminal for Windows
      // auto-expands --filepath=/src/utils to --filepath=C:/Users/Will/AppData/Local/Programs/Git/src/utils
      // so I figured it would be wise to promote the behavior in the application layer not just the library layer.
      if (filepath.startsWith('/') || filepath.endsWith('/')) {
        throw new GitError(E.DirectorySeparatorsError)
      }
      const _oid = oid;
      const result = await resolveTree({ fs, gitdir, oid });
      const tree = result.tree;
      if (filepath === '') {
        oid = result.oid;
      } else {
        const pathArray = filepath.split('/');
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
    const result = await readObject({
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
    // @ts-ignore
    return result
  } catch (err) {
    err.caller = 'git.readObject';
    throw err
  }
}

async function resolveFile ({ fs, gitdir, tree, pathArray, oid, filepath }) {
  const name = pathArray.shift();
  for (const entry of tree) {
    if (entry.path === name) {
      if (pathArray.length === 0) {
        return entry.oid
      } else {
        const { type, object } = await readObject({
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

// @ts-check

/**
 * List all the files in the git index or a commit
 *
 * > Note: This function is efficient for listing the files in the staging area, but listing all the files in a commit requires recursively walking through the git object store.
 * > If you do not require a complete list of every file, better can be achieved by using [readObject](./readObject.html) directly and ignoring subdirectories you don't care about.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ref] - Return a list of all the files in the commit at `ref` instead of the files currently in the git index (aka staging area)
 *
 * @returns {Promise<Array<string>>} Resolves successfully with an array of filepaths
 *
 * @example
 * // All the files in the previous commit
 * let files = await git.listFiles({ dir: '$input((/))', ref: '$input((HEAD))' })
 * console.log(files)
 * // All the files in the current staging area
 * files = await git.listFiles({ dir: '$input((/))' })
 * console.log(files)
 *
 */
async function listFiles ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref
}) {
  try {
    if (ref) {
      const oid = await GitRefManager.resolve({ gitdir, fs, ref });
      const filenames = [];
      await accumulateFilesFromOid({ gitdir, fs, oid, filenames, prefix: '' });
      return filenames
    } else {
      return GitIndexManager.acquire({ fs, gitdir }, async function (index) {
        return index.entries.map(x => x.path)
      })
    }
  } catch (err) {
    err.caller = 'git.listFiles';
    throw err
  }
}

async function accumulateFilesFromOid ({ gitdir, fs, oid, filenames, prefix }) {
  const { object } = await readObject$1({ gitdir, fs, oid, filepath: '' });
  // Note: this isn't parallelized because I'm too lazy to figure that out right now
  // @ts-ignore
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

// @ts-check

/**
 * List remotes
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 *
 * @returns {Promise<Array<{remote: string, url: string}>>} Resolves successfully with an array of `{remote, url}` objects
 *
 * @example
 * let remotes = await git.listRemotes({ dir: '$input((/))' })
 * console.log(remotes)
 *
 */
async function listRemotes ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs')
}) {
  try {
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

// @ts-check

/**
 * List tags
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 *
 * @returns {Promise<Array<string>>} Resolves successfully with an array of tag names
 *
 * @example
 * let tags = await git.listTags({ dir: '$input((/))' })
 * console.log(tags)
 *
 */
async function listTags ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs')
}) {
  try {
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
    const { type, object } = await readObject({ fs, gitdir, oid });
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

// @ts-check

/**
 *
 * @typedef {Object} CommitDescription - Returns an array of objects with a schema like this:
 * @property {string} oid - SHA-1 object id of this commit
 * @property {string} message - Commit message
 * @property {string} tree - SHA-1 object id of corresponding file tree
 * @property {string[]} parent - an array of zero or more SHA-1 object ids
 * @property {Object} author
 * @property {string} author.name - The author's name
 * @property {string} author.email - The author's email
 * @property {number} author.timestamp - UTC Unix timestamp in seconds
 * @property {number} author.timezoneOffset - Timezone difference from UTC in minutes
 * @property {Object} committer
 * @property {string} committer.name - The committer's name
 * @property {string} committer.email - The committer's email
 * @property {number} committer.timestamp - UTC Unix timestamp in seconds
 * @property {number} committer.timezoneOffset - Timezone difference from UTC in minutes
 * @property {string} [gpgsig] - PGP signature (if present)
 * @property {string} [payload] - PGP signing payload (if requested)
 */

/**
 * Get commit descriptions from the git history
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ref = 'HEAD'] - The commit to begin walking backwards through the history from
 * @param {number} [args.depth] - Limit the number of commits returned. No limit by default.
 * @param {Date} [args.since] - Return history newer than the given date. Can be combined with `depth` to get whichever is shorter.
 * @param {boolean} [args.signing = false] - Include the PGP signing payload
 *
 * @returns {Promise<Array<CommitDescription>>} Resolves to an array of CommitDescription objects
 * @see CommitDescription
 *
 * @example
 * let commits = await git.log({ dir: '$input((/))', depth: $input((5)), ref: '$input((master))' })
 * console.log(commits)
 *
 */
async function log$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref = 'HEAD',
  depth = undefined,
  since = undefined, // Date
  signing = false
}) {
  try {
    const sinceTimestamp =
      since === undefined ? undefined : Math.floor(since.valueOf() / 1000);
    // TODO: In the future, we may want to have an API where we return a
    // async iterator that emits commits.
    const commits = [];
    const shallowCommits = await GitShallowManager.read({ fs, gitdir });
    const oid = await GitRefManager.resolve({ fs, gitdir, ref });
    const tips /*: Array */ = [await logCommit({ fs, gitdir, oid, signing })];

    while (true) {
      const commit = tips.pop();

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
          const commit = await logCommit({ fs, gitdir, oid, signing });
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
    // @ts-ignore
    return commits
  } catch (err) {
    err.caller = 'git.log';
    throw err
  }
}

async function hashObject$1 ({ gitdir, type, object }) {
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
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourOid,
  theirOid,
  baseOid
}) {
  // Adapted from: http://gitlet.maryrosecook.com/docs/gitlet.html#section-220
  try {
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

        await Promise.all([
          base.exists && base.populateStat(),
          theirs.exists && theirs.populateStat(),
          ours.exists && ours.populateStat()
        ]);

        if ((base.exists && base.type !== 'blob') ||
            (ours.exists && ours.type !== 'blob') ||
            (theirs.exists && theirs.type !== 'blob')) return

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
  const giverPresent = giver.exists;

  if ((!receiverPresent && !basePresent && giverPresent) ||
    (receiverPresent && !basePresent && !giverPresent)) {
    return 'added'
  } else if ((receiverPresent && basePresent && !giverPresent) ||
    (!receiverPresent && basePresent && giverPresent)) {
    return 'deleted'
  } else {
    await Promise.all([
      receiverPresent && receiver.populateHash(),
      giverPresent && giver.populateHash()
    ]);
    if (receiver.oid === giver.oid) {
      if (receiver.mode === giver.mode) {
        return 'unmodified'
      } else {
        return 'modified'
      }
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

const LINEBREAKS = /^.*(\r?\n|$)/gm;

function mergeFile ({
  ourContent,
  baseContent,
  theirContent,
  ourName = 'ours',
  baseName = 'base',
  theirName = 'theirs',
  format = 'diff',
  markerSize = 7
}) {
  const ours = ourContent.match(LINEBREAKS);
  const base = baseContent.match(LINEBREAKS);
  const theirs = theirContent.match(LINEBREAKS);

  // Here we let the diff3 library do the heavy lifting.
  const result = diff3Merge(ours, base, theirs);

  // Here we note whether there are conflicts and format the results
  let mergedText = '';
  let cleanMerge = true;
  for (const item of result) {
    if (item.ok) {
      mergedText += item.ok.join('');
    }
    if (item.conflict) {
      cleanMerge = false;
      mergedText += `${'<'.repeat(markerSize)} ${ourName}\n`;
      mergedText += item.conflict.a.join('');
      if (format === 'diff3') {
        mergedText += `${'|'.repeat(markerSize)} ${baseName}\n`;
        mergedText += item.conflict.o.join('');
      }
      mergedText += `${'='.repeat(markerSize)}\n`;
      mergedText += item.conflict.b.join('');
      mergedText += `${'>'.repeat(markerSize)} ${theirName}\n`;
    }
  }
  return { cleanMerge, mergedText }
}

/**
 *
 * @typedef {Object} MergeReport - Returns an object with a schema like this:
 * @property {string} [oid] - The SHA-1 object id that is now at the head of the branch. Absent only if `dryRun` was specified and `mergeCommit` is true.
 * @property {boolean} [alreadyMerged] - True if the branch was already merged so no changes were made
 * @property {boolean} [fastForward] - True if it was a fast-forward merge
 * @property {boolean} [mergeCommit] - True if merge resulted in a merge commit
 * @property {string} [tree] - The SHA-1 object id of the tree resulting from a merge commit
 *
 */

/**
 * Merge two branches
 *
 * ## Limitations
 *
 * Currently it does not support incomplete merges. That is, if there are merge conflicts it cannot solve
 * with the built in diff3 algorithm it will not modify the working dir, and will throw a [`MergeNotSupportedFail`](./errors.md#mergenotsupportedfail) error.
 *
 * Currently it will fail if multiple candidate merge bases are found. (It doesn't yet implement the recursive merge strategy.)
 *
 * Currently it does not support selecting alternative merge strategies.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ourRef] - The branch receiving the merge. If undefined, defaults to the current branch.
 * @param {string} args.theirRef - The branch to be merged
 * @param {boolean} [args.fastForwardOnly = false] - If true, then non-fast-forward merges will throw an Error instead of performing a merge.
 * @param {boolean} [args.dryRun = false] - If true, simulates a merge so you can test whether it would succeed.
 * @param {boolean} [args.noUpdateBranch = false] - If true, does not update the branch pointer after creating the commit.
 * @param {boolean} [args.noCheckout = false] - If true, does not perform checkout after merge.
 * @param {string} [args.message] - Overrides the default auto-generated merge commit message
 * @param {Object} [args.author] - passed to [commit](commit.md) when creating a merge commit
 * @param {Object} [args.committer] - passed to [commit](commit.md) when creating a merge commit
 * @param {string} [args.signingKey] - passed to [commit](commit.md) when creating a merge commit
 *
 * @returns {Promise<MergeReport>} Resolves to a description of the merge operation
 * @see MergeReport
 *
 * @example
 * let m = await git.merge({ dir: '$input((/))', ours: '$input((master))', theirs: '$input((remotes/origin/master))' })
 * console.log(m)
 *
 */
async function merge ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourRef,
  theirRef,
  fastForwardOnly = false,
  dryRun = false,
  noUpdateBranch = false,
  noCheckout = false,
  message,
  author,
  committer,
  signingKey
}) {
  try {
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Merging repo',
        loaded: 0,
        lengthComputable: false
      });
    }
    const currentRef = await currentBranch({ fs, gitdir, fullname: true });
    if (ourRef === undefined) {
      ourRef = currentRef;
    } else {
      ourRef = await GitRefManager.expand({
        fs,
        gitdir,
        ref: ourRef
      });
    }
    theirRef = await GitRefManager.expand({
      fs,
      gitdir,
      ref: theirRef
    });
    const ourOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: ourRef
    });
    const theirOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: theirRef
    });
    // find most recent common ancestor of ref a and ref b
    const baseOids = await findMergeBase({
      core,
      dir,
      gitdir,
      fs,
      oids: [ourOid, theirOid]
    });
    const baseOid = baseOids[0];
    // handle fast-forward case
    if (!baseOid) {
      throw new GitError(E.MergeNoCommonAncestryError, { theirRef, ourRef })
    } else if (baseOid === theirOid) {
      return {
        oid: ourOid,
        alreadyMerged: true
      }
    } else if (baseOid === ourOid) {
      if (!dryRun && !noUpdateBranch) {
        await GitRefManager.writeRef({ fs, gitdir, ref: ourRef, value: theirOid });
      }
      if (!noCheckout) {
        await checkout({
          dir,
          gitdir,
          fs,
          ref: ourRef,
          emitter,
          emitterPrefix
        });
      }
      return {
        oid: theirOid,
        fastForward: true
      }
    } else {
      // not a simple fast-forward
      if (fastForwardOnly) {
        throw new GitError(E.FastForwardFail)
      }

      if (currentRef !== ourRef) {
        // checkout our branch to begin non-fast-forward merge (needed for tests)
        await checkout({
          dir,
          gitdir,
          fs,
          ref: ourRef,
          emitter,
          emitterPrefix,
          dryRun
        });
      }

      await GitRefManager.writeRef({ fs, gitdir, ref: 'MERGE_HEAD', value: theirOid });

      // for each file, determine whether it is present or absent or modified (see http://gitlet.maryrosecook.com/docs/gitlet.html#section-217)
      const mergeDiff = await findChangedFiles({
        fs,
        gitdir,
        dir,
        emitter,
        emitterPrefix,
        ourOid,
        theirOid,
        baseOid
      });
      const total = mergeDiff.length;

      let treeOid; let hasConflict = false;
      await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
        let count = 0;
        for (const diff of mergeDiff) {
          const { ours, theirs, base } = diff;
          // for simple cases of add, remove, or modify files
          switch (diff.status) {
            case 'added':
              await processAdded({ ours, theirs, fs, index, dir });
              break
            case 'deleted':
              index.delete({ filepath: base.fullpath });
              await fs.rm(`${dir}/${base.fullpath}`);
              break
            case 'modified':
              await processModified({ ours, theirs, base, fs, emitter, emitterPrefix, index, dir });
              break
            case 'conflict':
              const conflict = await processConflict({ ours, theirs, base, fs, emitter, emitterPrefix, index, dir, gitdir });
              hasConflict = hasConflict || conflict;
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
        treeOid = await GitIndexManager.constructTree({ fs, gitdir, dryRun, index });
      });

      if (!message) {
        message = `Merge branch '${abbreviateRef(theirRef)}' into ${abbreviateRef(ourRef)}`;
      }

      let oid;
      if (!hasConflict) {
        oid = await commit({
          fs,
          gitdir,
          message,
          ref: ourRef,
          tree: treeOid,
          parent: [ourOid], // theirOid should be handled by MERGE_HASH in commit
          author,
          committer,
          signingKey,
          dryRun,
          noUpdateBranch
        });
      } else {
        await fs.write(join(gitdir, 'MERGE_MSG'), message, 'utf8');
      }

      return {
        oid,
        tree: treeOid,
        recursiveMerge: true,
        mergeCommit: !hasConflict
      }
    }
  } catch (err) {
    err.caller = 'git.merge';
    throw err
  }
}

async function processAdded ({ ours, theirs, fs, index, dir }) {
  const added = ours.exists ? ours : theirs;
  await Promise.all([
    !added.oid && added.populateHash(),
    !added.content && added.populateContent()
  ]);
  const { fullpath: filepath, content, oid } = added;
  const workingPath = `${dir}/${filepath}`;
  await fs.write(workingPath, content);
  const stats = await fs.lstat(workingPath);
  index.insert({ filepath, stats, oid });
}

async function processModified ({ ours, theirs, base, fs, index, dir }) {
  await Promise.all([
    !ours.oid && ours.populateHash(),
    !base.oid && base.populateHash(),
    !theirs.oid && theirs.populateHash(),
    !ours.mode && ours.populateStats(),
    !base.mode && base.populateStats(),
    !theirs.mode && theirs.populateStats()
  ]);
  const mode = base.mode === ours.mode ? theirs.mode : ours.mode;
  const { fullpath: filepath, content, oid } = base.oid === ours.oid ? theirs : ours;
  const workingPath = `${dir}/${filepath}`;
  await fs.write(
    workingPath,
    content,
    mode === '100755' ? { mode: 0o777 } : undefined
  );
  const stats = await fs.lstat(workingPath);
  // Lightning FS does not store mode in IDB - problem for testing
  stats.mode = mode === '100755' ? 0o100755 : 0o100644;
  index.insert({ filepath, stats, oid });
}

async function processConflict ({ ours, theirs, base, fs, emitter, emitterPrefix, index, dir, gitdir }) {
  await Promise.all([
    !ours.content && ours.populateContent(),
    !theirs.content && theirs.populateContent(),
    !base.content && base.populateContent(),
    !base.oid && base.populateHash(),
    !ours.oid && ours.populateHash(),
    !theirs.oid && theirs.populateHash()
  ]);

  const merged = await mergeFile({
    ourContent: ours.content.toString('utf8'),
    baseContent: base.content.toString('utf8'),
    theirContent: theirs.content.toString('utf8')
  });

  const mode = base.mode === ours.mode ? theirs.mode : ours.mode;
  const { fullpath: filepath, oid: baseOid } = base;
  const workingPath = `${dir}/${filepath}`;
  await fs.write(
    workingPath,
    merged.mergedText,
    mode === '100755' ? { mode: 0o777 } : undefined
  );

  const stats = await fs.lstat(workingPath);
  stats.mode = mode === '100755' ? 0o100755 : 0o100644;

  if (!merged.cleanMerge) {
    index.writeConflict({
      filepath,
      stats,
      ourOid: ours.oid,
      theirOid: theirs.oid,
      baseOid
    });
    if (emitter) {
      emitter.emit(`${emitterPrefix}conflict`, {
        filepath,
        ourOid: ours.oid,
        theirOid: theirs.oid,
        baseOid
      });
    }
    return true
  } else {
    const oid = await hashObject$1({
      gitdir,
      type: 'blob',
      object: merged.mergedText
    });
    index.insert({ filepath, stats, oid });
    return false
  }
}

const types = {
  commit: 0b0010000,
  tree: 0b0100000,
  blob: 0b0110000,
  tag: 0b1000000,
  ofs_delta: 0b1100000,
  ref_delta: 0b1110000
};

/**
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string[]} args.oids
 */
async function pack ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  oids
}) {
  const hash = new Hash();
  const outputStream = [];
  function write (chunk, enc) {
    const buff = Buffer.from(chunk, enc);
    outputStream.push(buff);
    hash.update(buff);
  }
  function writeObject ({ stype, object }) {
    // Object type is encoded in bits 654
    const type = types[stype];
    // The length encoding gets complicated.
    let length = object.length;
    // Whether the next byte is part of the variable-length encoded number
    // is encoded in bit 7
    let multibyte = length > 0b1111 ? 0b10000000 : 0b0;
    // Last four bits of length is encoded in bits 3210
    const lastFour = length & 0b1111;
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
  for (const oid of oids) {
    const { type, object } = await readObject({ fs, gitdir, oid });
    writeObject({ write, object, stype: type });
  }
  // Write SHA1 checksum
  const digest = hash.digest();
  outputStream.push(digest);
  return outputStream
}

// @ts-check

/**
 *
 * @typedef {Object} PackObjectsResponse The packObjects command returns an object with two properties:
 * @property {string} filename - The suggested filename for the packfile if you want to save it to disk somewhere. It includes the packfile SHA.
 * @property {Buffer} [packfile] - The packfile contents. Not present if `write` parameter was true, in which case the packfile was written straight to disk.
 */

/**
 * Create a packfile from an array of SHA-1 object ids
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string[]} args.oids - An array of SHA-1 object ids to be included in the packfile
 * @param {boolean} [args.write = false] - Whether to save the packfile to disk or not
 *
 * @returns {Promise<PackObjectsResponse>} Resolves successfully when the packfile is ready with the filename and buffer
 * @see PackObjectsResponse
 *
 * @example
 * // Create a packfile containing only an empty tree
 * let { packfile } = await git.packObjects({
 *   dir: '$input((/))',
 *   oids: [$input(('4b825dc642cb6eb9a060e54bf8d69288fbee4904'))]
 * })
 * console.log(packfile)
 *
 */
async function packObjects ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  oids,
  write = false
}) {
  try {
    const buffers = await pack({ core, gitdir, fs, oids });
    const packfile = await collect(buffers);
    const packfileSha = packfile.slice(-20).toString('hex');
    const filename = `pack-${packfileSha}.pack`;
    if (write) {
      await fs.write(join(gitdir, `objects/pack/${filename}`), packfile);
      return { filename }
    }
    return {
      filename,
      packfile
    }
  } catch (err) {
    err.caller = 'git.packObjects';
    throw err
  }
}

// @ts-check

/**
 * Fetch and merge commits from a remote repository *(Currently, only fast-forward merges are implemented.)*
 *
 * To monitor progress events, see the documentation for the [`'emitter'` plugin](./plugin_emitter.md).
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ref] - Which branch to fetch. By default this is the currently checked out branch.
 * @param {string} [args.corsProxy] - Optional [CORS proxy](https://www.npmjs.com/%40isomorphic-git/cors-proxy). Overrides value in repo config.
 * @param {boolean} [args.singleBranch = false] - Instead of the default behavior of fetching all the branches, only fetch a single branch.
 * @param {boolean} [args.fastForwardOnly = false] - Only perform simple fast-forward merges. (Don't create merge commits.)
 * @param {boolean} [args.noGitSuffix = false] - If true, do not auto-append a `.git` suffix to the `url`. (**AWS CodeCommit needs this option**)
 * @param {string} [args.username] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.password] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.token] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.oauth2format] - See the [Authentication](./authentication.html) documentation
 * @param {object} [args.headers] - Additional headers to include in HTTP requests, similar to git's `extraHeader` config
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md).
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name.
 * @param {Object} [args.author] - passed to [commit](commit.md) when creating a merge commit
 * @param {Object} [args.committer] - passed to [commit](commit.md) when creating a merge commit
 * @param {string} [args.signingKey] - passed to [commit](commit.md) when creating a merge commit
 *
 * @returns {Promise<void>} Resolves successfully when pull operation completes
 *
 * @example
 * await git.pull({
 *   dir: '$input((/))',
 *   ref: '$input((master))',
 *   singleBranch: $input((true))
 * })
 * console.log('done')
 *
 */
async function pull ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref,
  fastForwardOnly = false,
  noGitSuffix = false,
  corsProxy,
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  // @ts-ignore
  authUsername,
  // @ts-ignore
  authPassword,
  username = authUsername,
  password = authPassword,
  token,
  oauth2format,
  singleBranch,
  headers = {},
  author,
  committer,
  signingKey
}) {
  try {
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Pulling repo',
        loaded: 0,
        lengthComputable: false
      });
    }
    // If ref is undefined, use 'HEAD'
    if (!ref) {
      ref = await currentBranch({ fs, gitdir });
    }
    // Fetch from the correct remote.
    const remote = await config({
      gitdir,
      fs,
      path: `branch.${ref}.remote`
    });
    const { fetchHead, fetchHeadDescription } = await fetch({
      dir,
      gitdir,
      fs,
      emitter,
      emitterPrefix,
      noGitSuffix,
      corsProxy,
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
      emitter,
      emitterPrefix,
      fastForwardOnly,
      message: `Merge ${fetchHeadDescription}`,
      author,
      committer,
      signingKey
    });
  } catch (err) {
    err.caller = 'git.pull';
    throw err
  }
}

async function parseReceivePackResponse (packfile) {
  const result = {};
  let response = '';
  const read = GitPktLine.streamReader(packfile);
  let line = await read();
  while (line !== true) {
    if (line !== null) response += line.toString('utf8') + '\n';
    line = await read();
  }

  const lines = response.toString('utf8').split('\n');
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
  for (const line of lines) {
    const status = line.slice(0, 2);
    const refAndMessage = line.slice(3);
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
  const packstream = [];
  let capsFirstLine = `\x00 ${capabilities.join(' ')}`;
  for (const trip of triplets) {
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

async function listObjects ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  oids
}) {
  const visited = new Set();
  // We don't do the purest simplest recursion, because we can
  // avoid reading Blob objects entirely since the Tree objects
  // tell us which oids are Blobs and which are Trees.
  async function walk (oid) {
    visited.add(oid);
    const { type, object } = await readObject({ fs, gitdir, oid });
    if (type === 'tag') {
      const tag = GitAnnotatedTag.from(object);
      const obj = tag.headers().object;
      await walk(obj);
    } else if (type === 'commit') {
      const commit = GitCommit.from(object);
      const tree = commit.headers().tree;
      await walk(tree);
    } else if (type === 'tree') {
      const tree = GitTree.from(object);
      for (const entry of tree) {
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
  for (const oid of oids) {
    await walk(oid);
  }
  return visited
}

// @ts-check

/**
 *
 * @typedef {Object} PushResponse - Returns an object with a schema like this:
 * @property {string[]} [ok]
 * @property {string[]} [errors]
 * @property {object} [headers]
 *
 */

/**
 * Push a branch or tag
 *
 * > *Note:* The behavior of `remoteRef` is reasonable but not the _correct_ behavior. It _should_ be using the configured remote tracking branch! TODO: I need to fix this
 *
 * The push command returns an object that describes the result of the attempted push operation.
 * *Notes:* If there were no errors, then there will be no `errors` property. There can be a mix of `ok` messages and `errors` messages.
 *
 * | param  | type [= default] | description                                                                                                                                                                                                      |
 * | ------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
 * | ok     | Array\<string\>  | The first item is "unpack" if the overall operation was successful. The remaining items are the names of refs that were updated successfully.                                                                    |
 * | errors | Array\<string\>  | If the overall operation threw and error, the first item will be "unpack {Overall error message}". The remaining items are individual refs that failed to be updated in the format "{ref name} {error message}". |
 *
 * To monitor progress events, see the documentation for the [`'emitter'` plugin](./plugin_emitter.md).
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ref] - Which branch to push. By default this is the currently checked out branch.
 * @param {string} [args.remoteRef] - The name of the receiving branch on the remote. By default this is the same as `ref`. (See note below)
 * @param {string} [args.remote] - If URL is not specified, determines which remote to use.
 * @param {boolean} [args.force = false] - If true, behaves the same as `git push --force`
 * @param {boolean} [args.noGitSuffix = false] - If true, do not auto-append a `.git` suffix to the `url`. (**AWS CodeCommit needs this option**)
 * @param {string} [args.url] - The URL of the remote git server. The default is the value set in the git config for that remote.
 * @param {string} [args.corsProxy] - Optional [CORS proxy](https://www.npmjs.com/%40isomorphic-git/cors-proxy). Overrides value in repo config.
 * @param {string} [args.username] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.password] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.token] - See the [Authentication](./authentication.html) documentation
 * @param {string} [args.oauth2format] - See the [Authentication](./authentication.html) documentation
 * @param {object} [args.headers] - Additional headers to include in HTTP requests, similar to git's `extraHeader` config
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md).
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name.
 *
 * @returns {Promise<PushResponse>} Resolves successfully when push completes with a detailed description of the operation from the server.
 * @see PushResponse
 *
 * @example
 * let pushResponse = await git.push({
 *   dir: '$input((/))',
 *   remote: '$input((origin))',
 *   ref: '$input((master))',
 *   token: $input((process.env.GITHUB_TOKEN)),
 * })
 * console.log(pushResponse)
 *
 */
async function push ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref,
  remoteRef,
  remote = 'origin',
  url,
  force = false,
  noGitSuffix = false,
  corsProxy,
  // @ts-ignore
  authUsername,
  // @ts-ignore
  authPassword,
  username = authUsername,
  password = authPassword,
  token,
  oauth2format,
  headers = {}
}) {
  try {
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Pushing repo',
        loaded: 0,
        lengthComputable: false
      });
    }
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
    const oid = await GitRefManager.resolve({ fs, gitdir, ref: fullRef });
    let auth = { username, password, token, oauth2format };
    const GitRemoteHTTP = GitRemoteManager.getRemoteHelperFor({ url });
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
    const emptyOid = '0000000000000000000000000000000000000000';
    const oldoid =
      httpRemote.refs.get(fullRemoteRef) || emptyOid;
    const finish = [...httpRemote.refs.values()];
    // hack to speed up common force push scenarios
    // @ts-ignore
    const mergebase = await findMergeBase({ fs, gitdir, oids: [oid, oldoid] });
    for (const baseOid of mergebase) finish.push(baseOid);
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
    // @ts-ignore
    const commits = await listCommitsAndTags({
      fs,
      gitdir,
      start: [oid],
      finish
    });
    // @ts-ignore
    const objects = await listObjects({ fs, gitdir, oids: commits });
    // We can only safely use capabilities that the server also understands.
    // For instance, AWS CodeCommit aborts a push if you include the `agent`!!!
    const capabilities = filterCapabilities(
      [...httpRemote.capabilities],
      ['report-status', 'side-band-64k', `agent=${pkg.agent}`]
    );
    const packstream1 = await writeReceivePackRequest({
      capabilities,
      triplets: [{ oldoid, oid, fullRef: fullRemoteRef }]
    });
    const packstream2 = await pack({
      fs,
      gitdir,
      oids: [...objects]
    });
    const res = await GitRemoteHTTP.connect({
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
    const { packfile, progress } = await GitSideBand.demux(res.body);
    if (emitter) {
      const lines = splitLines(progress);
      forAwait(lines, line => {
        emitter.emit(`${emitterPrefix}message`, line);
      });
    }
    // Parse the response!
    const result = await parseReceivePackResponse(packfile);
    if (res.headers) {
      result.headers = res.headers;
    }
    if (!result.errors || result.errors.length === 0) {
      // no errors pushing
      const refs = new Map();
      refs.set(fullRemoteRef, oid);
      const symrefs = new Map();
      // @ts-ignore
      await GitRefManager.updateRemoteRefs({
        fs,
        gitdir,
        remote,
        refs,
        symrefs
      });
    }
    return result
  } catch (err) {
    err.caller = 'git.push';
    throw err
  }
}

// @ts-check

/**
 * Remove a file from the git index (aka staging area)
 *
 * Note that this does NOT delete the file in the working directory.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.filepath - The path to the file to remove from the index
 *
 * @returns {Promise<void>} Resolves successfully once the git index has been updated
 *
 * @example
 * await git.remove({ dir: '$input((/))', filepath: '$input((README.md))' })
 * console.log('done')
 *
 */
async function remove ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  filepath
}) {
  try {
    await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      index.delete({ filepath });
    });
    // TODO: return oid?
  } catch (err) {
    err.caller = 'git.remove';
    throw err
  }
}

// @ts-check

/**
 * Reset a file in the git index (aka staging area)
 *
 * Note that this does NOT modify the file in the working directory.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.filepath - The path to the file to reset in the index
 * @param {string} [args.ref = 'HEAD'] - A ref to the commit to use
 *
 * @returns {Promise<void>} Resolves successfully once the git index has been updated
 *
 * @example
 * await git.resetIndex({ dir: '$input((/))', filepath: '$input((README.md))' })
 * console.log('done')
 *
 */
async function resetIndex ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  filepath,
  ref = 'HEAD'
}) {
  try {
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
      workdirOid = await hashObject$1({
        gitdir,
        type: 'blob',
        object
      });
      if (oid === workdirOid) {
        // ... use the workdir Stats object
        stats = await fs.lstat(join(dir, filepath));
      }
    }
    await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      index.delete({ filepath });
      if (oid) {
        index.insert({ filepath, stats, oid });
      }
    });
  } catch (err) {
    err.caller = 'git.reset';
    throw err
  }
}

// @ts-check

/**
 * Get the value of a symbolic ref or resolve a ref to its SHA-1 object id
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - The ref to resolve
 * @param {number} [args.depth = undefined] - How many symbolic references to follow before returning
 *
 * @returns {Promise<string>} Resolves successfully with a SHA-1 object id or the value of a symbolic ref
 *
 * @example
 * let currentCommit = await git.resolveRef({ dir: '$input((/))', ref: '$input((HEAD))' })
 * console.log(currentCommit)
 * let currentBranch = await git.resolveRef({ dir: '$input((/))', ref: '$input((HEAD))', depth: $input((2)) })
 * console.log(currentBranch)
 *
 */
async function resolveRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref,
  depth
}) {
  try {
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

class SignedGitCommit extends GitCommit {
  static from (commit) {
    return new SignedGitCommit(commit)
  }

  async sign (openpgp, privateKeys) {
    const commit = this.withoutSignature();
    const headers = GitCommit.justHeaders(this._commit);
    const message = GitCommit.justMessage(this._commit);
    const privKeyObj = openpgp.key.readArmored(privateKeys).keys;
    let { signature } = await openpgp.sign({
      data: openpgp.util.str2Uint8Array(commit),
      privateKeys: privKeyObj,
      detached: true,
      armor: true
    });
    // renormalize the line endings to the one true line-ending
    signature = normalizeNewlines(signature);
    const signedCommit =
      headers + '\n' + 'gpgsig' + indent(signature) + '\n' + message;
    // return a new commit object
    return GitCommit.from(signedCommit)
  }

  async listSigningKeys (openpgp) {
    const msg = openpgp.message.readSignedContent(
      this.withoutSignature(),
      this.isolateSignature()
    );
    return msg.getSigningKeyIds().map(keyid => keyid.toHex())
  }

  async verify (openpgp, publicKeys) {
    const pubKeyObj = openpgp.key.readArmored(publicKeys).keys;
    const msg = openpgp.message.readSignedContent(
      this.withoutSignature(),
      this.isolateSignature()
    );
    const results = msg.verify(pubKeyObj);
    const validity = results.reduce((a, b) => a.valid && b.valid, {
      valid: true
    });
    return validity
  }
}

// @ts-check

/**
 * Create a signed commit
 *
 * <aside>
 * OpenPGP.js is unfortunately licensed under an incompatible license and thus cannot be included in a minified bundle with
 * isomorphic-git which is an MIT/BSD style library, because that would violate the "dynamically linked" stipulation.
 * To use this feature you include openpgp with a separate script tag and pass it in as an argument.
 * </aside>
 *
 * It creates a signed version of whatever commit HEAD currently points to, and then updates the current branch,
 * leaving the original commit dangling.
 *
 * The `privateKeys` argument is a single string in ASCII armor format. However, it is plural "keys" because
 * you can technically have multiple private keys in a single ASCII armor string. The openpgp.sign() function accepts
 * multiple keys, so while I haven't tested it, it should support signing a single commit with multiple keys.
 *
 * @deprecated
 * > **Deprecated**
 * > This command will be removed in the 1.0.0 version of `isomorphic-git` as it is no longer necessary.
 * >
 * > Previously, to sign commits you needed two steps, `commit` and then `sign`.
 * > Now commits can be signed when they are created with the [`commit`](./commit.md) command, provided you use a [`pgp`](./plugin_pgp.md) plugin.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.openpgp - An instance of the [OpenPGP library](https://unpkg.com/openpgp%402.6.2)
 * @param {string} args.privateKeys - A PGP private key in ASCII armor format
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are completed
 *
 * @example
 * let sha = await git.sign({
 *   dir: '$input((/))',
 *   openpgp,
 *   privateKeys: `$textarea((
 * -----BEGIN PGP PRIVATE KEY BLOCK-----
 * ...
 * ))`
 * })
 * console.log(sha)
 *
 */
async function sign ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  privateKeys,
  openpgp
}) {
  try {
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
      const pgp = cores.get(core).get('pgp');
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

// @ts-check

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
async function status ({
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
    });
    if (ignored) {
      return 'ignored'
    }
    const treeOid = await getOidAtPath({
      fs,
      dir,
      gitdir,
      path: filepath
    });
    // Acquire a lock on the index
    const { indexEntry, conflictEntry } = await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      return {
        indexEntry: index.entriesMap.get(GitIndex.key(filepath, 0)),
        conflictEntry: index.entriesMap.get(GitIndex.key(filepath, 2))
      }
    });
    const stats = await fs.lstat(join(dir, filepath));

    const H = treeOid !== null; // head
    const I = !!indexEntry; // index
    const W = stats !== null; // working dir
    const C = !!conflictEntry; // in conflict

    const getWorkdirOid = async () => {
      if (I && !compareStats(indexEntry, stats)) {
        return indexEntry.oid
      } else {
        const object = await fs.read(join(dir, filepath));
        const workdirOid = await hashObject$1({
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
            GitIndexManager.acquire({ fs, gitdir }, async function (index) {
              index.insert({ filepath, stats, oid: workdirOid });
            });
          }
        }
        return workdirOid
      }
    };

    const prefix = C ? '!' : '';
    if (!H && !W && !I) return prefix + 'absent' // ---
    if (!H && !W && I) return prefix + '*absent' // -A-
    if (!H && W && !I) return prefix + '*added' // --A
    if (!H && W && I) {
      const workdirOid = await getWorkdirOid();
      return prefix + (workdirOid === indexEntry.oid ? 'added' : '*added') // -AA : -AB
    }
    if (H && !W && !I) return prefix + 'deleted' // A--
    if (H && !W && I) {
      return prefix + (treeOid === indexEntry.oid ? '*deleted' : '*deleted') // AA- : AB-
    }
    if (H && W && !I) {
      const workdirOid = await getWorkdirOid();
      return prefix + (workdirOid === treeOid ? '*undeleted' : '*undeletemodified') // A-A : A-B
    }
    if (H && W && I) {
      const workdirOid = await getWorkdirOid();
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

class GitWalkerIndex {
  constructor ({ fs, gitdir }) {
    this.treePromise = GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      const result = flatFileListToDirectoryStructure(index.entries);
      const conflicts = index.conflictedPaths;
      for (const path of conflicts) {
        const inode = result.get(path);
        if (inode) inode.conflict = true;
      }
      return result
    });
    const walker = this;
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
    const filepath = entry.fullpath;
    const tree = await this.treePromise;
    const inode = tree.get(filepath);
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
    const tree = await this.treePromise;
    const inode = tree.get(entry.fullpath);
    if (!inode) {
      throw new Error(
        `ENOENT: no such file or directory, lstat '${entry.fullpath}'`
      )
    }
    const stats = inode.type === 'tree' ? {} : normalizeStats(inode.metadata);
    Object.assign(entry, { type: inode.type }, stats);
  }

  async populateContent (entry) {
    // Cannot get content for an index entry
  }

  async populateHash (entry) {
    const tree = await this.treePromise;
    const inode = tree.get(entry.fullpath);
    if (!inode) return null
    if (inode.type === 'tree') {
      throw new Error(`EISDIR: illegal operation on a directory, read`)
    }
    Object.assign(entry, {
      oid: inode.metadata.oid
    });
  }
}

// @ts-check

/**
 *
 * @typedef Walker
 * @property {Symbol} Symbol('GitWalkerSymbol')
 */

/**
 * Get a git index Walker
 *
 * See [walkBeta1](./walkBeta1.md)
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 *
 * @returns {Walker} Returns a git index Walker
 *
 */
function STAGE ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs')
}) {
  const o = Object.create(null);
  Object.defineProperty(o, GitWalkerSymbol, {
    value: function () {
      return new GitWalkerIndex({ fs, gitdir })
    }
  });
  Object.freeze(o);
  return o
}

// @ts-check

/**
 * Efficiently get the status of multiple files at once.
 *
 * The returned `StatusMatrix` is admittedly not the easiest format to read.
 * However it conveys a large amount of information in dense format that should make it easy to create reports about the current state of the repository;
 * without having to do multiple, time-consuming isomorphic-git calls.
 * My hope is that the speed and flexibility of the function will make up for the learning curve of interpreting the return value.
 *
 * ```js live
 * // get the status of all the files in 'src'
 * let status = await git.statusMatrix({ dir: '$input((/))', pattern: '$input((src/**))' })
 * console.log(status)
 * ```
 *
 * ```js live
 * // get the status of all the JSON and Markdown files
 * let status = await git.statusMatrix({ dir: '$input((/))', pattern: '$input((**\/*.{json,md}))' })
 * console.log(status)
 * ```
 *
 * The result is returned as a 2D array.
 * The outer array represents the files and/or blobs in the repo, in alphabetical order.
 * The inner arrays describe the status of the file:
 * the first value is the filepath, and the next three are integers
 * representing the HEAD status, WORKDIR status, and STAGE status of the entry.
 *
 * ```js
 * // example StatusMatrix
 * [
 *   ["a.txt", 0, 2, 0], // new, untracked
 *   ["b.txt", 0, 2, 2], // added, staged
 *   ["c.txt", 0, 2, 3], // added, staged, with unstaged changes
 *   ["d.txt", 1, 1, 1], // unmodified
 *   ["e.txt", 1, 2, 1], // modified, unstaged
 *   ["f.txt", 1, 2, 2], // modified, staged
 *   ["g.txt", 1, 2, 3], // modified, staged, with unstaged changes
 *   ["h.txt", 1, 0, 1], // deleted, unstaged
 *   ["i.txt", 1, 0, 0], // deleted, staged
 * ]
 * ```
 *
 * - The HEAD status is either absent (0) or present (1).
 * - The WORKDIR status is either absent (0), identical to HEAD (1), or different from HEAD (2).
 * - The STAGE status is either absent (0), identical to HEAD (1), identical to WORKDIR (2), or different from WORKDIR (3).
 *
 * ```ts
 * type Filename      = string
 * type HeadStatus    = 0 | 1
 * type WorkdirStatus = 0 | 1 | 2
 * type StageStatus   = 0 | 1 | 2 | 3
 *
 * type StatusRow     = [Filename, HeadStatus, WorkdirStatus, StageStatus]
 *
 * type StatusMatrix  = StatusRow[]
 * ```
 *
 * > Think of the natural progression of file modifications as being from HEAD (previous) -> WORKDIR (current) -> STAGE (next).
 * > Then HEAD is "version 1", WORKDIR is "version 2", and STAGE is "version 3".
 * > Then, imagine a "version 0" which is before the file was created.
 * > Then the status value in each column corresponds to the oldest version of the file it is identical to.
 * > (For a file to be identical to "version 0" means the file is deleted.)
 *
 * Here are some examples of queries you can answer using the result:
 *
 * #### Q: What files have been deleted?
 * ```js
 * const FILE = 0, WORKDIR = 2
 *
 * const filenames = (await statusMatrix({ dir }))
 *   .filter(row => row[WORKDIR] === 0)
 *   .map(row => row[FILE])
 * ```
 *
 * #### Q: What files have unstaged changes?
 * ```js
 * const FILE = 0, WORKDIR = 2, STAGE = 3
 *
 * const filenames = (await statusMatrix({ dir }))
 *   .filter(row => row[WORKDIR] !== row[STAGE])
 *   .map(row => row[FILE])
 * ```
 *
 * #### Q: What files have been modified since the last commit?
 * ```js
 * const FILE = 0, HEAD = 1, WORKDIR = 2
 *
 * const filenames = (await statusMatrix({ dir }))
 *   .filter(row => row[HEAD] !== row[WORKDIR])
 *   .map(row => row[FILE])
 * ```
 *
 * #### Q: What files will NOT be changed if I commit right now?
 * ```js
 * const FILE = 0, HEAD = 1, STAGE = 3
 *
 * const filenames = (await statusMatrix({ dir }))
 *   .filter(row => row[HEAD] === row[STAGE])
 *   .map(row => row[FILE])
 * ```
 *
 * For reference, here are all possible combinations:
 *
 * | HEAD | WORKDIR | STAGE | `git status --short` equivalent |
 * | ---- | ------- | ----- | ------------------------------- |
 * | 0    | 0       | 0     | ``                              |
 * | 0    | 0       | 3     | `AD`                            |
 * | 0    | 2       | 0     | `??`                            |
 * | 0    | 2       | 2     | `A `                            |
 * | 0    | 2       | 3     | `AM`                            |
 * | 1    | 0       | 0     | `D `                            |
 * | 1    | 0       | 1     | ` D`                            |
 * | 1    | 0       | 3     | `MD`                            |
 * | 1    | 1       | 0     | `D ` + `??`                     |
 * | 1    | 1       | 1     | ``                              |
 * | 1    | 1       | 3     | `MM`                            |
 * | 1    | 2       | 0     | `D ` + `??`                     |
 * | 1    | 2       | 1     | ` M`                            |
 * | 1    | 2       | 2     | `M `                            |
 * | 1    | 2       | 3     | `MM`                            |
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ref = 'HEAD'] - Optionally specify a different commit to compare against the workdir and stage instead of the HEAD
 * @param {string[]} [args.filepaths = ['.']] - Limit the query to the given files and directories
 * @param {string} [args.pattern = null] - Filter the results to only those whose filepath matches a glob pattern. (Pattern is relative to `filepaths` if `filepaths` is provided.)
 *
 * @returns {Promise<number[][]>} Resolves with a status matrix, described below.
 */
async function statusMatrix ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref = 'HEAD',
  filepaths = ['.'],
  pattern = null
}) {
  try {
    let count = 0;
    let patternPart = '';
    let patternGlobrex;
    if (pattern) {
      patternPart = patternRoot(pattern);
      if (patternPart) {
        pattern = pattern.replace(patternPart + '/', '');
      }
      patternGlobrex = globrex(pattern, { globstar: true, extended: true });
    }
    const bases = filepaths.map(filepath => join(filepath, patternPart));
    const results = await walkBeta1({
      trees: [
        TREE({ fs, gitdir, ref }),
        WORKDIR({ fs, dir, gitdir }),
        STAGE({ fs, gitdir })
      ],
      filter: async function ([head, workdir, stage]) {
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
        // match against base paths
        return bases.some(base => worthWalking(head.fullpath, base))
      },
      map: async function ([head, workdir, stage]) {
        // Late filter against file names
        if (patternGlobrex) {
          let match = false;
          for (const base of bases) {
            const partToMatch = head.fullpath.replace(base + '/', '');
            if (patternGlobrex.regex.test(partToMatch)) {
              match = true;
              break
            }
          }
          if (!match) return
        }
        // For now, just bail on directories
        await Promise.all([
          stage.populateStat(),
          workdir.populateStat(),
          head.populateStat()
        ]);
        if (stage.type === 'tree' || stage.type === 'special' ||
            workdir.type === 'tree' || workdir.type === 'special' ||
            head.type === 'tree' || head.type === 'special') return
        // Figure out the oids, using the staged oid for the working dir oid if the stats match.
        await Promise.all([
          head.populateHash(),
          stage.populateHash()
        ]);
        if (!head.exists && workdir.exists && !stage.exists) {
          // We don't actually NEED the sha. Any sha will do
          // TODO: update this logic to handle N trees instead of just 3.
          workdir.oid = '42';
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
        const entry = [undefined, head.oid, workdir.oid, stage.oid];
        const result = entry.map(value => entry.indexOf(value));
        result.shift(); // remove leading undefined entry
        const fullpath = head.fullpath || workdir.fullpath || stage.fullpath;
        return [fullpath, ...result, !!stage.conflict]
      }
    });
    return results
  } catch (err) {
    err.caller = 'git.statusMatrix';
    throw err
  }
}

// @ts-check

/**
 * Create a lightweight tag
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - What to name the tag
 * @param {string} [args.object = 'HEAD'] - What oid the tag refers to. (Will resolve to oid if value is a ref.) By default, the commit object which is referred by the current `HEAD` is used.
 * @param {boolean} [args.force = false] - Instead of throwing an error if a tag named `ref` already exists, overwrite the existing tag.
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.tag({ dir: '$input((/))', ref: '$input((test-tag))' })
 * console.log('done')
 *
 */
async function tag ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref,
  object,
  force = false
}) {
  try {
    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'tag',
        parameter: 'ref'
      })
    }

    ref = ref.startsWith('refs/tags/') ? ref : `refs/tags/${ref}`;

    // Resolve passed object
    const value = await GitRefManager.resolve({
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

// @ts-check

/**
 * Verify a signed commit or tag
 *
 * For now, key management is beyond the scope of isomorphic-git's PGP features.
 * It is up to you to figure out what the commit's or tag's public key _should_ be.
 * I would use the "author" or "committer" name and email, and look up
 * that person's public key from a trusted source such as the GitHub API.
 *
 * The function returns `false` if any of the signatures on a signed git commit are invalid.
 * Otherwise, it returns an array of the key ids that were used to sign it.
 *
 * The `publicKeys` argument is a single string in ASCII armor format. However, it is plural "keys" because
 * you can technically have multiple public keys in a single ASCII armor string. While I haven't tested it, it
 * should support verifying a single commit signed with multiple keys. Hence why the returned result is an array of key ids.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - A reference to the commit or tag to verify
 * @param {string} args.publicKeys - A PGP public key in ASCII armor format.
 * @param {OpenPGP} [args.openpgp] - [deprecated] An instance of the [OpenPGP library](https://unpkg.com/openpgp@2.6.2). Deprecated in favor of using a [PGP plugin](./plugin_pgp.md).
 *
 * @returns {Promise<false | string[]>} The value `false` or the valid key ids (in hex format) used to sign the commit.
 *
 * @example
 * let keyids = await git.verify({
 *   dir: '$input((/))',
 *   openpgp,
 *   ref: '$input((HEAD))',
 *   publicKeys: `$textarea((
 * -----BEGIN PGP PUBLIC KEY BLOCK-----
 * ...
 * ))`
 * })
 * console.log(keyids)
 *
 */
async function verify ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref,
  publicKeys,
  openpgp
}) {
  try {
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
      const commit = SignedGitCommit.from(object);
      const keys = await commit.listSigningKeys(openpgp);
      const validity = await commit.verify(openpgp, publicKeys);
      if (!validity) return false
      return keys
    } else {
      // Newer plugin API
      const pgp = cores.get(core).get('pgp');
      if (type === 'commit') {
        const commit = GitCommit.from(object);
        const { valid, invalid } = await GitCommit.verify(
          commit,
          pgp,
          publicKeys
        );
        if (invalid.length > 0) return false
        return valid
      } else if (type === 'tag') {
        const tag = GitAnnotatedTag.from(object);
        const { valid, invalid } = await GitAnnotatedTag.verify(
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

// @ts-check

/**
 * Return the version number of isomorphic-git
 *
 * I don't know why you might need this. I added it just so I could check that I was getting
 * the correct version of the library and not a cached version.
 *
 * @returns {string} the version string taken from package.json at publication time
 *
 * @example
 * console.log(git.version())
 *
 */
function version () {
  try {
    return pkg.version
  } catch (err) {
    err.caller = 'git.version';
    throw err
  }
}

// @ts-check

/**
 * Write a git object directly
 *
 * `format` can have the following values:
 *
 * | param      | description                                                                                                                                                      |
 * | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
 * | 'deflated' | Treat `object` as the raw deflate-compressed buffer for an object, meaning can be written to `.git/objects/**` as-is.                                           |
 * | 'wrapped'  | Treat `object` as the inflated object buffer wrapped in the git object header. This is the raw buffer used when calculating the SHA-1 object id of a git object. |
 * | 'content'  | Treat `object` as the object buffer without the git header.                                                                                                      |
 * | 'parsed'   | Treat `object` as a parsed representation of the object.                                                                                                         |
 *
 * If `format` is `'parsed'`, then `object` must match one of the schemas for `CommitDescription`, `TreeDescription`, or `TagDescription` described in...
 * shucks I haven't written that page yet. :( Well, described in the [TypeScript definition](https://github.com/isomorphic-git/isomorphic-git/blob/master/src/index.d.ts) for now.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {Buffer|string|Object} args.object - The object to write.
 * @param {'blob'|'tree'|'commit'|'tag'} args.type - The kind of object to write.
 * @param {'deflated' | 'wrapped' | 'content' | 'parsed'} [args.format = 'parsed'] - What format the object is in. The possible choices are listed below.
 * @param {string} args.oid - If `format` is `'deflated'` then this param is required. Otherwise it is calculated.
 * @param {string} [args.filepath] - Don't return the object with `oid` itself, but resolve `oid` to a tree and then return the object at that filepath. To return the root directory of a tree set filepath to `''`
 * @param {string} [args.encoding] - If `type` is `'blob'` then `content` will be converted to a Buffer using `encoding`.
 *
 * @returns {Promise<string>} Resolves successfully with the SHA-1 object id of the newly written object.
 *
 * @example
 * // Manually create an annotated tag.
 * let sha = await git.resolveRef({ dir: '$input((/))', ref: '$input((HEAD))' })
 * console.log('commit', sha)
 *
 * let oid = await git.writeObject({
 *   dir: '$input((/))',
 *   type: 'tag',
 *   object: {
 *     object: sha,
 *     type: 'commit',
 *     tag: '$input((my-tag))',
 *     tagger: {
 *       name: '$input((your name))',
 *       email: '$input((email@example.com))',
 *       timestamp: Math.floor(Date.now()/1000),
 *       timezoneOffset: new Date().getTimezoneOffset()
 *     },
 *     message: '$input((Optional message))',
 *     signature: ''
 *   }
 * })
 *
 * console.log('tag', oid)
 *
 */
async function writeObject$1 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  type,
  object,
  format = 'parsed',
  oid,
  encoding = undefined
}) {
  try {
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

// @ts-check

/**
 * Write a ref which refers to the specified SHA-1 object id, or a symbolic ref which refers to the specified ref.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ref - The name of the ref to write
 * @param {string} args.value - When `symbolic` is false, a ref or an SHA-1 object id. When true, a ref starting with `refs/`.
 * @param {boolean} [args.force = false] - Instead of throwing an error if a ref named `ref` already exists, overwrite the existing ref.
 * @param {boolean} [args.symbolic = false] - Whether the ref is symbolic or not.
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.writeRef({
 *   dir: '$input((/))',
 *   ref: '$input((refs/heads/another-branch))',
 *   value: '$input((HEAD))'
 * })
 * await git.writeRef({
 *   dir: '$input((/))',
 *   ref: '$input((HEAD))',
 *   value: '$input((refs/heads/another-branch))',
 *   force: $input((true)),
 *   symbolic: $input((true))
 * })
 * console.log('done')
 *
 */
async function writeRef ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ref,
  value,
  force = false,
  symbolic = false
}) {
  try {
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

exports.E = E;
exports.STAGE = STAGE;
exports.TREE = TREE;
exports.WORKDIR = WORKDIR;
exports.add = add;
exports.addRemote = addRemote;
exports.annotatedTag = annotatedTag;
exports.branch = branch;
exports.checkout = checkout;
exports.clone = clone;
exports.commit = commit;
exports.config = config;
exports.cores = cores;
exports.currentBranch = currentBranch;
exports.deleteBranch = deleteBranch;
exports.deleteRef = deleteRef;
exports.deleteRemote = deleteRemote;
exports.deleteTag = deleteTag;
exports.expandOid = expandOid$1;
exports.expandRef = expandRef;
exports.fetch = fetch;
exports.findMergeBase = findMergeBase;
exports.findRoot = findRoot;
exports.getOidAtPath = getOidAtPath;
exports.getRemoteInfo = getRemoteInfo;
exports.hashBlob = hashBlob;
exports.indexPack = indexPack;
exports.init = init;
exports.isDescendent = isDescendent;
exports.listBranches = listBranches;
exports.listCommitsAndTags = listCommitsAndTags;
exports.listFiles = listFiles;
exports.listRemotes = listRemotes;
exports.listTags = listTags;
exports.log = log$1;
exports.merge = merge;
exports.packObjects = packObjects;
exports.plugins = plugins;
exports.pull = pull;
exports.push = push;
exports.readObject = readObject$1;
exports.remove = remove;
exports.resetIndex = resetIndex;
exports.resolveRef = resolveRef;
exports.sign = sign;
exports.status = status;
exports.statusMatrix = statusMatrix;
exports.tag = tag;
exports.utils = utils;
exports.verify = verify;
exports.version = version;
exports.walkBeta1 = walkBeta1;
exports.writeObject = writeObject$1;
exports.writeRef = writeRef;
