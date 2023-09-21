import * as fs from 'fs';
import * as zlib from 'zlib';

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
        
        let had_error = false;
        const read = fs.createReadStream(tempFilename);
        read.on('error', (err) => {
            console.log('error ' + err);
            had_error = true;
        });
        
        await new Promise(r => setTimeout(r, 20));
            
        if (had_error) {
            return Promise.reject(`Error reading ${tempFilename}.`);
        }
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
        console.error("compressFile Error:" +err.code + ' ' + err.message);
        // in case of an error: remove the output file and propagate the error
        deleteFile(tempFilename);
        //throw err;
        return Promise.reject(err);
    } finally {
        // in any case: remove the temp file
        deleteFile(tempFilename);
        
    };
}

export { compressFile };
