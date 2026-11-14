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

const manifestName = '.graphgoblin-plugin-output.json';

function unsafe(destination, reason) {
  return new Error(`Unsafe plugin output destination "${destination}": ${reason}`);
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
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    if (file === manifestName || parts.some((part) => !/^(?!\.{1,2}$)[.a-z0-9_-]+$/i.test(part)))
      throw new Error(`Invalid generated plugin file name "${file}"`);
    while (parts.length > 1) {
      parts.pop();
      directories.add(parts.join('/'));
    }
  }
  return [...directories].sort((left, right) => left.length - right.length);
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function inspectOutput(path, destination, kind, files, directories) {
  await checkDirectoryPath(path, destination);
  if (!(await statIfPresent(path))) return 'missing';
  const first = await readdir(path);
  if (first.length === 0) return 'empty';

  const foreign = (name) =>
    unsafe(
      destination,
      `"${name}" is not owned by this builder. Choose an empty or unused destination`,
    );
  const metadataPath = join(path, manifestName);
  if (!(await statIfPresent(metadataPath))?.isFile()) throw foreign(manifestName);
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    throw foreign(manifestName);
  }
  if (
    metadata?.format !== 1 ||
    metadata.kind !== kind ||
    !metadata.files ||
    Object.keys(metadata.files).length !== files.length
  )
    throw foreign(manifestName);

  const fileNames = new Set([...files, manifestName]);
  const directoryNames = new Set(directories);
  for (const directory of ['', ...directories]) {
    await checkDirectoryPath(join(path, directory), destination);
    const entries = await readdir(join(path, directory), { withFileTypes: true });
    for (const entry of entries) {
      const name = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && directoryNames.has(name)) continue;
      if (entry.isFile() && fileNames.has(name)) continue;
      throw foreign(name);
    }
  }
  for (const name of files) {
    const target = join(path, name);
    if (
      !(await statIfPresent(target))?.isFile() ||
      metadata.files[name] !== digest(await readFile(target))
    )
      throw foreign(name);
  }
  return 'owned';
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
  let staged = false;
  let moved = false;
  try {
    const inspect = (path) => inspectOutput(path, destination, options.kind, files, directories);
    const incumbent = await inspect(destination);
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
      } finally {
        await handle.close();
      }
    }
    if ((await inspect(destination)) !== incumbent)
      throw unsafe(destination, 'it changed during assembly');
    if (incumbent !== 'missing') {
      await rename(destination, previous);
      moved = true;
      // Once quarantined, check the actual tree that would be removed, including new entries.
      if ((await inspect(previous)) !== incumbent)
        throw unsafe(destination, 'it changed while staging');
    }
    await rename(next, destination);
    staged = false;
    if (moved) {
      await removeFiles(
        previous,
        destination,
        incumbent === 'owned' ? [...files, manifestName] : [],
        incumbent === 'owned' ? directories : [],
      );
    }
  } catch (error) {
    if (moved && staged && !(await statIfPresent(destination))) await rename(previous, destination);
    throw error;
  } finally {
    if (staged) await removeFiles(next, destination, createdFiles, createdDirectories);
    if (!(await statIfPresent(previous))) await rmdir(lock);
  }
  return destination;
}
