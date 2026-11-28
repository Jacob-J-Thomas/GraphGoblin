import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { openOutputMetadataCheck } from './plugin-output-metadata.mjs';

const manifestName = '.graphgoblin-plugin-output.json';
const maxListed = 10;
const moveAside =
  'Choose an unused destination, or inspect this directory and move it aside before rebuilding';

function unsafe(destination, reason) {
  return new Error(`Unsafe plugin output destination "${destination}": ${reason}`);
}

/** A bounded, quoted list for diagnostics; quoting escapes control characters in names. */
function listed(names, label = (name) => JSON.stringify(name)) {
  const shown = names.slice(0, maxListed).map(label);
  if (names.length > maxListed) shown.push(`and ${names.length - maxListed} more`);
  return shown.join(', ');
}

function validName(name) {
  return name.split('/').every((part) => /^(?!\.{1,2}$)[.a-z0-9_-]+$/i.test(part));
}

function parentOf(name) {
  return name.slice(0, Math.max(0, name.lastIndexOf('/')));
}

/** Every folder that contains a listed file, parents first. */
function directoriesOf(files) {
  const directories = new Set();
  for (const file of files)
    for (let directory = parentOf(file); directory; directory = parentOf(directory))
      directories.add(directory);
  return [...directories].sort((left, right) => left.length - right.length);
}

async function statIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function contains(parent, path) {
  const fromParent = relative(parent, path);
  return !isAbsolute(fromParent) && !fromParent.split(sep).includes('..');
}

/** Check every existing directory from the filesystem root, including the output itself. */
async function checkDirectoryPath(path, destination) {
  const root = parse(path).root;
  let current = root;
  for (const name of relative(root, path).split(sep).filter(Boolean)) {
    if (
      process.platform === 'win32' &&
      /[:<>|?*"]|[ .]$|^(?:con|prn|aux|nul|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3])(?:\.|$)/i.test(
        name,
      )
    )
      throw unsafe(destination, `"${name}" is an ambiguous Windows path component`);
    current = join(current, name);
    const stat = await statIfPresent(current);
    if (!stat) continue;
    if (!stat.isDirectory())
      throw unsafe(destination, `"${current}" is a link or is not a directory`);
    if (relative(current, await realpath(current)) !== '')
      throw unsafe(destination, `"${current}" redirects to a different path`);
  }
}

async function physicalPath(path) {
  const absolute = resolve(path);
  if (await statIfPresent(absolute)) return realpath(absolute);
  const parent = dirname(absolute);
  if (parent === absolute) return realpath(absolute);
  return join(await physicalPath(parent), relative(parent, absolute));
}

function fileTree(files) {
  for (const file of files)
    if (file === manifestName || !validName(file))
      throw new Error(`Invalid generated plugin file name "${file}"`);
  return directoriesOf(files);
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Classify an existing output against the builder's current finite inventory. The marker's names
 * are only compared and quoted, never read or removed; its hashes verify the current names only.
 */
async function inspectOutput(path, destination, kind, files, directories, checkMetadata) {
  await checkDirectoryPath(path, destination);
  if (!(await statIfPresent(path))) return 'missing';
  const first = await readdir(path);
  if (first.length === 0) {
    await checkMetadata(path, [], []);
    return 'empty';
  }

  const invalidMarker = () =>
    unsafe(
      destination,
      `"${manifestName}" is missing or is not a valid ownership marker from this builder, so the other entries are not known to be generated. ${moveAside}`,
    );
  const metadataPath = join(path, manifestName);
  if (!(await statIfPresent(metadataPath))?.isFile()) throw invalidMarker();
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    throw invalidMarker();
  }
  if (
    metadata?.format !== 1 ||
    metadata.kind !== kind ||
    !(metadata.files instanceof Object) ||
    Array.isArray(metadata.files)
  )
    throw invalidMarker();

  const recorded = new Set(Object.keys(metadata.files));
  const current = new Set(files);
  const changes = [];
  const markerOnly = [...recorded].filter((name) => !current.has(name));
  if (markerOnly.length) changes.push(`listed only by the marker: ${listed(markerOnly)}`);
  const unlisted = files.filter((name) => !recorded.has(name));
  if (unlisted.length) changes.push(`generated now but not listed: ${listed(unlisted)}`);
  if (changes.length)
    throw unsafe(
      destination,
      `its ownership marker from this builder lists a different file inventory from the one this version generates (${changes.join('; ')}). The builder verifies and replaces only its current inventory and never removes entries named only by a marker. Inspect this directory and move it aside, or choose an unused destination`,
    );

  const fileNames = new Set([...files, manifestName]);
  const directoryNames = new Set(directories);
  const present = new Set(['']);
  for (const directory of ['', ...directories]) {
    if (!present.has(directory)) continue; // Reported below with its missing parent or itself.
    await checkDirectoryPath(join(path, directory), destination);
    const entries = await readdir(join(path, directory), { withFileTypes: true });
    for (const entry of entries) {
      const name = directory ? `${directory}/${entry.name}` : entry.name;
      if (
        (entry.isDirectory() && directoryNames.has(name)) ||
        (entry.isFile() && fileNames.has(name))
      )
        present.add(name);
      else throw unsafe(destination, `"${name}" is not owned by this builder. ${moveAside}`);
    }
  }
  const missing = [...directories, ...files].filter(
    (name) => !present.has(name) && present.has(parentOf(name)),
  );
  if (missing.length)
    throw unsafe(
      destination,
      `expected generated entries are missing: ${listed(missing)}. ${moveAside}`,
    );
  await checkMetadata(path, directories, [...files, manifestName]);
  for (const name of files) {
    const target = join(path, name);
    if (
      !(await statIfPresent(target))?.isFile() ||
      metadata.files[name] !== digest(await readFile(target))
    )
      throw unsafe(
        destination,
        `"${name}" does not match the content this builder recorded for it. ${moveAside}`,
      );
  }
  return 'owned';
}

