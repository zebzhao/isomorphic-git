import AsyncLock from 'async-lock';
import crc32 from 'crc-32';
import applyDelta from 'git-apply-delta';
import { mark, stop } from 'marky';
import pako from 'pako';
import Hash from 'sha.js/sha1';
import ignore from 'ignore';
import pify from 'pify';
import diff3Merge from 'diff3';
import _path from 'path';

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
  RemoteDoesNotSupportSmartHTTP: `Remote did not reply using the "smart" HTTP protocol. Expected "001e# service=git-upload-pack" but received: { preview }`,
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
  ShortOidNotFound: `Could not find an object matching "{ short }".`,
  CheckoutConflictError: `Your local changes to the following files would be overwritten by checkout: { filepaths }`,
  NoteAlreadyExistsError: `A note object { note } already exists on object { oid }. Use 'force: true' parameter to overwrite existing notes.`
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
  ShortOidNotFound: `ShortOidNotFound`,
  CheckoutConflictError: `CheckoutConflictError`,
  NoteAlreadyExistsError: `NoteAlreadyExistsError`
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
  },
  'isomorphic-git': {
    autoTranslateSSH: bool
  }
};

// https://git-scm.com/docs/git-config#_syntax

// section starts with [ and ends with ]
// section is alphanumeric (ASCII) with - and .
// section is case insensitive
// subsection is optionnal
// subsection is specified after section and one or more spaces
// subsection is specified between double quotes
const SECTION_LINE_REGEX = /^\[([A-Za-z0-9-.]+)(?: "(.*)")?\]$/;
const SECTION_REGEX = /^[A-Za-z0-9-.]+$/;

// variable lines contain a name, and equal sign and then a value
// variable lines can also only contain a name (the implicit value is a boolean true)
// variable name is alphanumeric (ASCII) with -
// variable name starts with an alphabetic character
// variable name is case insensitive
const VARIABLE_LINE_REGEX = /^([A-Za-z][A-Za-z-]*)(?: *= *(.*))?$/;
const VARIABLE_NAME_REGEX = /^[A-Za-z][A-Za-z-]*$/;

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

let lock = null;

class GitShallowManager {
  static async read ({ fs, gitdir }) {
    if (lock === null) lock = new AsyncLock();
    const filepath = join(gitdir, 'shallow');
    const oids = new Set();
    await lock.acquire(filepath, async function () {
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
    if (lock === null) lock = new AsyncLock();
    const filepath = join(gitdir, 'shallow');
    if (oids.size > 0) {
      const text = [...oids].join('\n') + '\n';
      await lock.acquire(filepath, async function () {
        await fs.write(filepath, text, {
          encoding: 'utf8'
        });
      });
    } else {
      // No shallows
      await lock.acquire(filepath, async function () {
        await fs.rm(filepath);
      });
    }
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
    if (this._tag.indexOf('\n-----BEGIN PGP SIGNATURE-----') === -1) return
    const signature = this._tag.slice(
      this._tag.indexOf('-----BEGIN PGP SIGNATURE-----'),
      this._tag.indexOf('-----END PGP SIGNATURE-----') +
        '-----END PGP SIGNATURE-----'.length
    );
    return normalizeNewlines(signature)
  }

  payload () {
    return this.withoutSignature() + '\n'
  }

  toObject () {
    return Buffer.from(this._tag, 'utf8')
  }

  static async sign (tag, pgp, secretKey) {
    const payload = tag.payload();
    let { signature } = await pgp.sign({ payload, secretKey });
    // renormalize the line endings to the one true line-ending
    signature = normalizeNewlines(signature);
    const signedTag = payload + signature;
    // return a new tag object
    return GitAnnotatedTag.from(signedTag)
  }

  static async verify (tag, pgp, publicKey) {
    const payload = tag.payload();
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

async function readObjectLoose ({ fs, gitdir, oid }) {
  const source = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  const file = await fs.read(`${gitdir}/${source}`);
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
  let PACK = await reader.read(4);
  PACK = PACK.toString('utf8');
  if (PACK !== 'PACK') {
    throw new GitError(E.InternalFail, {
      message: `Invalid PACK header '${PACK}'`
    })
  }

  let version = await reader.read(4);
  version = version.readUInt32BE(0);
  if (version !== 2) {
    throw new GitError(E.InternalFail, {
      message: `Invalid packfile version: ${version}`
    })
  }

  let numObjects = await reader.read(4);
  numObjects = numObjects.readUInt32BE(0);
  // If (for some godforsaken reason) this is an empty packfile, abort now.
  if (numObjects < 1) return

  while (!reader.eof() && numObjects--) {
    const offset = reader.tell();
    const { type, length, ofs, reference } = await parseHeader(reader);
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
        await reader.read(chunk.length - inflator.strm.avail_in);
        const end = reader.tell();
        await onData({
          data: inflator.result,
          type,
          num: numObjects,
          offset,
          end,
          reference,
          ofs
        });
      }
    }
  }
}

async function parseHeader (reader) {
  // Object type is encoded in bits 654
  let byte = await reader.byte();
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
      ofs |= (byte & 0b01111111) << shift;
      shift += 7;
      bytes.push(byte);
    } while (byte & 0b10000000)
    reference = Buffer.from(bytes);
  }
  if (type === 7) {
    const buf = await reader.read(20);
    reference = buf;
  }
  return { type, length, ofs, reference }
}

/* eslint-env node, browser */

