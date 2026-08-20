import * as fs from 'fs';
import * as mysql from 'mysql2';
import * as sqlformatter from 'sql-formatter';
import { all as merge } from 'deepmerge';

import { ConnectionOptions, DataDumpOptions } from './interfaces/Options';
import { Table } from './interfaces/Table';
import { typeCast } from './typeCast';

interface QueryRes {
    [k: string]: unknown;
}

function buildInsert(
    table: Table,
    values: Array<string>,
    format: (s: string) => string,
    insert: string,
): string {

    const sql = format(
        [
            `${insert} INTO \`${table.name}\` (\`${table.columnsOrdered.join(
                '`,`',
            )}\`)`,
            `VALUES ${values.join(',')};`,
        ].join(' '),
    );

    // sql-formatter lib doesn't support the X'aaff' or b'01010' literals, and it adds a space in and breaks them
    // this undoes the wrapping we did to get around the formatting
    return sql.replace(/NOFORMAT_WRAP\("##(.+?)##"\)/g, '$1');
}
function buildInsertValue(row: QueryRes, table: Table): string {
    return `(${table.columnsOrdered.map(c => row[c]).join(',')})`;
}

function executeSql(pool: mysql.Pool, sql: string): Promise<void> {
    return new Promise((resolve, reject) =>
        pool.query(sql, err =>
            err ? /* istanbul ignore next */ reject(err) : resolve(),
        ),
    );
}