/**
 * Refuse every entry below `root` other than the listed regular files and the folders containing
 * them, so a builder with a finite inventory cannot silently omit a new source asset. Links and
 * other special entries are refused, never followed. Call it before changing any output.
 */
export async function checkSourceInventory(root, files) {
  for (const file of files)
    if (!validName(file)) throw new Error(`Invalid plugin source name "${file}"`);
  const allowed = new Set(files);
  const directories = new Set(directoriesOf(files));
  const unsupported = [];
  const visit = async (directory) => {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const name = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && directories.has(name)) await visit(name);
      else if (entry.isSymbolicLink())
        unsupported.push(`${JSON.stringify(name)} (link, not followed)`);
      else if (!(entry.isFile() && allowed.has(name)))
        unsupported.push(JSON.stringify(entry.isDirectory() ? `${name}/` : name));
    }
  };
  await visit('');
  if (unsupported.length)
    throw new Error(
      `Unsupported plugin source entries in "${root}": ${listed(unsupported.sort(), String)}. This builder packages only ${listed([...allowed])} from this folder. Move the unsupported entries out of it, or add explicit builder support for them, then assemble again`,
    );
}

/** Remove only entries created by this invocation or verified in a privately staged old tree. */
async function removeFiles(root, destination, files, directories) {
  for (const file of files) {
    const target = join(root, file);
    await checkDirectoryPath(dirname(target), destination);
    await unlink(target);
  }
  for (const directory of [...directories].reverse()) {
    const target = join(root, directory);
    await checkDirectoryPath(target, destination);
    await rmdir(target);
  }
  await checkDirectoryPath(root, destination);
  await rmdir(root);
}

/**
 * Publish a complete generated plugin tree. An existing tree must be empty or match both the
 * builder's finite file list and its own previous content hashes; an arbitrary marker is insufficient.
 * Stage next to the output and serialize cooperating builders before changing any incumbent.
 * A failure that leaves staging behind, or any cleanup failure, rejects with an AggregateError whose
 * `cause` is the primary failure (if any), whose `errors` lists it before each cleanup failure, and
 * whose message states what was published and which staging paths remain.
 */
