import * as mysql from 'mysql2/promise';

const poolArr: Map<String,DB> = new Map<string, DB>();

class DB {
    private readonly pool: mysql.IPromisePool;

    // can only instantiate via DB.connect method
    private constructor(pool: mysql.IPromisePool) {
        //debugger;
        this.pool = pool;
    }

    public static async connect(options: mysql.IConnectionConfig): Promise<DB> {
        const database = options.database || "SiPbxDomain";
        if (poolArr.has(database)) {
            // @ts-ignore: checked right before.
            return poolArr.get(database); 
        }

        poolArr.set(database, new DB(mysql.createPool(options)));
        // @ts-ignore: checked right before.
        return poolArr.get(database); 
       
    }

    public async query<T>(sql: string): Promise<Array<T>> {
        const res = await this.pool.query<T>(sql);
        return res[0];
    }
    public async multiQuery<T>(sql: string): Promise<Array<Array<T>>> {
        let isMulti = true;
        if (sql.split(';').length === 2) {
            isMulti = false;
        }

        let res = (await this.pool.query<Array<T>>(sql))[0];
        if (!isMulti) {
            // mysql will return a non-array payload if there's only one statement in the query
            // so standardise the res..
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            res = [res] as any;
        }

        return res;
    }

    // public async end(): Promise<void> {
    //      await this.pool.end().catch(() => {});
    // }

    // public static async cleanup(): Promise<void> {
    //     await Promise.all(
    //         poolArr.map(async p => {
    //              await p.end();
    //         }),
    //     );
    // }
}

export { DB };