async function inflate (buffer) {
  return  pako.inflate(buffer)
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

function toHex (buffer) {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) {
    if (byte < 16) hex += '0';
    hex += byte.toString(16);
  }
  return hex
}

/* eslint-env node, browser */

let supportsSubtleSHA1 = null;

async function shasum (buffer) {
  if (supportsSubtleSHA1 === null) {
    supportsSubtleSHA1 = await testSubtleSHA1();
  }
  return supportsSubtleSHA1 ? subtleSHA1(buffer) : shasumSync(buffer)
}

// This is modeled after @dominictarr's "shasum" module,
// but without the 'json-stable-stringify' dependency and
// extra type-casting features.
function shasumSync (buffer) {
  return new Hash().update(buffer).digest('hex')
}

async function subtleSHA1 (buffer) {
  const hash = await crypto.subtle.digest('SHA-1', buffer);
  return toHex(hash)
}

async function testSubtleSHA1 () {
  // I'm using a rather crude method of progressive enhancement, because
  // some browsers that have crypto.subtle.digest don't actually implement SHA-1.
  try {
    const hash = await subtleSHA1(new Uint8Array([]));
    if (hash === 'da39a3ee5e6b4b0d3255bfef95601890afd80709') return true
  } catch (_) {
    // no bother
  }
  return false
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
    mark('fromIdx');
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
    mark('hashes');
    const hashes = [];
    for (let i = 0; i < size; i++) {
      const hash = reader.slice(20).toString('hex');
      hashes[i] = hash;
    }
    log(`hashes ${stop('hashes').duration}`);
    reader.seek(reader.tell() + 4 * size);
    // Skip over CRCs
    mark('offsets');
    // Get offsets
    const offsets = new Map();
    for (let i = 0; i < size; i++) {
      offsets.set(hashes[i], reader.readUInt32BE());
    }
    log(`offsets ${stop('offsets').duration}`);
    const packfileSha = reader.slice(20).toString('hex');
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
    await listpack([pack], async ({ data, type, reference, offset, num }) => {
      if (totalObjectCount === null) totalObjectCount = num;
      const percent = Math.floor(
        ((totalObjectCount - num) * 100) / totalObjectCount
      );
      if (percent !== lastPercent) {
        if (emitter) {
          await emitter.emit(`${emitterPrefix}progress`, {
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
    const offsetArray = Object.keys(offsetToObject).map(Number);
    for (const [i, start] of offsetArray.entries()) {
      const end =
        i + 1 === offsetArray.length ? pack.byteLength - 20 : offsetArray[i + 1];
      const o = offsetToObject[start];
      const crc = crc32.buf(pack.slice(start, end)) >>> 0;
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
    const objectsByDepth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let offset in offsetToObject) {
      offset = Number(offset);
      const percent = Math.floor((count++ * 100) / totalObjectCount);
      if (percent !== lastPercent) {
        log(
          `${percent}%\t${Math.floor(
            stop('percent').duration
          )}\t${callsToReadSlice}\t${callsToGetExternal}`
        );
        if (emitter) {
          await emitter.emit(`${emitterPrefix}progress`, {
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

      const o = offsetToObject[offset];
      if (o.oid) continue
      try {
        p.readDepth = 0;
        p.externalReadDepth = 0;
        const { type, object } = await p.readSlice({ start: offset });
        callsToReadSlice += p.readDepth;
        callsToGetExternal += p.externalReadDepth;
        objectsByDepth[p.readDepth] += 1;
        const oid = await shasum(GitObject.wrap({ type, object }));
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
    const totalElapsedTime = stop('total').duration;
    times.misc = Math.floor(
      Object.values(times).reduce((a, b) => a - b, totalElapsedTime)
    );
    log(Object.keys(times).join('\t'));
    log(Object.values(times).join('\t'));
    log('by depth:');
    log([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].join('\t'));
    log(objectsByDepth.slice(0, 12).join('\t'));
    return p
  }

  async toBuffer () {
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
    const sha = await shasum(totalBuffer);
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
    object = Buffer.from(await inflate(buffer));
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
      result.object = Buffer.from(await inflate(result.object));
      result.format = 'wrapped';
    case 'wrapped':
      if (format === 'wrapped' && result.format === 'wrapped') {
        return result
      }
      const sha = await shasum(result.object);
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
        http: [],
        iterate: []
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

function compareStrings (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  return -(a < b) || +(a > b)
}

function comparePath (a, b) {
  // https://stackoverflow.com/a/40355107/2168416
  return compareStrings(a.path, b.path)
}

function compareTreeEntryPath (a, b) {
  // Git sorts tree entries as if there is a trailing slash on directory names.
  return compareStrings(appendSlashIfDir(a), appendSlashIfDir(b))
}

function appendSlashIfDir (entry) {
  return entry.mode === '040000' ? entry.path + '/' : entry.path
}

/**
 *
 * @typedef {Object} TreeEntry
 * @property {string} mode - the 6 digit hexadecimal mode
 * @property {string} path - the name of the file or directory
 * @property {string} oid - the SHA-1 object id of the blob or tree
 * @property {'commit'|'blob'|'tree'} type - the type of object
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
    entry.type = mode2type(entry.mode); // index
  }
  return entry
}

class GitTree {
  constructor (entries) {
    if (Buffer.isBuffer(entries)) {
      this._entries = parseBuffer(entries);
    } else if (Array.isArray(entries)) {
      this._entries = entries.map(nudgeIntoShape);
    } else {
      throw new GitError(E.InternalFail, {
        message: 'invalid type passed to GitTree constructor'
      })
    }
    // Tree entries are not sorted alphabetically in the usual sense (see `compareTreeEntryPath`)
    // but it is important later on that these be sorted in the same order as they would be returned from readdir.
    this._entries.sort(comparePath);
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
    // Adjust the sort order to match git's
    const entries = [...this._entries];
    entries.sort(compareTreeEntryPath);
    return Buffer.concat(
      entries.map(entry => {
        const mode = Buffer.from(entry.mode.replace(/^0/, ''));
        const space = Buffer.from(' ');
        const path = Buffer.from(entry.path, 'utf8');
        const nullchar = Buffer.from([0]);
        const oid = Buffer.from(entry.oid, 'hex');
        return Buffer.concat([mode, space, path, nullchar, oid])
      })
    )
  }

  /**
   * @returns {TreeEntry[]}
   */
  entries () {
    return this._entries
  }

  * [Symbol.iterator] () {
    for (const entry of this._entries) {
      yield entry;
    }
  }
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

/* eslint-env node, browser */

let supportsCompressionStream = null;

async function deflate (buffer) {
  if (supportsCompressionStream === null) {
    supportsCompressionStream = testCompressionStream();
  }
  return supportsCompressionStream
    ? browserDeflate(buffer)
    : pako.deflate(buffer)
}

async function browserDeflate (buffer) {
  const cs = new CompressionStream('deflate');
  const c = new Blob([buffer]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(c).arrayBuffer())
}

function testCompressionStream () {
  try {
    const cs = new CompressionStream('deflate');
    if (cs) return true
  } catch (_) {
    // no bother
  }
  return false
}

function padHex (b, n) {
  const s = n.toString(16);
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
  async function writeObject ({ stype, object }) {
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
    write(Buffer.from(await deflate(object)));
  }
  write('PACK');
  write('00000002', 'hex');
  // Write a 4 byte (32-bit) int
  write(padHex(8, oids.length), 'hex');
  for (const oid of oids) {
    const { type, object } = await readObject({ fs, gitdir, oid });
    await writeObject({ write, object, stype: type });
  }
  // Write SHA1 checksum
  const digest = hash.digest();
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

const pkg = {
  name: 'isomorphic-git',
  version: '0.0.0-development',
  agent: 'git/isomorphic-git@0.0.0-development'
};

async function writeRefsAdResponse ({ capabilities, refs, symrefs }) {
  const stream = [];
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
  fs = cores.get(core).get('fs'),
  advertiseRefs = false
}) {
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
    // '.' is not a valid gitignore entry, so '.' is never ignored
    if (filepath === '.') return false
    // ALWAYS ignore ".git" folders.
    if (basename(filepath) === '.git') return true
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

class GitIndex {
  /*::
   _entries: Map<string, CacheEntry>
   _dirty: boolean // Used to determine if index needs to be saved to filesystem
   */
  constructor (entries) {
    this._dirty = false;
    this._entries = entries || new Map();
  }

  static async from (buffer) {
    if (Buffer.isBuffer(buffer)) {
      return GitIndex.fromBuffer(buffer)
    } else if (buffer === null) {
      return new GitIndex(null)
    } else {
      throw new GitError(E.InternalFail, {
        message: 'invalid type passed to GitIndex.from'
      })
    }
  }

  static async fromBuffer (buffer) {
    // Verify shasum
    const shaComputed = await shasum(buffer.slice(0, -20));
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
        message: `Inavlid dircache magic file number: ${magic}`
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
    return new GitIndex(_entries)
  }

  static key (path, stage) {
    // No delimiter is needed as long as stage is always 1 char
    return path + stage
  }

  get entries () {
    return [...this._entries.values()].sort(comparePath)
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

  async toObject () {
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
    const sum = await shasum(main);
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
    oid = await shasum(object);
    object = Buffer.from(await deflate(object));
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
let lock$1 = null;

async function updateCachedIndexFile (fs, filepath) {
  const stat = await fs.lstat(filepath);
  const rawIndexFile = await fs.read(filepath);
  const index = await GitIndex.from(rawIndexFile);
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
  /**
   *
   * @param {object} opts
   * @param {function(GitIndex): any} closure
   */
  static async acquire ({ fs, gitdir }, closure) {
    const filepath = `${gitdir}/index`;
    if (lock$1 === null) lock$1 = new AsyncLock({ maxPending: Infinity });
    let result;
    await lock$1.acquire(filepath, async function () {
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
        const buffer = await index.toObject();
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

async function collect (iterable) {
  const buffers = [];
  // This will be easier once `for await ... of` loops are available.
  await forAwait(iterable, value => buffers.push(Buffer.from(value)));
  return Buffer.concat(buffers)
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
  const res = await global.fetch(url, { method, headers, body });
  const iter =
    res.body && res.body.getReader
      ? fromStream(res.body)
      : [new Uint8Array(await res.arrayBuffer())];
  // convert Header object to ordinary JSON
  headers = {};
  for (const [key, value] of res.headers.entries()) {
    headers[key] = value;
  }
  return {
    url: res.url,
    method: res.method,
    statusCode: res.status,
    statusMessage: res.statusText,
    body: iter,
    headers: headers
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
  const [firstRef, capabilitiesLine] = splitAndAssert(
    lineTwo.toString('utf8'),
    '\x00',
    '\\x00'
  );
  capabilitiesLine.split(' ').map(x => capabilities.add(x));
  const [ref, name] = splitAndAssert(firstRef, ' ', ' ');
  refs.set(name, ref);
  while (true) {
    const line = await read();
    if (line === true) break
    if (line !== null) {
      const [ref, name] = splitAndAssert(line.toString('utf8'), ' ', ' ');
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

function splitAndAssert (line, sep, expected) {
  const split = line.trim().split(sep);
  if (split.length !== 2) {
    throw new GitError(E.AssertServerResponseFail, {
      expected: `Two strings separated by '${expected}'`,
      actual: line.toString('utf8')
    })
  }
  return split
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
      // However, since the oauth2 option is incompatible with usernames and passwords, rather than throw an
      // E.MixUsernamePasswordOauth2formatTokenError error, we'll avoid that situation by ignoring the username
      // and/or password in the url.
      if (!auth.oauth2format) {
        auth.username = auth.username || urlAuth.username;
        auth.password = auth.password || urlAuth.password;
      }
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
    // Git "smart" HTTP servers should respond with the correct Content-Type header.
    if (
      res.headers['content-type'] === `application/x-${service}-advertisement`
    ) {
      const remoteHTTP = await parseRefsAdResponse(res.body, { service });
      remoteHTTP.auth = auth;
      return remoteHTTP
    } else {
      // If they don't send the correct content-type header, that's a good indicator it is either a "dumb" HTTP
      // server, or the user specified an incorrect remote URL and the response is actually an HTML page.
      // In this case, we save the response as plain text so we can generate a better error message if needed.
      const data = await collect(res.body);
      const response = data.toString('utf8');
      const preview =
        response.length < 256 ? response : response.slice(0, 256) + '...';
      // For backwards compatibility, try to parse it anyway.
      try {
        const remoteHTTP = await parseRefsAdResponse([data], { service });
        remoteHTTP.auth = auth;
        return remoteHTTP
      } catch (e) {
        throw new GitError(E.RemoteDoesNotSupportSmartHTTP, {
          preview,
          response
        })
      }
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

function translateSSHtoHTTP (url) {
  // handle "shorter scp-like syntax"
  url = url.replace(/^git@([^:]+):/, 'https://$1/');
  // handle proper SSH URLs
  url = url.replace(/^ssh:\/\//, 'https://');
  return url
}

function parseRemoteUrl ({ url }) {
  // the stupid "shorter scp-like syntax"
  if (url.startsWith('git@')) {
    return {
      transport: 'ssh',
      address: url
    }
  }
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
      transport: parts.transport,
      suggestion: parts.transport === 'ssh' ? translateSSHtoHTTP(url) : void 0
    })
  }
}

async function sleep (ms) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms))
}

const delayedReleases = new Map();
const fsmap = new WeakMap();
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
    // This is sad... but preserving reference equality is now necessary
    // to deal with cache invalidation in GitIndexManager.
    if (fsmap.has(fs)) {
      return fsmap.get(fs)
    }
    if (fsmap.has(fs._original_unwrapped_fs)) {
      return fsmap.get(fs._original_unwrapped_fs)
    }

    if (typeof fs._original_unwrapped_fs !== 'undefined') return fs

    if (
      Object.getOwnPropertyDescriptor(fs, 'promises') &&
      Object.getOwnPropertyDescriptor(fs, 'promises').enumerable
    ) {
      this._readFile = fs.promises.readFile.bind(fs.promises);
      this._writeFile = fs.promises.writeFile.bind(fs.promises);
      this._mkdir = fs.promises.mkdir.bind(fs.promises);
      this._rmdir = fs.promises.rmdir.bind(fs.promises);
      this._unlink = fs.promises.unlink.bind(fs.promises);
      this._stat = fs.promises.stat.bind(fs.promises);
      this._lstat = fs.promises.lstat.bind(fs.promises);
      this._readdir = fs.promises.readdir.bind(fs.promises);
      this._readlink = fs.promises.readlink.bind(fs.promises);
      this._symlink = fs.promises.symlink.bind(fs.promises);
    } else {
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
    this._original_unwrapped_fs = fs;
    fsmap.set(fs, this);
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
   *
   * @param {string} filepath
   * @param {object} [options]
   *
   * @returns {Buffer|null}
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
   *
   * @param {string} filepath
   * @param {Buffer|Uint8Array|string} contents
   * @param {object|string} [options]
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
        const parent = dirname(filepath);
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
   * Delete a directory without throwing an error if it is already deleted.
   */
  async rmdir (filepath) {
    try {
      await this._rmdir(filepath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  /**
   * Read a directory without throwing an error is the directory doesn't exist
   */
  async readdir (filepath) {
    try {
      const names = await this._readdir(filepath);
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
      const stats = await this._lstat(filename);
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

/**
 * Determine whether a file is binary (and therefore not worth trying to merge automatically)
 *
 * @param {Uint8Array} buffer
 *
 * If it looks incredibly simple / naive to you, compare it with the original:
 *
 * // xdiff-interface.c
 *
 * #define FIRST_FEW_BYTES 8000
 * int buffer_is_binary(const char *ptr, unsigned long size)
 * {
 *  if (FIRST_FEW_BYTES < size)
 *   size = FIRST_FEW_BYTES;
 *  return !!memchr(ptr, 0, size);
 * }
 *
 * Yup, that's how git does it. We could try to be smarter
 */
function isBinary (buffer) {
  // in canonical git, this check happens in builtins/merge-file.c
  // but I think it's DRYer to do it here.
  // The value picked is explained here: https://github.com/git/git/blob/ab15ad1a3b4b04a29415aef8c9afa2f64fc194a2/xdiff-interface.h#L12
  const MAX_XDIFF_SIZE = 1024 * 1024 * 1023;
  if (buffer.length > MAX_XDIFF_SIZE) return true
  // check for null characters in the first 8000 bytes
  return buffer.slice(0, 8000).some(value => value === 0)
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

class GitWalkerRepo2 {
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
      tree.mode = '40000';
      map.set('.', tree);
      return map
    })();
    const walker = this;
    this.ConstructEntry = class TreeEntry {
      constructor (fullpath) {
        this._fullpath = fullpath;
        this._type = false;
        this._mode = false;
        this._stat = false;
        this._content = false;
        this._oid = false;
      }

      async conflict () {
        return false
      }

      async type () {
        return walker.type(this)
      }

      async mode () {
        return walker.mode(this)
      }

      async stat () {
        return walker.stat(this)
      }

      async content () {
        return walker.content(this)
      }

      async oid () {
        return walker.oid(this)
      }
    };
  }

  async readdir (entry) {
    const filepath = entry._fullpath;
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
    return tree.entries().map(entry => join(filepath, entry.path))
  }

  async type (entry) {
    if (entry._type === false) {
      const map = await this.mapPromise;
      const { type } = map.get(entry._fullpath);
      entry._type = type;
    }
    return entry._type
  }

  async mode (entry) {
    if (entry._mode === false) {
      const map = await this.mapPromise;
      const { mode } = map.get(entry._fullpath);
      entry._mode = normalizeMode(parseInt(mode, 8));
    }
    return entry._mode
  }

  async stat (_entry) {}

  async content (entry) {
    if (entry._content === false) {
      const map = await this.mapPromise;
      const { fs, gitdir } = this;
      const obj = map.get(entry._fullpath);
      const oid = obj.oid;
      const { type, object } = await readObject({ fs, gitdir, oid });
      if (type !== 'blob') {
        entry._content = void 0;
      } else {
        entry._content = object;
      }
    }
    return entry._content
  }

  async oid (entry) {
    if (entry._oid === false) {
      const map = await this.mapPromise;
      const obj = map.get(entry._fullpath);
      entry._oid = obj.oid;
    }
    return entry._oid
  }
}

// This is part of an elaborate system to facilitate code-splitting / tree-shaking.
// commands/walk.js can depend on only this, and the actual Walker classes exported
// can be opaque - only having a single property (this symbol) that is not enumerable,
// and thus the constructor can be passed as an argument to walk while being "unusable"
// outside of it.
const GitWalkBeta1Symbol = Symbol('GitWalkBeta1Symbol');
const GitWalkBeta2Symbol = Symbol('GitWalkBeta2Symbol');

// @ts-check

/**
 *
 * @typedef Walker
 * @property {Symbol} Symbol('GitWalkerSymbol')
 */

/**
 * Get a git commit `Walker`
 *
 * See [walkBeta2](./walkBeta2.md)
 *
 * @param {object} args
 * @param {string} [args.ref='HEAD'] - The commit to walk
 * @param {import('../models/FileSystem').FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 *
 * @returns {Walker} Returns a git commit Walker
 *
 */
function TREE ({
  ref = 'HEAD',
  // @ts-ignore
  core = 'default',
  // @ts-ignore
  dir,
  gitdir,
  fs = cores.get(core).get('fs')
}) {
  const o = Object.create(null);
  Object.defineProperty(o, GitWalkBeta1Symbol, {
    value: function () {
      gitdir = gitdir || join(dir, '.git');
      return new GitWalkerRepo({ fs, gitdir, ref })
    }
  });
  Object.defineProperty(o, GitWalkBeta2Symbol, {
    value: function ({ fs, gitdir }) {
      return new GitWalkerRepo2({ fs, gitdir, ref })
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
//     of strings
// and return an iterator of length max(Q_n) for all n
//   of arrays of length N
//     of string|null who all have the same string value
function * unionOfIterators2 (sets) {
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
      min.consider(heads[i]);
    }
  }
  if (min.value === null) return
  // Iterate
  while (true) {
    const result = [];
    minimum = min.value;
    min.reset();
    for (let i = 0; i < numsets; i++) {
      if (heads[i] !== undefined && heads[i] === minimum) {
        result[i] = heads[i];
        heads[i] = sets[i].next().value;
      } else {
        // A little hacky, but eh
        result[i] = null;
      }
      if (heads[i] !== undefined) {
        min.consider(heads[i]);
      }
    }
    yield result;
    if (min.value === null) return
  }
}

// @ts-check

const defaultIterate = (walk, children) => Promise.all([...children].map(walk));

/**
 *
 * @typedef {Object} Walker
 * @property {Symbol} Symbol('GitWalkBeta2Symbol')
 */

/**
 *
 * @typedef {Object} Stat Normalized subset of filesystem `stat` data:
 * @property {number} ctimeSeconds
 * @property {number} ctimeNanoseconds
 * @property {number} mtimeSeconds
 * @property {number} mtimeNanoseconds
 * @property {number} dev
 * @property {number} ino
 * @property {number} mode
 * @property {number} uid
 * @property {number} gid
 * @property {number} size
 */

/**
 *
 * @typedef {Object} WalkerEntry The `WalkerEntry` is an interface that abstracts computing many common tree / blob stats.
 * @property {function(): Promise<'tree'|'blob'|'special'|'commit'>} type
 * @property {function(): Promise<number>} mode
 * @property {function(): Promise<string>} oid
 * @property {function(): Promise<Buffer>} content
 * @property {function(): Promise<Stat>} stat
 * @property {function(): Promise<boolean>} conflict
 */

/**
 * A powerful recursive tree-walking utility.
 *
 * The `walk` API (tentatively named `walkBeta2`) simplifies gathering detailed information about a tree or comparing all the filepaths in two or more trees.
 * Trees can be git commits, the working directory, or the or git index (staging area).
 * As long as a file or directory is present in at least one of the trees, it will be traversed.
 * Entries are traversed in alphabetical order.
 *
 * The arguments to `walk` are the `trees` you want to traverse, and 3 optional transform functions:
 *  `map`, `reduce`, and `iterate`.
 *
 * ## `TREE`, `WORKDIR`, and `STAGE`
 *
 * Tree walkers are represented by three separate functions that can be imported:
 *
 * ```js
 * import { TREE, WORKDIR, STAGE } from 'isomorphic-git'
 * ```
 *
 * These functions return opaque handles called `Walker`s.
 * The only thing that `Walker` objects are good for is passing into `walkBeta2`.
 * Here are the three `Walker`s passed into `walkBeta2` by the `statusMatrix` command for example:
 *
 * ```js
 * let ref = 'HEAD'
 *
 * let trees = [TREE({ ref }), WORKDIR(), STAGE()]
 * ```
 *
 * For the arguments, see the doc pages for [TREE](./TREE.md), [WORKDIR](./WORKDIR.md), and [STAGE](./STAGE.md).
 *
 * `map`, `reduce`, and `iterate` allow you control the recursive walk by pruning and transforming `WalkerEntry`s into the desired result.
 *
 * ## WalkerEntry
 *
 * {@link WalkerEntry typedef}
 *
 * `map` receives an array of `WalkerEntry[]` as its main argument, one `WalkerEntry` for each `Walker` in the `trees` argument.
 * The methods are memoized per `WalkerEntry` so calling them multiple times in a `map` function does not adversely impact performance.
 * By only computing these values if needed, you build can build lean, mean, efficient walking machines.
 *
 * ### WalkerEntry#type()
 *
 * Returns the kind as a string. This is normally either `tree` or `blob`.
 *
 * `TREE`, `STAGE`, and `WORKDIR` walkers all return a string.
 *
 * Possible values:
 *
 * - `'tree'` directory
 * - `'blob'` file
 * - `'special'` used by `WORKDIR` to represent irregular files like sockets and FIFOs
 * - `'commit'` used by `TREE` to represent submodules
 *
 * ```js
 * await entry.type()
 * ```
 *
 * ### WalkerEntry#mode()
 *
 * Returns the file mode as a number. Use this to distinguish between regular files, symlinks, and executable files.
 *
 * `TREE`, `STAGE`, and `WORKDIR` walkers all return a number for all `type`s of entries.
 *
 * It has been normalized to one of the 4 values that are allowed in git commits:
 *
 * - `0o40000` directory
 * - `0o100644` file
 * - `0o100755` file (executable)
 * - `0o120000` symlink
 *
 * Tip: to make modes more readable, you can print them to octal using `.toString(8)`.
 *
 * ```js
 * await entry.mode()
 * ```
 *
 * ### WalkerEntry#oid()
 *
 * Returns the SHA-1 object id for blobs and trees.
 *
 * `TREE` walkers return a string for `blob` and `tree` entries.
 *
 * `STAGE` and `WORKDIR` walkers return a string for `blob` entries and `undefined` for `tree` entries.
 *
 * ```js
 * await entry.oid()
 * ```
 *
 * ### WalkerEntry#content()
 *
 * Returns the file contents as a Buffer.
 *
 * `TREE` and `WORKDIR` walkers return a Buffer for `blob` entries and `undefined` for `tree` entries.
 *
 * `STAGE` walkers always return `undefined` since the file contents are never stored in the stage.
 *
 * ```js
 * await entry.content()
 * ```
 *
 * ### WalkerEntry#stat()
 *
 * Returns a normalized subset of filesystem Stat data.
 *
 * `WORKDIR` walkers return a `Stat` for `blob` and `tree` entries.
 *
 * `STAGE` walkers return a `Stat` for `blob` entries and `undefined` for `tree` entries.
 *
 * `TREE` walkers return `undefined` for all entry types.
 *
 * ```js
 * await entry.stat()
 * ```
 *
 * {@link Stat typedef}
 *
 * ## map(string, Array<WalkerEntry|null>) => Promise<any>
 *
 * This is the function that is called once per entry BEFORE visiting the children of that node.
 *
 * If you return `null` for a `tree` entry, then none of the children of that `tree` entry will be walked.
 *
 * This is a good place for query logic, such as examining the contents of a file.
 * Ultimately, compare all the entries and return any values you are interested in.
 * If you do not return a value (or return undefined) that entry will be filtered from the results.
 *
 * Example 1: Find all the files containing the word 'foo'.
 * ```js
 * async function map(filepath, [head, workdir]) {
 *   let content = (await workdir.content()).toString('utf8')
 *   if (content.contains('foo')) {
 *     return {
 *       filepath,
 *       content
 *     }
 *   }
 * }
 * ```
 *
 * Example 2: Return the difference between the working directory and the HEAD commit
 * ```js
 * const diff = require('diff-lines')
 * async function map(filepath, [head, workdir]) {
 *   return {
 *     filepath,
 *     oid: await head.oid(),
 *     diff: diff((await head.content()).toString('utf8'), (await workdir.content()).toString('utf8'))
 *   }
 * }
 * ```
 *
 * Example 3:
 * ```js
 * let path = require('path')
 * // Only examine files in the directory `cwd`
 * let cwd = 'src/app'
 * async function map (filepath, [head, workdir, stage]) {
 *   if (
 *     // don't skip the root directory
 *     head.fullpath !== '.' &&
 *     // return true for 'src' and 'src/app'
 *     !cwd.startsWith(filepath) &&
 *     // return true for 'src/app/*'
 *     path.dirname(filepath) !== cwd
 *   ) {
 *     return null
 *   } else {
 *     return filepath
 *   }
 * }
 * ```
 *
 * ## reduce(parent, children)
 *
 * This is the function that is called once per entry AFTER visiting the children of that node.
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
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {import('../models/FileSystem').FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin_fs.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {Walker[]} args.trees - The trees you want to traverse
 * @param {function(string, ?WalkerEntry[]): Promise<any>} [args.map] - Transform `WalkerEntry`s into a result form
 * @param {function(any, any[]): Promise<any>} [args.reduce] - Control how mapped entries are combined with their parent result
 * @param {function(function(WalkerEntry[]): Promise<any[]>, IterableIterator<WalkerEntry[]>): Promise<any[]>} [args.iterate] - Fine-tune how entries within a tree are iterated over
 *
 * @returns {Promise<any>} The finished tree-walking result
 *
 *
 */
async function walkBeta2 ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  trees,
  // @ts-ignore
  map = async (_, entry) => entry,
  // The default reducer is a flatmap that filters out undefineds.
  reduce = async (parent, children) => {
    const flatten = flat(children);
    if (parent !== undefined) flatten.unshift(parent);
    return flatten
  },
  // The default iterate function walks all children concurrently
  iterate: _iterate = cores.get(core).get('iterate')
}) {
  const iterate = _iterate || defaultIterate;
  try {
    const walkers = trees.map(proxy =>
      proxy[GitWalkBeta2Symbol]({ fs, dir, gitdir })
    );

    const root = new Array(walkers.length).fill('.');
    const range = arrayRange(0, walkers.length);
    const unionWalkerFromReaddir = async entries => {
      range.map(i => {
        entries[i] = entries[i] && new walkers[i].ConstructEntry(entries[i]);
      });
      const subdirs = await Promise.all(
        range.map(i => (entries[i] ? walkers[i].readdir(entries[i]) : []))
      );
      // Now process child directories
      const iterators = subdirs
        .map(array => (array === null ? [] : array))
        .map(array => array[Symbol.iterator]());
      return {
        entries,
        children: unionOfIterators2(iterators)
      }
    };

    const walk = async root => {
      const { entries, children } = await unionWalkerFromReaddir(root);
      const fullpath = entries.find(entry => entry && entry._fullpath)._fullpath;
      const parent = await map(fullpath, entries);
      if (parent !== null) {
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
 *
 * @typedef {import('../commands/readObject').TreeEntry} TreeEntry
 */

/**
 * Create a merged tree
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {import('../models/FileSystem').FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.ourOid - The SHA-1 object id of our tree
 * @param {string} args.baseOid - The SHA-1 object id of the base tree
 * @param {string} args.theirOid - The SHA-1 object id of their tree
 * @param {string} [args.ourName='ours'] - The name to use in conflicted files for our hunks
 * @param {string} [args.baseName='base'] - The name to use in conflicted files (in diff3 format) for the base hunks
 * @param {string} [args.theirName='theirs'] - The name to use in conflicted files for their hunks
 * @param {boolean} [args.dryRun=false]
 *
 * @returns {Promise<string>} - The SHA-1 object id of the merged tree
 *
 */
async function mergeTree ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  ourOid,
  baseOid,
  theirOid,
  ourName = 'ours',
  baseName = 'base',
  theirName = 'theirs',
  dryRun = false
}) {
  const ourTree = TREE({ ref: ourOid });
  const baseTree = TREE({ ref: baseOid });
  const theirTree = TREE({ ref: theirOid });

  const results = await walkBeta2({
    core,
    fs,
    dir,
    gitdir,
    trees: [ourTree, baseTree, theirTree],
    map: async function (filepath, [ours, base, theirs]) {
      const path = basename(filepath);
      // What we did, what they did
      const ourChange = await modified(ours, base);
      const theirChange = await modified(theirs, base);
      switch (`${ourChange}-${theirChange}`) {
        case 'false-false': {
          return {
            mode: await base.mode(),
            path,
            oid: await base.oid(),
            type: await base.type()
          }
        }
        case 'false-true': {
          return theirs
            ? {
              mode: await theirs.mode(),
              path,
              oid: await theirs.oid(),
              type: await theirs.type()
            }
            : void 0
        }
        case 'true-false': {
          return ours
            ? {
              mode: await ours.mode(),
              path,
              oid: await ours.oid(),
              type: await ours.type()
            }
            : void 0
        }
        case 'true-true': {
          // Modifications
          if (
            ours &&
            base &&
            theirs &&
            (await ours.type()) === 'blob' &&
            (await base.type()) === 'blob' &&
            (await theirs.type()) === 'blob'
          ) {
            return mergeBlobs({
              fs,
              gitdir,
              path,
              ours,
              base,
              theirs,
              ourName,
              baseName,
              theirName
            })
          }
          // all other types of conflicts fail
          throw new GitError(E.MergeNotSupportedFail)
        }
      }
    },
    /**
     * @param {TreeEntry} [parent]
     * @param {Array<TreeEntry>} children
     */
    reduce: async (parent, children) => {
      const entries = children.filter(Boolean); // remove undefineds

      // automatically delete directories if they have been emptied
      if (parent && parent.type === 'tree' && entries.length === 0) return

      if (entries.length > 0) {
        const tree = new GitTree(entries);
        const object = tree.toObject();
        const oid = await writeObject({
          fs,
          gitdir,
          type: 'tree',
          object,
          dryRun
        });
        parent.oid = oid;
      }
      return parent
    }
  });
  return results.oid
}

/**
 *
 * @param {import('../commands/walkBeta2.js').WalkerEntry} entry
 * @param {import('../commands/walkBeta2.js').WalkerEntry} base
 *
 */
async function modified (entry, base) {
  if (!entry && !base) return false
  if (entry && !base) return true
  if (!entry && base) return true
  if ((await entry.type()) === 'tree' && (await base.type()) === 'tree') {
    return false
  }
  if (
    (await entry.type()) === (await base.type()) &&
    (await entry.mode()) === (await base.mode()) &&
    (await entry.oid()) === (await base.oid())
  ) {
    return false
  }
  return true
}

/**
 *
 * @param {Object} args
 * @param {import('../models/FileSystem').FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.gitdir
 * @param {string} args.path
 * @param {import('../commands/walkBeta2.js').WalkerEntry} args.ours
 * @param {import('../commands/walkBeta2.js').WalkerEntry} args.base
 * @param {import('../commands/walkBeta2.js').WalkerEntry} args.theirs
 * @param {string} [args.ourName]
 * @param {string} [args.baseName]
 * @param {string} [args.theirName]
 * @param {string} [args.format]
 * @param {number} [args.markerSize]
 * @param {boolean} [args.dryRun = false]
 *
 */
async function mergeBlobs ({
  fs,
  gitdir,
  path,
  ours,
  base,
  theirs,
  ourName,
  theirName,
  baseName,
  format,
  markerSize,
  dryRun
}) {
  const type = 'blob';
  // Compute the new mode.
  // Since there are ONLY two valid blob modes ('100755' and '100644') it boils down to this
  const mode =
    (await base.mode()) === (await ours.mode())
      ? await theirs.mode()
      : await ours.mode();
  // The trivial case: nothing to merge except maybe mode
  if ((await ours.oid()) === (await theirs.oid())) {
    return { mode, path, oid: await ours.oid(), type }
  }
  // if only one side made oid changes, return that side's oid
  if ((await ours.oid()) === (await base.oid())) {
    return { mode, path, oid: await theirs.oid(), type }
  }
  if ((await theirs.oid()) === (await base.oid())) {
    return { mode, path, oid: await ours.oid(), type }
  }
  // if both sides made changes do a merge
  const { mergedText, cleanMerge } = mergeFile({
    ourContent: (await ours.content()).toString('utf8'),
    baseContent: (await base.content()).toString('utf8'),
    theirContent: (await theirs.content()).toString('utf8'),
    ourName,
    theirName,
    baseName,
    format,
    markerSize
  });
  if (!cleanMerge) {
    // all other types of conflicts fail
    throw new GitError(E.MergeNotSupportedFail)
  }
  const oid = await writeObject({
    fs,
    gitdir,
    type: 'blob',
    object: Buffer.from(mergedText, 'utf8'),
    dryRun
  });
  return { mode, path, oid, type }
}

// This module is necessary because Webpack doesn't ship with

const path = _path.posix === undefined ? _path : _path.posix;

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

async function parseUploadPackRequest (stream) {
  const read = GitPktLine.streamReader(stream);
  let done = false;
  let capabilities = null;
  const wants = [];
  const haves = [];
  const shallows = [];
  let depth;
  let since;
  const exclude = [];
  let relative = false;
  while (!done) {
    const line = await read();
    if (line === true) break
    if (line === null) continue
    const [key, value, ...rest] = line
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

export { E, FileSystem, GitAnnotatedTag, GitCommit, GitConfig, GitConfigManager, GitError, GitIgnoreManager, GitIndex, GitIndexManager, GitObject, GitPackIndex, GitPktLine, GitRefManager, GitRefSpec, GitRefSpecSet, GitRemoteHTTP, GitRemoteManager, GitShallowManager, GitSideBand, GitTree, GitWalkBeta1Symbol, GitWalkBeta2Symbol, SignedGitCommit, auth, calculateBasicAuthHeader, calculateBasicAuthUsernamePasswordPair, collect, comparePath, cores, flatFileListToDirectoryStructure, http, isBinary, join, listCommitsAndTags, listObjects, log, mergeFile, mergeTree, oauth2, pack, padHex, parseReceivePackResponse, parseRefsAdResponse, parseUploadPackRequest, parseUploadPackResponse, path, pkg, plugins, readObject, resolveTree, shasum, sleep, uploadPack, writeObject, writeReceivePackRequest, writeRefsAdResponse, writeUploadPackRequest };
