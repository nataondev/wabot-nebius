declare module "bun:sqlite" {
  export class Database {
    constructor(filename?: string);
    exec(sql: string): void;
    prepare<T = any>(
      sql: string,
    ): {
      run: (...args: any[]) => any;
      get: (...args: any[]) => T;
      all: (...args: any[]) => T[];
    };
  }
}
