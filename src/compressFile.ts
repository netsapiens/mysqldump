import * as fs from 'fs';
import * as zlib from 'zlib';

function compressFile(filename: string): Promise<void> {
    const tempFilename = `${filename}.temp`;

    fs.renameSync(filename, tempFilename);

    const deleteFile = (file: string): void => {
            setTimeout(function(){
            try {
                if(!fs.existsSync(file)) {
                    return;
                }
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);    
                }
              } catch (_err) {
                    if (_err.code !== 'ENOENT') throw _err;
                  /* istanbul ignore next */
              }
            },100); 
    };

    try {
        const read = fs.createReadStream(tempFilename);
        const zip = zlib.createGzip();
        const write = fs.createWriteStream(filename);
        read.pipe(zip).pipe(write);

        return new Promise((resolve, reject) => {
            write.on(
                'error',
                /* istanbul ignore next */ err => {
                    // close the write stream and propagate the error
                    write.end();
                    reject(err);
                },
            );
            write.on('finish', () => {
                resolve();
            });
        });
    } catch (err) /* istanbul ignore next */ {
        // in case of an error: remove the output file and propagate the error
        deleteFile(filename);
        throw err;
    } finally {
        // in any case: remove the temp file
        deleteFile(tempFilename);
    }
}

export { compressFile };