// eslint-disable-next-line complexity
async function getDataDump(
    connectionOptions: ConnectionOptions,
    options: Required<DataDumpOptions>,
    tables: Array<Table>,
    dumpToFile: string | null,
): Promise<Array<Table>> {
    // ensure we have a non-zero max row option
    options.maxRowsPerInsertStatement = Math.max(
        options.maxRowsPerInsertStatement,
        0,
    );

    // clone the array
    tables = [...tables];

    // build the format function if requested
    const format = options.format
        ? (sql: string) => sqlformatter.format(sql)
        : (sql: string) => sql;

    // we open a new pool with a special typecast function for dumping data
    const conn_pool = mysql.createPool(
        merge([
            connectionOptions,
            {
                multipleStatements: true,
                typeCast: typeCast(tables),
            },
        ]),
    );


    const retTables: Array<Table> = [];
    let currentTableLines: Array<string> | null = null;

    // open the write stream (if configured to)
    const outFileStream = dumpToFile
        ? fs.createWriteStream(dumpToFile, {
              flags: 'a', // append to the file
              encoding: 'utf8',
          })
        : null;

    // Without an 'error' listener a failed write (ENOSPC, EIO, ...) emits an
    // unhandled 'error' event, which takes the whole host process down.
    // Capture them instead and surface the first one after teardown.
    const outFileStreamErrors: Array<Error> = [];
    if (outFileStream) {
        outFileStream.on('error', err => {
            outFileStreamErrors.push(err);
        });
    }

    function saveChunk(str: string | Array<string>, inArray = true): void {
        if (!Array.isArray(str)) {
            str = [str];
        }

        // write to file if configured
        if (outFileStream) {
            str.forEach(s => outFileStream.write(`${s}\n`));
        }

        // write to memory if configured
        if (inArray && currentTableLines) {
            currentTableLines.push(...str);
        }
    }

    try {
        if (options.lockTables) {
            // // see: https://dev.mysql.com/doc/refman/5.7/en/replication-solutions-backups-read-only.html
            await executeSql(conn_pool, 'FLUSH TABLES WITH READ LOCK');
            await executeSql(conn_pool, 'SET GLOBAL read_only = ON');
        }

        // to avoid having to load an entire DB's worth of data at once, we select from each table individually
        // note that we use async/await within this loop to only process one table at a time (to reduce memory footprint)
        while (tables.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const table = tables.shift()!;

            if (table.isView && !options.includeViewData) {
                // don't dump data for views
                retTables.push(
                    merge<Table>([
                        table,
                        {
                            data: null,
                        },
                    ]),
                );

                // eslint-disable-next-line no-continue
                continue;
            }

            currentTableLines = options.returnFromFunction ? [] : null;

            if (retTables.length > 0) {
                // add a newline before the next header to pad the dumps
                saveChunk('');
            }
            

            if (options.verbose) {
                // write the table header to the file

                const where = options.where[table.name]
                    ? ` WHERE ${options.where[table.name]}`
                    : '';
                    
                const header = [
                    '# ------------------------------------------------------------',
                    `# DATA DUMP FOR TABLE: ${table.name}${
                        options.lockTables ? ' (locked)' : ''}`,
                    `# ${where}`,
                    '# ------------------------------------------------------------',
                    '',
                ];
                saveChunk(header);
            }

            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve, reject) => {
                // send the query
                const where = options.where[table.name]
                    ? ` WHERE ${options.where[table.name]}`
                    : '';

                const insertFunc = options.insert
                    ? `${options.insert} `
                    : 'INSERT';

                const query = conn_pool.query(
                    `SELECT * FROM \`${table.name}\`${where}`,
                );
                let rowQueue: Array<string> = [];

                // stream the data to the file
                query.on('result', (row: QueryRes) => {
                    // build the values list
                    rowQueue.push(buildInsertValue(row, table));

                    // if we've got a full queue
                    if (rowQueue.length === options.maxRowsPerInsertStatement) {
                        // create and write a fresh statement
                        const insert = buildInsert(table, rowQueue, format, insertFunc);
                        saveChunk(insert);
                        rowQueue = [];
                    }
                });
                query.on('end', () => {
                    // write the remaining rows to disk
                    if (rowQueue.length > 0) {
                        const insert = buildInsert(table, rowQueue, format, insertFunc);
                        saveChunk(insert);
                        rowQueue = [];
                    }

                    resolve(true);
                });
                query.on(
                    'error',
                    /* istanbul ignore next */ err => {
                        console.log("mysqldump query error");
                        console.error(err);
                        reject(err)
                    },
                );
            });

            // update the table definition
            retTables.push(
                merge<Table>([
                    table,
                    {
                        data: currentTableLines
                            ? currentTableLines.join('\n')
                            : null,
                    },
                ]),
            );
        }

        saveChunk('');
    } finally {
        if (options.lockTables) {
            // see: https://dev.mysql.com/doc/refman/5.7/en/replication-solutions-backups-read-only.html
            await executeSql(conn_pool, 'SET GLOBAL read_only = OFF');
            await executeSql(conn_pool, 'UNLOCK TABLES');
        }

        conn_pool.end(); // close the connection pool

        // Tear the write stream down in here, not after the try/finally: a
        // fs.WriteStream holds its file descriptor until it is ended or
        // destroyed, so any throw above (most commonly a rejected
        // `query.on('error')`) used to strand one descriptor per failed dump
        // for the whole remaining lifetime of the host process.
        if (outFileStream) {
            // tidy up the file stream, making sure writes are 100% flushed before continuing
            await new Promise(resolve => {
                // `destroyed` is absent from the WriteStream typings pinned
                // here, but is present at runtime on every supported Node.
                // A stream that is already gone will never emit 'close' again,
                // and calling end() on it would throw, so bail out early.
                const alreadyGone =
                    ((outFileStream as unknown) as { destroyed?: boolean })
                        .destroyed === true;
                if (alreadyGone) {
                    resolve(true);
                    return;
                }
                // 'close' rather than 'finish' is what guarantees the descriptor
                // has been released. Destroy on error so a stream that can never
                // flush still reaches 'close' instead of hanging here forever.
                outFileStream.once('close', () => resolve(true));
                outFileStream.once('error', () => outFileStream.destroy());
                outFileStream.end();
            });
        }
    }

    // clean up our connections
   // await ((connection.end() as unknown) as Promise<void>);

    if (outFileStreamErrors.length > 0) {
        // The dump loop finished but the file we produced is incomplete. Fail
        // loudly rather than let a truncated dump be treated as a good backup.
        throw outFileStreamErrors[0];
    }

    return retTables;
}

export { getDataDump };
