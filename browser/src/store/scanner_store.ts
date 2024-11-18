import { message } from "antd";
import { val, derive, combine, ReadonlyVal, Val } from "value-enhancer";
import { fetchJson } from "../utils";


export type ScannerStore$ = {
  readonly sources: ReadonlyVal<SourceStore[]>;
  readonly addedSourceName: Val<string>;
  readonly addedSourcePath: Val<string>;
  readonly isAddedNameDuplicated: ReadonlyVal<boolean>;
  readonly canAdd: ReadonlyVal<boolean>;
};

class ScannerStore {
  public readonly $: ScannerStore$;

  readonly #sources$: Val<SourceStore[]>;
  readonly #addedSourceName$: Val<string>;
  readonly #addedSourcePath$: Val<string>;

  private constructor(sources: { name: string, path: string }[]) {
    this.#sources$ = val(sources.map(({ name, path }) => new SourceStore(name, path, this.#onRemoveSource)));
    this.#addedSourceName$ = val("");
    this.#addedSourcePath$ = val("");

    const isAddedNameDuplicated$ = derive(
      this.#addedSourceName$,
      (name) => this.#sources$.value.some((source) => source.name === name),
    );
    const canAdd$ = combine(
      [isAddedNameDuplicated$, this.#addedSourceName$, this.#addedSourcePath$],
      ([isAddedNameDuplicated, name, path]) => {
        if (isAddedNameDuplicated) {
          return false;
        }
        if (standardize(name) == "") {
          return false;
        }
        if (standardize(path) == "") {
          return false;
        }
        return true;
      },
    );
    this.$ = {
      sources: derive(this.#sources$),
      addedSourceName: this.#addedSourceName$,
      addedSourcePath: this.#addedSourcePath$,
      isAddedNameDuplicated: isAddedNameDuplicated$,
      canAdd: canAdd$,
    };
  }

  public static async load(): Promise<ScannerStore> {
    const sources = await fetchJson<{ name: string, path: string }[]>("/api/sources");
    return new ScannerStore(sources);
  }

  #onRemoveSource = (name: string): void => {
    this.#sources$.set(this.#sources$.value.filter((source) => source.name !== name));
  };

  public addSource(): void {
    const name = standardize(this.#addedSourceName$.value);
    const path = standardize(this.#addedSourcePath$.value);
    fetchJson("/api/sources", {
      method: "PUT",
      body: JSON.stringify({ name, path }),
    }).then(() => {
      this.#addedSourceName$.set("");
      this.#addedSourcePath$.set("");
      this.#sources$.set([
        ...this.#sources$.value,
        new SourceStore(name, path, this.#onRemoveSource),
      ]);
    }).catch((error) => {
      message.error(error.message);
    });
  }
}

type SourceStore$ = {
  readonly path: Val<string>;
  readonly modified: ReadonlyVal<boolean>;
  readonly isSubmitting: ReadonlyVal<boolean>;
};

class SourceStore {
  public readonly name: string;
  public readonly $: SourceStore$;

  readonly #path$: Val<string>;
  readonly #remotePath$: Val<string>;
  readonly #isSubmitting$: Val<boolean>;
  readonly #onRemoved: (name: string) => void

  public constructor(name: string, path: string, onRemoved: (name: string) => void) {
    this.name = name;
    this.#path$ = val(path);
    this.#remotePath$ = val(path);
    this.#isSubmitting$ = val(false);
    this.#onRemoved = onRemoved;
    this.$ = {
      path: this.#path$,
      isSubmitting: derive(this.#isSubmitting$),
      modified: combine(
        [this.#path$, this.#remotePath$],
        ([path, remotePath]) => path !== remotePath,
      ),
    };
  }

  public submitPath(): void {
    this.#isSubmitting$.set(true);
    const path = standardize(this.#path$.value);
    fetchJson("/api/sources", {
      method: "PUT",
      body: JSON.stringify({
        name: this.name,
        value: path,
      }),
    }).then(() => {
      this.#path$.set(path);
      this.#remotePath$.set(path);
    }).catch((error) => {
      message.error(error.message);
    }).finally(() => {
      this.#isSubmitting$.set(false);
    });
  }

  public remove(): void {
    const query = new URLSearchParams({
      name: this.name,
    });
    this.#isSubmitting$.set(true);
    fetchJson(
      `/api/sources?${query}`,
      {method: "DELETE"},
    ).then(() => {
      this.#onRemoved(this.name);
    }).catch((error) => {
      message.error(error.message);
    });
  }
}

function standardize(content: string): string {
  return content.replace(/[\s\n\r\x00-\x1F\x7F]+/g, "").trim();
}