import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface RepairImageStorage {
  delete(key: string): Promise<void>;
  deleteSandbox(sandboxId: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array): Promise<void>;
  sweepExpiredQuarantine(maxAgeMilliseconds?: number): Promise<void>;
}

export class MemoryRepairImageStorage implements RepairImageStorage {
  readonly #objects = new Map<
    string,
    { readonly storedAt: number; readonly value: Uint8Array }
  >();

  async delete(key: string) {
    this.#objects.delete(key);
  }

  async deleteSandbox(sandboxId: string) {
    for (const key of this.#objects.keys()) {
      if (
        key.startsWith(`quarantine/${sandboxId}/`) ||
        key.startsWith(`finished/${sandboxId}/`)
      ) {
        this.#objects.delete(key);
      }
    }
  }

  async get(key: string) {
    const object = this.#objects.get(key);
    return object ? new Uint8Array(object.value) : null;
  }

  async put(key: string, value: Uint8Array) {
    await this.sweepExpiredQuarantine();
    this.#objects.set(key, {
      storedAt: Date.now(),
      value: new Uint8Array(value),
    });
  }

  async sweepExpiredQuarantine(maxAgeMilliseconds = 10 * 60 * 1_000) {
    const cutoff = Date.now() - maxAgeMilliseconds;
    for (const [key, object] of this.#objects) {
      if (key.startsWith("quarantine/") && object.storedAt <= cutoff) {
        this.#objects.delete(key);
      }
    }
  }

  keys() {
    return [...this.#objects.keys()].toSorted();
  }
}

const sandboxIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const objectKeyPattern =
  /^(?:quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}|finished\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp))$/iu;

function isMissingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class FileRepairImageStorage implements RepairImageStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  #pathFor(key: string) {
    if (!objectKeyPattern.test(key)) {
      throw new Error("Invalid private repair image object key.");
    }
    const target = resolve(this.#root, key);
    if (!target.startsWith(`${this.#root}${sep}`)) {
      throw new Error("Private repair image object key escaped its root.");
    }
    return target;
  }

  async delete(key: string) {
    await rm(this.#pathFor(key), { force: true });
  }

  async deleteSandbox(sandboxId: string) {
    if (!sandboxIdPattern.test(sandboxId)) {
      throw new Error("Invalid sandbox id for private image cleanup.");
    }
    await Promise.all(
      ["quarantine", "finished"].map((kind) =>
        rm(join(this.#root, kind, sandboxId), {
          force: true,
          recursive: true,
        }),
      ),
    );
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.#pathFor(key)));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async put(key: string, value: Uint8Array) {
    await this.sweepExpiredQuarantine();
    const target = this.#pathFor(key);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(dirname(target), { mode: 0o700, recursive: true });
    try {
      await writeFile(temporary, value, { mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async sweepExpiredQuarantine(maxAgeMilliseconds = 10 * 60 * 1_000) {
    const quarantineRoot = join(this.#root, "quarantine");
    const cutoff = Date.now() - maxAgeMilliseconds;
    let sandboxes;
    try {
      sandboxes = await readdir(quarantineRoot, { withFileTypes: true });
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    await Promise.all(
      sandboxes
        .filter((entry) => entry.isDirectory())
        .map(async (sandbox) => {
          const directory = join(quarantineRoot, sandbox.name);
          const objects = await readdir(directory, { withFileTypes: true });
          await Promise.all(
            objects
              .filter((entry) => entry.isFile())
              .map(async (entry) => {
                const target = join(directory, entry.name);
                const metadata = await stat(target);
                if (metadata.mtimeMs <= cutoff) {
                  await rm(target, { force: true });
                }
              }),
          );
          const remaining = await readdir(directory);
          if (remaining.length === 0) {
            await rm(directory, { force: true, recursive: true });
          }
        }),
    );
  }
}
