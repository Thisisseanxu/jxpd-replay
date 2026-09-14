import { constants } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  PreconditionFailedError,
  type BlobInput,
  type BlobResponseType,
  type ConsistencyMode,
  type ListOptions,
  type ListResult,
  type SetOptions,
  type Store,
} from '@edgeone/pages-blob';

type GetOptions = {
  type?: BlobResponseType;
  consistency?: ConsistencyMode;
};

function validateStoreName(name: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new Error(`Invalid local Blob store name: ${name}`);
  }
}

function validateKey(key: string) {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    Buffer.byteLength(key, 'utf8') > 600
  ) {
    throw new Error(`Invalid local Blob key: ${key}`);
  }
  const segments = key.split('/');
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid local Blob key: ${key}`);
  }
  return segments;
}

async function inputBytes(value: BlobInput) {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Blob) return Buffer.from(await value.arrayBuffer());
  return Buffer.from(await new Response(value).arrayBuffer());
}

/**
 * Filesystem-backed subset of EdgeOne Makers Blob used by the replay service.
 * Reads are always strongly consistent locally; consistency options are accepted
 * for API compatibility.
 */
export class LocalFileStore {
  readonly #storeDirectory: string;

  constructor(rootDirectory: string, storeName: string) {
    validateStoreName(storeName);
    this.#storeDirectory = path.resolve(rootDirectory, storeName);
  }

  asEdgeOneStore() {
    return this as unknown as Store;
  }

  #pathForKey(key: string) {
    const target = path.resolve(this.#storeDirectory, ...validateKey(key));
    const relative = path.relative(this.#storeDirectory, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Invalid local Blob key: ${key}`);
    }
    return target;
  }

  async set(key: string, value: BlobInput, options?: SetOptions) {
    const target = this.#pathForKey(key);
    const bytes = await inputBytes(value);
    await mkdir(path.dirname(target), { recursive: true });
    if (!options?.onlyIfNew) {
      await writeFile(target, bytes);
      return;
    }

    let handle;
    try {
      handle = await open(target, 'wx');
      await handle.writeFile(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new PreconditionFailedError();
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async setJSON(key: string, value: unknown, options?: SetOptions) {
    await this.set(key, JSON.stringify(value), options);
  }

  async get(key: string, options: GetOptions = {}) {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.#pathForKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    switch (options.type ?? 'text') {
      case 'arrayBuffer':
        return Uint8Array.from(bytes).buffer;
      case 'blob':
        return new Blob([Uint8Array.from(bytes).buffer]);
      case 'json':
        return JSON.parse(bytes.toString('utf8')) as unknown;
      case 'stream':
        return new Blob([Uint8Array.from(bytes).buffer]).stream();
      case 'text':
        return bytes.toString('utf8');
    }
  }

  async getMetadata(key: string) {
    try {
      const metadata = await stat(this.#pathForKey(key));
      return {
        etag: `local-${metadata.size}-${metadata.mtimeMs}`,
        headers: {
          'content-length': String(metadata.size),
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getWithHeaders(key: string) {
    const body = await this.get(key, { type: 'text' });
    if (body === null) return null;
    const metadata = await this.getMetadata(key);
    return { body, headers: metadata?.headers ?? {} };
  }

  async delete(key: string) {
    const target = this.#pathForKey(key);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    let directory = path.dirname(target);
    while (directory !== this.#storeDirectory) {
      try {
        await rmdir(directory);
      } catch {
        break;
      }
      directory = path.dirname(directory);
    }
  }

  async list(options: ListOptions = {}): Promise<ListResult> {
    const all = await this.#allBlobs();
    const prefix = options.prefix ?? '';
    const afterCursor = options.cursor ?? '';
    const matching = all.filter(
      (blob) => blob.key.startsWith(prefix) && blob.key > afterCursor,
    );

    if (options.directories) {
      const directories = new Set<string>();
      const blobs = [];
      for (const blob of matching) {
        const remainder = blob.key.slice(prefix.length);
        const separator = remainder.indexOf('/');
        if (separator === -1) blobs.push(blob);
        else directories.add(`${prefix}${remainder.slice(0, separator + 1)}`);
      }
      return { blobs, directories: [...directories].sort() };
    }

    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    const blobs = matching.slice(0, limit);
    const hasMore = blobs.length < matching.length;
    return {
      blobs,
      directories: [],
      ...(options.paginate === false && hasMore
        ? { cursor: blobs.at(-1)?.key }
        : {}),
    };
  }

  async #allBlobs() {
    try {
      await access(this.#storeDirectory, constants.F_OK);
    } catch {
      return [];
    }

    const blobs: Array<{ key: string; etag: string }> = [];
    const visit = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(target);
        } else if (entry.isFile()) {
          const metadata = await stat(target);
          blobs.push({
            key: path
              .relative(this.#storeDirectory, target)
              .split(path.sep)
              .join('/'),
            etag: `local-${metadata.size}-${metadata.mtimeMs}`,
          });
        }
      }
    };
    await visit(this.#storeDirectory);
    return blobs.sort((left, right) => left.key.localeCompare(right.key));
  }
}
