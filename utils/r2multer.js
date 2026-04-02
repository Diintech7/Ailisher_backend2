const { uploadFileToS3 } = require('./r2');
const { v4: uuidv4 } = require('uuid');

class R2Storage {
  constructor(opts) {
    this.folder = opts.folder || 'misc';
  }

  async _handleFile(req, file, cb) {
    try {
      // Create a unique R2 key
      const extension = file.originalname.split('.').pop() || '';
      const uniqueFilename = `${uuidv4()}.${extension}`;
      const r2Key = `${this.folder}/${Date.now()}_${uniqueFilename}`;
      
      const chunks = [];
      file.stream.on('data', (chunk) => chunks.push(chunk));
      file.stream.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          // Upload file to R2
          await uploadFileToS3(buffer, r2Key, file.mimetype);
          
          // Return the properties identical to what CloudinaryStorage would return
          // Setting path and filename to the R2 key. 
          // Database will save this 'path' as the image URL, allowing R2 getter functions to work correctly.
          cb(null, {
            path: r2Key,
            filename: r2Key 
          });
        } catch (uploadError) {
          cb(uploadError);
        }
      });

      file.stream.on('error', (err) => {
        cb(err);
      });

    } catch (err) {
      cb(err);
    }
  }

  _removeFile(req, file, cb) {
    // Boilerplate fallback for Multer if an error happens mid-upload
    delete file.buffer;
    cb(null);
  }
}

module.exports = R2Storage;