export async function writePluginOutput(options) {
  const destination = resolve(options.outDir);
  const packageDir = await physicalPath(options.packageDir);
  const cwd = await realpath(process.cwd());
  const protectedPaths = await Promise.all(options.protectedPaths.map(physicalPath));
  const allowedOutput = resolve(options.defaultOutDir);
  if (
    destination === parse(destination).root ||
    /^\\\\[.?]\\/.test(destination) ||
    [packageDir, cwd, ...protectedPaths].some((path) => contains(destination, path)) ||
    (contains(packageDir, destination) && relative(allowedOutput, destination) !== '') ||
    protectedPaths.some((path) => contains(path, destination))
  )
    throw unsafe(destination, 'it overlaps the working directory, builder package, or input path');

  const files = Object.keys(options.files);
  const directories = fileTree(files);
  const parent = dirname(destination);
  await checkDirectoryPath(destination, destination);
  await mkdir(parent, { recursive: true });
  await checkDirectoryPath(parent, destination);
  const lock = join(parent, `.${parse(destination).base}.graphgoblin-build`);
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw unsafe(
      destination,
      `another build is using "${lock}". Choose another destination or check this staging directory`,
    );
  }

  const next = join(lock, 'next');
  const previous = join(lock, 'previous');
  const createdFiles = [];
  const createdDirectories = [];
  let incumbent;
  let staged = false;
  let moved = false;
  let published = false;
  let primary;
  // Attempt every cleanup step even if another fails; none removes more than this build verified.
  const failures = [];
  const attempt = async (step) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  let metadataCheck;
  const checkMetadata = async (path, directoryNames, fileNames) => {
    try {
      metadataCheck ??= await openOutputMetadataCheck();
      await metadataCheck.check([
        ...['', ...directoryNames].map((name) => ({ path: join(path, name), directory: true })),
        ...fileNames.map((name) => ({ path: join(path, name), directory: false })),
      ]);
    } catch (error) {
      throw unsafe(destination, `${error.message}. Choose an unused destination`);
    }
  };
  try {
    const inspect = (path, inspectMetadata) =>
      inspectOutput(path, destination, options.kind, files, directories, inspectMetadata);
    incumbent = await inspect(destination, () => {});
    await mkdir(next);
    staged = true;
    for (const directory of directories) {
      await mkdir(join(next, directory));
      createdDirectories.push(directory);
    }
    const ownership = JSON.stringify({
      format: 1,
      kind: options.kind,
      files: Object.fromEntries(files.map((name) => [name, digest(options.files[name])])),
    });
    for (const [name, content] of [...Object.entries(options.files), [manifestName, ownership]]) {
      const handle = await open(join(next, name), 'wx');
      createdFiles.push(name);
      try {
        await handle.writeFile(content);
      } catch (error) {
        // Closing after a failed write is cleanup: its own failure must not mask the write's.
        await attempt(() => handle.close());
        throw error;
      }
      await handle.close();
    }
    if ((await inspect(destination, checkMetadata)) !== incumbent)
      throw unsafe(destination, 'it changed during assembly');
    if (incumbent !== 'missing') {
      await rename(destination, previous);
      moved = true;
      // Once quarantined, check the actual tree that would be removed, including new entries.
      if ((await inspect(previous, checkMetadata)) !== incumbent)
        throw unsafe(destination, 'it changed while staging');
    }
    if (metadataCheck) {
      try {
        await metadataCheck.finish();
      } catch (error) {
        throw unsafe(destination, `${error.message}. Choose an unused destination`);
      }
    }
    await rename(next, destination);
    staged = false;
    published = true;
  } catch (error) {
    primary = error;
  }

  if (metadataCheck) await attempt(() => metadataCheck.close());
  // Restore only into a vacant destination; a tree another writer created there is left alone.
  if (primary && moved)
    await attempt(async () => {
      if (!(await statIfPresent(destination))) await rename(previous, destination);
    });
  if (published && moved)
    await attempt(() =>
      removeFiles(
        previous,
        destination,
        incumbent === 'owned' ? [...files, manifestName] : [],
        incumbent === 'owned' ? directories : [],
      ),
    );
  if (staged) await attempt(() => removeFiles(next, destination, createdFiles, createdDirectories));
  const retained = [];
  let lockRemoved = false;
  await attempt(async () => {
    for (const path of [previous, next]) if (await statIfPresent(path)) retained.push(path);
    if (retained.length) return;
    await rmdir(lock);
    lockRemoved = true;
  });

  if (!primary && !failures.length) return destination;
  if (primary && !failures.length && lockRemoved) throw primary;
  // Report what remains on disk, so neither a rollback nor a removal is claimed without evidence.
  const cleanup = failures.map((error) => error.message).join('; ');
  const report = primary
    ? [
        primary.message.replace(/\.?$/, '.'),
        ...(cleanup ? [`Cleanup also failed: ${cleanup}.`] : []),
      ]
    : [
        `The complete new plugin output was published at "${destination}", but cleanup failed: ${cleanup}.`,
      ];
  if (retained.includes(previous))
    report.push(
      published
        ? `Entries of the replaced output remain in "${previous}".`
        : `The previous output was not restored and remains at "${previous}"; inspect it and "${destination}" before moving either by hand.`,
    );
  if (retained.includes(next)) report.push(`The unpublished new output remains at "${next}".`);
  if (!lockRemoved)
    report.push(
      `Staging directory "${lock}" remains; once no build is running, keep anything you need from it and move it aside before rebuilding this destination.`,
    );
  throw new AggregateError(
    primary ? [primary, ...failures] : failures,
    report.join(' '),
    primary ? { cause: primary } : undefined,
  );
}
