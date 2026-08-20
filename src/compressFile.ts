import * as fs from 'fs';
import * as zlib from 'zlib';
import { pipeline } from 'stream';

async function compressFile(filename: string): Promise<void> {
    const tempFilename = `${filename}.temp`;

    if (!fs.existsSync(filename)) {
        return Promise.reject(`File ${filename} does not exist.`);
    }
    try{
        fs.renameSync(filename, tempFilename);
    }
    catch(err){
        /* istanbul ignore next */
        return Promise.reject(err);
    }
    
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
                    /* istanbul ignore next */
                    console.log(_err.code);
              }
            },100); 
    };

    try {
        if (!fs.existsSync(tempFilename)) {
            return Promise.reject(`File ${tempFilename} does not exist.`);
        }
        
        const read = fs.createReadStream(tempFilename);
        const zip = zlib.createGzip();
        const write = fs.createWriteStream(filename);

        // `pipeline` destroys every stream in the chain as soon as any one of
        // them fails, which a chain of `.pipe()` calls does not do. Previously
        // only `write` had an error handler, so a read or gzip failure left all
        // three descriptors open AND never settled this promise - the caller
        // waited forever and the descriptors were never reclaimed.
        await new Promise((resolve, reject) => {
            pipeline(read, zip, write, err =>
                err ? reject(err) : resolve(true),
            );
        });

        return;
    } catch (err) /* istanbul ignore next */ {
        console.error(
            'compressFile Error: ' + (err && err.message ? err.message : err),
        );
        // propagate the error; the temp file is removed by the finally below
        return Promise.reject(err);
    } finally {
        // in any case: remove the temp file
        deleteFile(tempFilename);
        
    };
}

export { compressFile };
